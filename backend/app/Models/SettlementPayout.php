<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use LogicException;

/**
 * A single row of the payout ledger. Rows are permanent: no deletes, and no edits other than the reversal flag.
 * A correction is a new row (entry_type = reversal) that points at the original via reverses_payout_id.
 */
class SettlementPayout extends Model
{
    protected $fillable = [
        'payout_number', 'entry_type', 'status', 'settlement_id', 'consolidated_payout_id', 'business_date', 'stall_id',
        'stall_owner_id', 'payable_at_time', 'amount', 'balance_after', 'payment_method', 'transaction_reference', 'paid_at',
        'paid_by_user_id', 'received_by', 'notes', 'failure_reason', 'reverses_payout_id', 'reversal_reason', 'reversed_at',
        'idempotency_key',
    ];

    protected $casts = [
        'business_date' => 'date:Y-m-d',
        'payable_at_time' => 'decimal:2',
        'amount' => 'decimal:2',
        'balance_after' => 'decimal:2',
        'paid_at' => 'datetime',
        'reversed_at' => 'datetime',
    ];

    /** The reversal flag and the number assigned on creation are the only legitimate changes to a stored row. */
    private const MUTABLE = ['status', 'reversed_at', 'payout_number', 'updated_at'];

    protected static function booted(): void
    {
        static::updating(function (self $m) {
            foreach (array_keys($m->getDirty()) as $key) {
                if (!in_array($key, self::MUTABLE, true)) {
                    throw new LogicException("A recorded payout is immutable ({$key}). Create a reversal instead.");
                }
            }
            if ($m->isDirty('payout_number') && $m->getOriginal('payout_number') !== null) {
                throw new LogicException('A payout number cannot be changed.');
            }
            if ($m->isDirty('status') && $m->getOriginal('status') !== 'completed') {
                throw new LogicException('Only a completed payout can be marked reversed.');
            }
        });
        static::deleting(fn () => throw new LogicException('Payout transactions cannot be deleted; reverse them instead.'));
    }

    public function settlement()
    {
        return $this->belongsTo(StallSettlementRecord::class, 'settlement_id');
    }

    public function stall()
    {
        return $this->belongsTo(Stall::class);
    }

    public function owner()
    {
        return $this->belongsTo(StallOwner::class, 'stall_owner_id');
    }

    public function paidBy()
    {
        return $this->belongsTo(User::class, 'paid_by_user_id');
    }

    public function consolidated()
    {
        return $this->belongsTo(ConsolidatedPayout::class, 'consolidated_payout_id');
    }

    public function reverses()
    {
        return $this->belongsTo(self::class, 'reverses_payout_id');
    }

    public function audits()
    {
        return $this->hasMany(SettlementPayoutAudit::class, 'payout_id')->orderBy('id');
    }
}
