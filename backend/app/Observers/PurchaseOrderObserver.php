<?php

namespace App\Observers;

use App\Models\PurchaseOrder;
use App\Services\AuditService;

class PurchaseOrderObserver
{
    public function created(PurchaseOrder $po): void
    {
        AuditService::log(
            action: 'purchase_order_created',
            entityType: 'PurchaseOrder',
            entityId: $po->id,
            stallId: $po->stall_id,
            oldValues: null,
            newValues: [
                'po_number' => $po->po_number,
                'supplier_id' => $po->supplier_id,
                'total_amount' => $po->total_amount,
                'status' => $po->status,
            ]
        );
    }

    public function updated(PurchaseOrder $po): void
    {
        if ($po->wasChanged('status')) {
            $action = $po->status === 'received' ? 'purchase_order_received' : 'purchase_order_status_updated';
            AuditService::log(
                action: $action,
                entityType: 'PurchaseOrder',
                entityId: $po->id,
                stallId: $po->stall_id,
                oldValues: ['status' => $po->getOriginal('status')],
                newValues: ['status' => $po->status]
            );
        }
    }
}

