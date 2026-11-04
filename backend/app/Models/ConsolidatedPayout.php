<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use LogicException;

/** One payment made to a stall owner that covers several stall settlements; the split lives in the child settlement_payouts rows. */
class ConsolidatedPayout extends Model
{
    protected $fillable = [
        'consolidated_number', 'stall_owner_id', 'total_amount', 'payment_method', 'transaction_reference', 'paid_at',
        'paid_by_user_id', 'received_by', 'notes', 'status', 'reversed_at', 'idempotency_key',
    ];

    protected $casts = ['total_amount' => 'decimal:2', 'paid_at' => 'datetime', 'reversed_at' => 'datetime'];

    /** Only the status flag may change after the payment is recorded. */
    private const MUTABLE = ['status', 'reversed_at', 'consolidated_number', 'updated_at'];

    protected static function booted(): void
    {
        static::updating(function (self $m) {
            foreach (array_keys($m->getDirty()) as $key) {
                if (!in_array($key, self::MUTABLE, true)) {
                    throw new LogicException("A recorded consolidated payout is immutable ({$key}). Reverse it and record a new one.");
                }
            }
        });
        static::deleting(fn () => throw new LogicException('Consolidated payouts cannot be deleted; reverse them instead.'));
    }

    public function owner()
    {
        return $this->belongsTo(StallOwner::class, 'stall_owner_id');
    }

    public function paidBy()
    {
        return $this->belongsTo(User::class, 'paid_by_user_id');
    }

    public function allocations()
    {
        return $this->hasMany(SettlementPayout::class, 'consolidated_payout_id')->where('entry_type', 'payment');
    }

    public function payouts()
    {
        return $this->hasMany(SettlementPayout::class, 'consolidated_payout_id');
    }
}
