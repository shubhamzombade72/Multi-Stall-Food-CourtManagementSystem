<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class StoreSupplier extends Model
{
    protected $fillable = ['name', 'contact_person', 'phone', 'email', 'address', 'is_active'];

    protected $casts = ['is_active' => 'boolean'];

    public function purchaseOrders()
    {
        return $this->hasMany(StorePurchaseOrder::class);
    }
}
