<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class Payment extends Model
{
    use HasFactory;

    protected $fillable = [
        'uuid',
        'payment_number',
        'order_id',
        'order_split_id',
        'cashier_id',
        'payment_method',
        'amount',
        'cash_tendered',
        'change_returned',
        'transaction_reference',
        'status',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'cash_tendered' => 'decimal:2',
        'change_returned' => 'decimal:2',
    ];

    protected static function boot()
    {
        parent::boot();
        static::creating(function ($model) {
            if (empty($model->uuid)) {
                $model->uuid = (string) Str::uuid();
            }
            if (empty($model->payment_number)) {
                $model->payment_number = 'PAY-' . date('Ymd') . '-' . strtoupper(Str::random(5));
            }
        });

        static::deleting(function ($model) {
            if ($model->status === 'success' || $model->allocations()->exists()) {
                throw new \RuntimeException("Financial integrity violation: Cannot delete a successful payment transaction (Payment #{$model->payment_number}, ID: {$model->id}). Payments must be preserved for audit.");
            }
        });
    }

    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    public function orderSplit()
    {
        return $this->belongsTo(OrderSplit::class, 'order_split_id');
    }

    public function allocations()
    {
        return $this->hasMany(PaymentAllocation::class);
    }

    public function cashier()
    {
        return $this->belongsTo(User::class, 'cashier_id');
    }
}
