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
        $orders = Order::with(['table', 'items.stall:id,name,code', 'payments'])
            ->where('payment_status', 'unpaid')
            ->where('status', '!=', 'cancelled')
            ->orderByDesc('id')
            ->get();

        return response()->json([
            'success' => true,
            'data' => $orders,
        ]);
    }

    public function processPayment(Request $request)
    {
        $cashier = $request->user();

        $validated = $request->validate([
            'order_id' => 'required|exists:orders,id',
            'payment_method' => 'required|in:cash,upi_qr,card,split',
            'amount' => 'required|numeric|min:0.01',
            'cash_tendered' => 'nullable|numeric|min:0',
            'transaction_reference' => 'nullable|string|max:100',
        ]);

        $order = Order::with('items.stall')->findOrFail($validated['order_id']);

        if ($order->payment_status === 'paid') {
            return response()->json([
                'success' => false,
                'message' => 'This order has already been paid in full.',
            ], 422);
        }

        return DB::transaction(function () use ($validated, $order, $cashier) {
            $amount = $validated['amount'];
            $cashTendered = $validated['cash_tendered'] ?? $amount;
            $changeReturned = 0;

            if ($validated['payment_method'] === 'cash') {
                if ($cashTendered < $amount) {
                    abort(422, 'Cash tendered is less than the total bill amount.');
                }
                $changeReturned = bcsub((string) $cashTendered, (string) $amount, 2);
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

    public function getOrderReceipt($orderId)
    {
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

