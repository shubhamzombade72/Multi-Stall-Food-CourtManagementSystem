<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * One UPI payment REQUEST for one bill (the QR payload). It is never proof of payment.
 *
 * States:  pending -> initiated -> paid | failed | cancelled      (superseded: replaced by a newer QR; refunded: reserved)
 *   pending     QR generated; nothing is known about the customer.
 *   initiated   the cashier saw the customer start paying; still NOT money received.
 *   paid        a cashier verified the credit by hand (verification_method = 'manual') and recorded the payment.
 *   failed / cancelled / superseded   closed without payment; the QR can never settle the bill again.
 *   refunded    reserved for a refund workflow (none exists yet); unreachable from the API.
 */
class UpiPaymentRequest extends Model
{
    public const OPEN = ['pending', 'initiated'];

    /** Allowed moves a human may request through the API. Settlement (-> paid) happens only inside BillingController::settle. */
    public const TRANSITIONS = [
        'pending' => ['initiated', 'failed', 'cancelled'],
        'initiated' => ['failed', 'cancelled'],
    ];

    protected $fillable = [
        'uuid', 'order_id', 'order_split_id', 'reference', 'vpa', 'payee_name', 'amount', 'upi_uri', 'status', 'payment_id', 'created_by_user_id',
        'initiated_at', 'initiated_by_user_id', 'closed_at', 'closed_reason', 'verified_by_user_id', 'verified_at', 'verification_method',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'initiated_at' => 'datetime',
        'closed_at' => 'datetime',
        'verified_at' => 'datetime',
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

    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    public function orderSplit()
    {
        return $this->belongsTo(OrderSplit::class, 'order_split_id');
    }

    public function payment()
    {
        return $this->belongsTo(Payment::class);
    }

    public function verifiedBy()
    {
        return $this->belongsTo(User::class, 'verified_by_user_id');
    }

    public function isOpen(): bool
    {
        return in_array($this->status, self::OPEN, true);
    }

    public function canMoveTo(string $status): bool
    {
        return in_array($status, self::TRANSITIONS[$this->status] ?? [], true);
    }

    /** What the receipt/QR needs; never includes internal ids. `verification` is present only on a paid request. */
    public function toReceiptArray(): array
    {
        return [
            'reference' => $this->reference,
            'vpa' => $this->vpa,
            'payee_name' => $this->payee_name,
            'amount' => (string) $this->amount,
            'upi_uri' => $this->upi_uri,
            'status' => $this->status,
            'verification' => $this->status === 'paid' ? [
                'method' => $this->verification_method ?? 'manual',
                'verified_at' => $this->verified_at?->toIso8601String(),
                'verified_by' => $this->verifiedBy?->name,
            ] : null,
        ];
    }
}
