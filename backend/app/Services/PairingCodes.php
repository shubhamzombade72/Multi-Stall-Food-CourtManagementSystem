<?php

namespace App\Services;

use App\Models\Setting;
use Illuminate\Support\Facades\Hash;

/** One-time connection codes for pairing a terminal with this shared host. */
class PairingCodes
{
    public const VALID_MINUTES = 15;

    private const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    /**
     * Creates a code (replacing any earlier unused one) and the opaque string a terminal pastes in.
     * Only a hash of the code is stored.
     */
    public static function issue(?int $userId, string $apiUrl): array
    {
        $chars = '';
        for ($i = 0; $i < 8; $i++) {
            $chars .= self::ALPHABET[random_int(0, 31)];
        }
        $code = substr($chars, 0, 4) . '-' . substr($chars, 4);
        $expires = now()->addMinutes(self::VALID_MINUTES);
        Setting::updateOrCreate(['key' => 'pairing_code'], [
            'value' => ['hash' => Hash::make($code), 'expires_at' => $expires->toIso8601String()],
            'updated_by_user_id' => $userId,
        ]);
        AuditService::log('pairing_code_issued', 'Setting', 'pairing_code', null, null, null, $userId);

        $payload = rtrim(strtr(base64_encode(json_encode(['u' => $apiUrl, 'c' => $code])), '+/', '-_'), '=');

        return ['code' => $code, 'pairing_string' => 'FCPAIR1.' . $payload, 'expires_at' => $expires->toIso8601String()];
    }
}
