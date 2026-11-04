<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\MenuCategory;
use App\Models\MenuItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\Stall;
use App\Models\StallKitchenTicket;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\TestCase;

class BulkDeleteTest extends TestCase
{
    use DatabaseTransactions;

    private function owner(): User
    {
        return User::where('role', 'owner')->where('is_active', true)->firstOrFail();
    }

    private function makeStall(string $tag, int $items = 2): Stall
    {
        $stall = Stall::create(['name' => "Bulk {$tag}", 'code' => "BLK-{$tag}", 'is_active' => true]);
        $cat = MenuCategory::create(['stall_id' => $stall->id, 'name' => 'Mains', 'display_order' => 1, 'is_active' => true]);
        for ($i = 1; $i <= $items; $i++) {
            MenuItem::create(['stall_id' => $stall->id, 'category_id' => $cat->id, 'name' => "Dish {$tag}-{$i}", 'price' => 100 + $i]);
        }

        return $stall;
    }

    /** A paid historical order with one line for $item, plus its kitchen ticket. */
    private function historicOrder(MenuItem $item, string $tag): Order
    {
        $order = Order::create([
            'order_type' => 'takeaway', 'order_channel' => 'cashier_pos', 'status' => 'completed',
            'subtotal' => 100, 'tax_amount' => 5, 'discount_amount' => 0, 'total_amount' => 105,
            'payment_status' => 'paid', 'idempotency_key' => "bulk-{$tag}-" . uniqid(),
        ]);
        OrderItem::create([
            'order_id' => $order->id, 'stall_id' => $item->stall_id, 'menu_item_id' => $item->id,
            'item_name' => $item->name, 'unit_price' => 100, 'quantity' => 1, 'subtotal' => 100, 'status' => 'served',
        ]);
        StallKitchenTicket::create(['order_id' => $order->id, 'stall_id' => $item->stall_id, 'ticket_number' => "T-{$tag}-" . uniqid(), 'status' => 'served']);
        Payment::create([
            'payment_number' => "PAY-{$tag}-" . uniqid(), 'order_id' => $order->id, 'cashier_id' => $this->owner()->id,
            'payment_method' => 'cash', 'amount' => 105, 'status' => 'success',
        ]);

        return $order;
    }

    public function test_owner_bulk_deletes_five_stalls_with_their_catalog(): void
    {
        $stalls = collect(range(1, 5))->map(fn ($i) => $this->makeStall("S{$i}", 3));
        $keeper = $this->makeStall('KEEP', 2);

        $res = $this->actingAs($this->owner())->postJson('/api/stalls/bulk-delete', ['ids' => $stalls->pluck('id')->all()]);

        $res->assertOk()
            ->assertJsonPath('summary.requested', 5)->assertJsonPath('summary.deleted', 5)->assertJsonPath('summary.failed', 0)
            ->assertJsonPath('deleted.0.menu_items_removed', 3);
        $this->assertSame(0, Stall::whereIn('id', $stalls->pluck('id'))->count());
        $this->assertSame(0, MenuItem::whereIn('stall_id', $stalls->pluck('id'))->count());
        $this->assertSame(0, MenuCategory::whereIn('stall_id', $stalls->pluck('id'))->count());
        $this->assertSame(2, MenuItem::where('stall_id', $keeper->id)->count(), 'other stalls keep their menu');
        $this->assertSame(5, AuditLog::where('action', 'stall_deleted')->where('entity_type', 'Stall')->whereIn('entity_id', $stalls->pluck('id')->map(fn ($i) => (string) $i))->count());
    }

    public function test_owner_bulk_deletes_100_menu_items_in_one_request(): void
    {
        $stall = $this->makeStall('HUN', 100);
        $ids = MenuItem::where('stall_id', $stall->id)->pluck('id')->all();
        $this->assertCount(100, $ids);

        $res = $this->actingAs($this->owner())->postJson('/api/menu/bulk-delete', ['ids' => $ids]);

        $res->assertOk()->assertJsonPath('summary.deleted', 100)->assertJsonPath('summary.failed', 0);
        $this->assertSame(0, MenuItem::where('stall_id', $stall->id)->count());
        $this->assertNotNull(Stall::find($stall->id), 'deleting dishes never deletes the stall');
    }

    public function test_non_owners_and_guests_are_refused_and_nothing_is_deleted(): void
    {
        $stall = $this->makeStall('AUTH', 2);
        $itemIds = MenuItem::where('stall_id', $stall->id)->pluck('id')->all();

        foreach (['cashier', 'stall_manager', 'waiter', 'kitchen_staff'] as $role) {
            $user = User::where('role', $role)->where('is_active', true)->firstOrFail();
            $this->actingAs($user)->postJson('/api/stalls/bulk-delete', ['ids' => [$stall->id]])->assertStatus(403);
            $this->actingAs($user)->postJson('/api/menu/bulk-delete', ['ids' => $itemIds])->assertStatus(403);
        }
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/stalls/bulk-delete', ['ids' => [$stall->id]])->assertStatus(401);
        $this->postJson('/api/menu/bulk-delete', ['ids' => $itemIds])->assertStatus(401);

        $this->assertNotNull(Stall::find($stall->id));
        $this->assertSame(2, MenuItem::where('stall_id', $stall->id)->count());
    }

    public function test_a_stall_manager_cannot_delete_even_their_own_stalls_items(): void
    {
        $manager = User::where('role', 'stall_manager')->whereNotNull('stall_id')->firstOrFail();
        $item = MenuItem::where('stall_id', $manager->stall_id)->firstOrFail();

        $this->actingAs($manager)->postJson('/api/menu/bulk-delete', ['ids' => [$item->id]])->assertStatus(403);
        $this->assertNotNull(MenuItem::find($item->id));
    }

    public function test_request_validation(): void
    {
        $owner = $this->owner();
        $this->actingAs($owner)->postJson('/api/stalls/bulk-delete', [])->assertStatus(422);
        $this->actingAs($owner)->postJson('/api/stalls/bulk-delete', ['ids' => []])->assertStatus(422);
        $this->actingAs($owner)->postJson('/api/menu/bulk-delete', ['ids' => ['abc']])->assertStatus(422);
        $this->actingAs($owner)->postJson('/api/menu/bulk-delete', ['ids' => [1, 1]])->assertStatus(422);
        $this->actingAs($owner)->postJson('/api/menu/bulk-delete', ['ids' => range(1, 201)])->assertStatus(422)->assertJsonValidationErrors('ids');
        $this->actingAs($owner)->postJson('/api/menu/bulk-delete', ['ids' => range(1, 200)])->assertOk();
    }

    public function test_items_on_historic_orders_are_blocked_with_a_reason_and_orders_stay_intact(): void
    {
        $stall = $this->makeStall('FKI', 3);
        $items = MenuItem::where('stall_id', $stall->id)->orderBy('id')->get();
        $order = $this->historicOrder($items[0], 'FKI');
        $ordersBefore = Order::count();
        $linesBefore = OrderItem::count();
        $paymentsBefore = Payment::count();
        $ticketsBefore = StallKitchenTicket::count();

        $res = $this->actingAs($this->owner())->postJson('/api/menu/bulk-delete', ['ids' => $items->pluck('id')->all()]);

        $res->assertOk()->assertJsonPath('summary.deleted', 2)->assertJsonPath('summary.failed', 1)
            ->assertJsonPath('failed.0.id', $items[0]->id);
        $this->assertStringContainsString('past order', $res->json('failed.0.reason'));
        $this->assertNotNull(MenuItem::find($items[0]->id));
        $this->assertNull(MenuItem::find($items[1]->id));

        $this->assertSame($ordersBefore, Order::count());
        $this->assertSame($linesBefore, OrderItem::count());
        $this->assertSame($paymentsBefore, Payment::count());
        $this->assertSame($ticketsBefore, StallKitchenTicket::count());
        $this->assertSame('paid', $order->fresh()->payment_status);
        $this->assertSame(105.0, (float) Payment::where('order_id', $order->id)->value('amount'));
    }

    public function test_stalls_with_transactions_or_staff_are_blocked_and_history_survives(): void
    {
        $withOrders = $this->makeStall('FKS', 2);
        $this->historicOrder(MenuItem::where('stall_id', $withOrders->id)->firstOrFail(), 'FKS');
        $withStaff = $this->makeStall('STF', 1);
        User::factory()->create(['role' => 'stall_manager', 'stall_id' => $withStaff->id, 'email' => 'bulk.mgr@example.test']);
        $clean = $this->makeStall('CLN', 1);
        $linesBefore = OrderItem::count();
        $ticketsBefore = StallKitchenTicket::count();

        $res = $this->actingAs($this->owner())->postJson('/api/stalls/bulk-delete', [
            'ids' => [$withOrders->id, $withStaff->id, $clean->id, 99999999],
        ]);

        $res->assertOk()->assertJsonPath('summary.requested', 4)->assertJsonPath('summary.deleted', 1)->assertJsonPath('summary.failed', 3);
        $reasons = collect($res->json('failed'))->keyBy('id');
        $this->assertStringContainsString('order line', $reasons[$withOrders->id]['reason']);
        $this->assertStringContainsString('kitchen ticket', $reasons[$withOrders->id]['reason']);
        $this->assertStringContainsString('assigned staff', $reasons[$withStaff->id]['reason']);
        $this->assertStringContainsString('Not found', $reasons[99999999]['reason']);

        $this->assertNotNull(Stall::find($withOrders->id));
        $this->assertSame(2, MenuItem::where('stall_id', $withOrders->id)->count(), 'a blocked stall keeps its menu');
        $this->assertNotNull(Stall::find($withStaff->id));
        $this->assertNull(Stall::find($clean->id));
        $this->assertSame($linesBefore, OrderItem::count());
        $this->assertSame($ticketsBefore, StallKitchenTicket::count());
    }

    public function test_the_seeded_demo_stalls_cannot_be_bulk_deleted(): void
    {
        $ids = Stall::whereIn('code', ['STALL-PIZZA', 'STALL-BURGER', 'STALL-BEV'])->pluck('id')->all();
        $this->assertNotEmpty($ids);
        $before = MenuItem::whereIn('stall_id', $ids)->count();

        $res = $this->actingAs($this->owner())->postJson('/api/stalls/bulk-delete', ['ids' => $ids]);

        $res->assertOk()->assertJsonPath('summary.deleted', 0)->assertJsonPath('summary.failed', count($ids));
        $this->assertSame($before, MenuItem::whereIn('stall_id', $ids)->count());
    }
}
