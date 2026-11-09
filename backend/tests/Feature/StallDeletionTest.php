<?php

namespace Tests\Feature;

use App\Models\MenuCategory;
use App\Models\MenuItem;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\Stall;
use App\Models\StallKitchenTicket;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Stall deletion lifecycle: one eligibility verdict shared by the read-only preview and the real delete,
 * history is never touched, and a stall with history is deactivated instead (which stops new orders).
 * Runs against the PostgreSQL test database inside a rolled-back transaction.
 */
class StallDeletionTest extends TestCase
{
    use DatabaseTransactions;

    private function owner(): User
    {
        return User::where('role', 'owner')->where('is_active', true)->firstOrFail();
    }

    private function cashier(): User
    {
        return User::where('role', 'cashier')->where('is_active', true)->firstOrFail();
    }

    private function makeStall(string $tag, int $items = 2): Stall
    {
        $stall = Stall::create(['name' => "SDX {$tag}", 'code' => "SDX-{$tag}", 'is_active' => true]);
        $cat = MenuCategory::create(['stall_id' => $stall->id, 'name' => 'Mains', 'display_order' => 1, 'is_active' => true]);
        for ($i = 1; $i <= $items; $i++) {
            MenuItem::create(['stall_id' => $stall->id, 'category_id' => $cat->id, 'name' => "Dish {$tag}-{$i}", 'price' => 100 + $i]);
        }

        return $stall;
    }

    private function firstItem(Stall $stall): MenuItem
    {
        return MenuItem::where('stall_id', $stall->id)->orderBy('id')->firstOrFail();
    }

    /** An order with one line for $item (and optionally its kitchen ticket + payment). */
    private function order(MenuItem $item, string $tag, bool $ticket = true, bool $paid = true): Order
    {
        $order = Order::create([
            'order_type' => 'takeaway', 'order_channel' => 'cashier_pos', 'status' => $paid ? 'completed' : 'confirmed',
            'subtotal' => 100, 'tax_amount' => 5, 'discount_amount' => 0, 'total_amount' => 105,
            'payment_status' => $paid ? 'paid' : 'unpaid', 'idempotency_key' => "sdx-{$tag}-" . Str::random(8),
        ]);
        OrderItem::create([
            'order_id' => $order->id, 'stall_id' => $item->stall_id, 'menu_item_id' => $item->id,
            'item_name' => $item->name, 'unit_price' => 100, 'quantity' => 1, 'subtotal' => 100, 'status' => $paid ? 'served' : 'pending',
        ]);
        if ($ticket) {
            StallKitchenTicket::create(['order_id' => $order->id, 'stall_id' => $item->stall_id, 'ticket_number' => "T-{$tag}-" . Str::random(8), 'status' => 'served']);
        }
        if ($paid) {
            Payment::create([
                'payment_number' => "PAY-{$tag}-" . Str::random(8), 'order_id' => $order->id, 'cashier_id' => $this->owner()->id,
                'payment_method' => 'cash', 'amount' => 105, 'status' => 'success',
            ]);
        }

        return $order;
    }

    /** Create exactly one kind of link to $stall (some kinds need a parent row, which is a second blocker of its own). */
    private function link(string $key, Stall $stall): void
    {
        $now = now();
        $uid = $this->owner()->id;
        switch ($key) {
            case 'order_items':
                $this->order($this->firstItem($stall), 'L', ticket: false, paid: false);
                break;
            case 'kitchen_tickets':
                $o = Order::create(['order_type' => 'takeaway', 'order_channel' => 'cashier_pos', 'status' => 'confirmed', 'subtotal' => 0, 'tax_amount' => 0, 'discount_amount' => 0, 'total_amount' => 0, 'payment_status' => 'unpaid', 'idempotency_key' => 'sdx-kt-' . Str::random(8)]);
                StallKitchenTicket::create(['order_id' => $o->id, 'stall_id' => $stall->id, 'ticket_number' => 'T-KT-' . Str::random(8), 'status' => 'pending']);
                break;
            case 'settlement_records':
            case 'settlement_payouts':
                $closing = DB::table('daily_closings')->insertGetId(['closing_date' => '2099-01-01', 'closed_by_user_id' => $uid, 'created_at' => $now, 'updated_at' => $now]);
                $settlement = DB::table('stall_settlement_records')->insertGetId(['closing_id' => $closing, 'stall_id' => $stall->id, 'created_at' => $now, 'updated_at' => $now]);
                if ($key === 'settlement_payouts') {
                    DB::table('settlement_payouts')->insert([
                        'settlement_id' => $settlement, 'business_date' => '2099-01-01', 'stall_id' => $stall->id, 'payable_at_time' => 50, 'amount' => 50,
                        'balance_after' => 0, 'payment_method' => 'cash', 'paid_at' => $now, 'paid_by_user_id' => $uid, 'created_at' => $now, 'updated_at' => $now,
                    ]);
                }
                break;
            case 'purchase_orders':
                $supplier = DB::table('suppliers')->insertGetId(['stall_id' => $stall->id, 'name' => 'PO Supplier', 'created_at' => $now, 'updated_at' => $now]);
                DB::table('purchase_orders')->insert(['uuid' => (string) Str::uuid(), 'purchase_number' => 'PO-SDX-' . Str::random(6), 'stall_id' => $stall->id, 'supplier_id' => $supplier, 'created_by_user_id' => $uid, 'order_date' => '2099-01-01', 'created_at' => $now, 'updated_at' => $now]);
                break;
            case 'stock_movements':
                $inv = DB::table('inventory_items')->insertGetId(['stall_id' => $stall->id, 'name' => 'Flour', 'unit' => 'kg', 'created_at' => $now, 'updated_at' => $now]);
                DB::table('stock_movements')->insert(['stall_id' => $stall->id, 'inventory_item_id' => $inv, 'movement_type' => 'purchase', 'quantity' => 5, 'previous_stock' => 0, 'new_stock' => 5, 'performed_by_user_id' => $uid, 'created_at' => $now, 'updated_at' => $now]);
                break;
            case 'store_movements':
                $item = DB::table('store_items')->insertGetId(['name' => 'Store Rice ' . Str::random(4), 'unit' => 'kg', 'created_at' => $now, 'updated_at' => $now]);
                DB::table('store_movements')->insert(['store_item_id' => $item, 'stall_id' => $stall->id, 'movement_type' => 'issue', 'quantity' => 1, 'previous_stock' => 5, 'new_stock' => 4, 'unit_cost' => 10, 'value' => 10, 'business_date' => '2099-01-01', 'performed_by_user_id' => $uid, 'created_at' => $now, 'updated_at' => $now]);
                break;
            case 'staff':
                User::factory()->create(['role' => 'stall_manager', 'stall_id' => $stall->id, 'email' => 'sdx.' . Str::random(6) . '@example.test']);
                break;
            case 'suppliers':
                DB::table('suppliers')->insert(['stall_id' => $stall->id, 'name' => 'Lone Supplier', 'created_at' => $now, 'updated_at' => $now]);
                break;
            case 'inventory_items':
                DB::table('inventory_items')->insert(['stall_id' => $stall->id, 'name' => 'Lone Item', 'unit' => 'kg', 'created_at' => $now, 'updated_at' => $now]);
                break;
            default:
                $this->fail("unknown link {$key}");
        }
    }

    private function preview(array $ids, ?User $as = null)
    {
        $req = $as === null ? $this : $this->actingAs($as);

        return $req->postJson('/api/stalls/deletion-preview', ['ids' => $ids]);
    }

    private function blockers(array $previewStall): array
    {
        return collect($previewStall['blockers'])->keyBy('key')->all();
    }

    public static function historyKeys(): array
    {
        return [
            'order line' => ['order_items'],
            'kitchen ticket' => ['kitchen_tickets'],
            'settlement record' => ['settlement_records'],
            'settlement payout' => ['settlement_payouts'],
            'purchase order' => ['purchase_orders'],
            'stock movement' => ['stock_movements'],
            'store issue' => ['store_movements'],
        ];
    }

    public static function setupKeys(): array
    {
        return ['assigned staff' => ['staff'], 'supplier' => ['suppliers'], 'inventory item' => ['inventory_items']];
    }

    public function test_a_stall_without_dependencies_is_eligible_and_is_deleted_permanently(): void
    {
        $stall = $this->makeStall('CLEAN', 2);

        $p = $this->preview([$stall->id], $this->owner())->assertOk()->json('stalls.0');
        $this->assertTrue($p['eligible']);
        $this->assertSame([], $p['blockers']);
        $this->assertSame(2, $p['menu_items']);
        $this->assertSame(1, $p['categories']);

        $this->actingAs($this->owner())->postJson('/api/stalls/bulk-delete', ['ids' => [$stall->id]])
            ->assertOk()->assertJsonPath('summary.deleted', 1)->assertJsonPath('summary.failed', 0);
        $this->assertNull(Stall::find($stall->id));
        $this->assertSame(0, MenuItem::where('stall_id', $stall->id)->count());
    }

    #[DataProvider('historyKeys')]
    public function test_each_history_link_blocks_permanent_deletion_as_history(string $key): void
    {
        $stall = $this->makeStall('H' . substr(md5($key), 0, 5));
        $this->link($key, $stall);

        $p = $this->preview([$stall->id], $this->owner())->assertOk()->json('stalls.0');

        $this->assertFalse($p['eligible']);
        $blockers = $this->blockers($p);
        $this->assertArrayHasKey($key, $blockers, "{$key} must be reported");
        $this->assertSame('history', $blockers[$key]['kind']);
        $this->assertGreaterThanOrEqual(1, $blockers[$key]['count']);
        $this->assertTrue($p['can_deactivate']);

        $this->actingAs($this->owner())->postJson('/api/stalls/bulk-delete', ['ids' => [$stall->id]])
            ->assertOk()->assertJsonPath('summary.deleted', 0)->assertJsonPath('summary.failed', 1)
            ->assertJsonPath('failed.0.can_deactivate', true)->assertJsonPath('failed.0.blockers.0.kind', fn ($k) => in_array($k, ['history', 'setup'], true));
        $this->assertNotNull(Stall::find($stall->id), 'the stall survives');
    }

    #[DataProvider('setupKeys')]
    public function test_each_setup_link_blocks_permanent_deletion_as_setup(string $key): void
    {
        $stall = $this->makeStall('S' . substr(md5($key), 0, 5));
        $this->link($key, $stall);

        $p = $this->preview([$stall->id], $this->owner())->assertOk()->json('stalls.0');

        $this->assertFalse($p['eligible']);
        $this->assertSame('setup', $this->blockers($p)[$key]['kind']);
        $this->actingAs($this->owner())->postJson('/api/stalls/bulk-delete', ['ids' => [$stall->id]])->assertOk()->assertJsonPath('summary.deleted', 0);
        $this->assertNotNull(Stall::find($stall->id));
    }

    public function test_a_stall_whose_dish_is_on_a_past_order_line_of_another_stall_is_still_protected(): void
    {
        // An order line may point at this stall's dish while carrying another stall_id (legacy data); the dish link alone must block
        $stall = $this->makeStall('DISH', 1);
        $other = $this->makeStall('DISH2', 1);
        $item = $this->firstItem($stall);
        $order = Order::create(['order_type' => 'takeaway', 'order_channel' => 'cashier_pos', 'status' => 'completed', 'subtotal' => 1, 'tax_amount' => 0, 'discount_amount' => 0, 'total_amount' => 1, 'payment_status' => 'paid', 'idempotency_key' => 'sdx-dish-' . Str::random(8)]);
        OrderItem::create(['order_id' => $order->id, 'stall_id' => $other->id, 'menu_item_id' => $item->id, 'item_name' => 'x', 'unit_price' => 1, 'quantity' => 1, 'subtotal' => 1, 'status' => 'served']);

        $p = $this->preview([$stall->id], $this->owner())->assertOk()->json('stalls.0');

        $this->assertFalse($p['eligible']);
        $this->assertSame('history', $this->blockers($p)['menu_items_on_orders']['kind']);
    }

    public function test_preview_gives_the_same_verdict_as_the_real_delete(): void
    {
        $clean = $this->makeStall('PV1', 1);
        $blocked = $this->makeStall('PV2', 1);
        $this->link('order_items', $blocked);
        $withPayout = $this->makeStall('PV3', 1);
        $this->link('settlement_payouts', $withPayout);
        $ids = [$clean->id, $blocked->id, $withPayout->id];

        $verdict = collect($this->preview($ids, $this->owner())->assertOk()->json('stalls'))->pluck('eligible', 'id')->all();
        $this->assertSame([$clean->id => true, $blocked->id => false, $withPayout->id => false], $verdict);

        $res = $this->actingAs($this->owner())->postJson('/api/stalls/bulk-delete', ['ids' => $ids])->assertOk();
        $deleted = collect($res->json('deleted'))->pluck('id')->all();
        $this->assertSame([$clean->id], $deleted);
        $this->assertEqualsCanonicalizing([$blocked->id, $withPayout->id], collect($res->json('failed'))->pluck('id')->all());
    }

    public function test_preview_lists_ids_that_do_not_exist_instead_of_failing(): void
    {
        $stall = $this->makeStall('MISS', 1);

        $res = $this->preview([$stall->id, 99999999], $this->owner())->assertOk();

        $this->assertSame([99999999], $res->json('missing'));
        $this->assertCount(1, $res->json('stalls'));
    }

    public function test_preview_validates_ids_like_bulk_delete(): void
    {
        $this->actingAs($this->owner())->postJson('/api/stalls/deletion-preview', ['ids' => []])->assertStatus(422);
        $this->actingAs($this->owner())->postJson('/api/stalls/deletion-preview', ['ids' => ['x']])->assertStatus(422);
        $this->actingAs($this->owner())->postJson('/api/stalls/deletion-preview', ['ids' => range(1, 201)])->assertStatus(422);
    }

    public function test_only_the_owner_can_preview_or_delete_stalls(): void
    {
        $stall = $this->makeStall('AUTH', 1);
        $manager = User::factory()->create(['role' => 'stall_manager', 'stall_id' => $stall->id, 'email' => 'sdx.mgr@example.test']);

        $this->preview([$stall->id])->assertStatus(401);
        $this->postJson('/api/stalls/bulk-delete', ['ids' => [$stall->id]])->assertStatus(401);
        foreach ([$this->cashier(), $manager] as $user) {
            $this->preview([$stall->id], $user)->assertStatus(403);
            $this->actingAs($user)->postJson('/api/stalls/bulk-delete', ['ids' => [$stall->id]])->assertStatus(403);
        }
        $this->assertNotNull(Stall::find($stall->id));
    }

    public function test_a_mixed_selection_reports_every_stall_and_never_skips_one_silently(): void
    {
        $clean = $this->makeStall('MX1', 1);
        $history = $this->makeStall('MX2', 1);
        $this->link('kitchen_tickets', $history);
        $setup = $this->makeStall('MX3', 1);
        $this->link('suppliers', $setup);
        $ids = [$clean->id, $history->id, $setup->id, 99999999];

        $res = $this->actingAs($this->owner())->postJson('/api/stalls/bulk-delete', ['ids' => $ids])->assertOk();

        $res->assertJsonPath('summary.requested', 4)->assertJsonPath('summary.deleted', 1)->assertJsonPath('summary.failed', 3);
        $reported = array_merge(collect($res->json('deleted'))->pluck('id')->all(), collect($res->json('failed'))->pluck('id')->all());
        $this->assertEqualsCanonicalizing($ids, $reported);
        foreach ($res->json('failed') as $f) {
            $this->assertNotSame('', trim($f['reason']));
        }
    }

    public function test_a_blocked_delete_leaves_history_and_revenue_totals_unchanged(): void
    {
        $stall = $this->makeStall('REV', 2);
        $this->order($this->firstItem($stall), 'REV');
        $this->link('settlement_payouts', $stall);
        $owner = $this->owner();
        $snapshot = function () use ($owner): array {
            $dash = $this->actingAs($owner)->getJson('/api/reports/dashboard')->assertOk()->json('data');

            return [
                'stall_sales' => $dash['stall_sales'], 'payment_methods' => $dash['payment_methods_today'],
                'counts' => [
                    'order_items' => DB::table('order_items')->count(), 'orders' => DB::table('orders')->count(),
                    'tickets' => DB::table('stall_kitchen_tickets')->count(), 'payments' => DB::table('payments')->count(),
                    'settlements' => DB::table('stall_settlement_records')->count(), 'payouts' => DB::table('settlement_payouts')->count(),
                    'sum_lines' => (string) DB::table('order_items')->sum('subtotal'), 'sum_payments' => (string) DB::table('payments')->sum('amount'),
                ],
            ];
        };
        $before = $snapshot();

        $this->preview([$stall->id], $owner)->assertOk();
        $this->actingAs($owner)->postJson('/api/stalls/bulk-delete', ['ids' => [$stall->id]])->assertOk()->assertJsonPath('summary.deleted', 0);

        $this->assertEquals($before, $snapshot());
        $this->assertSame(2, MenuItem::where('stall_id', $stall->id)->count());
    }

    public function test_deactivating_a_stall_with_history_keeps_every_record_and_stops_new_orders(): void
    {
        $stall = $this->makeStall('DEACT', 2);
        $this->order($this->firstItem($stall), 'DEACT');
        $counts = fn () => [DB::table('order_items')->count(), DB::table('stall_kitchen_tickets')->count(), DB::table('payments')->count(), MenuItem::where('stall_id', $stall->id)->count()];
        $before = $counts();

        $this->actingAs($this->owner())->putJson("/api/stalls/{$stall->id}", ['is_active' => false])->assertOk();

        $this->assertFalse((bool) Stall::find($stall->id)->is_active);
        $this->assertSame($before, $counts());
        $this->actingAs($this->cashier())->postJson('/api/orders', ['order_type' => 'takeaway', 'items' => [['menu_item_id' => $this->firstItem($stall)->id, 'quantity' => 1]]])
            ->assertStatus(422)->assertJsonFragment(['message' => "Item '" . $this->firstItem($stall)->name . "' belongs to a stall that is currently closed."]);
        $this->assertSame($before, $counts(), 'the refused order wrote nothing');
        $this->assertFalse($this->preview([$stall->id], $this->owner())->json('stalls.0.can_deactivate'), 'an inactive stall cannot be deactivated again');
    }

    public function test_a_stall_that_gains_an_order_after_the_preview_is_refused_by_the_delete(): void
    {
        $stall = $this->makeStall('LATE', 1);
        $this->assertTrue($this->preview([$stall->id], $this->owner())->json('stalls.0.eligible'));

        $this->order($this->firstItem($stall), 'LATE', ticket: false, paid: false);

        $res = $this->actingAs($this->owner())->postJson('/api/stalls/bulk-delete', ['ids' => [$stall->id]])->assertOk();
        $res->assertJsonPath('summary.deleted', 0);
        $this->assertStringContainsString('order line', $res->json('failed.0.reason'));
        $this->assertNotNull(Stall::find($stall->id));
        $this->assertSame(1, OrderItem::where('stall_id', $stall->id)->count());
    }
}
