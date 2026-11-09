<?php

namespace Tests\Feature;

use App\Events\TicketStatusUpdatedEvent;
use App\Exceptions\FulfillmentException;
use App\Models\AuditLog;
use App\Models\DiningTable;
use App\Models\FulfillmentOperation;
use App\Models\MenuItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\StallKitchenTicket;
use App\Models\StallTicketItem;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Log;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\TestCase;

class ItemFulfillmentTest extends TestCase
{
    use DatabaseTransactions;

    private function user(string $role): User
    {
        return User::where('role', $role)->where('is_active', true)->firstOrFail();
    }

    private function makeOrder(string $suffix): Order
    {
        return Order::create([
            'order_type' => 'takeaway',
            'order_channel' => 'cashier_pos',
            'status' => 'confirmed',
            'subtotal' => 100,
            'tax_amount' => 5,
            'discount_amount' => 0,
            'total_amount' => 105,
            'payment_status' => 'pending',
            'idempotency_key' => 'fulfil-test-' . $suffix . '-' . uniqid(),
        ]);
    }

    public function test_settings_expose_order_tracking_delay_default_15(): void
    {
        $res = $this->actingAs($this->user('cashier'), 'sanctum')->getJson('/api/settings')->assertOk();
        $this->assertSame(15, $res->json('data.order_tracking.delay_minutes'));
    }

    public function test_owner_can_change_delay_within_range(): void
    {
        $owner = $this->user('owner');

        $this->actingAs($owner, 'sanctum')->putJson('/api/settings/order_tracking', ['delay_minutes' => 20])
            ->assertOk()->assertJsonPath('data.delay_minutes', 20);
        $this->actingAs($owner, 'sanctum')->getJson('/api/settings')
            ->assertJsonPath('data.order_tracking.delay_minutes', 20);

        $this->actingAs($owner, 'sanctum')->putJson('/api/settings/order_tracking', ['delay_minutes' => 0])->assertStatus(422);
        $this->actingAs($owner, 'sanctum')->putJson('/api/settings/order_tracking', ['delay_minutes' => 121])->assertStatus(422);

        $this->actingAs($this->user('cashier'), 'sanctum')
            ->putJson('/api/settings/order_tracking', ['delay_minutes' => 30])->assertStatus(403);
    }

    public function test_fulfillment_operation_key_is_unique_per_order(): void
    {
        $a = $this->makeOrder('a');
        $b = $this->makeOrder('b');
        $row = fn (Order $o) => [
            'order_id' => $o->id,
            'idempotency_key' => 'key-1',
            'operation' => 'serve_remaining',
            'request_hash' => hash('sha256', 'x'),
            'actor_user_id' => null,
            'result' => ['served' => [1]],
        ];

        FulfillmentOperation::create($row($a));
        FulfillmentOperation::create($row($b));
        $this->assertSame(['served' => [1]], FulfillmentOperation::where('order_id', $a->id)->first()->result);

        $this->expectException(UniqueConstraintViolationException::class);
        FulfillmentOperation::create($row($a));
    }

    // ------------------------------------------------- item fulfilment (Task 2)

    private function byEmail(string $email): User
    {
        return User::where('email', $email)->firstOrFail();
    }

    /** Places a takeaway order as the cashier; $stallItems = [stall_id => count]. */
    private function placeOrder(array $stallItems): Order
    {
        $items = [];
        foreach ($stallItems as $stallId => $count) {
            $menu = MenuItem::where('stall_id', $stallId)->where('is_available', true)->orderBy('id')->take($count)->get();
            $this->assertCount($count, $menu, "Seed needs {$count} available items for stall {$stallId}");
            foreach ($menu as $m) {
                $items[] = ['menu_item_id' => $m->id, 'quantity' => 1];
            }
        }
        $res = $this->actingAs($this->byEmail('cashier@foodcourt.com'), 'sanctum')
            ->postJson('/api/orders', ['order_type' => 'takeaway', 'items' => $items]);
        $res->assertStatus(201);

        return Order::findOrFail($res->json('data.id'));
    }

    private function pizzaStall(): int
    {
        return $this->byEmail('kitchen.pizza@foodcourt.com')->stall_id;
    }

    private function burgerStall(): int
    {
        return $this->byEmail('kitchen.burger@foodcourt.com')->stall_id;
    }

    /** Ticket items of an order, ordered by id, optionally for one stall. */
    private function ticketItems(Order $order, ?int $stallId = null)
    {
        return StallTicketItem::whereHas('ticket', function ($q) use ($order, $stallId) {
            $q->where('order_id', $order->id);
            if ($stallId) {
                $q->where('stall_id', $stallId);
            }
        })->orderBy('id')->get();
    }

    private function patchItem(User $user, int $itemId, string $status, ?int $version = null)
    {
        $body = ['status' => $status];
        if ($version !== null) {
            $body['expected_version'] = $version;
        }

        return $this->actingAs($user, 'sanctum')->patchJson("/api/ticket-items/{$itemId}/status", $body);
    }

    private function itemAudits(int $itemId): int
    {
        return AuditLog::where('action', 'ticket_item_status')
            ->where('entity_type', 'StallTicketItem')
            ->where('entity_id', (string) $itemId)
            ->count();
    }

    public function test_cashier_marks_one_item_served_and_only_that_item_changes(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 2]);
        [$a, $b] = $this->ticketItems($order)->all();
        $cashier = $this->byEmail('cashier@foodcourt.com');

        $res = $this->patchItem($cashier, $a->id, 'served', 0)->assertOk();
        $res->assertJsonPath('data.changed', true)
            ->assertJsonPath('data.item.id', $a->id)
            ->assertJsonPath('data.item.order_item_id', $a->order_item_id)
            ->assertJsonPath('data.item.status', 'served')
            ->assertJsonPath('data.item.version', 1)
            ->assertJsonPath('data.item.stall.id', $this->pizzaStall());
        $this->assertNotNull($res->json('data.item.served_at'));
        $this->assertNotNull($res->json('data.item.name'));

        $a->refresh();
        $b->refresh();
        $this->assertSame('served', $a->status);
        $this->assertNotNull($a->served_at);
        $this->assertSame($cashier->id, (int) $a->served_by_user_id);
        $this->assertSame(1, $a->version);
        $this->assertSame('pending', $b->status);
        $this->assertSame(0, $b->version);
        $this->assertNull($b->served_at);

        $this->assertSame('served', OrderItem::find($a->order_item_id)->status);
        $this->assertSame('pending', OrderItem::find($b->order_item_id)->status);
        $this->assertSame(1, $this->itemAudits($a->id));
        $this->assertSame(0, $this->itemAudits($b->id));
    }

    public function test_kitchen_marks_own_stall_item_ready_but_not_other_stall(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 1, $this->burgerStall() => 1]);
        $pizza = $this->ticketItems($order, $this->pizzaStall())->first();
        $burger = $this->ticketItems($order, $this->burgerStall())->first();
        $kitchen = $this->byEmail('kitchen.pizza@foodcourt.com');

        $this->patchItem($kitchen, $pizza->id, 'ready')->assertOk()->assertJsonPath('data.item.status', 'ready');
        $this->assertNotNull($pizza->fresh()->ready_at);
        $this->assertSame('ready', OrderItem::find($pizza->order_item_id)->status);

        $this->patchItem($kitchen, $burger->id, 'ready')->assertStatus(403);
        $this->assertSame('pending', $burger->fresh()->status);

        $this->patchItem($this->byEmail('manager.burger@foodcourt.com'), $burger->id, 'ready')->assertOk();
        $this->patchItem($this->byEmail('owner@foodcourt.com'), $burger->id, 'served')->assertOk();
    }

    public function test_cashier_cannot_mark_ready(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 1]);
        $item = $this->ticketItems($order)->first();

        $this->patchItem($this->byEmail('cashier@foodcourt.com'), $item->id, 'ready')->assertStatus(403);
        $this->assertSame('pending', $item->fresh()->status);
        $this->assertSame(0, $item->fresh()->version);
    }

    public function test_kitchen_staff_cannot_mark_served(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 1]);
        $item = $this->ticketItems($order)->first();

        $this->patchItem($this->byEmail('kitchen.pizza@foodcourt.com'), $item->id, 'served')->assertStatus(403);
        $this->patchItem($this->byEmail('manager.pizza@foodcourt.com'), $item->id, 'served')->assertStatus(403);
        $this->assertSame('pending', $item->fresh()->status);
    }

    public function test_store_staff_and_unauthenticated_are_refused(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 1]);
        $item = $this->ticketItems($order)->first();

        $this->app['auth']->forgetGuards();
        $this->patchJson("/api/ticket-items/{$item->id}/status", ['status' => 'served'])->assertStatus(401);

        $store = User::create([
            'name' => 'Store Staff Test',
            'email' => 'store.staff.fulfil.' . uniqid() . '@foodcourt.test',
            'password' => 'not-used-in-test',
            'role' => 'store_staff',
            'is_active' => true,
        ]);
        $this->patchItem($store, $item->id, 'served')->assertStatus(403);
        $this->patchItem($store, $item->id, 'ready')->assertStatus(403);
        $this->assertSame('pending', $item->fresh()->status);
    }

    public function test_backward_transition_is_rejected(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 1]);
        $item = $this->ticketItems($order)->first();
        $kitchen = $this->byEmail('kitchen.pizza@foodcourt.com');

        $this->patchItem($kitchen, $item->id, 'ready')->assertOk();
        $this->patchItem($kitchen, $item->id, 'preparing')->assertStatus(422);
        $this->patchItem($this->byEmail('cashier@foodcourt.com'), $item->id, 'served')->assertOk();
        $this->patchItem($kitchen, $item->id, 'ready')->assertStatus(422);
        $this->assertSame('served', $item->fresh()->status);
    }

    public function test_same_status_is_a_no_op_without_audit(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 1]);
        $item = $this->ticketItems($order)->first();
        $cashier = $this->byEmail('cashier@foodcourt.com');

        $this->patchItem($cashier, $item->id, 'served')->assertOk()->assertJsonPath('data.changed', true);
        $servedAt = $item->fresh()->served_at;

        $this->patchItem($cashier, $item->id, 'served')->assertOk()
            ->assertJsonPath('data.changed', false)
            ->assertJsonPath('data.item.version', 1);
        $this->assertSame(1, $item->fresh()->version);
        $this->assertEquals($servedAt, $item->fresh()->served_at);
        $this->assertSame(1, $this->itemAudits($item->id));
    }

    public function test_stale_version_is_rejected_with_409_and_current_item(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 1]);
        $item = $this->ticketItems($order)->first();

        $this->patchItem($this->byEmail('kitchen.pizza@foodcourt.com'), $item->id, 'ready', 0)->assertOk();

        $this->patchItem($this->byEmail('cashier@foodcourt.com'), $item->id, 'served', 0)
            ->assertStatus(409)
            ->assertJsonPath('error', 'version_conflict')
            ->assertJsonPath('data.item.id', $item->id)
            ->assertJsonPath('data.item.status', 'ready')
            ->assertJsonPath('data.item.version', 1);

        $this->assertSame('ready', $item->fresh()->status);
        $this->assertSame(1, $item->fresh()->version);
    }

    public function test_expected_fulfillment_refusals_are_not_reported_as_errors(): void
    {
        Exceptions::fake();
        $order = $this->placeOrder([$this->pizzaStall() => 2]);
        [$a, $b] = $this->ticketItems($order)->all();
        $cashier = $this->byEmail('cashier@foodcourt.com');

        $this->patchItem($cashier, $a->id, 'served', 0)->assertOk();
        $this->patchItem($this->byEmail('kitchen.pizza@foodcourt.com'), $b->id, 'ready')->assertOk();
        $this->patchItem($cashier, $b->id, 'served', 0)->assertStatus(409)->assertJsonPath('error', 'version_conflict');
        $this->patchItem($this->byEmail('kitchen.pizza@foodcourt.com'), $a->id, 'ready')->assertStatus(422);
        $this->patchItem($this->byEmail('kitchen.pizza@foodcourt.com'), $b->id, 'served')->assertStatus(403);
        $this->serveRemaining($cashier, $order->id, 'serve-key-report', [$b->id])->assertOk();
        $this->serveRemaining($cashier, $order->id, 'serve-key-report', [$a->id, $b->id])->assertStatus(409);

        Exceptions::assertNotReported(FulfillmentException::class);
        Exceptions::assertNothingReported();
    }

    public function test_same_target_with_stale_version_is_a_no_op_not_409(): void
    {
        // D4: two people tap Served on the same item; the second (stale version) gets a no-op success.
        $order = $this->placeOrder([$this->pizzaStall() => 1]);
        $item = $this->ticketItems($order)->first();

        $this->patchItem($this->byEmail('kitchen.pizza@foodcourt.com'), $item->id, 'ready', 0)->assertOk();
        $this->patchItem($this->byEmail('cashier@foodcourt.com'), $item->id, 'served', 1)->assertOk()
            ->assertJsonPath('data.changed', true);
        $audits = $this->itemAudits($item->id);

        $this->patchItem($this->byEmail('waiter1@foodcourt.com'), $item->id, 'served', 1)->assertOk()
            ->assertJsonPath('data.changed', false)
            ->assertJsonPath('data.item.status', 'served')
            ->assertJsonPath('data.item.version', 2);
        $this->assertSame(2, $item->fresh()->version);
        $this->assertSame($audits, $this->itemAudits($item->id));

        // A stale version with a different target is still a conflict
        $other = $this->ticketItems($this->placeOrder([$this->pizzaStall() => 1]))->first();
        $this->patchItem($this->byEmail('kitchen.pizza@foodcourt.com'), $other->id, 'ready', 0)->assertOk();
        $this->patchItem($this->byEmail('kitchen.pizza@foodcourt.com'), $other->id, 'preparing', 0)->assertStatus(409);
    }

    public function test_order_becomes_partially_ready_when_an_item_is_ready_while_ticket_pending(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 2]);
        [$a] = $this->ticketItems($order)->all();
        $this->assertSame('confirmed', $order->fresh()->status);

        $this->patchItem($this->byEmail('kitchen.pizza@foodcourt.com'), $a->id, 'ready')->assertOk();
        $this->assertSame('pending', StallKitchenTicket::find($a->ticket_id)->status);
        $this->assertSame('partially_ready', $order->fresh()->status);

        // Served directly at the counter counts as progress too
        $order2 = $this->placeOrder([$this->pizzaStall() => 2]);
        [$c] = $this->ticketItems($order2)->all();
        $this->patchItem($this->byEmail('cashier@foodcourt.com'), $c->id, 'served')->assertOk();
        $this->assertSame('partially_ready', $order2->fresh()->status);

        // Never overwrites a paid order
        $order3 = $this->placeOrder([$this->pizzaStall() => 2]);
        [$d] = $this->ticketItems($order3)->all();
        $order3->update(['status' => 'completed', 'payment_status' => 'paid']);
        $this->patchItem($this->byEmail('cashier@foodcourt.com'), $d->id, 'served')->assertOk();
        $this->assertSame('completed', $order3->fresh()->status);
    }

    public function test_kds_change_after_counter_served_whole_ticket_gets_friendly_message(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 2]);
        [$a, $b] = $this->ticketItems($order)->all();
        $cashier = $this->byEmail('cashier@foodcourt.com');
        $this->patchItem($cashier, $a->id, 'served')->assertOk();
        $this->patchItem($cashier, $b->id, 'served')->assertOk();
        $this->assertSame('picked_up', StallKitchenTicket::find($a->ticket_id)->status);

        $this->actingAs($this->byEmail('kitchen.pizza@foodcourt.com'), 'sanctum')
            ->putJson("/api/kitchen/tickets/{$a->ticket_id}/status", ['status' => 'ready'])
            ->assertStatus(422)
            ->assertJsonPath('message', 'This ticket was already served at the counter.');
        $this->assertSame('served', $a->fresh()->status);
    }

    public function test_cancelled_item_cannot_change(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 2]);
        [$a, $b] = $this->ticketItems($order)->all();
        $cashier = $this->byEmail('cashier@foodcourt.com');

        $a->update(['status' => 'cancelled']);
        $this->patchItem($cashier, $a->id, 'served')->assertStatus(422);
        $this->assertSame('cancelled', $a->fresh()->status);

        $order->update(['status' => 'cancelled']);
        $this->patchItem($cashier, $b->id, 'served')->assertStatus(422);
        $this->assertSame('pending', $b->fresh()->status);
    }

    public function test_ticket_picked_up_and_order_served_when_last_item_served(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 2]);
        [$a, $b] = $this->ticketItems($order)->all();
        $cashier = $this->byEmail('cashier@foodcourt.com');
        $ticket = StallKitchenTicket::findOrFail($a->ticket_id);

        $this->patchItem($cashier, $a->id, 'served')->assertOk();
        $this->assertNotSame('picked_up', $ticket->fresh()->status);
        $this->assertNotSame('served', $order->fresh()->status);

        $this->patchItem($cashier, $b->id, 'served')->assertOk();
        $this->assertSame('picked_up', $ticket->fresh()->status);
        $this->assertNotNull($ticket->fresh()->picked_up_at);
        $this->assertSame('served', $order->fresh()->status);
    }

    public function test_completed_order_keeps_completed_status_when_items_served(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 1]);
        $item = $this->ticketItems($order)->first();
        $order->update(['status' => 'completed', 'payment_status' => 'paid']);

        $this->patchItem($this->byEmail('cashier@foodcourt.com'), $item->id, 'served')->assertOk();

        $this->assertSame('served', $item->fresh()->status);
        $this->assertSame('picked_up', StallKitchenTicket::find($item->ticket_id)->status);
        $this->assertSame('completed', $order->fresh()->status);
    }

    public function test_kds_ticket_update_never_moves_items_backwards(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 2]);
        [$a, $b] = $this->ticketItems($order)->all();
        $cashier = $this->byEmail('cashier@foodcourt.com');
        $kitchen = $this->byEmail('kitchen.pizza@foodcourt.com');

        $this->patchItem($cashier, $a->id, 'served')->assertOk();

        $kds = fn (string $s) => $this->actingAs($kitchen, 'sanctum')
            ->putJson("/api/kitchen/tickets/{$a->ticket_id}/status", ['status' => $s]);

        $kds('preparing')->assertOk();
        $this->assertSame('served', $a->fresh()->status);
        $this->assertSame('preparing', $b->fresh()->status);

        $kds('ready')->assertOk();
        $this->assertSame('served', $a->fresh()->status);
        $this->assertSame('ready', $b->fresh()->status);
        $this->assertSame('ready', OrderItem::find($b->order_item_id)->status);

        $kds('picked_up')->assertOk();
        $this->assertSame('served', $b->fresh()->status);
        $this->assertSame($cashier->id, (int) $a->fresh()->served_by_user_id);
        $this->assertSame(1, $a->fresh()->version);

        // Backwards on the KDS still refused with the existing message
        $kds('preparing')->assertStatus(422)
            ->assertJsonPath('message', "Ticket cannot move from 'picked_up' to 'preparing'.");
    }

    public function test_kds_accept_keeps_items_pending_and_writes_no_invalid_item_status(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 2]);
        $items = $this->ticketItems($order);
        $ticketId = $items->first()->ticket_id;
        $kitchen = $this->byEmail('kitchen.pizza@foodcourt.com');
        $kds = fn (string $s) => $this->actingAs($kitchen, 'sanctum')
            ->putJson("/api/kitchen/tickets/{$ticketId}/status", ['status' => $s]);
        $valid = ['pending', 'preparing', 'ready', 'served', 'cancelled'];

        $kds('accepted')->assertOk()->assertJsonPath('data.status', 'accepted');
        foreach ($items as $i) {
            $this->assertSame('pending', $i->fresh()->status);
            $this->assertSame(0, $i->fresh()->version);
        }

        foreach (['preparing', 'ready', 'picked_up'] as $s) {
            $kds($s)->assertOk();
            foreach ($items as $i) {
                $this->assertContains($i->fresh()->status, $valid, "KDS '{$s}' wrote an invalid item status");
            }
        }
        foreach ($items as $i) {
            $this->assertSame('served', $i->fresh()->status);
            $this->assertSame('served', OrderItem::find($i->order_item_id)->status);
        }
        $this->assertSame('served', $order->fresh()->status);
    }

    public function test_waiter_serve_ticket_goes_through_service_and_is_idempotent(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 2]);
        $items = $this->ticketItems($order);
        $ticketId = $items->first()->ticket_id;
        $waiter = $this->byEmail('waiter1@foodcourt.com');

        // Not ready yet → existing 422
        $this->actingAs($waiter, 'sanctum')->postJson("/api/waiter/tickets/{$ticketId}/served")
            ->assertStatus(422)
            ->assertJsonPath('message', "Ticket is 'pending', only ready tickets can be served.");

        $this->actingAs($this->byEmail('kitchen.pizza@foodcourt.com'), 'sanctum')
            ->putJson("/api/kitchen/tickets/{$ticketId}/status", ['status' => 'ready'])->assertOk();

        $this->actingAs($waiter, 'sanctum')->postJson("/api/waiter/tickets/{$ticketId}/served")
            ->assertOk()->assertJsonPath('message', 'Food marked as served to table');

        $ticket = StallKitchenTicket::findOrFail($ticketId);
        $this->assertSame('picked_up', $ticket->status);
        $this->assertSame($waiter->id, (int) $ticket->served_by_waiter_id);
        $versions = [];
        foreach ($items as $i) {
            $f = $i->fresh();
            $this->assertSame('served', $f->status);
            $this->assertSame($waiter->id, (int) $f->served_by_user_id);
            $this->assertSame(2, $f->version);
            $this->assertSame('served', OrderItem::find($i->order_item_id)->status);
            $versions[$i->id] = $f->version;
        }
        $audits = array_map(fn ($i) => $this->itemAudits($i->id), $items->all());
        $this->assertSame('served', $order->fresh()->status);

        // Repeat tap → idempotent 200, nothing changes
        $this->actingAs($waiter, 'sanctum')->postJson("/api/waiter/tickets/{$ticketId}/served")
            ->assertOk()->assertJsonPath('message', 'Food already marked as served');
        foreach ($items as $i) {
            $this->assertSame($versions[$i->id], $i->fresh()->version);
        }
        $this->assertSame($audits, array_map(fn ($i) => $this->itemAudits($i->id), $items->all()));

        // Cashier still not allowed on the waiter endpoint
        $this->actingAs($this->byEmail('cashier@foodcourt.com'), 'sanctum')
            ->postJson("/api/waiter/tickets/{$ticketId}/served")->assertStatus(403);
    }

    public function test_cancel_order_cancels_ticket_items(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 1, $this->burgerStall() => 1]);

        $this->actingAs($this->byEmail('cashier@foodcourt.com'), 'sanctum')
            ->postJson("/api/orders/{$order->id}/cancel", ['reason' => 'Customer left'])->assertOk();

        $this->assertSame('cancelled', $order->fresh()->status);
        foreach ($this->ticketItems($order) as $i) {
            $this->assertSame('cancelled', $i->status);
            $this->assertSame(1, $i->version);
            $this->assertSame('cancelled', OrderItem::find($i->order_item_id)->status);
            $this->assertSame('cancelled', StallKitchenTicket::find($i->ticket_id)->status);
        }
    }

    public function test_cancel_order_is_refused_once_any_item_is_ready_or_served(): void
    {
        $cashier = $this->byEmail('cashier@foodcourt.com');
        $cases = [
            'ready' => $this->byEmail('kitchen.pizza@foodcourt.com'),
            'served' => $cashier,
        ];

        foreach ($cases as $status => $actor) {
            $order = $this->placeOrder([$this->pizzaStall() => 2]);
            [$a, $b] = $this->ticketItems($order)->all();
            $this->patchItem($actor, $a->id, $status)->assertOk();

            $ticket = StallKitchenTicket::findOrFail($a->ticket_id);
            $this->assertSame('pending', $ticket->status, 'Partial item progress leaves the ticket at its KDS status');
            $before = [
                'order' => $order->fresh()->status,
                'a' => $a->fresh()->only(['status', 'version']),
                'b' => $b->fresh()->only(['status', 'version']),
            ];

            $this->actingAs($cashier, 'sanctum')
                ->postJson("/api/orders/{$order->id}/cancel", ['reason' => 'Customer left'])
                ->assertStatus(422)
                ->assertJsonPath('message', 'Cannot cancel order. Food preparation has already started at one or more stalls.');

            $this->assertSame($before['order'], $order->fresh()->status, "{$status}: order changed");
            $this->assertSame($before['a'], $a->fresh()->only(['status', 'version']), "{$status}: item A changed");
            $this->assertSame($before['b'], $b->fresh()->only(['status', 'version']), "{$status}: item B changed");
            $this->assertSame('pending', $ticket->fresh()->status, "{$status}: ticket changed");
            $this->assertSame($status, OrderItem::find($a->order_item_id)->status, "{$status}: mirror broken");
            $this->assertSame('pending', OrderItem::find($b->order_item_id)->status);
        }
    }

    public function test_cancel_order_items_never_breaks_a_served_items_mirror(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 2, $this->burgerStall() => 1]);
        $served = $this->ticketItems($order, $this->pizzaStall())->first();
        $burger = $this->ticketItems($order, $this->burgerStall())->first();
        $cashier = $this->byEmail('cashier@foodcourt.com');
        $this->patchItem($cashier, $served->id, 'served')->assertOk();

        // Service called directly (defensive path: cancelOrder itself refuses this case)
        app(\App\Services\FulfillmentService::class)->cancelOrderItems($order->fresh(), $cashier);

        $this->assertSame('served', $served->fresh()->status);
        $this->assertSame('served', OrderItem::find($served->order_item_id)->status);
        $this->assertNotSame('cancelled', StallKitchenTicket::find($served->ticket_id)->status);
        $this->assertSame('cancelled', $burger->fresh()->status);
        $this->assertSame('cancelled', OrderItem::find($burger->order_item_id)->status);
        $this->assertSame('cancelled', StallKitchenTicket::find($burger->ticket_id)->status);
    }

    public function test_broadcast_failure_does_not_roll_back(): void
    {
        // Two items so the ticket stays pending after one item is ready (KDS can still move it)
        $order = $this->placeOrder([$this->pizzaStall() => 2]);
        $item = $this->ticketItems($order)->first();

        Log::spy();
        Event::listen(TicketStatusUpdatedEvent::class, function () {
            throw new \RuntimeException('broadcast down');
        });

        $this->patchItem($this->byEmail('kitchen.pizza@foodcourt.com'), $item->id, 'ready')
            ->assertOk()->assertJsonPath('data.item.status', 'ready');
        $this->assertSame('ready', $item->fresh()->status);
        $this->assertSame(1, $item->fresh()->version);

        // The KDS path also survives a failing broadcast
        $this->actingAs($this->byEmail('kitchen.pizza@foodcourt.com'), 'sanctum')
            ->putJson("/api/kitchen/tickets/{$item->ticket_id}/status", ['status' => 'preparing'])->assertOk();
        $this->assertSame('preparing', StallKitchenTicket::find($item->ticket_id)->status);

        // The failing listener really ran and was logged, not swallowed silently
        Log::shouldHaveReceived('warning')
            ->withArgs(fn ($msg) => str_contains((string) $msg, 'broadcast down'))
            ->atLeast()->times(2);
    }

    // ------------------------------------------------- Serve All Remaining + board (Task 3)

    private function serveRemaining(User $user, int $orderId, string $key, array $itemIds)
    {
        return $this->actingAs($user, 'sanctum')->postJson("/api/orders/{$orderId}/serve-remaining", [
            'idempotency_key' => $key,
            'item_ids' => $itemIds,
        ]);
    }

    private function orderAudits(int $orderId): int
    {
        return AuditLog::where('action', 'order_serve_remaining')
            ->where('entity_type', 'Order')
            ->where('entity_id', (string) $orderId)
            ->count();
    }

    /** Hide every pre-existing seeded/shared order from the board (rolled back by DatabaseTransactions). */
    private function quietBoard(): void
    {
        Order::where('status', '!=', 'cancelled')->update(['status' => 'cancelled']);
    }

    /**
     * Fast fixture: one order with one ticket item per entry of $statuses (alternating pizza / burger stall).
     * Each entry is a status string or [status, served_at].
     */
    private function makeBoardOrder(array $statuses, ?CarbonInterface $createdAt = null, array $attrs = []): Order
    {
        $order = $this->makeOrder('board');
        if ($attrs) {
            $order->forceFill($attrs)->save();
        }
        if ($createdAt) {
            $order->forceFill(['created_at' => $createdAt])->save();
        }
        $stalls = [$this->pizzaStall(), $this->burgerStall()];
        $tickets = [];
        foreach (array_values($statuses) as $i => $entry) {
            [$status, $servedAt] = is_array($entry) ? $entry : [$entry, null];
            $stallId = $stalls[$i % 2];
            $menu = MenuItem::where('stall_id', $stallId)->orderBy('id')->firstOrFail();
            $tickets[$stallId] ??= StallKitchenTicket::create(['order_id' => $order->id, 'stall_id' => $stallId, 'status' => 'pending']);
            $orderItem = OrderItem::create([
                'order_id' => $order->id,
                'stall_id' => $stallId,
                'menu_item_id' => $menu->id,
                'item_name' => $menu->name,
                'unit_price' => 50,
                'quantity' => 1,
                'subtotal' => 50,
                'status' => $status,
            ]);
            StallTicketItem::create([
                'ticket_id' => $tickets[$stallId]->id,
                'order_item_id' => $orderItem->id,
                'quantity' => 1,
                'status' => $status,
                'served_at' => $servedAt ?? ($status === 'served' ? now() : null),
            ]);
        }

        return $order;
    }

    public function test_serve_remaining_serves_listed_unserved_items_once(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 2, $this->burgerStall() => 1]);
        [$a, $b, $c] = $this->ticketItems($order)->all();
        $cashier = $this->byEmail('cashier@foodcourt.com');

        $this->patchItem($cashier, $a->id, 'served')->assertOk();
        $originalServedAt = $a->fresh()->served_at->toIso8601String();
        $this->travel(2)->minutes();

        $res = $this->serveRemaining($cashier, $order->id, 'serve-key-0001', [$a->id, $b->id, $c->id])->assertOk();
        $res->assertJsonPath('success', true)
            ->assertJsonPath('data.replayed', false)
            ->assertJsonPath('data.served_item_ids', [$b->id, $c->id])
            ->assertJsonPath('data.order.id', $order->id);
        $this->assertCount(3, $res->json('data.order.items'));
        foreach ($res->json('data.order.items') as $item) {
            $this->assertSame('served', $item['status']);
        }

        $this->assertSame($originalServedAt, $a->fresh()->served_at->toIso8601String());
        foreach ([$b, $c] as $item) {
            $this->assertSame('served', $item->fresh()->status);
            $this->assertSame(1, $item->fresh()->version);
            $this->assertSame('served', OrderItem::find($item->order_item_id)->status);
        }
        $this->assertSame('served', $order->fresh()->status);

        $this->assertSame(1, $this->orderAudits($order->id));
        $this->assertSame(1, $this->itemAudits($a->id)); // only the earlier single tap
        $this->assertSame(1, $this->itemAudits($b->id));
        $this->assertSame(1, $this->itemAudits($c->id));
        $this->assertSame(1, FulfillmentOperation::where('order_id', $order->id)->count());
    }

    public function test_serve_remaining_replay_returns_stored_result_without_new_audit(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 2]);
        [$a, $b] = $this->ticketItems($order)->all();
        $cashier = $this->byEmail('cashier@foodcourt.com');

        $first = $this->serveRemaining($cashier, $order->id, 'serve-key-0002', [$a->id, $b->id])->assertOk();
        // Same items in another order → same request hash → replay
        $second = $this->serveRemaining($this->byEmail('waiter1@foodcourt.com'), $order->id, 'serve-key-0002', [$b->id, $a->id])->assertOk();

        $second->assertJsonPath('data.replayed', true)
            ->assertJsonPath('data.served_item_ids', $first->json('data.served_item_ids'))
            ->assertJsonPath('data.order.id', $order->id);
        $this->assertSame(1, $this->orderAudits($order->id));
        $this->assertSame(1, $this->itemAudits($a->id));
        $this->assertSame(1, $this->itemAudits($b->id));
        $this->assertSame(1, $a->fresh()->version);
        $this->assertSame(1, FulfillmentOperation::where('order_id', $order->id)->count());
    }

    public function test_serve_remaining_replay_survives_cache_flush(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 1]);
        $a = $this->ticketItems($order)->first();
        $cashier = $this->byEmail('cashier@foodcourt.com');

        $this->serveRemaining($cashier, $order->id, 'serve-key-0003', [$a->id])->assertOk()
            ->assertJsonPath('data.served_item_ids', [$a->id]);
        Cache::flush();
        $this->serveRemaining($cashier, $order->id, 'serve-key-0003', [$a->id])->assertOk()
            ->assertJsonPath('data.replayed', true)
            ->assertJsonPath('data.served_item_ids', [$a->id]);

        $this->assertSame(1, $this->orderAudits($order->id));
        $this->assertSame(1, $this->itemAudits($a->id));
    }

    public function test_same_key_different_items_is_409(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 2]);
        [$a, $b] = $this->ticketItems($order)->all();
        $cashier = $this->byEmail('cashier@foodcourt.com');

        $this->serveRemaining($cashier, $order->id, 'serve-key-0004', [$a->id])->assertOk();
        $this->serveRemaining($cashier, $order->id, 'serve-key-0004', [$a->id, $b->id])
            ->assertStatus(409)
            ->assertJsonPath('success', false)
            ->assertJsonPath('error', 'idempotency_key_reused');

        $this->assertSame('pending', $b->fresh()->status);
        $this->assertSame(1, $this->orderAudits($order->id));
    }

    /**
     * Simulates the lock-free race (e.g. SQLite) that the unique (order_id, idempotency_key) constraint arbitrates:
     * another request with the same key committed its operation row after this request's existence check.
     * The row is pre-inserted and hidden from that first lookup only, so the insert hits the unique constraint.
     * On PostgreSQL this path is not reachable over HTTP (the order-row lock serialises the requests and the
     * READ COMMITTED lookup after the lock sees the committed row); qa/fulfillment/concurrency.e2e.mjs covers that.
     */
    private function serveRemainingAfterLostRace(Order $order, array $storedItemIds, array $requestItemIds)
    {
        sort($storedItemIds);
        FulfillmentOperation::create([
            'order_id' => $order->id,
            'idempotency_key' => 'serve-key-race-01',
            'operation' => 'serve_remaining',
            'request_hash' => hash('sha256', 'serve_remaining|' . implode(',', $storedItemIds)),
            'actor_user_id' => $this->byEmail('waiter1@foodcourt.com')->id,
            'result' => ['served_item_ids' => $storedItemIds, 'order_id' => $order->id],
        ]);

        $hideNext = 1;
        FulfillmentOperation::addGlobalScope('lost-race', function ($query) use (&$hideNext) {
            if ($hideNext-- > 0) {
                $query->whereRaw('1 = 0');
            }
        });
        try {
            $res = $this->serveRemaining($this->byEmail('cashier@foodcourt.com'), $order->id, 'serve-key-race-01', $requestItemIds);
        } finally {
            $prop = new \ReflectionProperty(\Illuminate\Database\Eloquent\Model::class, 'globalScopes');
            $scopes = $prop->getValue();
            unset($scopes[FulfillmentOperation::class]['lost-race']);
            $prop->setValue(null, $scopes);
        }
        // Exactly two lookups: the in-transaction existence check (hidden) and the catch-path fallback (visible)
        $this->assertSame(-1, $hideNext);

        return $res;
    }

    public function test_serve_remaining_unique_violation_replays_the_committed_result(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 2]);
        [$a, $b] = $this->ticketItems($order)->all();

        $this->serveRemainingAfterLostRace($order, [$a->id, $b->id], [$b->id, $a->id])
            ->assertOk()
            ->assertJsonPath('data.replayed', true)
            ->assertJsonPath('data.served_item_ids', [$a->id, $b->id])
            ->assertJsonPath('data.order.id', $order->id);

        // The losing request's writes were rolled back: no item change, no audit, still one operation row
        foreach ([$a, $b] as $item) {
            $this->assertSame('pending', $item->fresh()->status);
            $this->assertSame(0, $item->fresh()->version);
            $this->assertSame(0, $this->itemAudits($item->id));
        }
        $this->assertSame(0, $this->orderAudits($order->id));
        $this->assertSame(1, FulfillmentOperation::where('order_id', $order->id)->count());
    }

    public function test_serve_remaining_unique_violation_with_other_items_is_409(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 2]);
        [$a, $b] = $this->ticketItems($order)->all();

        $this->serveRemainingAfterLostRace($order, [$a->id], [$a->id, $b->id])
            ->assertStatus(409)
            ->assertJsonPath('error', 'idempotency_key_reused');

        $this->assertSame('pending', $a->fresh()->status);
        $this->assertSame('pending', $b->fresh()->status);
        $this->assertSame(0, $this->orderAudits($order->id));
        $this->assertSame(1, FulfillmentOperation::where('order_id', $order->id)->count());
    }

    public function test_item_not_in_order_is_422(): void
    {
        $order = $this->placeOrder([$this->pizzaStall() => 1]);
        $other = $this->placeOrder([$this->pizzaStall() => 1]);
        $mine = $this->ticketItems($order)->first();
        $foreign = $this->ticketItems($other)->first();
        $cashier = $this->byEmail('cashier@foodcourt.com');

        $this->serveRemaining($cashier, $order->id, 'serve-key-0005', [$mine->id, $foreign->id])
            ->assertStatus(422)->assertJsonPath('success', false);

        $this->assertSame('pending', $mine->fresh()->status);
        $this->assertSame('pending', $foreign->fresh()->status);
        $this->assertSame(0, FulfillmentOperation::where('order_id', $order->id)->count());
        $this->assertSame(0, $this->orderAudits($order->id));

        // Malformed bodies are refused by validation
        $this->serveRemaining($cashier, $order->id, 'short', [$mine->id])->assertStatus(422);
        $this->serveRemaining($cashier, $order->id, 'serve-key-0005', [])->assertStatus(422);
        $this->serveRemaining($cashier, $order->id, 'serve-key-0005', [$mine->id, $mine->id])->assertStatus(422);
    }

    public function test_board_lists_active_orders_newest_first_with_shape(): void
    {
        $this->quietBoard();
        $table = DiningTable::orderBy('id')->firstOrFail();
        $newer = $this->makeBoardOrder(['pending', 'ready'], now()->subMinutes(5), [
            'order_type' => 'dine_in', 'table_id' => $table->id, 'guest_count' => 4, 'notes' => 'Less spicy, no onion',
        ]);
        $older = $this->makeBoardOrder(['preparing'], now()->subMinutes(12));

        $res = $this->actingAs($this->byEmail('cashier@foodcourt.com'), 'sanctum')->getJson('/api/orders/board')->assertOk();
        $res->assertJsonPath('success', true)
            ->assertJsonPath('data.delay_minutes', 15)
            ->assertJsonPath('data.total_active', 2)
            ->assertJsonPath('data.next_cursor', null);
        $this->assertNotEmpty($res->json('data.server_time'));
        $this->assertSame([$newer->id, $older->id], array_column($res->json('data.orders'), 'id'));

        $o = $res->json('data.orders.0');
        $this->assertSame(['id', 'order_number', 'order_type', 'table', 'guest_count', 'notes', 'created_at', 'status', 'payment_status', 'items'], array_keys($o));
        $this->assertSame(['id' => $table->id, 'table_number' => $table->table_number], $o['table']);
        $this->assertSame(4, $o['guest_count']);
        $this->assertSame('Less spicy, no onion', $o['notes']);
        $this->assertNull($res->json('data.orders.1.notes'));
        $this->assertSame('dine_in', $o['order_type']);
        $this->assertSame($newer->order_number, $o['order_number']);
        $this->assertCount(2, $o['items']);
        $this->assertSame(['id', 'order_item_id', 'ticket_id', 'name', 'quantity', 'notes', 'stall', 'status', 'version', 'ready_at', 'served_at'], array_keys($o['items'][0]));
        $this->assertSame(['pending', 'ready'], array_column($o['items'], 'status'));
        $this->assertSame(['id', 'name', 'code'], array_keys($o['items'][0]['stall']));
        $this->assertNull($res->json('data.orders.1.table'));
        $this->assertNull($res->json('data.orders.1.guest_count'));
    }

    public function test_kitchen_staff_watch_only_their_own_stall_on_the_board(): void
    {
        $this->quietBoard();
        $both = $this->makeBoardOrder(['pending', 'preparing'], now()->subMinutes(5)); // pizza + burger
        $burgerOnly = $this->makeBoardOrder([['served', now()->subHours(2)], 'pending'], now()->subHours(3)); // pizza served long ago, burger still to serve
        $pizza = $this->byEmail('kitchen.pizza@foodcourt.com');

        $res = $this->actingAs($pizza, 'sanctum')->getJson('/api/orders/board')->assertOk();
        $ids = array_column($res->json('data.orders'), 'id');
        $this->assertContains($both->id, $ids);
        $this->assertNotContains($burgerOnly->id, $ids, 'an order whose pizza part is finished is not on the pizza kitchen board');
        foreach ($res->json('data.orders') as $o) {
            foreach ($o['items'] as $it) {
                $this->assertSame($this->pizzaStall(), $it['stall']['id'], 'only the own stall\'s dishes are shown');
            }
        }
        $res->assertJsonPath('data.total_active', 1);

        // Watching is all they can do: marking served stays with the owner, cashier and waiter
        $item = collect($res->json('data.orders'))->firstWhere('id', $both->id)['items'][0];
        $this->patchItem($pizza, $item['id'], 'served')->assertStatus(403);

        // The other roles still see every stall
        $all = $this->actingAs($this->byEmail('waiter1@foodcourt.com'), 'sanctum')->getJson('/api/orders/board')->assertOk();
        $this->assertSame([$both->id, $burgerOnly->id], array_column($all->json('data.orders'), 'id')); // newest first
        $all->assertJsonPath('data.total_active', 2);

        $store = User::create([
            'name' => 'Store Staff Board Test',
            'email' => 'store.staff.board.' . uniqid() . '@foodcourt.test',
            'password' => 'not-used-in-test',
            'role' => 'store_staff',
            'is_active' => true,
        ]);
        $this->actingAs($store, 'sanctum')->getJson('/api/orders/board')->assertStatus(403);
    }

    public function test_board_keeps_completed_and_paid_orders_with_unserved_items(): void
    {
        $this->quietBoard();
        $paid = $this->makeBoardOrder(['served', 'pending'], now()->subHours(3), ['status' => 'completed', 'payment_status' => 'paid']);
        $legacy = $this->makeBoardOrder(['accepted'], now()->subHours(2)); // legacy value reads as pending

        $res = $this->actingAs($this->byEmail('waiter1@foodcourt.com'), 'sanctum')->getJson('/api/orders/board')->assertOk();
        $this->assertSame([$legacy->id, $paid->id], array_column($res->json('data.orders'), 'id'));
        $res->assertJsonPath('data.total_active', 2)
            ->assertJsonPath('data.orders.1.status', 'completed')
            ->assertJsonPath('data.orders.1.payment_status', 'paid')
            ->assertJsonPath('data.orders.0.items.0.status', 'pending');
    }

    public function test_board_excludes_all_cancelled_and_long_finished_orders(): void
    {
        $this->quietBoard();
        $this->makeBoardOrder(['cancelled', 'cancelled'], now()->subMinutes(5));
        $this->makeBoardOrder(['pending'], now()->subMinutes(5), ['status' => 'cancelled']);
        $this->makeBoardOrder([['served', now()->subMinutes(30)], 'cancelled'], now()->subHour());
        $this->makeBoardOrder(['picked_up'], now()->subHour()); // legacy served, no served_at

        $res = $this->actingAs($this->byEmail('owner@foodcourt.com'), 'sanctum')->getJson('/api/orders/board')->assertOk();
        $res->assertJsonPath('data.orders', [])
            ->assertJsonPath('data.total_active', 0)
            ->assertJsonPath('data.next_cursor', null);
    }

    public function test_board_shows_recently_fully_served_order(): void
    {
        $this->quietBoard();
        $recent = $this->makeBoardOrder([['served', now()->subMinutes(30)], ['served', now()->subMinutes(3)]], now()->subHour());

        $res = $this->actingAs($this->byEmail('cashier@foodcourt.com'), 'sanctum')->getJson('/api/orders/board')->assertOk();
        $this->assertSame([$recent->id], array_column($res->json('data.orders'), 'id'));
        $res->assertJsonPath('data.total_active', 0)
            ->assertJsonPath('data.orders.0.items.0.status', 'served')
            ->assertJsonPath('data.orders.0.items.1.status', 'served');

        $this->travel(8)->minutes(); // last item was served 11 minutes ago now
        $this->actingAs($this->byEmail('cashier@foodcourt.com'), 'sanctum')->getJson('/api/orders/board')
            ->assertOk()->assertJsonPath('data.orders', []);
    }

    public function test_board_paginates_beyond_100_without_hiding(): void
    {
        $this->quietBoard();
        $start = now()->subHours(4);
        $ids = [];
        for ($i = 0; $i < 105; $i++) {
            // Pairs share a created_at to exercise the id tie-breaker of the keyset cursor
            $ids[] = $this->makeBoardOrder(['pending'], $start->copy()->addMinutes(intdiv($i, 2)))->id;
        }
        $cashier = $this->byEmail('cashier@foodcourt.com');

        $page1 = $this->actingAs($cashier, 'sanctum')->getJson('/api/orders/board')->assertOk();
        $this->assertCount(100, $page1->json('data.orders'));
        $page1->assertJsonPath('data.total_active', 105);
        $cursor = $page1->json('data.next_cursor');
        $this->assertIsString($cursor);

        $page2 = $this->actingAs($cashier, 'sanctum')->getJson('/api/orders/board?cursor=' . urlencode($cursor))->assertOk();
        $this->assertCount(5, $page2->json('data.orders'));
        $page2->assertJsonPath('data.total_active', 105)->assertJsonPath('data.next_cursor', null);

        $seen = array_merge(array_column($page1->json('data.orders'), 'id'), array_column($page2->json('data.orders'), 'id'));
        // Newest first; orders sharing a created_at are ordered by id descending
        $this->assertSame(array_reverse($ids), $seen);

        $this->actingAs($cashier, 'sanctum')->getJson('/api/orders/board?cursor=not-a-cursor')->assertStatus(422);
    }

    /** Number of SQL queries one GET /orders/board request runs. */
    private function boardQueryCount(): int
    {
        $this->actingAs($this->byEmail('cashier@foodcourt.com'), 'sanctum');
        DB::flushQueryLog();
        DB::enableQueryLog();
        $this->getJson('/api/orders/board')->assertOk();
        $count = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $count;
    }

    public function test_board_query_count_is_constant(): void
    {
        $this->quietBoard();
        $tables = DiningTable::orderBy('id')->take(4)->pluck('id')->all();
        // Same relation mix as below (a table) so the counts are comparable: Laravel skips an eager load whose keys are all null
        $this->makeBoardOrder(['pending', 'ready'], now()->subMinutes(30), ['order_type' => 'dine_in', 'table_id' => $tables[0]]);
        $one = $this->boardQueryCount();

        for ($i = 0; $i < 19; $i++) {
            $this->makeBoardOrder(['pending', 'preparing', 'ready', ['served', now()->subMinutes(2)]], now()->subMinutes(20 - $i), [
                'order_type' => 'dine_in',
                'table_id' => $tables[$i % count($tables)],
            ]);
        }
        $twenty = $this->boardQueryCount();

        fwrite(STDERR, "\n[board queries] 1 order: {$one}, 20 orders: {$twenty}\n");
        $this->assertLessThanOrEqual(8, $one);
        $this->assertLessThanOrEqual(8, $twenty);
        $this->assertSame($one, $twenty);
    }

    public function test_board_supporting_indexes_exist(): void
    {
        // The board is polled every 5 s; PostgreSQL does not index foreign keys on its own.
        $this->assertTrue(Schema::hasIndex('stall_kitchen_tickets', ['order_id']), 'stall_kitchen_tickets(order_id)');
        $this->assertTrue(Schema::hasIndex('stall_ticket_items', ['ticket_id', 'status']), 'stall_ticket_items(ticket_id, status)');
        $this->assertTrue(Schema::hasIndex('orders', ['created_at', 'id']), 'orders(created_at, id)');
    }

    public function test_board_roles(): void
    {
        foreach (['owner@foodcourt.com', 'cashier@foodcourt.com', 'waiter1@foodcourt.com'] as $email) {
            $this->actingAs($this->byEmail($email), 'sanctum')->getJson('/api/orders/board')->assertOk();
        }
        // Kitchen staff and stall managers may watch the board, scoped to their own stall (read-only)
        foreach (['kitchen.pizza@foodcourt.com', 'manager.pizza@foodcourt.com'] as $email) {
            $this->actingAs($this->byEmail($email), 'sanctum')->getJson('/api/orders/board')
                ->assertOk()->assertJsonPath('success', true);
        }

        // Kitchen cannot Serve All, and the refused call does not consume the key
        $order = $this->placeOrder([$this->pizzaStall() => 1]);
        $item = $this->ticketItems($order)->first();
        $this->serveRemaining($this->byEmail('kitchen.pizza@foodcourt.com'), $order->id, 'serve-key-0006', [$item->id])
            ->assertStatus(403);
        $this->assertSame(0, FulfillmentOperation::where('order_id', $order->id)->count());
        $this->assertSame('pending', $item->fresh()->status);
        $this->serveRemaining($this->byEmail('cashier@foodcourt.com'), $order->id, 'serve-key-0006', [$item->id])
            ->assertOk()->assertJsonPath('data.replayed', false);
    }

    // ------------------------------------------------- Quantity controls & Add Item (Task A, B, D)

    public function test_quantity_increase_and_decrease_lifecycle_with_recalculation_and_audit(): void
    {
        $cashier = $this->byEmail('cashier@foodcourt.com');
        $order = $this->placeOrder([$this->pizzaStall() => 1]);
        $ticketItem = $this->ticketItems($order)->first();
        $this->assertSame(1, (int) $ticketItem->quantity);

        $initialTotal = $order->fresh()->total_amount;

        // 1. Increase 1 -> 2
        $res = $this->actingAs($cashier, 'sanctum')
            ->patchJson("/api/ticket-items/{$ticketItem->id}/quantity", ['delta' => 1])
            ->assertOk();
        $this->assertSame(2, $res->json('data.order.items.0.quantity'));
        $this->assertSame(2, (int) $ticketItem->fresh()->quantity);
        $orderItem = OrderItem::findOrFail($ticketItem->order_item_id);
        $this->assertSame(2, (int) $orderItem->quantity);
        $this->assertGreaterThan($initialTotal, (float) $order->fresh()->total_amount);

        // Verify audit log for increase
        $incAudit = AuditLog::where('action', 'ticket_item_quantity_increased')
            ->where('entity_id', (string) $ticketItem->id)
            ->latest('id')
            ->first();
        $this->assertNotNull($incAudit);
        $this->assertSame(1, (int) $incAudit->old_values['quantity']);
        $this->assertSame(2, (int) $incAudit->new_values['quantity']);
        $this->assertSame($cashier->id, $incAudit->user_id);

        // 2. Decrease 2 -> 1
        $res = $this->actingAs($cashier, 'sanctum')
            ->patchJson("/api/ticket-items/{$ticketItem->id}/quantity", ['delta' => -1])
            ->assertOk();
        $this->assertSame(1, $res->json('data.order.items.0.quantity'));
        $this->assertSame(1, (int) $ticketItem->fresh()->quantity);
        $this->assertSame(1, (int) $orderItem->fresh()->quantity);
        $this->assertEquals($initialTotal, $order->fresh()->total_amount);

        // Verify audit log for decrease
        $decAudit = AuditLog::where('action', 'ticket_item_quantity_decreased')
            ->where('entity_id', (string) $ticketItem->id)
            ->latest('id')
            ->first();
        $this->assertNotNull($decAudit);
        $this->assertSame(2, (int) $decAudit->old_values['quantity']);
        $this->assertSame(1, (int) $decAudit->new_values['quantity']);
        $this->assertSame($cashier->id, $decAudit->user_id);

        // 3. Prevent decrease below 1
        $this->actingAs($cashier, 'sanctum')
            ->patchJson("/api/ticket-items/{$ticketItem->id}/quantity", ['delta' => -1])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Quantity cannot be decreased below 1.');
        $this->assertSame(1, (int) $ticketItem->fresh()->quantity);
    }

    public function test_quantity_cannot_be_modified_on_served_ready_or_cancelled_items(): void
    {
        $cashier = $this->byEmail('cashier@foodcourt.com');
        $kitchen = $this->byEmail('kitchen.pizza@foodcourt.com');
        $order = $this->placeOrder([$this->pizzaStall() => 1]);
        $ticketItem = $this->ticketItems($order)->first();

        // Ready item test
        $this->patchItem($kitchen, $ticketItem->id, 'ready')->assertOk();
        $this->actingAs($cashier, 'sanctum')
            ->patchJson("/api/ticket-items/{$ticketItem->id}/quantity", ['delta' => 1])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Cannot modify quantity of an already prepared item. Please add a new item.');

        // Served item test
        $this->patchItem($cashier, $ticketItem->id, 'served')->assertOk();
        $this->actingAs($cashier, 'sanctum')
            ->patchJson("/api/ticket-items/{$ticketItem->id}/quantity", ['delta' => 1])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Cannot modify quantity of an already served item.');

        // Cancelled item test
        $order2 = $this->placeOrder([$this->pizzaStall() => 1]);
        $ticketItem2 = $this->ticketItems($order2)->first();
        $ticketItem2->update(['status' => 'cancelled']);
        $this->actingAs($cashier, 'sanctum')
            ->patchJson("/api/ticket-items/{$ticketItem2->id}/quantity", ['delta' => 1])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Cannot modify quantity of a cancelled item.');
    }

    public function test_quantity_controls_and_add_item_prevent_modifying_paid_orders(): void
    {
        $cashier = $this->byEmail('cashier@foodcourt.com');
        $order = $this->placeOrder([$this->pizzaStall() => 1]);
        $ticketItem = $this->ticketItems($order)->first();

        $order->update(['payment_status' => 'paid']);

        // Quantity modification blocked
        $this->actingAs($cashier, 'sanctum')
            ->patchJson("/api/ticket-items/{$ticketItem->id}/quantity", ['delta' => 1])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Order has existing payments and cannot be modified.');

        // Add item blocked
        $menuItem = MenuItem::where('stall_id', $this->burgerStall())->where('is_available', true)->firstOrFail();
        $this->actingAs($cashier, 'sanctum')
            ->postJson("/api/orders/{$order->id}/items", ['menu_item_id' => $menuItem->id, 'quantity' => 1])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Order has existing payments and items cannot be added.');
    }

    public function test_add_item_multi_stall_and_ticket_isolation(): void
    {
        $cashier = $this->byEmail('cashier@foodcourt.com');
        // Initial order: only pizza stall
        $order = $this->placeOrder([$this->pizzaStall() => 1]);
        $this->assertSame(1, $order->kitchenTickets()->count());
        $initialSubtotal = (float) $order->subtotal;

        // Add burger stall item
        $burgerItem = MenuItem::where('stall_id', $this->burgerStall())->where('is_available', true)->firstOrFail();
        $res = $this->actingAs($cashier, 'sanctum')
            ->postJson("/api/orders/{$order->id}/items", [
                'menu_item_id' => $burgerItem->id,
                'quantity' => 2,
                'special_instructions' => 'Extra mayo',
            ])
            ->assertOk();

        // 1. Order now has 2 kitchen tickets (1 for Pizza, 1 for Burger)
        $order->refresh();
        $this->assertSame(2, $order->kitchenTickets()->count());
        $burgerTicket = $order->kitchenTickets()->where('stall_id', $this->burgerStall())->firstOrFail();
        $this->assertSame('pending', $burgerTicket->status);
        $this->assertSame(1, $burgerTicket->ticketItems()->count());

        $burgerTicketItem = $burgerTicket->ticketItems()->firstOrFail();
        $this->assertSame(2, (int) $burgerTicketItem->quantity);
        $this->assertSame('pending', $burgerTicketItem->status);

        // 2. Financial recalculation verified
        $expectedLine = bcmul((string) $burgerItem->price, '2', 2);
        $this->assertEquals(bcadd((string) $initialSubtotal, $expectedLine, 2), (string) $order->subtotal);

        // 3. Audit log verified
        $addAudit = AuditLog::where('action', 'order_item_added')
            ->where('stall_id', $this->burgerStall())
            ->latest('id')
            ->first();
        $this->assertNotNull($addAudit);
        $this->assertSame($order->id, (int) $addAudit->new_values['order_id']);
        $this->assertSame(2, (int) $addAudit->new_values['quantity']);

        // 4. Adding same item with same instructions merges quantity
        $res2 = $this->actingAs($cashier, 'sanctum')
            ->postJson("/api/orders/{$order->id}/items", [
                'menu_item_id' => $burgerItem->id,
                'quantity' => 1,
                'special_instructions' => 'Extra mayo',
            ])
            ->assertOk();

        $this->assertSame(3, (int) $burgerTicketItem->fresh()->quantity);
        $mergeAudit = AuditLog::where('action', 'order_item_quantity_merged')
            ->where('stall_id', $this->burgerStall())
            ->latest('id')
            ->first();
        $this->assertNotNull($mergeAudit);
        $this->assertSame(2, (int) $mergeAudit->old_values['quantity']);
        $this->assertSame(3, (int) $mergeAudit->new_values['quantity']);

        // 5. Adding same item with DIFFERENT instructions creates distinct line
        $res3 = $this->actingAs($cashier, 'sanctum')
            ->postJson("/api/orders/{$order->id}/items", [
                'menu_item_id' => $burgerItem->id,
                'quantity' => 1,
                'special_instructions' => 'No mayo',
            ])
            ->assertOk();

        // Burger ticket now has 2 items: 3x with Extra mayo, 1x with No mayo
        $this->assertSame(2, $burgerTicket->fresh()->ticketItems()->count());
    }
}
