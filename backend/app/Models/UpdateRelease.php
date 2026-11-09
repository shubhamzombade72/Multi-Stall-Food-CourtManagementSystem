<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class UpdateRelease extends Model
{
    protected $fillable = ['version', 'channel', 'status', 'notes', 'min_supported_version', 'required', 'app_compatibility', 'database_compatibility', 'release_date', 'published_at', 'unpublished_at', 'created_by_user_id'];

    protected function casts(): array
    {
        return ['notes' => 'array', 'required' => 'boolean', 'app_compatibility' => 'array', 'database_compatibility' => 'array', 'release_date' => 'datetime', 'published_at' => 'datetime', 'unpublished_at' => 'datetime'];
    }

    public const CREATED = 'RELEASE_CREATED';
    public const PUBLISHED = 'RELEASE_PUBLISHED';

    public function packages(): HasMany
    {
        return $this->hasMany(UpdatePackage::class, 'release_id');
    }

    public function isPublished(): bool
    {
        return $this->status === self::PUBLISHED;
    }
}
