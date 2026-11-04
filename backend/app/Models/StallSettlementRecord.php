<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class StallSettlementRecord extends Model
{
    use HasFactory;

    protected $fillable = [
        'closing_id',
        'stall_id',
        'stall_gross_sales',
        'stall_item_count',
        'settlement_amount',
        'settlement_status',
        'paid_to_representative',
        'paid_at',
        'payment_method',
        'notes',
        'payable_at_close',
        'adjustment_amount',
        'net_payable',
        'paid_amount',
        'remaining_amount',
        'payout_status',
        'last_payout_at',
    ];

    protected $casts = [
        'stall_gross_sales' => 'decimal:2',
        'stall_item_count' => 'integer',
        'settlement_amount' => 'decimal:2',
        'paid_at' => 'datetime',
        'payable_at_close' => 'decimal:2',
        'adjustment_amount' => 'decimal:2',
        'net_payable' => 'decimal:2',
        'paid_amount' => 'decimal:2',
        'remaining_amount' => 'decimal:2',
        'last_payout_at' => 'datetime',
    ];

    public function closing()
    {
        return $this->belongsTo(DailyClosing::class, 'closing_id');
    }

    public function stall()
    {
        return $this->belongsTo(Stall::class);
    }

    public function payouts()
    {
        return $this->hasMany(SettlementPayout::class, 'settlement_id')->orderBy('id');
    }
}

