<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CashierClosing extends Model
{
    protected $fillable = [
        'cashier_id',
        'business_date',
        'payments_count',
        'expected_cash',
        'counted_cash',
        'variance',
        'non_cash_total',
        'notes',
        'closed_by_user_id',
    ];

    protected $casts = [
        'business_date' => 'date:Y-m-d',
        'payments_count' => 'integer',
    ];

    public function cashier()
    {
        return $this->belongsTo(User::class, 'cashier_id');
    }

    public function closedBy()
    {
        return $this->belongsTo(User::class, 'closed_by_user_id');
    }
}
