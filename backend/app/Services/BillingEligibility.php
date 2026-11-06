<?php

namespace App\Services;

use App\Exceptions\BillingNotEligibleException;
use App\Models\Order;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The ONE rule for "may this order be billed?": every item of the order must be served or cancelled, and at least one
 * must be billable. It is derived from stall_ticket_items (the fulfilment source of truth, see FulfillmentService); an
 * order_item with no ticket item falls back to its own status. orders.status and ticket statuses are never consulted:
 * they are derived values and legitimately lag behind the items (e.g. an item added to a "served" order).
 *
 * Writers of money (BillingController::settle, UpiPaymentService::requestFor) must call assertBillable() inside their
 * transaction, after locking the order row. Every fulfilment writer locks that row first too, so the check and the
 * payment are one atomic step against the kitchen.
 */
class BillingEligibility
{
    public const BLOCKED_MESSAGE = 'Billing is unavailable. All order items must be Served or Cancelled before generating the final bill.';

    public const NOTHING_TO_BILL_MESSAGE = 'This order has no billable items: every item is cancelled. Cancel the order instead of generating a bill.';

    /** Raw item statuses (incl. the legacy picked_up) that no longer block billing. */
    private const TERMINAL_RAW = ['served', 'picked_up', 'cancelled'];

    private const STATUS_LABELS = ['pending' => 'Pending', 'preparing' => 'Cooking', 'ready' => 'Ready'];

    public function __construct(private readonly FulfillmentService $fulfillment)
    {
    }

    /** Unpaid or part-paid live orders that are ready for the cashier: the Pending Bills list and its dashboard count. */
    public function pendingBillsQuery(): Builder
    {
        return $this->openBillsQuery()
            ->whereNotExists($this->linesOf(fn (QueryBuilder $q) => $q->whereRaw($this->lineStatusNotIn())))
            ->whereExists($this->linesOf(fn (QueryBuilder $q) => $q->whereRaw("COALESCE(bsi.status, boi.status) <> 'cancelled'")));
    }

    /** How many open bills are still waiting for the kitchen (shown so hidden orders are not mistaken for settled ones). */
    public function awaitingFulfilmentCount(): int
    {
        return $this->openBillsQuery()
            ->whereExists($this->linesOf(fn (QueryBuilder $q) => $q->whereRaw($this->lineStatusNotIn())))
            ->count();
    }

    /**
     * Pending Bills rows: amounts reflect cancelled items, and only bills with something left to pay remain.
     *
     * @param  Collection<int, Order>  $orders
     * @return Collection<int, Order>
     */
    public function presentPendingBills(Collection $orders): Collection
    {
        return $orders->map(function (Order $order) {
            $this->applyRepricing($order, $this->evaluate($order));
            $order->total_paid = $order->totalPaid();
            $order->remaining_balance = $order->remainingBalance();

            return $order;
        })->filter(fn (Order $order) => bccomp((string) $order->remaining_balance, '0.00', 2) > 0)->values();
    }

    /**
     * The order's current billing state, read fresh from the database.
     *
     * @return array{eligible: bool, message: ?string, outstanding_items: array, cancelled_order_item_ids: int[], billable_subtotal: string}
     */
    public function evaluate(Order $order): array
    {
        $lines = DB::table('order_items as oi')
            ->leftJoin('stall_ticket_items as sti', 'sti.order_item_id', '=', 'oi.id')
            ->leftJoin('stalls as s', 's.id', '=', 'oi.stall_id')
            ->where('oi.order_id', $order->id)
            ->orderBy('oi.id')
            ->get(['oi.id', 'oi.item_name', 'oi.quantity', 'oi.subtotal', 'oi.status as line_status', 'sti.status as ticket_item_status', 's.name as stall_name']);

        $outstanding = [];
        $cancelled = [];
        $subtotal = '0.00';
        foreach ($lines as $line) {
            $status = $this->fulfillment->normalize((string) ($line->ticket_item_status ?? $line->line_status));
            if ($status === 'cancelled') {
                $cancelled[] = (int) $line->id;
                continue;
            }
            $subtotal = bcadd($subtotal, (string) $line->subtotal, 2);
            if ($status !== 'served') {
                $outstanding[] = [
                    'order_item_id' => (int) $line->id,
                    'name' => $line->item_name,
                    'quantity' => (int) $line->quantity,
                    'stall' => $line->stall_name,
                    'status' => $status,
                    'status_label' => self::STATUS_LABELS[$status] ?? ucfirst($status),
                ];
            }
        }

        $hasLiveLine = $lines->count() > count($cancelled);
        $message = $outstanding ? self::BLOCKED_MESSAGE : ($hasLiveLine ? null : self::NOTHING_TO_BILL_MESSAGE);

        return [
            'eligible' => $message === null,
            'message' => $message,
            'outstanding_items' => $outstanding,
            'cancelled_order_item_ids' => $cancelled,
            'billable_subtotal' => $subtotal,
        ];
    }

    /** Throws the API's refusal when the order may not be billed; returns the evaluation otherwise. */
    public function assertBillable(Order $order): array
    {
        $evaluation = $this->evaluate($order);
        if (!$evaluation['eligible']) {
            throw new BillingNotEligibleException($order, $evaluation);
        }

        return $evaluation;
    }

    /**
     * Drops cancelled items from the bill in memory, keeping the GST rate and mode the bill was priced with (a later
     * settings change never alters an existing bill). Returns true when the amounts changed; the caller decides to save.
     */
    public function applyRepricing(Order $order, array $evaluation): bool
    {
        if ($evaluation['cancelled_order_item_ids'] === []) {
            return false;
        }

        $priced = TaxService::calculate($evaluation['billable_subtotal'], [
            'enabled' => !in_array($order->tax_mode, [null, '', 'none'], true),
            'mode' => $order->tax_mode,
            'rate_percent' => (string) $order->tax_rate_percent,
        ]);
        if (bccomp((string) $order->total_amount, $priced['total_amount'], 2) === 0) {
            return false;
        }

        $order->forceFill([
            'subtotal' => $priced['subtotal'],
            'tax_amount' => $priced['tax_amount'],
            'total_amount' => $priced['total_amount'],
        ]);

        return true;
    }

    /** Persists a bill whose amounts changed because of cancelled items (call under the order lock). */
    public function persistRepricing(Order $order, array $evaluation, ?int $actorId): void
    {
        $before = (string) $order->total_amount;
        if ($this->applyRepricing($order, $evaluation)) {
            $order->save();
            AuditService::log('order_repriced_cancelled_items', 'Order', $order->id, null, ['total_amount' => $before], [
                'total_amount' => (string) $order->total_amount,
                'cancelled_order_item_ids' => $evaluation['cancelled_order_item_ids'],
            ], $actorId);
        }
    }

    private function openBillsQuery(): Builder
    {
        return Order::query()
            ->whereIn('orders.payment_status', ['unpaid', 'partially_paid'])
            ->where('orders.status', '!=', 'cancelled');
    }

    /** SQL condition: the line's effective status does not allow billing (an unknown status blocks too). */
    private function lineStatusNotIn(): string
    {
        $list = "'" . implode("','", self::TERMINAL_RAW) . "'";

        return "COALESCE(bsi.status, boi.status) NOT IN ({$list})";
    }

    /** Correlated subquery over the order's lines joined to their fulfilment records. */
    private function linesOf(\Closure $condition): \Closure
    {
        return function (QueryBuilder $sub) use ($condition) {
            $sub->selectRaw('1')
                ->from('order_items as boi')
                ->leftJoin('stall_ticket_items as bsi', 'bsi.order_item_id', '=', 'boi.id')
                ->whereColumn('boi.order_id', 'orders.id');
            $condition($sub);
        };
    }
}
