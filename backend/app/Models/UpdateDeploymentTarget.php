<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class UpdateDeploymentTarget extends Model
{
    protected $fillable = ['deployment_id', 'client_id', 'release_id', 'package_id', 'status', 'decision', 'proof_nonce', 'last_error', 'approved_at', 'download_started_at', 'completed_at'];

    protected function casts(): array
    {
        return ['approved_at' => 'datetime', 'download_started_at' => 'datetime', 'completed_at' => 'datetime'];
    }

    protected $hidden = ['proof_nonce'];

    public function deployment(): BelongsTo
    {
        return $this->belongsTo(UpdateDeployment::class, 'deployment_id');
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(UpdateClient::class, 'client_id');
    }

    public function release(): BelongsTo
    {
        return $this->belongsTo(UpdateRelease::class, 'release_id');
    }

    public function package(): BelongsTo
    {
        return $this->belongsTo(UpdatePackage::class, 'package_id');
    }
}
