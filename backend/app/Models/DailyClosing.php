<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class DailyClosing extends Model
{
    use HasFactory;

    protected $fillable = [
        'closing_date',
        'closed_by_user_id',
        'total_orders_count',
        'total_gross_sales',
        'total_discounts',
        'total_net_sales',
        'total_cash_collected',
        'total_digital_collected',
        'status',
        'notes',
    ];

    protected $casts = [
        'closing_date' => 'date',
        'total_orders_count' => 'integer',
        'total_gross_sales' => 'decimal:2',
        'total_discounts' => 'decimal:2',
        'total_net_sales' => 'decimal:2',
        'total_cash_collected' => 'decimal:2',
        'total_digital_collected' => 'decimal:2',
    ];

    public function closedBy()
    {
        return $this->belongsTo(User::class, 'closed_by_user_id');
    }

    public function settlements()
    {
        return $this->hasMany(StallSettlementRecord::class, 'closing_id');
    }
}

