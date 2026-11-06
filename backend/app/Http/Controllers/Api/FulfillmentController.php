<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MenuItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\StallKitchenTicket;
use App\Models\StallTicketItem;
use App\Services\AuditService;
use App\Services\FulfillmentService;
use App\Services\TaxService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class FulfillmentController extends Controller
{
    public function __construct(private readonly FulfillmentService $fulfillment)
    {
    }

    /** GET /orders/board?cursor= — tracking board feed (owner, cashier, waiter). */
    public function board(Request $request)
    {
        if (!$this->fulfillment->canMarkServed($request->user())) {
            return response()->json(['success' => false, 'message' => 'Only the owner, cashier or waiter can view the order board.'], 403);
        }
        $validated = $request->validate(['cursor' => 'nullable|string|max:200']);

        $page = $this->fulfillment->board($validated['cursor'] ?? null);

        return response()->json([
            'success' => true,
            'data' => [
                'server_time' => now()->toIso8601String(),
                'delay_minutes' => (int) SettingsController::current('order_tracking')['delay_minutes'],
            ] + $page,
        ]);
    }

    /** POST /orders/{id}/serve-remaining — Serve All Remaining for the confirmed items (durably idempotent). */
    public function serveRemaining(Request $request, $id)
    {
        // Role check first, so a refused call never consumes the idempotency key
        if (!$this->fulfillment->canMarkServed($request->user())) {
            return response()->json(['success' => false, 'message' => 'Only the owner, cashier or waiter can mark food as served.', 'error' => 'forbidden'], 403);
        }
        $validated = $request->validate([
            'idempotency_key' => 'required|string|min:8|max:64',
            'item_ids' => 'required|array|min:1|max:200',
            'item_ids.*' => 'required|integer|distinct',
        ]);

        $result = $this->fulfillment->serveRemaining(
            (int) $id,
            $request->user(),
            $validated['idempotency_key'],
            $validated['item_ids'],
        );

        return response()->json([
            'success' => true,
            'message' => $result['replayed'] ? 'Already served (repeated request)' : 'Remaining items served',
            'data' => [
                'replayed' => $result['replayed'],
                'served_item_ids' => $result['served_item_ids'],
                'order' => $this->fulfillment->boardOrder($result['order_id']),
            ],
        ]);
    }

    /** PATCH /ticket-items/{id}/status — move one item forward (Preparing / Ready / Served). */
    public function updateItemStatus(Request $request, $id)
    {
        $validated = $request->validate([
            'status' => 'required|in:preparing,ready,served',
            'expected_version' => 'nullable|integer|min:0',
        ]);

        $result = $this->fulfillment->transitionItem(
            (int) $id,
            $validated['status'],
            $request->user(),
            isset($validated['expected_version']) ? (int) $validated['expected_version'] : null,
        );

        return response()->json([
            'success' => true,
            'message' => $result['changed'] ? 'Item updated' : 'Item already has this status',
            'data' => [
                'changed' => $result['changed'],
                'item' => FulfillmentService::presentItem($result['item']),
            ],
        ]);
    }

    /** PATCH /ticket-items/{id}/quantity — increase or decrease dish quantity (+1 / -1) on active order. */
    public function updateItemQuantity(Request $request, $id)
    {
        if (!$this->fulfillment->canMarkServed($request->user())) {
            return response()->json(['success' => false, 'message' => 'Only the owner, cashier or waiter can modify order items.'], 403);
        }

        $validated = $request->validate([
            'delta' => 'required|integer|in:-1,1',
        ]);

        $ticketItem = StallTicketItem::with(['orderItem', 'ticket.order'])->findOrFail($id);
        $order = $ticketItem->ticket?->order;

        if (!$order) {
            return response()->json(['success' => false, 'message' => 'Associated order not found.'], 404);
        }

        if ($order->status === 'cancelled') {
            return response()->json(['success' => false, 'message' => 'Order is cancelled.'], 422);
        }

        if ($order->payment_status === 'paid' || $order->payment_status === 'partially_paid' || $order->payments()->exists() || $order->splits()->where('payment_status', 'paid')->exists()) {
            return response()->json(['success' => false, 'message' => 'Order has existing payments and cannot be modified.'], 422);
        }

        $currentStatus = $this->fulfillment->normalize((string) $ticketItem->status);
        if ($currentStatus === 'cancelled') {
            return response()->json(['success' => false, 'message' => 'Cannot modify quantity of a cancelled item.'], 422);
        }
        if ($currentStatus === 'served') {
            return response()->json(['success' => false, 'message' => 'Cannot modify quantity of an already served item.'], 422);
        }
        if ($currentStatus === 'ready') {
            return response()->json(['success' => false, 'message' => 'Cannot modify quantity of an already prepared item. Please add a new item.'], 422);
        }

        $newQty = (int) $ticketItem->quantity + (int) $validated['delta'];
        if ($newQty < 1) {
            return response()->json(['success' => false, 'message' => 'Quantity cannot be decreased below 1.'], 422);
        }

        DB::transaction(function () use ($ticketItem, $order, $validated, $request) {
            $order = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            // A payment may have committed since the check above; a settled bill must never change underneath it
            if ($order->status === 'cancelled' || $order->payments()->exists()) {
                abort(422, 'Order has existing payments and cannot be modified.');
            }
            $ticketItem = StallTicketItem::whereKey($ticketItem->id)->lockForUpdate()->firstOrFail();
            $orderItem = OrderItem::whereKey($ticketItem->order_item_id)->lockForUpdate()->first();

            $oldQty = (int) $ticketItem->quantity;
            $actualNewQty = $oldQty + (int) $validated['delta'];
            if ($actualNewQty < 1) {
                abort(422, 'Quantity cannot be decreased below 1.');
            }

            $ticketItem->quantity = $actualNewQty;
            $ticketItem->version = ((int) $ticketItem->version) + 1;
            $ticketItem->save();

            if ($orderItem) {
                $orderItem->quantity = $actualNewQty;
                $orderItem->subtotal = bcmul((string) $orderItem->unit_price, (string) $actualNewQty, 2);
                $orderItem->save();
            }

            // Recalculate order subtotal and taxes
            $subtotal = (string) ($order->items()->where('status', '!=', 'cancelled')->sum('subtotal') ?? 0);
            $priced = TaxService::calculate($subtotal);
            $order->update([
                'subtotal' => $priced['subtotal'],
                'tax_amount' => $priced['tax_amount'],
                'tax_rate_percent' => $priced['tax_rate_percent'],
                'tax_mode' => $priced['tax_mode'],
                'total_amount' => $priced['total_amount'],
            ]);

            AuditService::log(
                action: $validated['delta'] > 0 ? 'ticket_item_quantity_increased' : 'ticket_item_quantity_decreased',
                entityType: 'StallTicketItem',
                entityId: $ticketItem->id,
                stallId: $ticketItem->ticket?->stall_id,
                oldValues: [
                    'quantity' => $oldQty,
                    'order_id' => $order->id,
                    'order_item_id' => $orderItem?->id,
                ],
                newValues: [
                    'quantity' => $actualNewQty,
                    'order_id' => $order->id,
                    'order_item_id' => $orderItem?->id,
                    'delta' => (int) $validated['delta'],
                ],
                userId: $request->user()?->id,
            );
        });

        try {
            if ($ticketItem->ticket) {
                event(new \App\Events\TicketStatusUpdatedEvent($ticketItem->ticket));
            }
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Broadcast TicketStatusUpdatedEvent failed: ' . $e->getMessage());
        }

        return response()->json([
            'success' => true,
            'message' => 'Quantity updated',
            'data' => [
                'order' => $this->fulfillment->boardOrder($order->id),
            ],
        ]);
    }

    /** POST /orders/{id}/items — add extra item(s) from menu to an existing active order. */
    public function addItem(Request $request, $id)
    {
        if (!$this->fulfillment->canMarkServed($request->user())) {
            return response()->json(['success' => false, 'message' => 'Only the owner, cashier or waiter can add items to orders.'], 403);
        }

        $validated = $request->validate([
            'menu_item_id' => 'required|integer|exists:menu_items,id',
            'quantity' => 'nullable|integer|min:1|max:99',
            'special_instructions' => 'nullable|string|max:255',
        ]);

        $order = Order::with('kitchenTickets')->findOrFail($id);

        if ($order->status === 'cancelled') {
            return response()->json(['success' => false, 'message' => 'Order is cancelled.'], 422);
        }

        if ($order->payment_status === 'paid' || $order->payment_status === 'partially_paid' || $order->payments()->exists() || $order->splits()->where('payment_status', 'paid')->exists()) {
            return response()->json(['success' => false, 'message' => 'Order has existing payments and items cannot be added.'], 422);
        }

        $menuItem = MenuItem::with('stall')->findOrFail($validated['menu_item_id']);

        if (!$menuItem->is_available) {
            return response()->json(['success' => false, 'message' => "Item '{$menuItem->name}' is currently unavailable."], 422);
        }

        if (!$menuItem->stall?->is_active) {
            return response()->json(['success' => false, 'message' => "Stall '{$menuItem->stall?->name}' is currently inactive."], 422);
        }

        $quantity = (int) ($validated['quantity'] ?? 1);
        $unitPrice = $menuItem->price;
        $instructions = isset($validated['special_instructions']) && trim($validated['special_instructions']) !== ''
            ? trim($validated['special_instructions'])
            : null;

        DB::transaction(function () use ($order, $menuItem, $quantity, $unitPrice, $instructions, $request) {
            $order = Order::whereKey($order->id)->lockForUpdate()->firstOrFail();
            // A payment may have committed since the check above; a settled bill must never change underneath it
            if ($order->status === 'cancelled' || $order->payments()->exists()) {
                abort(422, 'Order has existing payments and items cannot be added.');
            }

            // Check if there is an existing unserved line for the exact same dish and instructions
            $existingOrderItem = $order->items()
                ->where('menu_item_id', $menuItem->id)
                ->where(function ($q) use ($instructions) {
                    if ($instructions === null) {
                        $q->whereNull('special_instructions')->orWhere('special_instructions', '');
                    } else {
                        $q->where('special_instructions', $instructions);
                    }
                })
                ->whereIn('status', ['pending', 'preparing'])
                ->lockForUpdate()
                ->first();

            $merged = false;
            if ($existingOrderItem) {
                $existingTicketItem = StallTicketItem::where('order_item_id', $existingOrderItem->id)->lockForUpdate()->first();
                if ($existingTicketItem && in_array($this->fulfillment->normalize((string) $existingTicketItem->status), ['pending', 'preparing'], true)) {
                    $oldQty = (int) $existingOrderItem->quantity;
                    $newQty = $oldQty + $quantity;
                    $existingOrderItem->quantity = $newQty;
                    $existingOrderItem->subtotal = bcmul((string) $unitPrice, (string) $newQty, 2);
                    $existingOrderItem->save();

                    $existingTicketItem->quantity = $newQty;
                    $existingTicketItem->version = ((int) $existingTicketItem->version) + 1;
                    $existingTicketItem->save();

                    AuditService::log(
                        action: 'order_item_quantity_merged',
                        entityType: 'StallTicketItem',
                        entityId: $existingTicketItem->id,
                        stallId: $menuItem->stall_id,
                        oldValues: ['quantity' => $oldQty, 'order_id' => $order->id, 'order_item_id' => $existingOrderItem->id],
                        newValues: ['quantity' => $newQty, 'order_id' => $order->id, 'order_item_id' => $existingOrderItem->id, 'added_quantity' => $quantity],
                        userId: $request->user()?->id,
                    );
                    $merged = true;
                }
            }

            if (!$merged) {
                $lineTotal = bcmul((string) $unitPrice, (string) $quantity, 2);
                $orderItem = $order->items()->create([
                    'stall_id' => $menuItem->stall_id,
                    'menu_item_id' => $menuItem->id,
                    'item_name' => $menuItem->name,
                    'unit_price' => $unitPrice,
                    'quantity' => $quantity,
                    'subtotal' => $lineTotal,
                    'status' => 'pending',
                    'special_instructions' => $instructions,
                ]);

                $ticket = $order->kitchenTickets()
                    ->where('stall_id', $menuItem->stall_id)
                    ->whereIn('status', ['pending', 'accepted', 'preparing'])
                    ->lockForUpdate()
                    ->first();

                if (!$ticket) {
                    $ticket = StallKitchenTicket::create([
                        'order_id' => $order->id,
                        'stall_id' => $menuItem->stall_id,
                        'status' => 'pending',
                    ]);
                }

                $ticketItem = StallTicketItem::create([
                    'ticket_id' => $ticket->id,
                    'order_item_id' => $orderItem->id,
                    'quantity' => $quantity,
                    'status' => 'pending',
                    'version' => 1,
                ]);

                AuditService::log(
                    action: 'order_item_added',
                    entityType: 'OrderItem',
                    entityId: $orderItem->id,
                    stallId: $menuItem->stall_id,
                    oldValues: null,
                    newValues: [
                        'order_id' => $order->id,
                        'menu_item_id' => $menuItem->id,
                        'item_name' => $menuItem->name,
                        'quantity' => $quantity,
                        'stall_id' => $menuItem->stall_id,
                        'ticket_id' => $ticket->id,
                        'ticket_item_id' => $ticketItem->id,
                    ],
                    userId: $request->user()?->id,
                );
            }

            if ($order->status === 'completed') {
                $order->status = 'confirmed';
            }

            // Recalculate billing
            $subtotal = (string) ($order->items()->where('status', '!=', 'cancelled')->sum('subtotal') ?? 0);
            $priced = TaxService::calculate($subtotal);
            $order->update([
                'status' => $order->status,
                'subtotal' => $priced['subtotal'],
                'tax_amount' => $priced['tax_amount'],
                'tax_rate_percent' => $priced['tax_rate_percent'],
                'tax_mode' => $priced['tax_mode'],
                'total_amount' => $priced['total_amount'],
            ]);
        });

        return response()->json([
            'success' => true,
            'message' => "Item '{$menuItem->name}' added to order",
            'data' => [
                'order' => $this->fulfillment->boardOrder($order->id),
            ],
        ]);
    }
}
