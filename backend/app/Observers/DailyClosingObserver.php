<?php

namespace App\Observers;

use App\Models\DailyClosing;
use App\Services\AuditService;

class DailyClosingObserver
{
    public function created(DailyClosing $closing): void
    {
        AuditService::log(
            action: 'daily_closing_created',
            entityType: 'DailyClosing',
            entityId: $closing->id,
            stallId: null,
            oldValues: null,
            newValues: [
                'closing_date' => $closing->closing_date,
                'total_orders' => $closing->total_orders,
                'total_sales' => $closing->total_sales,
                'cash_sales' => $closing->cash_sales,
                'upi_sales' => $closing->upi_sales,
                'card_sales' => $closing->card_sales,
                'status' => $closing->status,
            ]
        );
    }

    public function updated(DailyClosing $closing): void
    {
        AuditService::log(
            action: 'daily_closing_updated',
            entityType: 'DailyClosing',
            entityId: $closing->id,
            stallId: null,
            oldValues: array_intersect_key($closing->getOriginal(), $closing->getChanges()),
            newValues: $closing->getChanges()
        );
    }
}

