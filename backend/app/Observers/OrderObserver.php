<?php

namespace App\Observers;

use App\Models\Order;
use App\Services\AuditService;

class OrderObserver
{
    public function created(Order $order): void
    {
        AuditService::log(
            action: 'order_created',
            entityType: 'Order',
            entityId: $order->id,
            stallId: null,
            oldValues: null,
            newValues: [
                'order_number' => $order->order_number,
                'total_amount' => $order->total_amount,
                'order_channel' => $order->order_channel,
                'table_id' => $order->table_id,
                'status' => $order->status,
                'payment_status' => $order->payment_status,
            ],
            userId: $order->cashier_id ?? $order->waiter_id
        );
    }

    public function updated(Order $order): void
    {
        if ($order->wasChanged('status')) {
            $action = $order->status === 'cancelled' ? 'order_cancelled' : 'order_status_updated';
            AuditService::log(
                action: $action,
                entityType: 'Order',
                entityId: $order->id,
                stallId: null,
                oldValues: ['status' => $order->getOriginal('status')],
                newValues: array_filter(['status' => $order->status, 'reason' => $order->cancellationReason])
            );
        }

        if ($order->wasChanged('payment_status')) {
            AuditService::log(
                action: 'order_payment_status_updated',
                entityType: 'Order',
                entityId: $order->id,
                stallId: null,
                oldValues: ['payment_status' => $order->getOriginal('payment_status')],
                newValues: ['payment_status' => $order->payment_status]
            );
        }
    }
}

