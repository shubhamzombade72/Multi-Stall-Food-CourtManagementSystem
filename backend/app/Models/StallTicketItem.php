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
        'ready_at',
        'served_at',
        'served_by_user_id',
        'version',
    ];

    protected $casts = [
        'quantity' => 'integer',
        'ready_at' => 'datetime',
        'served_at' => 'datetime',
        'version' => 'integer',
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

