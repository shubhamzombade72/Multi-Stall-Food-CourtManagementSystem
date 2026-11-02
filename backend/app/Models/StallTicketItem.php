<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class StallTicketItem extends Model
{
    use HasFactory;

    protected $fillable = [
        'ticket_id',
        'order_item_id',
        'quantity',
        'status',
    ];

    protected $casts = [
        'quantity' => 'integer',
    ];

    public function ticket()
    {
        return $this->belongsTo(StallKitchenTicket::class, 'ticket_id');
    }

    public function orderItem()
    {
        return $this->belongsTo(OrderItem::class, 'order_item_id');
    }
}

