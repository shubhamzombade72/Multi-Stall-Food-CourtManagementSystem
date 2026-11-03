<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PairedDevice;
use App\Models\Setting;
use App\Services\AuditService;
use App\Services\PairingCodes;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Connects another computer (counter, kitchen, waiter) to this shared host without anyone typing an address:
 * the owner creates a short-lived one-time code, the other computer redeems it and receives a device token.
 * Only on a shared server; a PC's built-in server has no pairing.
 */
class PairingController extends Controller
{
    public function createCode(Request $request)
    {
        $this->sharedHostOnly();
        if (!$request->user()->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Owner access required.'], 403);
        }

        $url = config('foodcourt.public_url') ?: rtrim($request->getSchemeAndHttpHost(), '/') . '/api';

        return response()->json(['success' => true, 'data' => PairingCodes::issue($request->user()->id, $url)], 201);
    }

    public function redeem(Request $request)
    {
        $this->sharedHostOnly();
        $validated = $request->validate(['code' => 'required|string|max:20', 'device_name' => 'required|string|max:100']);

        $stored = Setting::getValue('pairing_code');
        $code = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $validated['code']));
        $code = substr($code, 0, 4) . '-' . substr($code, 4);
        $valid = is_array($stored)
            && !empty($stored['hash'])
            && now()->lt(\Illuminate\Support\Carbon::parse($stored['expires_at'] ?? '2000-01-01'))
            && Hash::check($code, $stored['hash']);
        if (!$valid) {
            AuditService::log('pairing_failed', 'Setting', 'pairing_code');
            throw ValidationException::withMessages(['code' => ['That connection code is not valid or has expired. Ask the owner for a new one.']]);
        }
        Setting::where('key', 'pairing_code')->delete(); // single use

        $token = Str::random(48);
        $device = PairedDevice::create(['name' => $validated['device_name'], 'token_hash' => PairedDevice::hashToken($token)]);
        AuditService::log('device_paired', 'PairedDevice', $device->id, null, null, ['name' => $device->name]);

        return response()->json(['success' => true, 'data' => [
            'device_id' => $device->id,
            'device_token' => $token,
            'food_court_name' => SettingsController::current('business_profile')['name'] ?? 'Food Court',
        ]]);
    }

    public function devices(Request $request)
    {
        $this->sharedHostOnly();
        if (!$request->user()->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Owner access required.'], 403);
        }

        return response()->json(['success' => true, 'data' => PairedDevice::query()->orderByDesc('id')->get(['id', 'name', 'last_seen_at', 'revoked_at', 'created_at'])]);
    }

    public function revoke(Request $request, $id)
    {
        $this->sharedHostOnly();
        if (!$request->user()->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Owner access required.'], 403);
        }

        $device = PairedDevice::findOrFail($id);
        $device->forceFill(['revoked_at' => now()])->save();
        AuditService::log('device_revoked', 'PairedDevice', $device->id, null, null, ['name' => $device->name]);

        return response()->json(['success' => true, 'message' => 'Computer disconnected']);
    }

    private function sharedHostOnly(): void
    {
        abort_if(config('foodcourt.embedded'), 404);
    }
}
