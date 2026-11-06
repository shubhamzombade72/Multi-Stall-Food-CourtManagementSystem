<?php

namespace Tests\Concerns;

use App\Models\Order;
use App\Models\StallTicketItem;
use App\Models\User;
use App\Services\FulfillmentService;

/** Billing requires every item served or cancelled: tests that are about payment serve the food first, like the real floor. */
trait ServesOrders
{
    protected function serveAllItems(Order|int $order): void
    {
        $orderId = $order instanceof Order ? $order->id : $order;
        $owner = User::where('role', 'owner')->where('is_active', true)->firstOrFail();
        $ids = StallTicketItem::whereHas('ticket', fn ($q) => $q->where('order_id', $orderId))->pluck('id');
        foreach ($ids as $id) {
            app(FulfillmentService::class)->transitionItem((int) $id, 'served', $owner);
        }
    }
}
