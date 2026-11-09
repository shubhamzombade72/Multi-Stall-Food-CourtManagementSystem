<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class UpdateEvent extends Model
{
    protected $fillable = ['client_id', 'target_id', 'release_id', 'category', 'status', 'is_error', 'message', 'details', 'client_time'];

    protected function casts(): array
    {
        return ['is_error' => 'boolean', 'details' => 'array', 'client_time' => 'datetime'];
    }
}
