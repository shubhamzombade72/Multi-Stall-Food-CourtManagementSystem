<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\AuditService;
use App\Services\SetupState;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

/**
 * First-run setup for the desktop app's built-in server (see config/foodcourt.php). Available only in
 * embedded mode and only while setup has never been completed, so it can never be used to add an owner to
 * a live system or to quietly re-create a deleted one (that needs the recovery key).
 */
class SetupController extends Controller
{
    public function status()
    {
        abort_unless(config('foodcourt.embedded'), 404);

        return response()->json([
            'success' => true,
            'data' => [
                'needs_setup' => SetupState::needsSetup(),
                'recovery_required' => SetupState::recoveryRequired(),
            ],
        ]);
    }

    public function createOwner(Request $request)
    {
        abort_unless(config('foodcourt.embedded'), 404);

        $validated = $request->validate([
            'name' => 'required|string|max:100',
            'email' => 'required|email|max:150',
            'password' => ['required', 'string', Password::min(8)->letters()->numbers()],
        ]);

        $recoveryKey = null;
        $user = DB::transaction(function () use ($validated, &$recoveryKey) {
            if (!SetupState::needsSetup()) {
                return null;
            }

            $created = User::create([
                'name' => $validated['name'],
                'email' => $validated['email'],
                'password' => $validated['password'],
                'role' => 'owner',
                'is_active' => true,
            ]);
            $recoveryKey = SetupState::issueRecoveryKey($created->id);

            return $created;
        });

        if (!$user) {
            return response()->json(['success' => false, 'message' => 'Setup has already been completed.'], 409);
        }

        AuditService::log('owner_setup', 'User', $user->id, null, null, null, $user->id);
        $token = $user->createToken('auth-token', [$user->role])->plainTextToken;

        return response()->json([
            'success' => true,
            'message' => 'Owner account created',
            'data' => [
                'token' => $token,
                'user' => [
                    'id' => $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'role' => $user->role,
                    'phone' => $user->phone,
                    'stall_id' => null,
                    'stall' => null,
                ],
                'recovery_key' => $recoveryKey,
            ],
        ], 201);
    }

    /**
     * Forgotten owner password (or deleted owner): the one-time recovery key shown at setup restores access.
     * The key is rotated on use. Built-in server only; throttled at the route.
     */
    public function recover(Request $request)
    {
        abort_unless(config('foodcourt.embedded'), 404);

        $validated = $request->validate([
            'email' => 'required|email|max:150',
            'recovery_key' => 'required|string|max:60',
            'password' => ['required', 'string', Password::min(8)->letters()->numbers()],
            'name' => 'nullable|string|max:100',
        ]);

        if (!SetupState::recoveryKeyMatches($validated['recovery_key'])) {
            AuditService::log('owner_recovery_failed', 'User', '-');
            throw ValidationException::withMessages(['recovery_key' => ['The recovery key is not valid.']]);
        }

        $email = mb_strtolower(trim($validated['email']));
        $existing = User::query()->whereRaw('lower(email) = ?', [$email])->first();
        $ownerExists = User::query()->where('role', 'owner')->exists();

        if ($existing && $existing->role === 'owner') {
            $existing->password = $validated['password'];
            $existing->is_active = true;
            $existing->save();
            $existing->tokens()->delete();
            $user = $existing;
        } elseif (!$existing && !$ownerExists) {
            if (empty($validated['name'])) {
                throw ValidationException::withMessages(['name' => ["Enter the owner's name to restore the owner account."]]);
            }
            $user = User::create(['name' => $validated['name'], 'email' => $email, 'password' => $validated['password'], 'role' => 'owner', 'is_active' => true]);
        } else {
            throw ValidationException::withMessages(['email' => ['That email is not the owner account for this system.']]);
        }

        $newKey = SetupState::issueRecoveryKey($user->id);
        AuditService::log('owner_password_recovered', 'User', $user->id, null, null, null, $user->id);

        return response()->json(['success' => true, 'message' => 'Owner access restored. Sign in with the new password.', 'data' => ['recovery_key' => $newKey]]);
    }

    /** A signed-in owner replaces the recovery key (needed on installs created before keys existed). */
    public function issueRecoveryKey(Request $request)
    {
        abort_unless(config('foodcourt.embedded'), 404);
        $user = $request->user();
        if (!$user->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Owner access required.'], 403);
        }
        $request->validate(['password' => 'required|string']);
        if (!Hash::check($request->input('password'), $user->password)) {
            throw ValidationException::withMessages(['password' => ['That password is not correct.']]);
        }

        $key = SetupState::issueRecoveryKey($user->id);
        AuditService::log('recovery_key_issued', 'User', $user->id, null, null, null, $user->id);

        return response()->json(['success' => true, 'data' => ['recovery_key' => $key]]);
    }
}
