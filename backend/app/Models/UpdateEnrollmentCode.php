<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class UpdateEnrollmentCode extends Model
{
    protected $fillable = ['code_hash', 'customer_label', 'channel', 'expires_at', 'used_at', 'client_id', 'created_by_user_id'];

    protected function casts(): array
    {
        return ['expires_at' => 'datetime', 'used_at' => 'datetime'];
    }
}
