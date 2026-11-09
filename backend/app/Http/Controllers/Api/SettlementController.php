<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DailyClosing;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\Stall;
use App\Models\StallSettlementRecord;
use App\Services\PayoutException;
use App\Services\PayoutService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SettlementController extends Controller
{
    public function getDailySummary(Request $request)
    {
        $user = $request->user();
        if (!$user->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Owner access required.'], 403);
        }

        $date = $request->query('date', now()->toDateString());

        // Orders on this day
        $completedOrders = Order::whereDate('created_at', $date)
            ->where('payment_status', 'paid')
            ->get();

        $totalOrdersCount = $completedOrders->count();
        $totalGrossSales = $completedOrders->sum('subtotal');
        $totalDiscounts = $completedOrders->sum('discount_amount');
        $totalNetSales = $completedOrders->sum('total_amount');
        // GST exactly as each bill was priced (stored per bill), so a later rate change never alters a past day
        $totalTax = $completedOrders->sum('tax_amount');

        // Cash vs Digital Payments
        $payments = Payment::whereDate('created_at', $date)
            ->where('status', 'success')
            ->get();

        $cashCollected = $payments->where('payment_method', 'cash')->sum('amount');
        $digitalCollected = $payments->whereIn('payment_method', ['upi_qr', 'card', 'split'])->sum('amount');

        // Stall-wise sales breakdown
        $stallSales = OrderItem::join('orders', 'order_items.order_id', '=', 'orders.id')
            ->join('stalls', 'order_items.stall_id', '=', 'stalls.id')
            ->whereDate('orders.created_at', $date)
            ->where('orders.payment_status', 'paid')
            ->where('order_items.status', '!=', 'cancelled')
            ->select(
                'stalls.id as stall_id',
                'stalls.name as stall_name',
                'stalls.code as stall_code',
                DB::raw('COUNT(DISTINCT orders.id) as total_bills_count'),
                DB::raw('COUNT(order_items.id) as total_items_sold'),
                DB::raw('SUM(order_items.subtotal) as stall_gross_sales')
            )
            ->groupBy('stalls.id', 'stalls.name', 'stalls.code')
            ->get();

        // Check if day is already closed
        $existingClosing = DailyClosing::with('settlements.stall.owner')->where('closing_date', $date)->first();

        // Four separate numbers, never merged: sales calculated, settlement payable, payout actually made, still outstanding.
        // The closing snapshot (payable_at_close) stays fixed; paid/outstanding move only with confirmed payouts.
        $settlements = $existingClosing?->settlements ?? collect();
        $payoutSummary = [
            'sales_calculated' => PayoutService::money($stallSales->sum('stall_gross_sales')),
            'settlement_payable_at_close' => PayoutService::money($settlements->sum(fn ($s) => (float) $s->payable_at_close)),
            'settlement_payable_now' => PayoutService::money($settlements->sum(fn ($s) => (float) $s->net_payable)),
            'payout_made' => PayoutService::money($settlements->sum(fn ($s) => (float) $s->paid_amount)),
            'outstanding' => PayoutService::money($settlements->sum(fn ($s) => (float) $s->remaining_amount)),
            'stalls_paid' => $settlements->where('payout_status', 'paid')->count(),
            'stalls_partially_paid' => $settlements->where('payout_status', 'partially_paid')->count(),
            'stalls_pending' => $settlements->where('payout_status', 'pending')->count(),
        ];

        return response()->json([
            'success' => true,
            'data' => [
                'date' => $date,
                'is_closed' => (bool) $existingClosing,
                'closing' => $existingClosing,
                'payout_summary' => $payoutSummary,
                'summary' => [
                    'total_orders' => $totalOrdersCount,
                    'gross_sales' => number_format($totalGrossSales, 2, '.', ''),
                    'discounts' => number_format($totalDiscounts, 2, '.', ''),
                    'net_sales' => number_format($totalNetSales, 2, '.', ''),
                    'tax_collected' => number_format($totalTax, 2, '.', ''),
                    'cash_collected' => number_format($cashCollected, 2, '.', ''),
                    'digital_collected' => number_format($digitalCollected, 2, '.', ''),
                ],
                'stall_breakdown' => $stallSales,
            ]
        ]);
    }

    /**
     * GET /settlements/stall-bills — review all bills contributing to stall sales on a business date.
     * Owner only. Returns order-level and item-level details per stall.
     */
    public function stallBills(Request $request)
    {
        $user = $request->user();
        if (!$user->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Owner access required.'], 403);
        }

        $validated = $request->validate([
            'date' => 'nullable|date',
            'stall_id' => 'nullable|integer|exists:stalls,id',
        ]);

        $date = $validated['date'] ?? now()->toDateString();
        $stallId = $validated['stall_id'] ?? null;

        $itemsQuery = OrderItem::with(['order.table', 'order.payments', 'stall'])
            ->join('orders', 'order_items.order_id', '=', 'orders.id')
            ->whereDate('orders.created_at', $date)
            ->where('orders.payment_status', 'paid')
            ->where('order_items.status', '!=', 'cancelled');

        if ($stallId) {
            $itemsQuery->where('order_items.stall_id', $stallId);
        }

        $items = $itemsQuery->select('order_items.*')->orderBy('orders.id', 'desc')->get();

        // Group by order and stall to form stall bill entries
        $grouped = $items->groupBy(fn ($item) => "{$item->order_id}_{$item->stall_id}");

        $bills = [];
        foreach ($grouped as $stallOrderItems) {
            $first = $stallOrderItems->first();
            $order = $first->order;
            $stall = $first->stall;

            $stallSubtotal = $stallOrderItems->sum('subtotal');
            $paymentMethod = $order->payments->first()?->payment_method ?? 'cash';

            $bills[] = [
                'order_id' => $order->id,
                'order_number' => $order->order_number,
                'created_at' => $order->created_at->toIso8601String(),
                'table_number' => $order->table?->table_number,
                'order_type' => $order->order_type,
                'order_channel' => $order->order_channel,
                'stall_id' => $stall->id,
                'stall_name' => $stall->name,
                'stall_code' => $stall->code,
                'items' => $stallOrderItems->map(fn ($i) => [
                    'id' => $i->id,
                    'item_name' => $i->item_name,
                    'quantity' => $i->quantity,
                    'unit_price' => number_format((float) $i->unit_price, 2, '.', ''),
                    'subtotal' => number_format((float) $i->subtotal, 2, '.', ''),
                ])->values(),
                'stall_subtotal' => number_format((float) $stallSubtotal, 2, '.', ''),
                'order_total_amount' => number_format((float) $order->total_amount, 2, '.', ''),
                'payment_method' => $paymentMethod,
                'payment_status' => $order->payment_status,
            ];
        }

        return response()->json([
            'success' => true,
            'data' => [
                'date' => $date,
                'stall_id' => $stallId,
                'total_bills' => count($bills),
                'total_sales' => number_format((float) array_sum(array_column($bills, 'stall_subtotal')), 2, '.', ''),
                'bills' => $bills,
            ],
        ]);
    }

    /** Historical daily closings with their stall settlement records (owner only). */
    public function closings(Request $request)
    {
        if (!$request->user()->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Owner access required.'], 403);
        }

        $closings = DailyClosing::with(['settlements.stall:id,name,code,stall_owner_id'])
            ->orderByDesc('closing_date')
            ->paginate($request->integer('per_page', 30));

        return response()->json(['success' => true, 'data' => $closings]);
    }

    public function closeDay(Request $request)
    {
        $user = $request->user();
        if (!$user->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Only Owner can perform EOD closing.'], 403);
        }

        $validated = $request->validate([
            'date' => 'required|date',
            'notes' => 'nullable|string',
        ]);

        $date = $validated['date'];

        if (DailyClosing::where('closing_date', $date)->exists()) {
            return response()->json(['success' => false, 'message' => 'Daily closing has already been executed for this date.'], 422);
        }

        return DB::transaction(function () use ($date, $validated, $user) {
            $completedOrders = Order::whereDate('created_at', $date)
                ->where('payment_status', 'paid')
                ->get();

            $totalOrdersCount = $completedOrders->count();
            $totalGrossSales = $completedOrders->sum('subtotal');
            $totalDiscounts = $completedOrders->sum('discount_amount');
            $totalNetSales = $completedOrders->sum('total_amount');

            $payments = Payment::whereDate('created_at', $date)->where('status', 'success')->get();
            $cashCollected = $payments->where('payment_method', 'cash')->sum('amount');
            $digitalCollected = $payments->whereIn('payment_method', ['upi_qr', 'card', 'split'])->sum('amount');

            $closing = DailyClosing::create([
                'closing_date' => $date,
                'closed_by_user_id' => $user->id,
                'total_orders_count' => $totalOrdersCount,
                'total_gross_sales' => $totalGrossSales,
                'total_discounts' => $totalDiscounts,
                'total_net_sales' => $totalNetSales,
                'total_cash_collected' => $cashCollected,
                'total_digital_collected' => $digitalCollected,
                'status' => 'closed',
                'notes' => $validated['notes'] ?? null,
            ]);

            // Create settlement record for each active stall
            $stalls = Stall::where('is_active', true)->get();

            foreach ($stalls as $stall) {
                $stallItems = OrderItem::join('orders', 'order_items.order_id', '=', 'orders.id')
                    ->where('order_items.stall_id', $stall->id)
                    ->whereDate('orders.created_at', $date)
                    ->where('orders.payment_status', 'paid')
                    ->where('order_items.status', '!=', 'cancelled')
                    ->select('order_items.*')
                    ->get();

                $stallGross = $stallItems->sum('subtotal');
                $itemCount = $stallItems->count();

                // Approved rule: the payable is the stall's recorded sales for the day (no commission or deduction is invented;
                // later deductions or corrections are explicit, audited adjustments). Closing records what is OWED. It never
                // marks anything paid: money is paid only when the owner confirms a payout (PayoutService).
                StallSettlementRecord::create([
                    'closing_id' => $closing->id,
                    'stall_id' => $stall->id,
                    'stall_gross_sales' => $stallGross,
                    'stall_item_count' => $itemCount,
                    'settlement_amount' => 0,
                    'settlement_status' => 'calculated',
                    'payable_at_close' => $stallGross,
                    'adjustment_amount' => 0,
                    'net_payable' => $stallGross,
                    'paid_amount' => 0,
                    'remaining_amount' => $stallGross,
                    'payout_status' => PayoutService::deriveStatus(PayoutService::money($stallGross), '0.00'),
                ]);
            }

            return response()->json([
                'success' => true,
                'message' => 'End of day closing executed successfully. Stall settlement records generated.',
                'data' => $closing->load('settlements.stall'),
            ], 201);
        });
    }

    public function recordSettlementPayment(Request $request, $recordId)
    {
        $user = $request->user();
        if (!$user->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
        }

        // Legacy single-shot endpoint, kept for older clients. It now records an ordinary ledger payout, so every
        // guard (no overpayment, audit trail, permanent record) applies. New clients use POST /settlements/{id}/payouts.
        $validated = $request->validate([
            'amount_paid' => 'required|decimal:0,2|min:0.01|max:9999999999.99',
            'paid_to_representative' => 'required|string|max:100',
            'payment_method' => 'required|in:cash,bank_transfer,upi',
            'notes' => 'nullable|string',
        ]);

        try {
            [$payout] = app(PayoutService::class)->record($user, (int) $recordId, [
                'amount' => $validated['amount_paid'],
                'payment_method' => $validated['payment_method'],
                'transaction_reference' => $validated['payment_method'] === 'cash' ? null : ($validated['notes'] ?? 'legacy-entry'),
                'received_by' => $validated['paid_to_representative'],
                'notes' => $validated['notes'] ?? null,
                'idempotency_key' => $request->header('Idempotency-Key'),
            ]);
        } catch (PayoutException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], $e->status);
        }

        $record = StallSettlementRecord::with('stall')->findOrFail($recordId);

        return response()->json([
            'success' => true,
            'message' => "Settlement payment recorded for stall {$record->stall->name}",
            'data' => $record,
            'payout' => $payout,
        ]);
    }
}

