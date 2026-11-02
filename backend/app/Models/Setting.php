<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Setting extends Model
{
    protected $fillable = [
        'key',
        'value',
        'updated_by_user_id',
    ];

    protected $casts = [
        'value' => 'array',
    ];

    /** Value stored under $key, or $default when the owner has not saved it yet. */
    public static function getValue(string $key, mixed $default = null): mixed
    {
        $row = static::where('key', $key)->first();

        return $row ? $row->value : $default;
    }
}
