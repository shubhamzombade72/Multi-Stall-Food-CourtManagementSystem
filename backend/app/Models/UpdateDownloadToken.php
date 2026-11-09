<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class UpdateDownloadToken extends Model
{
    protected $fillable = ['token_hash', 'target_id', 'package_id', 'client_id', 'expires_at', 'first_used_at'];

    protected function casts(): array
    {
        return ['expires_at' => 'datetime', 'first_used_at' => 'datetime'];
    }

    public function package(): BelongsTo
    {
        return $this->belongsTo(UpdatePackage::class, 'package_id');
    }

    public function target(): BelongsTo
    {
        return $this->belongsTo(UpdateDeploymentTarget::class, 'target_id');
    }
}
