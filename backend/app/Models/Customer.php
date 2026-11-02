<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Customer extends Model
{
    protected $fillable = [
        'name',
        'phone',
        'email',
        'notes',
        'created_by_user_id',
    ];

    /** Orders are linked by phone number (orders.customer_phone); the orders table is unchanged. */
    public function orders()
    {
        return $this->hasMany(Order::class, 'customer_phone', 'phone');
    }
}
