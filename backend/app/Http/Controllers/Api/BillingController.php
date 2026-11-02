<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DiningTable;
use App\Models\Order;
use App\Models\Payment;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class BillingController extends Controller
{
    public function getPendingBills(Request $request)
    {
        $user = $request->user();
        if (!$user->isOwner() && !$user->isCashier()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Only Cashier or Owner can view pending bills.'], 403);
        }

        $query = Order::with(['table', 'items.stall:id,name,code', 'kitchenTickets.stall:id,name,code', 'payments'])
            ->where('payment_status', 'unpaid')
            ->where('status', '!=', 'cancelled');

        if ($request->filled('search')) {
            $search = $request->query('search');
            $query->where(function ($q) use ($search) {
                $q->where('order_number', 'ilike', "%{$search}%")
                  ->orWhere('customer_name', 'ilike', "%{$search}%");
            });
        }

        if ($request->filled('table_id')) {
            $query->where('table_id', $request->query('table_id'));
        }

        $orders = $query->orderByDesc('id')->get();

        return response()->json([
            'success' => true,
            'data' => $orders,
        ]);
    }

    public function processPayment(Request $request)
    {
        $cashier = $request->user();
        if (!$cashier->isOwner() && !$cashier->isCashier()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Cashier or Owner privileges required to process payments.'], 403);
        }

        $validated = $request->validate([
            'order_id' => 'required|exists:orders,id',
            'payment_method' => 'required|in:cash,upi_qr,card,split',
            'amount' => 'required|numeric|min:0.01',
            'cash_tendered' => 'nullable|numeric|min:0',
            'transaction_reference' => 'nullable|string|max:100',
        ]);

        return DB::transaction(function () use ($validated, $cashier) {
            $order = Order::where('id', $validated['order_id'])->lockForUpdate()->firstOrFail();

            if ($order->payment_status === 'paid') {
                abort(422, 'This order has already been paid in full.');
            }

            if ($order->status === 'cancelled') {
                abort(422, 'Cannot take payment for a cancelled order.');
            }

            // A single payment settles the whole bill, so it must equal the server-side total exactly
            $amount = bcadd((string) $validated['amount'], '0', 2);
            if (bccomp($amount, (string) $order->total_amount, 2) !== 0) {
                abort(422, "Payment amount {$amount} does not match the bill total {$order->total_amount}.");
            }

            $cashTendered = bcadd((string) ($validated['cash_tendered'] ?? $amount), '0', 2);
            $changeReturned = '0.00';

            if ($validated['payment_method'] === 'cash') {
                if (bccomp($cashTendered, $amount, 2) < 0) {
                    abort(422, 'Cash tendered is less than the total bill amount.');
                }
                $changeReturned = bcsub($cashTendered, $amount, 2);
            }

            $payment = Payment::create([
                'order_id' => $order->id,
                'cashier_id' => $cashier->id,
                'payment_method' => $validated['payment_method'],
                'amount' => $amount,
                'cash_tendered' => $cashTendered,
                'change_returned' => $changeReturned,
                'transaction_reference' => $validated['transaction_reference'] ?? null,
                'status' => 'success',
            ]);

            $order->update([
                'payment_status' => 'paid',
                'status' => 'completed',
                'cashier_id' => $cashier->id,
            ]);

            // Release table if dine-in
            if ($order->table_id) {
                DiningTable::where('id', $order->table_id)->update(['status' => 'available']);
            }

            try {
                event(new \App\Events\PaymentCompletedEvent($payment));
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning('Broadcast PaymentCompletedEvent failed: ' . $e->getMessage());
            }

            return response()->json([
                'success' => true,
                'message' => 'Payment recorded successfully. Bill settled.',
                'data' => [
                    'payment' => $payment,
                    'order' => $order->fresh(['table', 'items.stall', 'payments']),
                    'change_returned' => $changeReturned,
                ]
            ]);
        });
    }

    public function getOrderReceipt(Request $request, $orderId)
    {
        $user = $request->user();
        if (!$user->isOwner() && !$user->isCashier()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Only Cashier or Owner can view receipts.'], 403);
        }

        $order = Order::with([
            'table',
            'items.stall:id,name,code',
            'payments.cashier:id,name',
            'waiter:id,name',
            'cashier:id,name'
        ])->findOrFail($orderId);

        // Group items by stall for itemized receipt
        $itemsByStall = $order->items->groupBy('stall.name');

        return response()->json([
            'success' => true,
            'data' => [
                'order' => $order,
                'stall_breakdown' => $itemsByStall,
            ]
        ]);
    }
}

