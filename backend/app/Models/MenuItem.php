<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class MenuItem extends Model
{
    use HasFactory;

    protected $fillable = [
        'uuid',
        'stall_id',
        'category_id',
        'name',
        'description',
        'price',
        'is_veg',
        'is_available',
        'preparation_time_minutes',
        'image_url',
    ];

    protected $casts = [
        'price' => 'decimal:2',
        'is_veg' => 'boolean',
        'is_available' => 'boolean',
        'preparation_time_minutes' => 'integer',
    ];

    protected static function boot()
    {
        parent::boot();
        static::creating(function ($model) {
            if (empty($model->uuid)) {
                $model->uuid = (string) Str::uuid();
            }
        });
    }

    public function stall()
    {
        return $this->belongsTo(Stall::class);
    }

    public function category()
    {
        return $this->belongsTo(MenuCategory::class, 'category_id');
    }

    public function orderItems()
    {
        return $this->hasMany(OrderItem::class);
    }
}

