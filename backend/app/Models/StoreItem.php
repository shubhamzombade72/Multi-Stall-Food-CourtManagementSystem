<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class StoreItem extends Model
{
    public const UNITS = ['kg', 'g', 'l', 'ml', 'pcs', 'packet'];

    protected $fillable = ['name', 'unit', 'current_stock', 'minimum_alert_stock', 'unit_cost', 'is_active'];

    protected $casts = [
        'current_stock' => 'decimal:3',
        'minimum_alert_stock' => 'decimal:3',
        'unit_cost' => 'decimal:2',
        'is_active' => 'boolean',
    ];

    public function movements()
    {
        return $this->hasMany(StoreMovement::class);
    }
}
