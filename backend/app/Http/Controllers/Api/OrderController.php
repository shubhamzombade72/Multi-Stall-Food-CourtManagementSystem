<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DiningTable;
use App\Models\MenuItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\StallKitchenTicket;
use App\Models\StallTicketItem;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class OrderController extends Controller
{
    public function index(Request $request)
    {
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

    public function show($id)
    {
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
            'order_type' => 'required|in:dine_in,takeaway',
            'order_channel' => 'required|in:qr_customer,waiter_app,cashier_pos',
            'customer_name' => 'nullable|string|max:100',
            'customer_phone' => 'nullable|string|max:20',
            'notes' => 'nullable|string',
            'items' => 'required|array|min:1',
            'items.*.menu_item_id' => 'required|exists:menu_items,id',
            'items.*.quantity' => 'required|integer|min:1',
            'items.*.special_instructions' => 'nullable|string|max:255',
        ]);

        $authenticatedUser = $request->user('sanctum');

        $waiterId = null;
        $cashierId = null;

        if ($authenticatedUser) {
            if ($authenticatedUser->isWaiter()) {
                $waiterId = $authenticatedUser->id;
            } elseif ($authenticatedUser->isCashier()) {
                $cashierId = $authenticatedUser->id;
            }
        }

        return DB::transaction(function () use ($validated, $waiterId, $cashierId) {
            // 1. Fetch all requested menu items for authoritative server-side pricing
            $itemIds = array_column($validated['items'], 'menu_item_id');
            $menuItems = MenuItem::whereIn('id', $itemIds)->get()->keyBy('id');

            $subtotal = 0;
            $preparedItems = [];
            $itemsByStall = [];

            foreach ($validated['items'] as $itemInput) {
                $menuItem = $menuItems->get($itemInput['menu_item_id']);

                if (!$menuItem->is_available) {
                    abort(422, "Item '{$menuItem->name}' is currently out of stock.");
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

                $itemsByStall[$menuItem->stall_id][] = count($preparedItems) - 1; // index reference
            }

            // Standard 5% GST on food court sales
            $taxAmount = bcmul($subtotal, '0.05', 2);
            $totalAmount = bcadd($subtotal, $taxAmount, 2);

            // 2. Create Consolidated Parent Order
            $order = Order::create([
                'table_id' => $validated['table_id'] ?? null,
                'order_type' => $validated['order_type'],
                'order_channel' => $validated['order_channel'],
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

            // 5. Update Dining Table status to occupied
            if (!empty($validated['table_id'])) {
                DiningTable::where('id', $validated['table_id'])->update(['status' => 'occupied']);
            }

            return response()->json([
                'success' => true,
                'message' => 'Order placed successfully and dispatched to stall kitchens',
                'data' => $order->load(['table', 'items.stall:id,name,code', 'kitchenTickets.stall:id,name,code']),
            ], 201);
        });
    }

    public function cancelOrder(Request $request, $id)
    {
        $order = Order::with('kitchenTickets')->findOrFail($id);

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

