<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class StallKitchenTicket extends Model
{
    use HasFactory;

    protected $fillable = [
        'uuid',
        'ticket_number',
        'order_id',
        'stall_id',
        'status',
        'accepted_at',
        'ready_at',
        'picked_up_at',
        'served_by_waiter_id',
    ];

    protected $casts = [
        'accepted_at' => 'datetime',
        'ready_at' => 'datetime',
        'picked_up_at' => 'datetime',
    ];

    protected static function boot()
    {
        parent::boot();
        static::creating(function ($model) {
            if (empty($model->uuid)) {
                $model->uuid = (string) Str::uuid();
            }
            if (empty($model->ticket_number)) {
                $model->ticket_number = 'KKT-' . date('Ymd') . '-' . strtoupper(Str::random(4));
            }
        });
    }

    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    public function stall()
    {
        return $this->belongsTo(Stall::class);
    }

    public function ticketItems()
    {
        return $this->hasMany(StallTicketItem::class, 'ticket_id');
    }

    public function items()
    {
        return $this->ticketItems();
    }

    public function waiter()
    {
        return $this->belongsTo(User::class, 'served_by_waiter_id');
    }
}
