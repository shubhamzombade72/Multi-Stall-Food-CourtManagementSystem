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
        'discount_amount',
        'total_amount',
        'payment_status',
        'notes',
        'guest_count',
    ];

    protected $casts = [
        'subtotal' => 'decimal:2',
        'tax_amount' => 'decimal:2',
        'discount_amount' => 'decimal:2',
        'total_amount' => 'decimal:2',
        'guest_count' => 'integer',
    ];

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
}

