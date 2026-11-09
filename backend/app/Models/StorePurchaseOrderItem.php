<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class StorePurchaseOrderItem extends Model
{
    protected $fillable = ['store_purchase_order_id', 'store_item_id', 'quantity', 'unit_price', 'total_price'];

    protected $casts = [
        'quantity' => 'decimal:3',
        'unit_price' => 'decimal:2',
        'total_price' => 'decimal:2',
    ];

    public function item()
    {
        return $this->belongsTo(StoreItem::class, 'store_item_id');
    }
}
