<?php

namespace App\Observers;

use App\Models\MenuItem;
use App\Services\AuditService;

class MenuItemObserver
{
    public function created(MenuItem $item): void
    {
        AuditService::log(
            action: 'menu_item_created',
            entityType: 'MenuItem',
            entityId: $item->id,
            stallId: $item->stall_id,
            oldValues: null,
            newValues: [
                'name' => $item->name,
                'price' => $item->price,
                'is_available' => $item->is_available,
            ]
        );
    }

    public function updated(MenuItem $item): void
    {
        $action = $item->wasChanged('price') ? 'menu_item_price_changed' : 'menu_item_updated';
        AuditService::log(
            action: $action,
            entityType: 'MenuItem',
            entityId: $item->id,
            stallId: $item->stall_id,
            oldValues: array_intersect_key($item->getOriginal(), $item->getChanges()),
            newValues: $item->getChanges()
        );
    }

    public function deleted(MenuItem $item): void
    {
        AuditService::log(
            action: 'menu_item_deleted',
            entityType: 'MenuItem',
            entityId: $item->id,
            stallId: $item->stall_id,
            oldValues: ['name' => $item->name, 'price' => $item->price],
            newValues: null
        );
    }
}

