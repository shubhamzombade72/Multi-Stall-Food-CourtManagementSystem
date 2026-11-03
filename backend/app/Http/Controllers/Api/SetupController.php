<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\AuditService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rules\Password;

/**
 * First-run setup for the desktop app's built-in server (see config/foodcourt.php). Available only in
 * embedded mode and only while no user exists, so it can never be used to add an owner to a live system.
 */
class SetupController extends Controller
{
    public function status()
    {
        abort_unless(config('foodcourt.embedded'), 404);

        return response()->json([
            'success' => true,
            'data' => ['needs_setup' => !User::query()->exists()],
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

        $user = DB::transaction(function () use ($validated) {
            if (User::query()->exists()) {
                return null;
            }

            return User::create([
                'name' => $validated['name'],
                'email' => $validated['email'],
                'password' => $validated['password'],
                'role' => 'owner',
                'is_active' => true,
            ]);
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
            ],
        ], 201);
    }
}
