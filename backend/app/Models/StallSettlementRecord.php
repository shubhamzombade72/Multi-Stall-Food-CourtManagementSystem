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
    ];

    protected $casts = [
        'stall_gross_sales' => 'decimal:2',
        'stall_item_count' => 'integer',
        'settlement_amount' => 'decimal:2',
        'paid_at' => 'datetime',
    ];

    public function closing()
    {
        return $this->belongsTo(DailyClosing::class, 'closing_id');
    }

    public function stall()
    {
        return $this->belongsTo(Stall::class);
    }
}

