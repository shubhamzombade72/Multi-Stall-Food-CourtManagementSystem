<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\AuditService;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Owner-only staff management: create staff, assign role and stall, activate/deactivate, reset password.
 * Deactivation and password resets revoke the user's existing API tokens immediately.
 */
class StaffController extends Controller
{
    public const ROLES = ['owner', 'cashier', 'stall_manager', 'kitchen_staff', 'waiter', 'store_staff'];

    /** Roles whose work is confined to one stall and therefore need a stall assignment */
    public const STALL_ROLES = ['stall_manager', 'kitchen_staff', 'store_staff'];

    private function denyUnlessOwner(Request $request)
    {
        if (!$request->user()->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Owner access required.'], 403);
        }
        return null;
    }

    private function present(User $u): array
    {
        return [
            'id' => $u->id,
            'name' => $u->name,
            'email' => $u->email,
            'role' => $u->role,
            'phone' => $u->phone,
            'stall_id' => $u->stall_id,
            'stall' => $u->stall ? ['id' => $u->stall->id, 'name' => $u->stall->name, 'code' => $u->stall->code] : null,
            'is_active' => (bool) $u->is_active,
            'created_at' => $u->created_at,
        ];
    }

    public function index(Request $request)
    {
        if ($denied = $this->denyUnlessOwner($request)) {
            return $denied;
        }

        $query = User::with('stall:id,name,code')->orderBy('role')->orderBy('name');
        if ($request->filled('role')) {
            $query->where('role', $request->query('role'));
        }
        if ($request->filled('stall_id')) {
            $query->where('stall_id', $request->query('stall_id'));
        }

        return response()->json([
            'success' => true,
            'data' => $query->get()->map(fn (User $u) => $this->present($u)),
        ]);
    }

    public function store(Request $request)
    {
        if ($denied = $this->denyUnlessOwner($request)) {
            return $denied;
        }

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => ['required', 'email', 'max:255', function ($attribute, $value, $fail) {
                if (User::query()->whereRaw('lower(email) = ?', [mb_strtolower(trim($value))])->exists()) {
                    $fail('The email has already been taken.');
                }
            }],
            'password' => 'required|string|min:8|max:100',
            'role' => ['required', Rule::in(self::ROLES)],
            'stall_id' => 'nullable|exists:stalls,id',
            'phone' => 'nullable|string|max:20',
        ]);
        if ($error = $this->stallRuleError($validated['role'], $validated['stall_id'] ?? null)) {
            return $error;
        }

        $user = User::create($validated + ['is_active' => true]);
        AuditService::log('staff_created', 'User', $user->id, $user->stall_id, null, [
            'email' => $user->email, 'role' => $user->role, 'stall_id' => $user->stall_id,
        ]);

        return response()->json(['success' => true, 'message' => 'Staff account created', 'data' => $this->present($user->load('stall'))], 201);
    }

    public function update(Request $request, $id)
    {
        if ($denied = $this->denyUnlessOwner($request)) {
            return $denied;
        }

        $staff = User::findOrFail($id);
        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'role' => ['sometimes', 'required', Rule::in(self::ROLES)],
            'stall_id' => 'sometimes|nullable|exists:stalls,id',
            'phone' => 'sometimes|nullable|string|max:20',
            'is_active' => 'sometimes|boolean',
        ]);

        // The owner must not be able to lock themselves out of the system
        if ($staff->id === $request->user()->id
            && ((array_key_exists('is_active', $validated) && !$validated['is_active'])
                || (isset($validated['role']) && $validated['role'] !== 'owner'))) {
            return response()->json(['success' => false, 'message' => 'You cannot deactivate or demote your own owner account.'], 422);
        }

        $role = $validated['role'] ?? $staff->role;
        $stallId = array_key_exists('stall_id', $validated) ? $validated['stall_id'] : $staff->stall_id;
        if ($error = $this->stallRuleError($role, $stallId)) {
            return $error;
        }

        $old = $staff->only(['name', 'role', 'stall_id', 'phone', 'is_active']);
        $staff->update($validated);

        if (array_key_exists('is_active', $validated) && !$validated['is_active']) {
            $staff->tokens()->delete(); // deactivation takes effect immediately on every device
        }

        AuditService::log('staff_updated', 'User', $staff->id, $staff->stall_id, $old, $staff->only(array_keys($old)));

        return response()->json(['success' => true, 'message' => 'Staff account updated', 'data' => $this->present($staff->fresh('stall'))]);
    }

    public function resetPassword(Request $request, $id)
    {
        if ($denied = $this->denyUnlessOwner($request)) {
            return $denied;
        }

        $staff = User::findOrFail($id);
        $validated = $request->validate([
            'password' => 'required|string|min:8|max:100|confirmed',
        ]);

        $staff->update(['password' => $validated['password']]); // hashed by the model cast
        $staff->tokens()->delete();
        AuditService::log('staff_password_reset', 'User', $staff->id, $staff->stall_id);

        return response()->json(['success' => true, 'message' => 'Password reset. The user must sign in again on every device.']);
    }

    private function stallRuleError(string $role, $stallId)
    {
        if (in_array($role, self::STALL_ROLES, true) && empty($stallId)) {
            return response()->json(['success' => false, 'message' => "The {$role} role requires a stall assignment."], 422);
        }
        return null;
    }
}
