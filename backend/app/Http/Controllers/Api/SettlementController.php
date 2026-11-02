<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DailyClosing;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\Stall;
use App\Models\StallSettlementRecord;
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
            ->select(
                'stalls.id as stall_id',
                'stalls.name as stall_name',
                'stalls.code as stall_code',
                DB::raw('COUNT(order_items.id) as total_items_sold'),
                DB::raw('SUM(order_items.subtotal) as stall_gross_sales')
            )
            ->groupBy('stalls.id', 'stalls.name', 'stalls.code')
            ->get();

        // Check if day is already closed
        $existingClosing = DailyClosing::with('settlements.stall')->where('closing_date', $date)->first();

        return response()->json([
            'success' => true,
            'data' => [
                'date' => $date,
                'is_closed' => (bool) $existingClosing,
                'closing' => $existingClosing,
                'summary' => [
                    'total_orders' => $totalOrdersCount,
                    'gross_sales' => number_format($totalGrossSales, 2, '.', ''),
                    'discounts' => number_format($totalDiscounts, 2, '.', ''),
                    'net_sales' => number_format($totalNetSales, 2, '.', ''),
                    'cash_collected' => number_format($cashCollected, 2, '.', ''),
                    'digital_collected' => number_format($digitalCollected, 2, '.', ''),
                ],
                'stall_breakdown' => $stallSales,
            ]
        ]);
    }

    /** Historical daily closings with their stall settlement records (owner only). */
    public function closings(Request $request)
    {
        if (!$request->user()->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Owner access required.'], 403);
        }

        $closings = DailyClosing::with(['settlements.stall:id,name,code'])
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
                    ->select('order_items.*')
                    ->get();

                $stallGross = $stallItems->sum('subtotal');
                $itemCount = $stallItems->count();

                // The settlement formula is an UNRESOLVED owner decision: no payable amount is derived here.
                // Gross sales are recorded as fact; the owner enters the amount actually paid (recordSettlementPayment).
                StallSettlementRecord::create([
                    'closing_id' => $closing->id,
                    'stall_id' => $stall->id,
                    'stall_gross_sales' => $stallGross,
                    'stall_item_count' => $itemCount,
                    'settlement_amount' => 0,
                    'settlement_status' => 'calculated',
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

        $validated = $request->validate([
            'amount_paid' => 'required|decimal:0,2|min:0|max:9999999999.99',
            'paid_to_representative' => 'required|string|max:100',
            'payment_method' => 'required|in:cash,bank_transfer,upi',
            'notes' => 'nullable|string',
        ]);

        $record = DB::transaction(function () use ($recordId, $validated) {
            $record = StallSettlementRecord::with('stall')->where('id', $recordId)->lockForUpdate()->firstOrFail();

            // A recorded settlement payment is history; it must never be silently overwritten
            if ($record->settlement_status === 'paid') {
                abort(422, 'This stall settlement has already been recorded as paid.');
            }

            $record->update([
                'settlement_amount' => $validated['amount_paid'],
                'settlement_status' => 'paid',
                'paid_to_representative' => $validated['paid_to_representative'],
                'payment_method' => $validated['payment_method'],
                'paid_at' => now(),
                'notes' => $validated['notes'] ?? null,
            ]);

            return $record;
        });

        return response()->json([
            'success' => true,
            'message' => "Settlement payment recorded for stall {$record->stall->name}",
            'data' => $record,
        ]);
    }
}

