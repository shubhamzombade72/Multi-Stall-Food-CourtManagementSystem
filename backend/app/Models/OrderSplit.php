<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class OrderSplit extends Model
{
    use HasFactory;

    protected $fillable = [
        'order_id',
        'split_number',
        'split_code',
        'split_type',
        'subtotal',
        'tax_amount',
        'discount_amount',
        'total_amount',
        'paid_amount',
        'payment_status',
        'notes',
    ];

    protected $casts = [
        'split_number' => 'integer',
        'subtotal' => 'decimal:2',
        'tax_amount' => 'decimal:2',
        'discount_amount' => 'decimal:2',
        'total_amount' => 'decimal:2',
        'paid_amount' => 'decimal:2',
    ];

    protected $appends = [
        'remaining_balance',
    ];

    protected static function boot()
    {
        parent::boot();
        static::deleting(function ($model) {
            if ($model->payment_status === 'paid' || bccomp((string) $model->paid_amount, '0.00', 2) > 0 || $model->allocations()->exists()) {
                throw new \RuntimeException("Financial integrity violation: Cannot delete split bill {$model->split_code} (ID: {$model->id}) because it has payment history or financial allocations.");
            }
        });
    }

    public function getRemainingBalanceAttribute(): string
    {
        return $this->remainingBalance();
    }

    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    public function items()
    {
        return $this->hasMany(OrderSplitItem::class);
    }

    public function payment()
    {
        return $this->hasOne(Payment::class, 'order_split_id')->latestOfMany();
    }

    public function payments()
    {
        return $this->hasMany(Payment::class, 'order_split_id');
    }

    public function allocations()
    {
        return $this->hasMany(PaymentAllocation::class);
    }

    public function upiRequests()
    {
        return $this->hasMany(UpiPaymentRequest::class, 'order_split_id');
    }

    public function isPaid(): bool
    {
        return $this->payment_status === 'paid';
    }

    public function totalPaid(): string
    {
        $paid = $this->allocations()->whereHas('payment', function ($q) {
            $q->where('status', 'success');
        })->sum('amount');
        return bcadd((string) $paid, '0', 2);
    }

    public function remainingBalance(): string
    {
        $rem = bcsub((string) $this->total_amount, (string) $this->totalPaid(), 2);
        return bccomp($rem, '0', 2) > 0 ? $rem : '0.00';
    }

    public function recalculateStatus(): void
    {
        $paid = $this->totalPaid();
        $status = 'unpaid';
        if (bccomp($paid, (string) $this->total_amount, 2) >= 0) {
            $status = 'paid';
        } elseif (bccomp($paid, '0.00', 2) > 0) {
            $status = 'partially_paid';
        }
        $this->update([
            'paid_amount' => $paid,
            'payment_status' => $status,
        ]);
    }
}
