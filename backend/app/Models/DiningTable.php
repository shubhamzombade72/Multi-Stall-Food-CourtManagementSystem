<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class DiningTable extends Model
{
    use HasFactory;

    protected $fillable = [
        'table_number',
        'capacity',
        'section',
        'qr_token',
        'status',
        'is_active',
    ];

    // The QR token is the table's ordering secret; only the owner may see it (via makeVisible)
    protected $hidden = [
        'qr_token',
    ];

    protected $casts = [
        'capacity' => 'integer',
        'is_active' => 'boolean',
    ];

    protected static function boot()
    {
        parent::boot();
        static::creating(function ($model) {
            if (empty($model->qr_token)) {
                $model->qr_token = 'TBL-' . strtoupper(Str::random(12));
            }
        });
    }

    public function orders()
    {
        return $this->hasMany(Order::class, 'table_id');
    }
}

