<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class InventoryItem extends Model
{
    use HasFactory;

    protected $fillable = [
        'stall_id',
        'name',
        'unit',
        'current_stock',
        'minimum_alert_stock',
        'unit_cost',
    ];

    protected $casts = [
        'current_stock' => 'decimal:3',
        'minimum_alert_stock' => 'decimal:3',
        'unit_cost' => 'decimal:2',
    ];

    public function stall()
    {
        return $this->belongsTo(Stall::class);
    }

    public function stockMovements()
    {
        return $this->hasMany(StockMovement::class);
    }
}

