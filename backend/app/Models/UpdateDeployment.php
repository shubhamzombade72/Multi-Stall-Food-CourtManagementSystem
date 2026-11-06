<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class UpdateDeployment extends Model
{
    protected $fillable = ['release_id', 'scope', 'excluded_client_ids', 'status', 'note', 'created_by_user_id'];

    protected function casts(): array
    {
        return ['excluded_client_ids' => 'array'];
    }

    public function release(): BelongsTo
    {
        return $this->belongsTo(UpdateRelease::class, 'release_id');
    }

    public function targets(): HasMany
    {
        return $this->hasMany(UpdateDeploymentTarget::class, 'deployment_id');
    }
}
