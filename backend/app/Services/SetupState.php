<?php

namespace App\Services;

use App\Models\Setting;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

/**
 * Records, once, that the first owner has been set up. After that the first-run screen can never come back,
 * even if every account is later deleted: a missing owner is restored only with the recovery key, never
 * silently. The marker also keeps the hash of the owner's recovery key (the key itself is shown once).
 */
class SetupState
{
    public const KEY = 'system_setup';

    private const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    public static function marker(): ?array
    {
        $value = Setting::getValue(self::KEY);

        return is_array($value) && !empty($value['completed_at']) ? $value : null;
    }

    /** An installation that already has accounts (created before this marker existed) counts as set up. */
    public static function backfillIfNeeded(): void
    {
        if (self::marker() === null && User::query()->exists()) {
            Setting::updateOrCreate(['key' => self::KEY], ['value' => ['completed_at' => now()->toIso8601String(), 'recovery_key_hash' => null]]);
        }
    }

    public static function needsSetup(): bool
    {
        self::backfillIfNeeded();

        return !User::query()->exists() && self::marker() === null;
    }

    public static function recoveryRequired(): bool
    {
        return self::marker() !== null && !User::query()->exists();
    }

    /** 'needed' | 'recovery_required' | 'complete' */
    public static function state(): string
    {
        if (self::needsSetup()) {
            return 'needed';
        }

        return self::recoveryRequired() ? 'recovery_required' : 'complete';
    }

    /** Stores a fresh recovery key (replacing any earlier one) and returns it for one-time display. */
    public static function issueRecoveryKey(?int $userId = null): string
    {
        $key = self::generateKey();
        $existing = self::marker();
        Setting::updateOrCreate(['key' => self::KEY], [
            'value' => [
                'completed_at' => $existing['completed_at'] ?? now()->toIso8601String(),
                'recovery_key_hash' => Hash::make($key),
            ],
            'updated_by_user_id' => $userId,
        ]);

        return $key;
    }

    public static function recoveryKeyMatches(string $input): bool
    {
        $hash = self::marker()['recovery_key_hash'] ?? null;
        // Always spend the same hashing time, so a missing key is not distinguishable by response time
        $ok = Hash::check(self::canonical($input), $hash ?: Hash::make('0'));

        return !empty($hash) && $ok;
    }

    /** "abcd efgh..." / "ABCD-EFGH-..." -> "ABCD-EFGH-IJKL-MNOP-QRST" */
    public static function canonical(string $key): string
    {
        $clean = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $key));

        return implode('-', str_split($clean, 4));
    }

    private static function generateKey(): string
    {
        $chars = '';
        for ($i = 0; $i < 20; $i++) {
            $chars .= self::ALPHABET[random_int(0, 31)];
        }

        return implode('-', str_split($chars, 4));
    }
}
