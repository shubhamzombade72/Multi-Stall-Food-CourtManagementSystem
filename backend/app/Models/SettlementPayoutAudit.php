<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use LogicException;

/** Append-only audit trail for the payout ledger. Written inside the same transaction as the change it describes. */
class SettlementPayoutAudit extends Model
{
    public $timestamps = false;

    protected $fillable = ['settlement_id', 'payout_id', 'consolidated_payout_id', 'action', 'user_id', 'details', 'created_at'];

    protected $casts = ['details' => 'array', 'created_at' => 'datetime'];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Payout audit entries are append-only.'));
        static::deleting(fn () => throw new LogicException('Payout audit entries cannot be deleted.'));
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
