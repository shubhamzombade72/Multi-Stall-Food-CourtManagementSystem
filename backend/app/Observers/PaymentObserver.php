<?php

namespace App\Observers;

use App\Models\Payment;
use App\Services\AuditService;

class PaymentObserver
{
    public function created(Payment $payment): void
    {
        AuditService::log(
            action: 'payment_created',
            entityType: 'Payment',
            entityId: $payment->id,
            stallId: null,
            oldValues: null,
            newValues: [
                'payment_number' => $payment->payment_number,
                'order_id' => $payment->order_id,
                'payment_method' => $payment->payment_method,
                'amount' => $payment->amount,
                'status' => $payment->status,
            ],
            userId: $payment->cashier_id
        );
    }

    public function updated(Payment $payment): void
    {
        if ($payment->wasChanged('status')) {
            AuditService::log(
                action: 'payment_status_updated',
                entityType: 'Payment',
                entityId: $payment->id,
                stallId: null,
                oldValues: ['status' => $payment->getOriginal('status')],
                newValues: ['status' => $payment->status]
            );
        }
    }
}

