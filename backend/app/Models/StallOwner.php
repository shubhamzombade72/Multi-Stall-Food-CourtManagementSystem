<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** The person or firm a stall's settlement money is owed to. One owner may hold several stalls. */
class StallOwner extends Model
{
    protected $fillable = ['name', 'phone', 'upi_id', 'is_active'];

    protected $casts = ['is_active' => 'boolean'];

    public function stalls()
    {
        return $this->hasMany(Stall::class);
    }
}
