<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DiningTable;
use App\Models\MenuItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\StallKitchenTicket;
use App\Models\StallTicketItem;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class OrderController extends Controller
{
    public function index(Request $request)
    {
        if ($denied = $this->denyUnlessOwnerOrCashier($request)) {
            return $denied;
        }

        $query = Order::with(['table', 'items.stall', 'kitchenTickets.stall', 'payments', 'waiter:id,name', 'cashier:id,name']);

        if ($request->has('status')) {
            $query->where('status', $request->query('status'));
        }

        if ($request->has('payment_status')) {
            $query->where('payment_status', $request->query('payment_status'));
        }

        if ($request->has('order_channel')) {
            $query->where('order_channel', $request->query('order_channel'));
        }

        if ($request->has('table_id')) {
            $query->where('table_id', $request->query('table_id'));
        }

        if ($request->has('date')) {
            $query->whereDate('created_at', $request->query('date'));
        }

        $orders = $query->orderByDesc('id')->paginate($request->integer('per_page', 20));

        return response()->json([
            'success' => true,
            'data' => $orders,
        ]);
    }

    public function show(Request $request, $id)
    {
        if ($denied = $this->denyUnlessOwnerOrCashier($request)) {
            return $denied;
        }

        $order = Order::with([
            'table',
            'items.stall',
            'items.menuItem',
            'kitchenTickets.stall',
            'kitchenTickets.ticketItems.orderItem',
            'payments.cashier:id,name',
            'waiter:id,name',
            'cashier:id,name'
        ])->findOrFail($id);

        return response()->json([
            'success' => true,
            'data' => $order,
        ]);
    }

    public function createOrder(Request $request)
    {
        $validated = $request->validate([
            'table_id' => 'nullable|exists:dining_tables,id',
            'qr_token' => 'nullable|string|max:64',
            'order_type' => 'required|in:dine_in,takeaway',
            'order_channel' => 'nullable|in:qr_customer,waiter_app,cashier_pos',
            'customer_name' => 'nullable|string|max:100',
            'customer_phone' => 'nullable|string|max:20',
            'notes' => 'nullable|string',
            'idempotency_key' => 'nullable|string|max:64',
            'items' => 'required|array|min:1',
            'items.*.menu_item_id' => 'required|exists:menu_items,id',
            'items.*.quantity' => 'required|integer|min:1',
            'items.*.special_instructions' => 'nullable|string|max:255',
        ]);

        $authenticatedUser = $request->user('sanctum');

        // 1. Idempotency Check: Return existing order if key was already processed
        if (!empty($validated['idempotency_key'])) {
            $existing = Order::where('idempotency_key', $validated['idempotency_key'])->first();
            if ($existing) {
                return $this->idempotentReplay($existing, $authenticatedUser);
            }
        }

        $waiterId = null;
        $cashierId = null;
        $orderChannel = 'qr_customer';

        if ($authenticatedUser) {
            if ($authenticatedUser->isWaiter()) {
                $orderChannel = 'waiter_app';
                $waiterId = $authenticatedUser->id;
            } elseif ($authenticatedUser->isCashier()) {
                $orderChannel = 'cashier_pos';
                $cashierId = $authenticatedUser->id;
            } elseif ($authenticatedUser->isOwner()) {
                $orderChannel = $request->input('order_channel', 'cashier_pos');
            } else {
                return response()->json(['success' => false, 'message' => 'Staff role cannot place customer orders.'], 403);
            }
        } else {
            // Unauthenticated public request: ALWAYS force qr_customer channel (never trust client spoofing)
            $orderChannel = 'qr_customer';
        }

        // Table Resolution: public (QR) orders MUST present the table's QR secret; the table is
        // taken from the token, never from a client-supplied table_id.
        $tableId = $validated['table_id'] ?? null;
        if (!$authenticatedUser) {
            $matchedTable = empty($validated['qr_token'])
                ? null
                : DiningTable::where('qr_token', $validated['qr_token'])->where('is_active', true)->first();
            if (!$matchedTable) {
                return response()->json([
                    'success' => false,
                    'message' => 'Invalid or missing table QR code. Please scan the QR code on your table.',
                ], 422);
            }
            $tableId = $matchedTable->id;
        }

        try {
            return $this->persistOrder($validated, $tableId, $orderChannel, $waiterId, $cashierId, $authenticatedUser);
        } catch (UniqueConstraintViolationException $e) {
            // Two concurrent submissions with the same idempotency key: the loser replays the winner
            $existing = !empty($validated['idempotency_key'])
                ? Order::where('idempotency_key', $validated['idempotency_key'])->first()
                : null;
            if (!$existing) {
                throw $e;
            }
            return $this->idempotentReplay($existing, $authenticatedUser);
        }
    }

    private function persistOrder(array $validated, $tableId, string $orderChannel, $waiterId, $cashierId, $authenticatedUser)
    {
        return DB::transaction(function () use ($validated, $tableId, $orderChannel, $waiterId, $cashierId, $authenticatedUser) {
            // Fetch all requested menu items for authoritative server-side pricing
            $itemIds = array_column($validated['items'], 'menu_item_id');
            $menuItems = MenuItem::with('stall:id,is_active')->whereIn('id', $itemIds)->get()->keyBy('id');

            $subtotal = 0;
            $preparedItems = [];
            $itemsByStall = [];

            foreach ($validated['items'] as $itemInput) {
                $menuItem = $menuItems->get($itemInput['menu_item_id']);

                if (!$menuItem->is_available) {
                    abort(422, "Item '{$menuItem->name}' is currently out of stock.");
                }

                if (!$menuItem->stall?->is_active) {
                    abort(422, "Item '{$menuItem->name}' belongs to a stall that is currently closed.");
                }

                $quantity = $itemInput['quantity'];
                $unitPrice = $menuItem->price;
                $lineTotal = bcmul((string) $unitPrice, (string) $quantity, 2);
                $subtotal = bcadd($subtotal, $lineTotal, 2);

                $preparedItems[] = [
                    'stall_id' => $menuItem->stall_id,
                    'menu_item_id' => $menuItem->id,
                    'item_name' => $menuItem->name,
                    'unit_price' => $unitPrice,
                    'quantity' => $quantity,
                    'subtotal' => $lineTotal,
                    'status' => 'pending',
                    'special_instructions' => $itemInput['special_instructions'] ?? null,
                ];

                $itemsByStall[$menuItem->stall_id][] = count($preparedItems) - 1;
            }

            // Standard 5% GST on food court sales
            $taxAmount = bcmul($subtotal, '0.05', 2);
            $totalAmount = bcadd($subtotal, $taxAmount, 2);

            // Create Consolidated Parent Order
            $order = Order::create([
                'table_id' => $tableId,
                'order_type' => $validated['order_type'],
                'order_channel' => $orderChannel,
                'idempotency_key' => $validated['idempotency_key'] ?? null,
                'customer_name' => $validated['customer_name'] ?? null,
                'customer_phone' => $validated['customer_phone'] ?? null,
                'waiter_id' => $waiterId,
                'cashier_id' => $cashierId,
                'status' => 'confirmed',
                'subtotal' => $subtotal,
                'tax_amount' => $taxAmount,
                'discount_amount' => 0,
                'total_amount' => $totalAmount,
                'payment_status' => 'unpaid',
                'notes' => $validated['notes'] ?? null,
            ]);

            // 3. Create Order Items & Child Stall Tickets
            $createdOrderItems = [];
            foreach ($preparedItems as $idx => $pItem) {
                $orderItem = $order->items()->create($pItem);
                $createdOrderItems[$idx] = $orderItem;
            }

            // 4. Multi-Stall Ticket Splitting: Create 1 Kitchen Ticket per stall
            foreach ($itemsByStall as $stallId => $itemIndexes) {
                $ticket = StallKitchenTicket::create([
                    'order_id' => $order->id,
                    'stall_id' => $stallId,
                    'status' => 'pending',
                ]);

                foreach ($itemIndexes as $idx) {
                    $orderItem = $createdOrderItems[$idx];
                    StallTicketItem::create([
                        'ticket_id' => $ticket->id,
                        'order_item_id' => $orderItem->id,
                        'quantity' => $orderItem->quantity,
                        'status' => 'pending',
                    ]);
                }
            }

            // Update Dining Table status to occupied
            if (!empty($tableId)) {
                DiningTable::where('id', $tableId)->update(['status' => 'occupied']);
            }

            try {
                event(new \App\Events\OrderCreatedEvent($order));
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning('Broadcast OrderCreatedEvent failed: ' . $e->getMessage());
            }

            return response()->json([
                'success' => true,
                'message' => 'Order placed successfully and dispatched to stall kitchens',
                'data' => $authenticatedUser
                    ? $order->load(['table', 'items.stall:id,name,code', 'kitchenTickets.stall:id,name,code'])
                    : $this->publicOrderView($order),
            ], 201);
        });
    }

    private function idempotentReplay(Order $existing, $authenticatedUser)
    {
        return response()->json([
            'success' => true,
            'message' => 'Order retrieved from existing idempotency record',
            'data' => $authenticatedUser && !$authenticatedUser->isKitchenStaff()
                ? $existing->load(['table', 'items.stall:id,name,code', 'kitchenTickets.stall:id,name,code'])
                : $this->publicOrderView($existing),
        ], 200);
    }

    private function denyUnlessOwnerOrCashier(Request $request)
    {
        $user = $request->user();
        if ($user->isOwner() || $user->isCashier()) {
            return null;
        }
        return response()->json(['success' => false, 'message' => 'Unauthorized. Owner or Cashier access required.'], 403);
    }

    public function trackOrder(Request $request, $trackingToken)
    {
        $order = Order::where('tracking_token', $trackingToken)->first();

        if (!$order) {
            return response()->json([
                'success' => false,
                'message' => 'Order tracking link is invalid or expired.',
            ], 404);
        }

        return response()->json([
            'success' => true,
            'data' => $this->publicOrderView($order),
        ]);
    }

    /**
     * Sanitized order view for unauthenticated customers (no PII, no staff internals, no QR secret).
     */
    private function publicOrderView(Order $order): array
    {
        $order->loadMissing([
            'table:id,table_number,section',
            'items.stall:id,name,code',
            'kitchenTickets.stall:id,name,code',
        ]);

        return [
            'order_number' => $order->order_number,
            'tracking_token' => $order->tracking_token,
            'order_channel' => $order->order_channel,
            'order_type' => $order->order_type,
            'status' => $order->status,
            'payment_status' => $order->payment_status,
            'created_at' => $order->created_at,
            'table' => $order->table ? [
                'table_number' => $order->table->table_number,
                'section' => $order->table->section,
            ] : null,
            'items' => $order->items->map(function ($it) {
                return [
                    'id' => $it->id,
                    'item_name' => $it->item_name,
                    'quantity' => $it->quantity,
                    'status' => $it->status,
                    'subtotal' => $it->subtotal,
                    'stall_name' => $it->stall->name ?? 'Stall',
                ];
            }),
            'kitchen_tickets' => $order->kitchenTickets->map(function ($t) {
                return [
                    'id' => $t->id,
                    'ticket_number' => $t->ticket_number,
                    'stall_name' => $t->stall->name ?? 'Stall',
                    'status' => $t->status,
                ];
            }),
            'subtotal' => $order->subtotal,
            'tax_amount' => $order->tax_amount,
            'total_amount' => $order->total_amount,
        ];
    }

    public function cancelOrder(Request $request, $id)
    {
        $user = $request->user();
        if (!$user->isOwner() && !$user->isCashier()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Only Cashier or Owner can cancel orders.'], 403);
        }

        $order = Order::with('kitchenTickets')->findOrFail($id);

        if ($order->payment_status === 'paid') {
            return response()->json([
                'success' => false,
                'message' => 'Cannot cancel an order that has already been paid in full. Contact management for refund.',
            ], 422);
        }

        // Check if any ticket is already preparing
        $hasActivePreparation = $order->kitchenTickets->contains(function ($ticket) {
            return in_array($ticket->status, ['preparing', 'ready', 'picked_up']);
        });

        if ($hasActivePreparation) {
            return response()->json([
                'success' => false,
                'message' => 'Cannot cancel order. Food preparation has already started at one or more stalls.',
            ], 422);
        }

        DB::transaction(function () use ($order) {
            $order->update(['status' => 'cancelled']);
            $order->kitchenTickets()->update(['status' => 'cancelled']);
            $order->items()->update(['status' => 'cancelled']);

            if ($order->table_id) {
                DiningTable::where('id', $order->table_id)->update(['status' => 'available']);
            }
        });

        return response()->json([
            'success' => true,
            'message' => 'Order cancelled successfully',
            'data' => $order->fresh(),
        ]);
    }
}

