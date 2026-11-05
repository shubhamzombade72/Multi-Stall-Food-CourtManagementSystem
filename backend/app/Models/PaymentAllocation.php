<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class PaymentAllocation extends Model
{
    use HasFactory;

    protected $fillable = [
        'payment_id',
        'order_id',
        'order_split_id',
        'amount',
        'allocated_by_user_id',
        'notes',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
    ];

    public static bool $allowAdministrativeReallocation = false;

    protected static function boot()
    {
        parent::boot();
        static::deleting(function ($model) {
            if (!static::$allowAdministrativeReallocation) {
                throw new \RuntimeException("Financial integrity violation: Payment allocation records are immutable ledger entries and cannot be hard-deleted (Allocation ID: {$model->id}).");
            }
        });
    }

    public function payment()
    {
        return $this->belongsTo(Payment::class);
    }

    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    public function orderSplit()
    {
        return $this->belongsTo(OrderSplit::class, 'order_split_id');
    }

    public function allocatedBy()
    {
        return $this->belongsTo(User::class, 'allocated_by_user_id');
    }
}

