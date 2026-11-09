<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class UpdateClient extends Model
{
    protected $fillable = ['device_id', 'name', 'customer_label', 'token_hash', 'machine_fingerprint', 'status', 'channel', 'mode', 'reported_app_version', 'reported_schema_fingerprint', 'verified_app_version', 'verified_schema_fingerprint', 'last_health', 'last_check_at', 'last_success_at', 'last_failure_at'];

    protected function casts(): array
    {
        return ['last_health' => 'array', 'last_check_at' => 'datetime', 'last_success_at' => 'datetime', 'last_failure_at' => 'datetime'];
    }

    protected $hidden = ['token_hash'];

    public static function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }

    public function targets(): HasMany
    {
        return $this->hasMany(UpdateDeploymentTarget::class, 'client_id');
    }
}
