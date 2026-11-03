<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PairedDevice extends Model
{
    protected $fillable = ['name', 'token_hash', 'paired_by_user_id', 'last_seen_at', 'revoked_at'];

    protected function casts(): array
    {
        return ['last_seen_at' => 'datetime', 'revoked_at' => 'datetime'];
    }

    public static function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }

    /** The active (not revoked) device that owns $token, if any. */
    public static function findActive(?string $token): ?self
    {
        if ($token === null || $token === '') {
            return null;
        }

        return static::query()->where('token_hash', self::hashToken($token))->whereNull('revoked_at')->first();
    }
}
