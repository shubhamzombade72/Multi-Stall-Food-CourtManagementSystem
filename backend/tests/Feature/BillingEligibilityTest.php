<?php

namespace Tests\Feature;

use App\Models\DailyClosing;
use App\Models\MenuItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\Setting;
use App\Models\StallSettlementRecord;
use App\Models\StallTicketItem;
use App\Models\UpiPaymentRequest;
use App\Models\User;
use App\Services\BillingEligibility;
use App\Services\FulfillmentService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Concerns\ServesOrders;
use Tests\TestCase;

/**
 * An order may be billed only when every item is served or cancelled, whichever API path is used.
 * In-process tests; genuinely concurrent requests are in BillingConcurrencyTest.
 */
class BillingEligibilityTest extends TestCase
{
    use DatabaseTransactions;
    use ServesOrders;

    private const BLOCKED = 'Billing is unavailable. All order items must be Served or Cancelled before generating the final bill.';

    private function cashier(): User
    {
        return User::where('role', 'cashier')->where('is_active', true)->firstOrFail();
    }

    private function owner(): User
    {
        return User::where('role', 'owner')->where('is_active', true)->firstOrFail();
    }

    /** Places an order through the real API: $perStall items from each of the first count($perStall) stalls with enough dishes. */
    private function placeOrder(array $perStall): Order
    {
        $stallIds = MenuItem::where('is_available', true)->whereHas('stall', fn ($q) => $q->where('is_active', true))
            ->select('stall_id')->groupBy('stall_id')->havingRaw('COUNT(*) >= ?', [max($perStall)])->orderBy('stall_id')
            ->limit(count($perStall))->pluck('stall_id');
        $this->assertCount(count($perStall), $stallIds, 'Seed needs more stalls with enough dishes');

        $items = [];
        foreach ($perStall as $i => $count) {
            foreach (MenuItem::where('stall_id', $stallIds[$i])->where('is_available', true)->orderBy('id')->take($count)->get() as $menu) {
                $items[] = ['menu_item_id' => $menu->id, 'quantity' => 1];
            }
        }

        $id = $this->actingAs($this->cashier(), 'sanctum')
            ->postJson('/api/orders', ['order_type' => 'takeaway', 'items' => $items])
            ->assertCreated()->json('data.id');

        return Order::findOrFail($id);
    }

    private function ticketItems(Order $order)
    {
        return StallTicketItem::whereHas('ticket', fn ($q) => $q->where('order_id', $order->id))->orderBy('id')->get();
    }

    /** Sets each item (in id order) through the real fulfilment service; 'cancelled' has no per-item API, so it is written directly. */
    private function setItems(Order $order, array $statuses): void
    {
        foreach ($this->ticketItems($order)->values() as $i => $item) {
            $to = $statuses[$i] ?? null;
            if ($to === 'cancelled') {
                $this->cancelItem($item);
            } elseif ($to !== null && $to !== 'pending') {
                app(FulfillmentService::class)->transitionItem($item->id, $to, $this->owner());
            }
        }
    }

    private function cancelItem(StallTicketItem $item): void
    {
        $item->update(['status' => 'cancelled']);
        OrderItem::whereKey($item->order_item_id)->update(['status' => 'cancelled']);
    }

    private function pay(Order $order, ?string $amount = null, array $extra = [])
    {
        return $this->actingAs($this->cashier(), 'sanctum')->postJson('/api/billing/pay', [
            'order_id' => $order->id,
            'payment_method' => 'cash',
            'amount' => $amount ?? (string) $order->fresh()->total_amount,
        ] + $extra);
    }

    private function pendingIds(): array
    {
        return collect($this->actingAs($this->cashier(), 'sanctum')->getJson('/api/billing/pending')->assertOk()->json('data'))->pluck('id')->all();
    }

    private function assertBlockedWithoutSideEffects($response, Order $order, array $before): void
    {
        $response->assertStatus(422)->assertJsonPath('message', self::BLOCKED)->assertJsonPath('error', 'billing_not_eligible');
        $this->assertSame(0, Payment::where('order_id', $order->id)->count());
        $fresh = $order->fresh();
        $this->assertSame($before['payment_status'], $fresh->payment_status);
        $this->assertSame($before['status'], $fresh->status);
        $this->assertSame(0, UpiPaymentRequest::where('order_id', $order->id)->count());
    }

    // ---- the billing eligibility table ------------------------------------------------------------------------------

    public function test_all_items_served_allows_billing_for_the_full_amount(): void
    {
        $order = $this->placeOrder([5]);
        $this->assertNotContains($order->id, $this->pendingIds());

        $this->setItems($order, array_fill(0, 5, 'served'));
        $this->assertContains($order->id, $this->pendingIds());

        $this->pay($order)->assertOk()->assertJsonPath('data.is_fully_paid', true);
        $this->assertSame('paid', $order->fresh()->payment_status);
        $this->assertSame((string) $order->total_amount, (string) Payment::where('order_id', $order->id)->sole()->amount);
        $this->assertNotContains($order->id, $this->pendingIds());
    }

    public static function nonTerminalMixes(): array
    {
        return [
            'the reported bug: 3 served + cooking + pending' => [['served', 'served', 'served', 'preparing', 'pending'], ['Cooking', 'Pending']],
            'served + pending' => [['served', 'served', 'served', 'pending', 'pending'], ['Pending', 'Pending']],
            'served + cooking' => [['served', 'served', 'served', 'preparing', 'preparing'], ['Cooking', 'Cooking']],
            'served + ready' => [['served', 'served', 'served', 'served', 'ready'], ['Ready']],
            'served + pending + cancelled' => [['served', 'served', 'pending', 'cancelled', 'cancelled'], ['Pending']],
        ];
    }

    #[DataProvider('nonTerminalMixes')]
    public function test_every_billing_path_is_blocked_while_an_item_is_not_terminal(array $statuses, array $labels): void
    {
        Setting::updateOrCreate(['key' => 'payment_methods'], ['value' => ['enabled' => ['cash', 'upi_qr', 'card']]]);
        Setting::updateOrCreate(['key' => 'upi'], ['value' => ['enabled' => true, 'vpa' => 'mangalmurti@oksbi']]);

        $order = $this->placeOrder([5]);
        $this->setItems($order, $statuses);
        $before = $order->fresh()->only(['status', 'payment_status']);

        $this->assertNotContains($order->id, $this->pendingIds());

        $pay = $this->pay($order);
        $this->assertBlockedWithoutSideEffects($pay, $order, $before);
        $this->assertSame($labels, collect($pay->json('data.outstanding_items'))->pluck('status_label')->all());

        $this->assertBlockedWithoutSideEffects($this->actingAs($this->cashier(), 'sanctum')->getJson("/api/billing/orders/{$order->id}/open"), $order, $before);
        $this->assertBlockedWithoutSideEffects($this->actingAs($this->cashier(), 'sanctum')->getJson("/api/billing/receipt/{$order->id}"), $order, $before);
        $this->assertBlockedWithoutSideEffects($this->actingAs($this->cashier(), 'sanctum')->postJson("/api/billing/orders/{$order->id}/upi-request"), $order, $before);

        $this->actingAs($this->cashier(), 'sanctum')->getJson("/api/orders/{$order->id}")
            ->assertOk()->assertJsonPath('data.billing.eligible', false)->assertJsonPath('data.billing.message', self::BLOCKED);
    }

    public function test_a_part_payment_cannot_slip_through_on_an_unfinished_order(): void
    {
        $order = $this->placeOrder([2]);
        $this->setItems($order, ['served', 'pending']);
        $before = $order->fresh()->only(['status', 'payment_status']);

        $this->assertBlockedWithoutSideEffects($this->pay($order, '1.00'), $order, $before);
    }

    public function test_all_items_cancelled_never_produces_a_bill(): void
    {
        $order = $this->placeOrder([2]);
        $this->setItems($order, ['cancelled', 'cancelled']);

        $this->assertNotContains($order->id, $this->pendingIds());
        $this->pay($order)->assertStatus(422)->assertJsonPath('message', BillingEligibility::NOTHING_TO_BILL_MESSAGE);
        $this->actingAs($this->cashier(), 'sanctum')->getJson("/api/billing/receipt/{$order->id}")->assertStatus(422);
        $this->assertSame(0, Payment::where('order_id', $order->id)->count());

        // The existing rule for an order nobody will pay for still works
        $this->actingAs($this->cashier(), 'sanctum')->postJson("/api/orders/{$order->id}/cancel", ['reason' => 'All items cancelled'])->assertOk();
    }

    // ---- multi-stall ------------------------------------------------------------------------------------------------

    public function test_multi_stall_partial_fulfilment_blocks_the_whole_order(): void
    {
        $order = $this->placeOrder([2, 3]);
        // Stall A finished both items, stall B only one of three
        $this->setItems($order, ['served', 'served', 'served', 'preparing', 'pending']);
        $before = $order->fresh()->only(['status', 'payment_status']);

        $this->assertNotContains($order->id, $this->pendingIds());
        $pay = $this->pay($order);
        $this->assertBlockedWithoutSideEffects($pay, $order, $before);
        $this->assertCount(2, $pay->json('data.outstanding_items'));
    }

    public function test_multi_stall_complete_fulfilment_bills_all_items_once(): void
    {
        $order = $this->placeOrder([2, 3]);
        $this->setItems($order, array_fill(0, 5, 'served'));

        $rows = collect($this->actingAs($this->cashier(), 'sanctum')->getJson('/api/billing/pending')->json('data'))->where('id', $order->id);
        $this->assertCount(1, $rows, 'A multi-stall order must appear exactly once');
        $this->assertCount(5, $rows->first()['items']);

        $this->pay($order)->assertOk();
    }

    // ---- the source of truth ----------------------------------------------------------------------------------------

    public function test_parent_order_status_never_overrides_the_item_records(): void
    {
        $order = $this->placeOrder([2]);
        $this->setItems($order, ['served', 'pending']);
        // Whatever the derived statuses say, the pending item decides
        $order->update(['status' => 'served']);
        DB::table('stall_kitchen_tickets')->where('order_id', $order->id)->update(['status' => 'picked_up']);

        $this->assertNotContains($order->id, $this->pendingIds());
        $this->pay($order)->assertStatus(422)->assertJsonPath('error', 'billing_not_eligible');
    }

    public function test_the_ticket_item_wins_over_a_drifted_order_item_mirror(): void
    {
        $order = $this->placeOrder([1]);
        $item = $this->ticketItems($order)->first();
        OrderItem::whereKey($item->order_item_id)->update(['status' => 'served']); // mirror claims served, ticket item is pending

        $this->assertNotContains($order->id, $this->pendingIds());
        $this->pay($order)->assertStatus(422);
    }

    public function test_legacy_item_statuses_keep_their_meaning(): void
    {
        $served = $this->placeOrder([1]);
        $this->ticketItems($served)->first()->update(['status' => 'picked_up']);
        $this->assertContains($served->id, $this->pendingIds());

        $waiting = $this->placeOrder([1]);
        $this->ticketItems($waiting)->first()->update(['status' => 'accepted']);
        $this->assertNotContains($waiting->id, $this->pendingIds());
        $this->assertSame('Pending', $this->pay($waiting)->assertStatus(422)->json('data.outstanding_items.0.status_label'));
    }

    public function test_an_order_line_without_a_ticket_item_uses_its_own_status(): void
    {
        $order = $this->placeOrder([2]);
        $this->setItems($order, ['served', 'served']);
        $this->assertContains($order->id, $this->pendingIds());

        $extra = $this->ticketItems($order)->last();
        OrderItem::whereKey($extra->order_item_id)->update(['status' => 'pending']);
        $extra->delete();

        $this->assertNotContains($order->id, $this->pendingIds());
        $this->pay($order)->assertStatus(422);
    }

    public function test_an_order_with_no_items_is_not_a_bill(): void
    {
        $order = Order::create(['order_type' => 'takeaway', 'order_channel' => 'cashier_pos', 'status' => 'confirmed', 'subtotal' => 50, 'tax_amount' => 0, 'discount_amount' => 0, 'total_amount' => 50, 'payment_status' => 'unpaid']);

        $this->assertNotContains($order->id, $this->pendingIds());
        $this->pay($order)->assertStatus(422);
    }

    // ---- cancelled items and the amount -----------------------------------------------------------------------------

    public function test_cancelled_item_is_excluded_from_the_amount_keeping_the_gst_the_bill_was_priced_with(): void
    {
        $owner = $this->owner();
        $this->actingAs($owner, 'sanctum')->putJson('/api/settings/tax', ['enabled' => true, 'mode' => 'exclusive', 'rate_percent' => '5.00', 'apply_to' => 'all'])->assertOk();

        $order = $this->placeOrder([3]);
        $lines = OrderItem::where('order_id', $order->id)->orderBy('id')->get();
        $keep = bcadd((string) $lines[0]->subtotal, (string) $lines[1]->subtotal, 2);
        $expectedTax = number_format(round(((float) $keep) * 0.05 + 1e-9, 2), 2, '.', '');
        $expectedTotal = bcadd($keep, $expectedTax, 2);

        // A later settings change must not re-price this bill
        $this->actingAs($owner, 'sanctum')->putJson('/api/settings/tax', ['enabled' => true, 'mode' => 'exclusive', 'rate_percent' => '18.00', 'apply_to' => 'all'])->assertOk();

        $this->setItems($order, ['served', 'served', 'cancelled']);

        $row = collect($this->actingAs($this->cashier(), 'sanctum')->getJson('/api/billing/pending')->json('data'))->firstWhere('id', $order->id);
        $this->assertSame($expectedTotal, $row['total_amount']);
        $this->assertSame($expectedTotal, $row['remaining_balance']);
        $this->actingAs($this->cashier(), 'sanctum')->getJson("/api/billing/orders/{$order->id}/open")
            ->assertOk()->assertJsonPath('data.remaining_balance', $expectedTotal);
        $this->assertNotSame($expectedTotal, (string) $order->fresh()->total_amount, 'Reads must not write');

        // The original (too high) amount is refused; the corrected one settles the bill
        $this->pay($order, (string) $order->total_amount)->assertStatus(422);
        $this->pay($order, $expectedTotal)->assertOk()->assertJsonPath('data.is_fully_paid', true);

        $fresh = $order->fresh();
        $this->assertSame($expectedTotal, (string) $fresh->total_amount);
        $this->assertSame($keep, (string) $fresh->subtotal);
        $this->assertSame($expectedTax, (string) $fresh->tax_amount);
        $this->assertSame('5.00', (string) $fresh->tax_rate_percent);
        $this->assertDatabaseHas('audit_logs', ['action' => 'order_repriced_cancelled_items', 'entity_id' => $order->id]);

        // The receipt does not list the cancelled line
        $receipt = $this->actingAs($this->cashier(), 'sanctum')->getJson("/api/billing/receipt/{$order->id}")->assertOk();
        $this->assertCount(2, $receipt->json('data.order.items'));
        $this->assertSame($expectedTotal, $receipt->json('data.order.total_amount'));
    }

    // ---- stale screens and double submits ---------------------------------------------------------------------------

    public function test_a_bill_opened_before_an_item_was_added_is_rejected_on_the_latest_state(): void
    {
        $order = $this->placeOrder([1]);
        $this->setItems($order, ['served']);
        $opened = $this->actingAs($this->cashier(), 'sanctum')->getJson("/api/billing/orders/{$order->id}/open")->assertOk()->json('data');

        // While the payment dialog is open the waiter adds a dish
        $menu = MenuItem::where('is_available', true)->where('id', '!=', OrderItem::where('order_id', $order->id)->value('menu_item_id'))->firstOrFail();
        $this->actingAs($this->cashier(), 'sanctum')->postJson("/api/orders/{$order->id}/items", ['menu_item_id' => $menu->id])->assertOk();

        $this->pay($order, $opened['remaining_balance'], ['expected_balance' => $opened['remaining_balance']])
            ->assertStatus(422)->assertJsonPath('error', 'billing_not_eligible');
        $this->assertSame(0, Payment::where('order_id', $order->id)->count());
        $this->assertNotContains($order->id, $this->pendingIds());

        // Once it is served the bill comes back with the new amount, and the old on-screen figure is not accepted as final
        $this->serveAllItems($order);
        $this->assertContains($order->id, $this->pendingIds());
        $this->pay($order, $opened['remaining_balance'], ['expected_balance' => $opened['remaining_balance']])
            ->assertStatus(409)->assertJsonPath('error', 'balance_changed');
        $this->assertSame(0, Payment::where('order_id', $order->id)->count());
        $this->pay($order)->assertOk();
    }

    public function test_repeated_payment_requests_create_one_payment(): void
    {
        $order = $this->placeOrder([1]);
        $this->setItems($order, ['served']);

        $this->pay($order)->assertOk();
        $this->pay($order)->assertStatus(422)->assertJsonPath('message', 'This order has already been paid in full.');

        $this->assertSame(1, Payment::where('order_id', $order->id)->count());
        $this->actingAs($this->cashier(), 'sanctum')->getJson("/api/billing/orders/{$order->id}/open")->assertStatus(422);
    }

    public function test_items_cannot_change_once_a_payment_exists(): void
    {
        $order = $this->placeOrder([2]);
        $this->setItems($order, ['served', 'served']);
        $this->pay($order)->assertOk();

        $menu = MenuItem::where('is_available', true)->firstOrFail();
        $this->actingAs($this->cashier(), 'sanctum')->postJson("/api/orders/{$order->id}/items", ['menu_item_id' => $menu->id])->assertStatus(422);
    }

    public function test_only_cashier_or_owner_can_open_a_bill(): void
    {
        $order = $this->placeOrder([1]);
        $waiter = User::where('role', 'waiter')->where('is_active', true)->firstOrFail();
        $this->actingAs($waiter, 'sanctum')->getJson("/api/billing/orders/{$order->id}/open")->assertForbidden();
        $this->actingAs($waiter, 'sanctum')->postJson('/api/billing/pay', ['order_id' => $order->id, 'payment_method' => 'cash', 'amount' => 1])->assertForbidden();
    }

    // ---- refresh and counts -----------------------------------------------------------------------------------------

    public function test_pending_bills_refresh_follows_fulfilment_and_dashboard_agrees(): void
    {
        $order = $this->placeOrder([2]);
        $count = fn () => $this->actingAs($this->owner(), 'sanctum')->getJson('/api/reports/dashboard')->assertOk()->json('data.pending_bills.count');
        $awaiting = fn () => $this->actingAs($this->cashier(), 'sanctum')->getJson('/api/billing/pending')->json('awaiting_fulfilment_count');

        $startCount = $count();
        $startAwaiting = $awaiting();
        foreach (['preparing', 'ready'] as $status) {
            $this->setItems($order, [$status, null]);
            $this->assertNotContains($order->id, $this->pendingIds(), "visible while an item is {$status}");
        }
        $this->setItems($order, ['served', null]);
        $this->assertNotContains($order->id, $this->pendingIds(), 'visible with one item still pending');
        $this->assertSame($startCount, $count());

        $this->setItems($order, [null, 'served']);
        $this->assertContains($order->id, $this->pendingIds());
        $this->assertSame($startCount + 1, $count());
        $this->assertSame($startAwaiting - 1, $awaiting());

        $this->pay($order)->assertOk();
        $this->assertNotContains($order->id, $this->pendingIds());
        $this->assertSame($startCount, $count());
    }

    // ---- history ----------------------------------------------------------------------------------------------------

    public function test_a_paid_order_from_before_this_rule_keeps_its_receipt_and_its_item_list(): void
    {
        $order = $this->placeOrder([2]);
        // History: a bill settled under the old rule with an item that never reached Served
        Payment::create(['order_id' => $order->id, 'cashier_id' => $this->cashier()->id, 'payment_method' => 'cash', 'amount' => $order->total_amount, 'cash_tendered' => $order->total_amount, 'change_returned' => 0, 'status' => 'success']);
        $order->recalculatePaymentStatus($this->cashier()->id);

        $receipt = $this->actingAs($this->cashier(), 'sanctum')->getJson("/api/billing/receipt/{$order->id}")->assertOk();
        $this->assertCount(2, $receipt->json('data.order.items'));
        $this->assertSame('paid', $receipt->json('data.order.payment_status'));
        $this->actingAs($this->cashier(), 'sanctum')->getJson('/api/billing/payments?per_page=200')->assertOk();
    }

    public function test_a_part_payment_from_before_this_rule_keeps_its_receipt_but_takes_no_more_money(): void
    {
        $order = $this->placeOrder([2]);
        Payment::create(['order_id' => $order->id, 'cashier_id' => $this->cashier()->id, 'payment_method' => 'cash', 'amount' => '1.00', 'cash_tendered' => '1.00', 'change_returned' => 0, 'status' => 'success']);
        $order->recalculatePaymentStatus($this->cashier()->id);

        $this->actingAs($this->cashier(), 'sanctum')->getJson("/api/billing/receipt/{$order->id}")->assertOk();
        $this->pay($order, '1.00')->assertStatus(422)->assertJsonPath('error', 'billing_not_eligible');
        $this->assertSame(1, Payment::where('order_id', $order->id)->count());

        $this->serveAllItems($order);
        $this->assertContains($order->id, $this->pendingIds());
        $this->pay($order, $order->fresh()->remainingBalance())->assertOk()->assertJsonPath('data.is_fully_paid', true);
    }

    public function test_a_cancelled_order_stays_readable(): void
    {
        $order = $this->placeOrder([1]);
        $this->actingAs($this->cashier(), 'sanctum')->postJson("/api/orders/{$order->id}/cancel", ['reason' => 'Guest left'])->assertOk();

        $this->actingAs($this->cashier(), 'sanctum')->getJson("/api/billing/receipt/{$order->id}")->assertOk();
        $this->pay($order)->assertStatus(422);
    }

    // ---- daily closing ----------------------------------------------------------------------------------------------

    public function test_daily_closing_counts_each_transaction_once_and_excludes_cancelled_items(): void
    {
        $date = sprintf('2097-%02d-%02d', random_int(1, 12), random_int(1, 28));
        DailyClosing::where('closing_date', $date)->delete();
        $owner = $this->owner();
        $this->actingAs($owner, 'sanctum')->putJson('/api/settings/tax', ['enabled' => false, 'mode' => 'exclusive', 'rate_percent' => '0.00', 'apply_to' => 'all'])->assertOk();

        $served = $this->placeOrder([2, 1]);
        $this->setItems($served, ['served', 'served', 'served']);
        $partlyCancelled = $this->placeOrder([2, 1]);
        $this->setItems($partlyCancelled, ['served', 'cancelled', 'served']);
        $unfinished = $this->placeOrder([2, 1]);
        $this->setItems($unfinished, ['served', 'served', 'pending']);

        $this->pay($served)->assertOk();
        $this->pay($served)->assertStatus(422); // the double click
        $cancelledLine = OrderItem::where('order_id', $partlyCancelled->id)->orderBy('id')->get()[1];
        $this->pay($partlyCancelled, bcsub((string) $partlyCancelled->total_amount, (string) $cancelledLine->subtotal, 2))->assertOk();
        $this->pay($unfinished)->assertStatus(422);

        $orderIds = [$served->id, $partlyCancelled->id, $unfinished->id];
        DB::table('orders')->whereIn('id', $orderIds)->update(['created_at' => "{$date} 12:00:00"]);
        DB::table('payments')->whereIn('order_id', $orderIds)->update(['created_at' => "{$date} 12:30:00"]);

        $collected = bcadd((string) $served->fresh()->total_amount, (string) $partlyCancelled->fresh()->total_amount, 2);
        $stallLines = OrderItem::whereIn('order_id', [$served->id, $partlyCancelled->id])->where('status', '!=', 'cancelled')->get();

        $summary = $this->actingAs($owner, 'sanctum')->getJson("/api/settlements/daily-summary?date={$date}")->assertOk()->json('data');
        $this->assertSame(2, $summary['summary']['total_orders']);
        $this->assertSame($collected, $summary['summary']['net_sales']);
        $this->assertSame($collected, $summary['summary']['cash_collected']);

        $closing = $this->actingAs($owner, 'sanctum')->postJson('/api/settlements/close-day', ['date' => $date])->assertCreated()->json('data');
        $this->assertSame(2, $closing['total_orders_count']);
        $this->assertEquals((float) $collected, (float) $closing['total_net_sales']);
        $this->assertEquals((float) $collected, (float) $closing['total_cash_collected']);

        // Stall payables add up to exactly the lines actually sold: no cancelled line, no unfinished order, nothing twice
        $records = StallSettlementRecord::where('closing_id', $closing['id'])->get();
        $this->assertEquals((float) $stallLines->sum('subtotal'), (float) $records->sum('stall_gross_sales'));
        $this->assertSame($stallLines->count(), (int) $records->sum('stall_item_count'));
    }
}
