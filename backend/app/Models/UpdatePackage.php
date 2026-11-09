<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class UpdatePackage extends Model
{
    protected $fillable = ['release_id', 'package_type', 'source_version', 'manifest_raw', 'manifest_sha256', 'signature', 'signing_key_id', 'package_sha256', 'package_size', 'storage_name', 'uploaded_at'];

    protected function casts(): array
    {
        return ['uploaded_at' => 'datetime', 'package_size' => 'integer'];
    }

    public function release(): BelongsTo
    {
        return $this->belongsTo(UpdateRelease::class, 'release_id');
    }

    public function manifest(): array
    {
        return json_decode($this->manifest_raw, true) ?: [];
    }
}
