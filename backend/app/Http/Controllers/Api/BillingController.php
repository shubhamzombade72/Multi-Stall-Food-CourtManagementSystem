<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DiningTable;
use App\Models\Order;
use App\Models\Payment;
use App\Models\UpiPaymentRequest;
use App\Services\AuditService;
use App\Services\UpiPaymentService;
use App\Support\Sql;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class BillingController extends Controller
{
    public function getPendingBills(Request $request)
    {
        $user = $request->user();
        if (!$user->isOwner() && !$user->isCashier()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Only Cashier or Owner can view pending bills.'], 403);
        }

        $query = Order::with([
            'table',
            'items.stall:id,name,code',
            'kitchenTickets.stall:id,name,code',
            'payments.cashier:id,name',
        ])
            ->whereIn('payment_status', ['unpaid', 'partially_paid'])
            ->where('status', '!=', 'cancelled');

        if ($request->filled('search')) {
            $search = $request->query('search');
            $query->where(function ($q) use ($search) {
                $q->where('order_number', Sql::like(), "%{$search}%")
                  ->orWhere('customer_name', Sql::like(), "%{$search}%")
                  ->orWhereHas('table', function ($tq) use ($search) {
                      $tq->where('table_number', Sql::like(), "%{$search}%");
                  });
            });
        }

        if ($request->filled('table_id')) {
            $query->where('table_id', $request->query('table_id'));
        }

        $orders = $query->orderByDesc('id')->get()->map(function ($order) {
            $order->total_paid = $order->totalPaid();
            $order->remaining_balance = $order->remainingBalance();
            return $order;
        })->filter(function ($order) {
            return in_array($order->payment_status, ['unpaid', 'partially_paid'], true)
                && bccomp((string) $order->remaining_balance, '0.00', 2) > 0;
        })->values();

        return response()->json([
            'success' => true,
            'data' => $orders,
            'count' => $orders->count(),
        ]);
    }

    public function processPayment(Request $request)
    {
        $cashier = $request->user();
        if (!$cashier->isOwner() && !$cashier->isCashier()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Cashier or Owner privileges required to process payments.'], 403);
        }

        $upiVerified = $request->input('payment_method') === 'upi_qr' && UpiPaymentService::isActive();
        $upiRules = $upiVerified ? [
            'upi_reference' => 'required|string|max:40',
            'transaction_reference' => ['nullable', 'string', 'regex:/^[A-Za-z0-9]{6,40}$/'],
            'payment_verified' => 'accepted',
        ] : [
            'upi_reference' => 'nullable|string|max:40',
        ];

        $validated = $request->validate(array_merge([
            'order_id' => 'required|exists:orders,id',
            'payment_method' => 'required|in:' . implode(',', SettingsController::enabledPaymentMethods()),
            'amount' => 'required|numeric|min:0.01',
            'cash_tendered' => 'nullable|numeric|min:0',
            'transaction_reference' => 'nullable|string|max:100',
        ], $upiRules), [
            'payment_verified.accepted' => 'Confirm that you have verified the payment in the merchant UPI app or bank statement.',
            'transaction_reference.regex' => 'Enter the UPI transaction / bank reference (UTR): 6-40 letters or digits.',
            'upi_reference.required' => 'Generate the UPI QR for this bill first.',
        ]);

        try {
            return $this->settle($validated, $cashier, $upiVerified);
        } catch (UniqueConstraintViolationException $e) {
            throw ValidationException::withMessages(['transaction_reference' => 'This UPI reference was already used for another payment.']);
        }
    }

    private function settle(array $validated, $cashier, bool $upiVerified)
    {
        return DB::transaction(function () use ($validated, $cashier, $upiVerified) {
            $order = Order::where('id', $validated['order_id'])->lockForUpdate()->firstOrFail();

            if ($order->payment_status === 'paid') {
                abort(422, 'This order has already been paid in full.');
            }

            if ($order->status === 'cancelled') {
                abort(422, 'Cannot take payment for a cancelled order.');
            }

            $amount = bcadd((string) $validated['amount'], '0', 2);
            $remaining = $order->remainingBalance();

            if (bccomp($remaining, '0.00', 2) <= 0) {
                abort(422, 'This order has already been paid in full.');
            }

            if (bccomp($amount, '0.00', 2) <= 0) {
                abort(422, 'Payment amount must be greater than zero.');
            }

            if (bccomp($amount, $remaining, 2) > 0) {
                abort(422, "Payment amount {$amount} exceeds remaining balance {$remaining}.");
            }

            $cashTendered = bcadd((string) ($validated['cash_tendered'] ?? $amount), '0', 2);
            $changeReturned = '0.00';

            if ($validated['payment_method'] === 'cash') {
                if (bccomp($cashTendered, $amount, 2) < 0) {
                    abort(422, 'Cash tendered is less than the payment amount.');
                }
                $changeReturned = bcsub($cashTendered, $amount, 2);
            }

            $upiRequest = null;
            if ($upiVerified) {
                $upiRequest = UpiPaymentRequest::where('reference', $validated['upi_reference'])
                    ->where('order_id', $order->id)
                    ->lockForUpdate()
                    ->first();

                if (!$upiRequest || !$upiRequest->isOpen()) {
                    abort(422, 'This UPI QR is not valid for this bill any more. Generate a fresh QR and try again.');
                }
                if (bccomp((string) $upiRequest->amount, $amount, 2) !== 0 || $upiRequest->vpa !== strtolower((string) UpiPaymentService::config()['vpa'])) {
                    abort(422, 'The UPI QR does not match the bill amount or the merchant UPI ID. Generate a fresh QR and try again.');
                }
                if (!empty($validated['transaction_reference'])
                    && Payment::where('payment_method', 'upi_qr')->where('transaction_reference', $validated['transaction_reference'])->exists()) {
                    throw ValidationException::withMessages(['transaction_reference' => 'This UPI reference was already used for another payment.']);
                }
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

            $order->recalculatePaymentStatus($cashier->id);

            if ($upiRequest) {
                $was = $upiRequest->status;
                $upiRequest->update([
                    'status' => 'paid',
                    'payment_id' => $payment->id,
                    'verification_method' => 'manual',
                    'verified_by_user_id' => $cashier->id,
                    'verified_at' => now(),
                ]);
                AuditService::log('upi_payment_confirmed', 'UpiPaymentRequest', $upiRequest->id, null, ['status' => $was], [
                    'status' => 'paid',
                    'verification_method' => 'manual',
                    'order_id' => $order->id,
                    'payment_id' => $payment->id,
                    'reference' => $upiRequest->reference,
                    'vpa' => $upiRequest->vpa,
                    'amount' => (string) $upiRequest->amount,
                    'transaction_reference' => $payment->transaction_reference,
                    'verified_by_user_id' => $cashier->id,
                ], $cashier->id);
            }

            $order->refresh();
            $isFullyPaid = ($order->payment_status === 'paid');

            try {
                event(new \App\Events\PaymentCompletedEvent($payment));
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning('Broadcast PaymentCompletedEvent failed: ' . $e->getMessage());
            }

            return response()->json([
                'success' => true,
                'message' => $isFullyPaid ? 'Payment recorded successfully. Bill settled.' : 'Payment recorded successfully.',
                'data' => [
                    'payment' => $payment,
                    'order' => $order->fresh(['table', 'items.stall', 'payments']),
                    'change_returned' => $changeReturned,
                    'is_fully_paid' => $isFullyPaid,
                    'remaining_balance' => $order->fresh()->remainingBalance(),
                ]
            ]);
        });
    }

    /** Payment history for the cashier counter / owner, newest first, filterable by date and method. */
    public function paymentHistory(Request $request)
    {
        $user = $request->user();
        if (!$user->isOwner() && !$user->isCashier()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Only Cashier or Owner can view payments.'], 403);
        }

        $request->validate([
            'date' => 'nullable|date',
            'payment_method' => 'nullable|in:cash,upi_qr,card,split',
            'per_page' => 'nullable|integer|min:1|max:200',
        ]);

        $query = Payment::with([
            'order:id,order_number,table_id,order_channel,total_amount',
            'order.table:id,table_number',
            'orderSplit:id,split_code,split_number',
            'cashier:id,name'
        ])->orderByDesc('id');

        if ($request->filled('date')) {
            $query->whereDate('created_at', $request->query('date'));
        }
        if ($request->filled('payment_method')) {
            $query->where('payment_method', $request->query('payment_method'));
        }

        return response()->json(['success' => true, 'data' => $query->paginate($request->integer('per_page', 50))]);
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

        $itemsByStall = $order->items->groupBy('stall.name');

        return response()->json([
            'success' => true,
            'data' => [
                'order' => $order,
                'total_paid' => $order->totalPaid(),
                'remaining_balance' => $order->remainingBalance(),
                'stall_breakdown' => $itemsByStall,
                'upi_enabled' => UpiPaymentService::isActive(),
                'upi' => $this->receiptUpi($order),
            ]
        ]);
    }

    /**
     * The UPI details a receipt prints.
     */
    private function receiptUpi(Order $order): ?array
    {
        $paid = UpiPaymentRequest::with('verifiedBy:id,name')
            ->where('order_id', $order->id)
            ->where('status', 'paid')
            ->latest('id')
            ->first();
        if ($paid) {
            return $paid->toReceiptArray();
        }

        if ($order->payment_status === 'paid' || $order->status === 'cancelled' || !UpiPaymentService::isActive()) {
            return null;
        }

        $pending = UpiPaymentRequest::where('order_id', $order->id)
            ->whereIn('status', UpiPaymentRequest::OPEN)
            ->latest('id')
            ->first();
        if ($pending && $pending->vpa === strtolower((string) UpiPaymentService::config()['vpa'])
            && bccomp((string) $pending->amount, (string) $order->total_amount, 2) === 0) {
            return $pending->toReceiptArray();
        }

        return null;
    }

    public function upiRequestStatus(Request $request, $reference, UpiPaymentService $upi)
    {
        $user = $request->user();
        if (!$user->isOwner() && !$user->isCashier()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Only Cashier or Owner can update a UPI status.'], 403);
        }

        $validated = $request->validate([
            'status' => 'required|in:initiated,failed,cancelled',
            'reason' => 'nullable|string|max:255',
        ]);

        $updated = $upi->transition((string) $reference, $validated['status'], $user, $validated['reason'] ?? null);

        return response()->json(['success' => true, 'data' => $updated->toReceiptArray()]);
    }

    public function upiRequest(Request $request, $orderId, UpiPaymentService $upi)
    {
        $user = $request->user();
        if (!$user->isOwner() && !$user->isCashier()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Only Cashier or Owner can create a UPI QR.'], 403);
        }

        $upiRequest = $upi->requestFor(Order::findOrFail($orderId), $user);

        return response()->json(['success' => true, 'data' => $upiRequest->toReceiptArray()]);
    }
}
