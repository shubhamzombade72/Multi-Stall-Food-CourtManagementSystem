<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class UpiPaymentRequest extends Model
{
    protected $fillable = [
        'uuid', 'order_id', 'reference', 'vpa', 'payee_name', 'amount', 'upi_uri', 'status', 'payment_id', 'created_by_user_id',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
    ];

    protected static function boot()
    {
        parent::boot();
        static::creating(function ($model) {
            if (empty($model->uuid)) {
                $model->uuid = (string) Str::uuid();
            }
        });
    }

    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    public function payment()
    {
        return $this->belongsTo(Payment::class);
    }

    /** What the receipt/QR needs; never includes internal ids. */
    public function toReceiptArray(): array
    {
        return [
            'reference' => $this->reference,
            'vpa' => $this->vpa,
            'payee_name' => $this->payee_name,
            'amount' => (string) $this->amount,
            'upi_uri' => $this->upi_uri,
            'status' => $this->status,
        ];
    }
}
