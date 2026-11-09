<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class StorePurchaseOrder extends Model
{
    // order_date has no date cast on purpose: it stays YYYY-MM-DD on both PostgreSQL and SQLite
    protected $fillable = [
        'purchase_number', 'store_supplier_id', 'created_by_user_id', 'order_date', 'total_amount',
        'status', 'notes', 'received_at', 'cancelled_at', 'cancel_reason',
    ];

    protected $casts = [
        'total_amount' => 'decimal:2',
        'received_at' => 'datetime',
        'cancelled_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $order) {
            if (empty($order->purchase_number)) {
                $order->purchase_number = 'SPO-' . now(StoreMovement::BUSINESS_TIMEZONE)->format('Ymd') . '-' . strtoupper(Str::random(5));
            }
        });
    }

    public function supplier()
    {
        return $this->belongsTo(StoreSupplier::class, 'store_supplier_id');
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }

    public function items()
    {
        return $this->hasMany(StorePurchaseOrderItem::class);
    }
}
