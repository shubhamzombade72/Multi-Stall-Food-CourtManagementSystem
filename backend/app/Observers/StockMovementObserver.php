<?php

namespace App\Observers;

use App\Models\StockMovement;
use App\Services\AuditService;

class StockMovementObserver
{
    public function created(StockMovement $movement): void
    {
        AuditService::log(
            action: 'stock_movement_created',
            entityType: 'StockMovement',
            entityId: $movement->id,
            stallId: $movement->stall_id,
            oldValues: null,
            newValues: [
                'inventory_item_id' => $movement->inventory_item_id,
                'movement_type' => $movement->movement_type,
                'quantity' => $movement->quantity,
                'reference_type' => $movement->reference_type,
                'reference_id' => $movement->reference_id,
                'notes' => $movement->notes,
            ]
        );
    }
}

