<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Durable idempotency record for a fulfilment write (unique per order + key). */
class FulfillmentOperation extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = [
        'order_id',
        'idempotency_key',
        'operation',
        'request_hash',
        'actor_user_id',
        'result',
    ];

    protected $casts = [
        'result' => 'array',
    ];

    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    public function actor()
    {
        return $this->belongsTo(User::class, 'actor_user_id');
    }
}
