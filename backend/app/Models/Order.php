<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class Order extends Model
{
    use HasFactory;

    /** Set by OrderController::cancelOrder so the audit entry records why (not a database column). */
    public ?string $cancellationReason = null;

    protected $fillable = [
        'uuid',
        'order_number',
        'tracking_token',
        'idempotency_key',
        'table_id',
        'order_type',
        'order_channel',
        'customer_name',
        'customer_phone',
        'waiter_id',
        'cashier_id',
        'status',
        'subtotal',
        'tax_amount',
        'tax_rate_percent',
        'tax_mode',
        'discount_amount',
        'total_amount',
        'payment_status',
        'notes',
        'guest_count',
    ];

    protected $casts = [
        'subtotal' => 'decimal:2',
        'tax_amount' => 'decimal:2',
        'tax_rate_percent' => 'decimal:2',
        'discount_amount' => 'decimal:2',
        'total_amount' => 'decimal:2',
        'guest_count' => 'integer',
    ];

    protected $appends = [
        'paid_amount',
        'remaining_balance',
    ];

    public function getPaidAmountAttribute(): string
    {
        return $this->totalPaid();
    }

    public function getRemainingBalanceAttribute(): string
    {
        return $this->remainingBalance();
    }

    protected static function boot()
    {
        parent::boot();
        static::creating(function ($model) {
            if (empty($model->uuid)) {
                $model->uuid = (string) Str::uuid();
            }
            if (empty($model->order_number)) {
                $model->order_number = 'ORD-' . date('Ymd') . '-' . strtoupper(Str::random(5));
            }
            if (empty($model->tracking_token)) {
                $model->tracking_token = 'trk_' . Str::random(36);
            }
        });

        static::deleting(function ($model) {
            if ($model->payments()->where('status', 'success')->exists() || $model->paymentAllocations()->exists()) {
                throw new \RuntimeException("Financial integrity violation: Cannot delete order #{$model->order_number} (ID: {$model->id}) because it has successful payments or ledger allocations.");
            }
        });
    }

    public function table()
    {
        return $this->belongsTo(DiningTable::class, 'table_id');
    }

    public function waiter()
    {
        return $this->belongsTo(User::class, 'waiter_id');
    }

    public function cashier()
    {
        return $this->belongsTo(User::class, 'cashier_id');
    }

    public function items()
    {
        return $this->hasMany(OrderItem::class);
    }

    public function kitchenTickets()
    {
        return $this->hasMany(StallKitchenTicket::class);
    }

    public function payments()
    {
        return $this->hasMany(Payment::class);
    }

    public function splits()
    {
        return $this->hasMany(OrderSplit::class)->orderBy('split_number');
    }

    public function paymentAllocations()
    {
        return $this->hasMany(PaymentAllocation::class);
    }

    public function totalPaid(): string
    {
        $paid = $this->payments()->where('status', 'success')->sum('amount');
        return bcadd((string) $paid, '0', 2);
    }

    public function remainingBalance(): string
    {
        $rem = bcsub((string) $this->total_amount, (string) $this->totalPaid(), 2);
        return bccomp($rem, '0', 2) > 0 ? $rem : '0.00';
    }

    public function recalculatePaymentStatus(?int $cashierId = null): void
    {
        $totalPaid = $this->totalPaid();
        $totalAmount = (string) $this->total_amount;
        $isPaid = bccomp($totalPaid, $totalAmount, 2) >= 0;

        $newStatus = 'unpaid';
        if ($isPaid) {
            $newStatus = 'paid';
        } elseif (bccomp($totalPaid, '0.00', 2) > 0) {
            $newStatus = 'partially_paid';
        }

        $updates = [
            'payment_status' => $newStatus,
        ];
        if ($isPaid) {
            $updates['status'] = 'completed';
            if ($cashierId) {
                $updates['cashier_id'] = $cashierId;
            }
            if ($this->table_id) {
                DiningTable::where('id', $this->table_id)->update(['status' => 'available']);
            }
        } elseif ($cashierId) {
            $updates['cashier_id'] = $cashierId;
        }

        $this->update($updates);
    }
}
