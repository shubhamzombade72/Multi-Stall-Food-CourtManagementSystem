<?php

namespace Tests\Feature;

use App\Models\DailyClosing;
use App\Models\DiningTable;
use App\Models\InventoryItem;
use App\Models\MenuItem;
use App\Models\Order;
use App\Models\Stall;
use App\Models\StallKitchenTicket;
use App\Models\StallSettlementRecord;
use App\Models\Supplier;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Concerns\ServesOrders;
use Tests\TestCase;

/**
 * Phase 3 staging validation: defects found while verifying the Phase 2 claims.
 * Runs inside a transaction so it never mutates the seeded test database.
 */
class StagingHardeningTest extends TestCase
{
    use DatabaseTransactions;
    use ServesOrders;

    private function user(string $role, ?int $stallId = null): User
    {
        $query = User::where('role', $role)->where('is_active', true);
        if ($stallId !== null) {
            $query->where('stall_id', $stallId);
        }
        return $query->firstOrFail();
    }

    private function twoStalls(): array
    {
        $stalls = Stall::where('is_active', true)->orderBy('id')->take(2)->get();
        $this->assertCount(2, $stalls);
        return [$stalls[0], $stalls[1]];
    }

    private function placeOrderAs(User $user, array $menuItemIds): Order
    {
        $items = array_map(fn ($id) => ['menu_item_id' => $id, 'quantity' => 1], $menuItemIds);
        $res = $this->actingAs($user, 'sanctum')->postJson('/api/orders', [
            'table_id' => DiningTable::first()->id,
            'order_type' => 'dine_in',
            'items' => $items,
        ]);
        $res->assertStatus(201);
        return Order::findOrFail($res->json('data.id'));
    }

    // ---------------------------------------------------------------- QR

    public function test_public_tables_endpoint_does_not_leak_qr_tokens(): void
    {
        $res = $this->getJson('/api/public/tables');
        $res->assertStatus(200);
        foreach ($res->json('data') as $table) {
            $this->assertArrayNotHasKey('qr_token', $table);
        }
    }

    public function test_public_order_requires_valid_qr_token(): void
    {
        $table = DiningTable::first();
        $item = MenuItem::where('is_available', true)->first();
        $payload = [
            'table_id' => $table->id,
            'order_type' => 'dine_in',
            'items' => [['menu_item_id' => $item->id, 'quantity' => 1]],
        ];

        $this->postJson('/api/public/orders', $payload)->assertStatus(422);
        $this->postJson('/api/public/orders', $payload + ['qr_token' => 'TBL-FORGED'])->assertStatus(422);
    }

    public function test_public_idempotent_replay_does_not_expose_customer_phone(): void
    {
        $table = DiningTable::first();
        $item = MenuItem::where('is_available', true)->first();
        $payload = [
            'qr_token' => $table->qr_token,
            'idempotency_key' => 'idem-phase3-' . uniqid(),
            'order_type' => 'dine_in',
            'customer_phone' => '9876543210',
            'items' => [['menu_item_id' => $item->id, 'quantity' => 1]],
        ];

        $this->postJson('/api/public/orders', $payload)->assertStatus(201);
        $replay = $this->postJson('/api/public/orders', $payload);
        $replay->assertStatus(200);
        $this->assertStringNotContainsString('9876543210', $replay->getContent());
    }

    public function test_order_rejects_items_from_inactive_stall(): void
    {
        $cashier = $this->user('cashier');
        $item = MenuItem::where('is_available', true)->first();
        Stall::where('id', $item->stall_id)->update(['is_active' => false]);

        $this->actingAs($cashier, 'sanctum')->postJson('/api/orders', [
            'order_type' => 'takeaway',
            'items' => [['menu_item_id' => $item->id, 'quantity' => 1]],
        ])->assertStatus(422);
    }

    // ---------------------------------------------------------------- Payments

    public function test_payment_amount_must_match_order_total(): void
    {
        $cashier = $this->user('cashier');
        $order = $this->placeOrderAs($cashier, [MenuItem::where('is_available', true)->first()->id]);
        $this->serveAllItems($order);

        $this->actingAs($cashier, 'sanctum')->postJson('/api/billing/pay', [
            'order_id' => $order->id,
            'payment_method' => 'upi_qr',
            'amount' => '1.00',
        ])->assertStatus(422);

        $this->assertEquals('unpaid', $order->fresh()->payment_status);

        $this->actingAs($cashier, 'sanctum')->postJson('/api/billing/pay', [
            'order_id' => $order->id,
            'payment_method' => 'cash',
            'amount' => (string) $order->total_amount,
            'cash_tendered' => '1000.00',
        ])->assertStatus(200);

        $this->assertEquals('paid', $order->fresh()->payment_status);
        $this->assertEquals(1, $order->payments()->count());
    }

    // ---------------------------------------------------------------- Role / stall isolation

    public function test_kitchen_staff_cannot_read_financial_or_cross_stall_data(): void
    {
        [$stallA] = $this->twoStalls();
        $kitchen = $this->user('kitchen_staff', $stallA->id);
        $order = Order::firstOrFail();

        $this->actingAs($kitchen, 'sanctum');
        $this->getJson('/api/orders')->assertStatus(403);
        $this->getJson("/api/orders/{$order->id}")->assertStatus(403);
        $this->getJson("/api/billing/receipt/{$order->id}")->assertStatus(403);
        $this->getJson('/api/reports/dashboard')->assertStatus(403);
        $this->getJson('/api/reports/stall-sales')->assertStatus(403);
    }

    public function test_stall_details_and_updates_are_restricted(): void
    {
        [$stallA, $stallB] = $this->twoStalls();
        $kitchen = $this->user('kitchen_staff', $stallA->id);
        $manager = $this->user('stall_manager', $stallA->id);

        $this->actingAs($kitchen, 'sanctum')->getJson("/api/stalls/{$stallB->id}")->assertStatus(403);
        $this->actingAs($kitchen, 'sanctum')->putJson("/api/stalls/{$stallA->id}", ['name' => 'Hijacked'])->assertStatus(403);
        $this->actingAs($manager, 'sanctum')->putJson("/api/stalls/{$stallA->id}", ['is_active' => false])->assertStatus(403);
        $this->assertTrue((bool) $stallA->fresh()->is_active);
    }

    public function test_kitchen_staff_cannot_adjust_inventory(): void
    {
        [$stallA] = $this->twoStalls();
        $kitchen = $this->user('kitchen_staff', $stallA->id);
        $inv = InventoryItem::where('stall_id', $stallA->id)->firstOrFail();

        $this->actingAs($kitchen, 'sanctum')->postJson("/api/inventory/{$inv->id}/adjust", [
            'new_stock' => 0,
            'reason' => 'tamper',
            'movement_type' => 'manual_adjustment',
        ])->assertStatus(403);
    }

    // ---------------------------------------------------------------- Kitchen & serving

    public function test_kitchen_ticket_cannot_move_backwards(): void
    {
        $cashier = $this->user('cashier');
        $item = MenuItem::where('is_available', true)->first();
        $order = $this->placeOrderAs($cashier, [$item->id]);
        $ticket = $order->kitchenTickets()->firstOrFail();
        $kitchen = $this->user('kitchen_staff', $ticket->stall_id);

        $this->actingAs($kitchen, 'sanctum')->putJson("/api/kitchen/tickets/{$ticket->id}/status", ['status' => 'ready'])->assertStatus(200);
        $this->actingAs($kitchen, 'sanctum')->putJson("/api/kitchen/tickets/{$ticket->id}/status", ['status' => 'accepted'])->assertStatus(422);
    }

    public function test_only_waiters_serve_ready_tickets_and_payment_status_is_preserved(): void
    {
        $cashier = $this->user('cashier');
        $waiter = $this->user('waiter');
        $item = MenuItem::where('is_available', true)->first();
        $order = $this->placeOrderAs($cashier, [$item->id]);
        $ticket = $order->kitchenTickets()->firstOrFail();
        $kitchen = $this->user('kitchen_staff', $ticket->stall_id);

        // Not ready yet -> cannot be served
        $this->actingAs($waiter, 'sanctum')->postJson("/api/waiter/tickets/{$ticket->id}/served")->assertStatus(422);

        $this->actingAs($kitchen, 'sanctum')->putJson("/api/kitchen/tickets/{$ticket->id}/status", ['status' => 'ready'])->assertStatus(200);

        // Kitchen staff is not a waiter
        $this->actingAs($kitchen, 'sanctum')->postJson("/api/waiter/tickets/{$ticket->id}/served")->assertStatus(403);

        // Ready is not served: the customer cannot pay until the waiter has confirmed serving
        $this->actingAs($cashier, 'sanctum')->postJson('/api/billing/pay', [
            'order_id' => $order->id,
            'payment_method' => 'upi_qr',
            'amount' => (string) $order->total_amount,
        ])->assertStatus(422)->assertJsonPath('error', 'billing_not_eligible');

        $this->actingAs($waiter, 'sanctum')->postJson("/api/waiter/tickets/{$ticket->id}/served")->assertStatus(200);

        $this->actingAs($cashier, 'sanctum')->postJson('/api/billing/pay', [
            'order_id' => $order->id,
            'payment_method' => 'upi_qr',
            'amount' => (string) $order->total_amount,
        ])->assertStatus(200);

        // Repeating the waiter's confirmation must not reopen a settled order
        $this->actingAs($waiter, 'sanctum')->postJson("/api/waiter/tickets/{$ticket->id}/served")->assertStatus(200);

        $fresh = $order->fresh();
        $this->assertEquals('paid', $fresh->payment_status);
        $this->assertEquals('completed', $fresh->status, 'Serving must not reopen a settled order');
    }

    // ---------------------------------------------------------------- Purchases

    public function test_purchase_order_cannot_reference_another_stalls_items_or_supplier(): void
    {
        [$stallA, $stallB] = $this->twoStalls();
        $manager = $this->user('stall_manager', $stallA->id);
        $foreignItem = InventoryItem::where('stall_id', $stallB->id)->firstOrFail();
        $foreignSupplier = Supplier::where('stall_id', $stallB->id)->firstOrFail();
        $ownSupplier = Supplier::where('stall_id', $stallA->id)->firstOrFail();
        $ownItem = InventoryItem::where('stall_id', $stallA->id)->firstOrFail();

        $this->actingAs($manager, 'sanctum')->postJson('/api/purchases', [
            'stall_id' => $stallA->id,
            'supplier_id' => $ownSupplier->id,
            'order_date' => now()->toDateString(),
            'items' => [['inventory_item_id' => $foreignItem->id, 'quantity' => 5, 'unit_price' => 10]],
        ])->assertStatus(422);

        $this->actingAs($manager, 'sanctum')->postJson('/api/purchases', [
            'stall_id' => $stallA->id,
            'supplier_id' => $foreignSupplier->id,
            'order_date' => now()->toDateString(),
            'items' => [['inventory_item_id' => $ownItem->id, 'quantity' => 5, 'unit_price' => 10]],
        ])->assertStatus(422);
    }

    // ---------------------------------------------------------------- Settlement

    public function test_settlement_record_cannot_be_paid_twice(): void
    {
        $owner = $this->user('owner');
        $closing = DailyClosing::create([
            'closing_date' => '2001-01-01',
            'closed_by_user_id' => $owner->id,
            'total_orders_count' => 0,
            'total_gross_sales' => 0,
            'total_discounts' => 0,
            'total_net_sales' => 0,
            'total_cash_collected' => 0,
            'total_digital_collected' => 0,
            'status' => 'closed',
        ]);
        $record = StallSettlementRecord::create([
            'closing_id' => $closing->id,
            'stall_id' => Stall::first()->id,
            'stall_gross_sales' => '1500.50',
            'stall_item_count' => 0,
            'settlement_amount' => 0,
            'settlement_status' => 'calculated',
            'payable_at_close' => '1500.50',
            'net_payable' => '1500.50',
            'remaining_amount' => '1500.50',
            'payout_status' => 'pending',
        ]);

        $this->actingAs($owner, 'sanctum')->postJson("/api/settlements/{$record->id}/pay", [
            'paid_to_representative' => 'Rep', 'payment_method' => 'cash',
        ])->assertStatus(422); // the owner must state the amount actually paid

        // A payout can never exceed the payable (ledger rule); the owner states the amount, the server enforces the cap
        $this->actingAs($owner, 'sanctum')->postJson("/api/settlements/{$record->id}/pay", [
            'amount_paid' => '1500.51', 'paid_to_representative' => 'Rep', 'payment_method' => 'cash',
        ])->assertStatus(422);

        $body = ['amount_paid' => '1500.50', 'paid_to_representative' => 'Rep', 'payment_method' => 'cash'];
        $this->actingAs($owner, 'sanctum')->postJson("/api/settlements/{$record->id}/pay", $body)->assertStatus(200);
        $this->assertEquals('1500.50', $record->fresh()->settlement_amount);
        $this->actingAs($owner, 'sanctum')->postJson("/api/settlements/{$record->id}/pay", $body)->assertStatus(422);
    }

    // ---------------------------------------------------------------- Auth

    public function test_login_is_rate_limited(): void
    {
        $email = 'nobody-' . uniqid() . '@foodcourt.com';
        $last = null;
        for ($i = 0; $i < 7; $i++) {
            $last = $this->postJson('/api/auth/login', ['email' => $email, 'password' => 'wrong']);
        }
        $last->assertStatus(429);
    }

    public function test_public_orders_are_throttled_per_table(): void
    {
        $table = DiningTable::first();
        $item = MenuItem::where('is_available', true)->first();
        $statuses = [];
        for ($i = 0; $i < 21; $i++) {
            $statuses[] = $this->postJson('/api/public/orders', [
                'qr_token' => $table->qr_token,
                'order_type' => 'dine_in',
                'items' => [['menu_item_id' => $item->id, 'quantity' => 1]],
            ])->status();
        }
        $this->assertSame(429, end($statuses));

        // A different table on the same network is unaffected
        $other = DiningTable::where('id', '!=', $table->id)->first();
        $this->postJson('/api/public/orders', [
            'qr_token' => $other->qr_token,
            'order_type' => 'dine_in',
            'items' => [['menu_item_id' => $item->id, 'quantity' => 1]],
        ])->assertStatus(201);
    }

    public function test_demo_seeder_refuses_to_run_in_production(): void
    {
        $this->app['env'] = 'production';
        try {
            $this->expectException(\RuntimeException::class);
            (new \Database\Seeders\DatabaseSeeder())->run();
        } finally {
            $this->app['env'] = 'testing';
        }
    }

    public function test_deactivated_user_token_is_rejected(): void
    {
        $waiter = $this->user('waiter');
        $token = $waiter->createToken('t')->plainTextToken;
        $waiter->update(['is_active' => false]);

        $this->withHeader('Authorization', "Bearer {$token}")->getJson('/api/auth/me')->assertStatus(403);
    }

    // ---------------------------------------------------------------- Realtime channel authorization

    /**
     * The test suite runs with the null broadcaster, which authorizes everything. Switch to the
     * real Reverb (Pusher-protocol) broadcaster so channel callbacks are actually enforced.
     */
    private function useReverbBroadcaster(): void
    {
        config([
            'broadcasting.default' => 'reverb',
            'broadcasting.connections.reverb.key' => 'staging-test-key',
            'broadcasting.connections.reverb.secret' => 'staging-test-secret',
            'broadcasting.connections.reverb.app_id' => 'staging-test-app',
        ]);
        require base_path('routes/channels.php');
    }

    public function test_private_stall_channel_authorization(): void
    {
        $this->useReverbBroadcaster();
        [$stallA, $stallB] = $this->twoStalls();
        $kitchen = $this->user('kitchen_staff', $stallA->id);
        $waiter = $this->user('waiter');
        $cashier = $this->user('cashier');
        $owner = $this->user('owner');

        $auth = fn (User $u, string $channel) => $this->actingAs($u, 'sanctum')
            ->postJson('/api/broadcasting/auth', ['socket_id' => '1234.5678', 'channel_name' => $channel]);

        $auth($kitchen, "private-stall.{$stallA->id}")->assertStatus(200);
        $auth($kitchen, "private-stall.{$stallB->id}")->assertStatus(403);
        $auth($kitchen, 'private-cashier')->assertStatus(403);
        $auth($kitchen, 'private-waiters')->assertStatus(403);
        $auth($waiter, 'private-waiters')->assertStatus(200);
        $auth($waiter, "private-stall.{$stallA->id}")->assertStatus(403);
        $auth($cashier, 'private-cashier')->assertStatus(200);
        $auth($owner, "private-stall.{$stallB->id}")->assertStatus(200);
    }

    public function test_unauthenticated_broadcast_auth_is_rejected(): void
    {
        $this->useReverbBroadcaster();
        $this->postJson('/api/broadcasting/auth', ['socket_id' => '1234.5678', 'channel_name' => 'private-cashier'])
            ->assertStatus(401);
    }

    public function test_events_broadcast_on_private_channels_only(): void
    {
        $cashier = $this->user('cashier');
        $order = $this->placeOrderAs($cashier, [MenuItem::where('is_available', true)->first()->id]);
        $ticket = $order->kitchenTickets()->firstOrFail();

        $events = [
            new \App\Events\OrderCreatedEvent($order),
            new \App\Events\TicketStatusUpdatedEvent($ticket),
            new \App\Events\TicketReadyEvent($ticket),
        ];

        foreach ($events as $event) {
            foreach ($event->broadcastOn() as $channel) {
                $name = $channel->name;
                $isTracking = str_starts_with($name, 'orders.track.trk_');
                $this->assertTrue(
                    $isTracking || str_starts_with($name, 'private-'),
                    get_class($event) . " broadcasts on non-private channel {$name}"
                );
            }
        }
    }
}
