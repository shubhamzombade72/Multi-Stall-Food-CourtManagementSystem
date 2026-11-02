<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\AuditService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function login(Request $request)
    {
        $validated = $request->validate([
            'email' => 'required|email',
            'password' => 'required|string',
        ]);

        $user = User::with('stall')->where('email', $validated['email'])->first();

        if (!$user || !Hash::check($validated['password'], $user->password)) {
            // Login history: failed attempts are kept (the password never is)
            AuditService::log('login_failed', 'User', $user?->id ?? '-', $user?->stall_id, null, [
                'email' => mb_substr($validated['email'], 0, 100),
                'reason' => $user ? 'wrong_password' : 'unknown_email',
            ], $user?->id);
            throw ValidationException::withMessages([
                'email' => ['The provided credentials do not match our records.'],
            ]);
        }

        if (!$user->is_active) {
            AuditService::log('login_blocked_inactive', 'User', $user->id, $user->stall_id, null, null, $user->id);
            return response()->json([
                'success' => false,
                'message' => 'Your account has been deactivated. Please contact the administrator.',
            ], 403);
        }

        // Revoke prior tokens on fresh login
        $user->tokens()->delete();

        $token = $user->createToken('auth-token', [$user->role])->plainTextToken;
        AuditService::log('login_success', 'User', $user->id, $user->stall_id, null, [
            'user_agent' => mb_substr((string) $request->userAgent(), 0, 200),
        ], $user->id);

        return response()->json([
            'success' => true,
            'message' => 'Login successful',
            'data' => [
                'token' => $token,
                'user' => [
                    'id' => $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'role' => $user->role,
                    'phone' => $user->phone,
                    'stall_id' => $user->stall_id,
                    'stall' => $user->stall ? [
                        'id' => $user->stall->id,
                        'name' => $user->stall->name,
                        'code' => $user->stall->code,
                    ] : null,
                ]
            ]
        ]);
    }

    public function me(Request $request)
    {
        $user = $request->user()->load('stall');
        return response()->json([
            'success' => true,
            'data' => [
                'user' => [
                    'id' => $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'role' => $user->role,
                    'phone' => $user->phone,
                    'stall_id' => $user->stall_id,
                    'stall' => $user->stall ? [
                        'id' => $user->stall->id,
                        'name' => $user->stall->name,
                        'code' => $user->stall->code,
                    ] : null,
                ]
            ]
        ]);
    }

    public function logout(Request $request)
    {
        $request->user()->currentAccessToken()->delete();
        AuditService::log('logout', 'User', $request->user()->id, $request->user()->stall_id, null, null, $request->user()->id);

        return response()->json([
            'success' => true,
            'message' => 'Logged out successfully',
        ]);
    }
}

