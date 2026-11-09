<?php

namespace Tests\Feature;

use App\Models\InventoryItem;
use App\Models\Stall;
use App\Models\StoreItem;
use App\Models\StoreMovement;
use App\Models\StoreSupplier;
use App\Models\Supplier;
use App\Models\User;
use App\Services\BulkDeleteService;
use App\Services\StoreStockService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Str;
use Tests\TestCase;

/** The central raw material store. Builds its own records, so it runs on the seeded PostgreSQL test DB and on a bare SQLite one. */
class CentralStoreTest extends TestCase
{
    use DatabaseTransactions;

    private User $owner;
    private User $store;
    private Stall $stallA;
    private Stall $stallB;

    protected function setUp(): void
    {
        parent::setUp();
        $this->stallA = $this->stall('A');
        $this->stallB = $this->stall('B');
        $this->owner = $this->person('owner');
        $this->store = $this->person('store_staff');
    }

    private function stall(string $label): Stall
    {
        return Stall::create(['name' => "Test Stall {$label} " . Str::random(6), 'code' => 'T' . strtoupper(Str::random(7)), 'is_active' => true]);
    }

    private function person(string $role, ?int $stallId = null): User
    {
        return User::create([
            'name' => "Test {$role}", 'email' => Str::random(12) . '@store.test', 'password' => 'password123',
            'role' => $role, 'stall_id' => $stallId, 'is_active' => true,
        ]);
    }

    private function item(string $opening = '10', string $cost = '100', array $extra = []): StoreItem
    {
        $id = $this->actingAs($this->store, 'sanctum')->postJson('/api/store/items', $extra + [
            'name' => 'Paneer ' . Str::random(6), 'unit' => 'kg', 'minimum_alert_stock' => 2, 'unit_cost' => $cost, 'opening_stock' => $opening,
        ])->assertStatus(201)->json('data.id');

        return StoreItem::findOrFail($id);
    }

    private function supplier(): StoreSupplier
    {
        return StoreSupplier::create(['name' => 'Supplier ' . Str::random(8)]);
    }

    private function purchase(StoreItem $item, string $qty = '5', string $price = '120'): int
    {
        return $this->actingAs($this->store, 'sanctum')->postJson('/api/store/purchases', [
            'store_supplier_id' => $this->supplier()->id, 'order_date' => '2026-11-07',
            'items' => [['store_item_id' => $item->id, 'quantity' => $qty, 'unit_price' => $price]],
        ])->assertStatus(201)->json('data.id');
    }

    private function assertHistoryAddsUp(StoreItem $item): void
    {
        $sum = StoreMovement::where('store_item_id', $item->id)->pluck('quantity')->reduce(fn ($s, $q) => bcadd($s, (string) $q, 3), '0.000');
        $this->assertSame($sum, bcadd((string) $item->fresh()->current_stock, '0', 3));
    }

    public function test_opening_stock_is_in_the_history(): void
    {
        $item = $this->item('12.5');

        $this->assertSame('12.500', $item->current_stock);
        $this->assertDatabaseHas('store_movements', ['store_item_id' => $item->id, 'movement_type' => 'opening_stock', 'performed_by_user_id' => $this->store->id]);
        $this->assertHistoryAddsUp($item);
    }

    public function test_zero_opening_stock_adds_no_history_row(): void
    {
        $item = $this->item('0');
        $this->assertSame(0, StoreMovement::where('store_item_id', $item->id)->count());
    }

    public function test_issue_reduces_store_stock_and_records_stall_and_value(): void
    {
        $item = $this->item('10', '100');

        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/issue", ['stall_id' => $this->stallA->id, 'quantity' => '2.5'])->assertOk();

        $this->assertSame('7.500', $item->fresh()->current_stock);
        $movement = StoreMovement::where('store_item_id', $item->id)->where('movement_type', 'issue_to_stall')->firstOrFail();
        $this->assertSame($this->stallA->id, $movement->stall_id);
        $this->assertSame('-2.500', $movement->quantity);
        $this->assertSame('250.00', $movement->value);
        $this->assertHistoryAddsUp($item);
    }

    public function test_issue_is_refused_above_stock_for_inactive_stall_or_inactive_item(): void
    {
        $item = $this->item('1');
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/issue", ['stall_id' => $this->stallA->id, 'quantity' => '1.001'])->assertStatus(422);

        $this->stallB->update(['is_active' => false]);
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/issue", ['stall_id' => $this->stallB->id, 'quantity' => '0.5'])->assertStatus(422);

        $item->update(['is_active' => false]);
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/issue", ['stall_id' => $this->stallA->id, 'quantity' => '0.5'])->assertStatus(422);

        $this->assertSame('1.000', $item->fresh()->current_stock);
    }

    public function test_a_stall_cannot_return_more_than_it_was_issued(): void
    {
        $item = $this->item('10');
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/issue", ['stall_id' => $this->stallA->id, 'quantity' => '3'])->assertOk();

        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/return", ['stall_id' => $this->stallA->id, 'quantity' => '3.001', 'reason' => 'x'])->assertStatus(422);
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/return", ['stall_id' => $this->stallB->id, 'quantity' => '1', 'reason' => 'x'])->assertStatus(422);

        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/return", ['stall_id' => $this->stallA->id, 'quantity' => '2', 'reason' => 'extra'])->assertOk();
        $this->assertSame('9.000', $item->fresh()->current_stock);
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/return", ['stall_id' => $this->stallA->id, 'quantity' => '1.5', 'reason' => 'x'])->assertStatus(422);
        $this->assertHistoryAddsUp($item);
    }

    public function test_waste_needs_a_reason_and_cannot_exceed_stock(): void
    {
        $item = $this->item('4');
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/waste", ['quantity' => '1'])->assertStatus(422);
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/waste", ['quantity' => '5', 'reason' => 'spoiled'])->assertStatus(422);
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/waste", ['quantity' => '1', 'reason' => 'spoiled'])->assertOk();
        $this->assertSame('3.000', $item->fresh()->current_stock);
    }

    public function test_count_sets_the_stock_and_keeps_the_difference(): void
    {
        $item = $this->item('10', '50');

        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/count", ['counted_stock' => '8.5'])->assertOk();
        $this->assertSame('8.500', $item->fresh()->current_stock);
        $count = StoreMovement::where('store_item_id', $item->id)->where('movement_type', 'stock_count')->firstOrFail();
        $this->assertSame('-1.500', $count->quantity);
        $this->assertSame('75.00', $count->value);

        // A count that matches is still proof it was counted
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/count", ['counted_stock' => '8.5'])->assertOk();
        $this->assertSame(2, StoreMovement::where('store_item_id', $item->id)->where('movement_type', 'stock_count')->count());
        $this->assertHistoryAddsUp($item);
    }

    public function test_value_of_an_old_issue_does_not_change_when_the_price_changes(): void
    {
        $item = $this->item('10', '100');
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/issue", ['stall_id' => $this->stallA->id, 'quantity' => '1'])->assertOk();
        $this->actingAs($this->store, 'sanctum')->putJson("/api/store/items/{$item->id}", ['unit_cost' => '999'])->assertOk();

        $this->assertSame('100.00', StoreMovement::where('store_item_id', $item->id)->where('movement_type', 'issue_to_stall')->value('value'));
    }

    public function test_unit_is_locked_after_history_and_duplicates_are_refused(): void
    {
        $item = $this->item('1');
        $this->actingAs($this->store, 'sanctum')->putJson("/api/store/items/{$item->id}", ['unit' => 'g'])->assertStatus(422);

        $fresh = $this->item('0');
        $this->actingAs($this->store, 'sanctum')->putJson("/api/store/items/{$fresh->id}", ['unit' => 'g'])->assertOk();
        $this->actingAs($this->store, 'sanctum')->putJson("/api/store/items/{$fresh->id}", ['unit' => 'bucket'])->assertStatus(422);

        $this->actingAs($this->store, 'sanctum')->postJson('/api/store/items', [
            'name' => '  ' . strtoupper($item->name) . ' ', 'unit' => 'kg', 'minimum_alert_stock' => 0, 'unit_cost' => 0,
        ])->assertStatus(422);
        $this->actingAs($this->store, 'sanctum')->postJson('/api/store/items', [
            'name' => 'Odd unit', 'unit' => 'bucket', 'minimum_alert_stock' => 0, 'unit_cost' => 0,
        ])->assertStatus(422);
    }

    public function test_inactive_items_leave_the_default_list_and_low_stock_filter_works(): void
    {
        $low = $this->item('1');
        $high = $this->item('50');
        $gone = $this->item('0');
        $this->actingAs($this->store, 'sanctum')->putJson("/api/store/items/{$gone->id}", ['is_active' => false])->assertOk();

        $ids = collect($this->actingAs($this->store, 'sanctum')->getJson('/api/store/items')->assertOk()->json('data'))->pluck('id');
        $this->assertTrue($ids->contains($low->id) && $ids->contains($high->id));
        $this->assertFalse($ids->contains($gone->id));
        $this->assertTrue(collect($this->actingAs($this->store, 'sanctum')->getJson('/api/store/items?include_inactive=1')->json('data'))->pluck('id')->contains($gone->id));

        $lowIds = collect($this->actingAs($this->store, 'sanctum')->getJson('/api/store/items?low_stock_only=1')->json('data'))->pluck('id');
        $this->assertTrue($lowIds->contains($low->id));
        $this->assertFalse($lowIds->contains($high->id));
        $this->assertFalse($lowIds->contains($gone->id));

        $dashboard = $this->actingAs($this->owner, 'sanctum')->getJson('/api/reports/dashboard')->assertOk()->json('data.low_stock_items');
        $this->assertTrue(collect($dashboard)->pluck('id')->contains($low->id));
    }

    public function test_receiving_adds_stock_once_and_updates_the_price(): void
    {
        $item = $this->item('10', '100');
        $po = $this->purchase($item, '5', '120');
        $this->assertSame('10.000', $item->fresh()->current_stock); // ordering alone changes nothing

        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/purchases/{$po}/receive")->assertOk()->assertJsonPath('data.status', 'received');
        $this->assertSame('15.000', $item->fresh()->current_stock);
        $this->assertSame('120.00', $item->fresh()->unit_cost);
        $this->assertSame('600.00', StoreMovement::where('store_item_id', $item->id)->where('movement_type', 'purchase_inward')->value('value'));

        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/purchases/{$po}/receive")->assertStatus(422);
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/purchases/{$po}/cancel", ['reason' => 'late'])->assertStatus(422);
        $this->assertSame('15.000', $item->fresh()->current_stock);
        $this->assertHistoryAddsUp($item);
    }

    public function test_the_same_item_on_two_lines_is_added_twice_correctly(): void
    {
        $item = $this->item('1', '10');
        $po = $this->actingAs($this->store, 'sanctum')->postJson('/api/store/purchases', [
            'store_supplier_id' => $this->supplier()->id, 'order_date' => '2026-11-07',
            'items' => [
                ['store_item_id' => $item->id, 'quantity' => '2', 'unit_price' => '10'],
                ['store_item_id' => $item->id, 'quantity' => '3', 'unit_price' => '20'],
            ],
        ])->assertStatus(201)->assertJsonPath('data.total_amount', '80.00')->json('data.id');

        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/purchases/{$po}/receive")->assertOk();
        $this->assertSame('6.000', $item->fresh()->current_stock);
        $this->assertHistoryAddsUp($item);
    }

    public function test_cancelled_order_adds_no_stock_and_cannot_be_received(): void
    {
        $item = $this->item('10');
        $po = $this->purchase($item);
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/purchases/{$po}/cancel", [])->assertStatus(422); // reason required
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/purchases/{$po}/cancel", ['reason' => 'wrong item'])->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/purchases/{$po}/receive")->assertStatus(422);
        $this->assertSame('10.000', $item->fresh()->current_stock);
    }

    public function test_order_needs_active_supplier_and_active_items(): void
    {
        $item = $this->item('1');
        $inactiveSupplier = StoreSupplier::create(['name' => 'Gone ' . Str::random(6), 'is_active' => false]);
        $line = ['store_item_id' => $item->id, 'quantity' => 1, 'unit_price' => 1];

        $this->actingAs($this->store, 'sanctum')->postJson('/api/store/purchases', ['store_supplier_id' => $inactiveSupplier->id, 'order_date' => '2026-11-07', 'items' => [$line]])->assertStatus(422);

        $item->update(['is_active' => false]);
        $this->actingAs($this->store, 'sanctum')->postJson('/api/store/purchases', ['store_supplier_id' => $this->supplier()->id, 'order_date' => '2026-11-07', 'items' => [$line]])->assertStatus(422);
    }

    public function test_supplier_history_and_duplicate_name(): void
    {
        $name = 'Fresh Dairy ' . Str::random(6);
        $id = $this->actingAs($this->store, 'sanctum')->postJson('/api/store/suppliers', ['name' => $name, 'phone' => '9000000000'])->assertStatus(201)->json('data.id');
        $this->actingAs($this->store, 'sanctum')->postJson('/api/store/suppliers', ['name' => strtoupper($name)])->assertStatus(422);

        $item = $this->item('0', '10');
        $po = $this->actingAs($this->store, 'sanctum')->postJson('/api/store/purchases', [
            'store_supplier_id' => $id, 'order_date' => '2026-11-07', 'items' => [['store_item_id' => $item->id, 'quantity' => 2, 'unit_price' => 15]],
        ])->json('data.id');
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/purchases/{$po}/receive")->assertOk();

        $this->actingAs($this->store, 'sanctum')->getJson("/api/store/suppliers/{$id}")->assertOk()
            ->assertJsonPath('data.summary.purchase_orders', 1)
            ->assertJsonPath('data.summary.received_total', '30.00');

        $listed = collect($this->actingAs($this->store, 'sanctum')->getJson('/api/store/suppliers')->json('data'))->firstWhere('id', $id);
        $this->assertSame(1, $listed['purchase_orders_count']);
        $this->assertEquals(30, $listed['received_total']);

        $this->actingAs($this->store, 'sanctum')->putJson("/api/store/suppliers/{$id}", ['is_active' => false])->assertOk();
        $this->assertFalse(collect($this->actingAs($this->store, 'sanctum')->getJson('/api/store/suppliers')->json('data'))->pluck('id')->contains($id));
    }

    public function test_only_owner_and_store_staff_run_the_store(): void
    {
        $item = $this->item('5');
        $po = $this->purchase($item);
        $blocked = [
            $this->person('cashier'),
            $this->person('waiter'),
            $this->person('kitchen_staff', $this->stallA->id),
            $this->person('stall_manager', $this->stallA->id),
        ];
        $calls = [
            ['GET', '/api/store/items'], ['POST', '/api/store/items'], ['PUT', "/api/store/items/{$item->id}"],
            ['POST', "/api/store/items/{$item->id}/issue"], ['POST', "/api/store/items/{$item->id}/return"],
            ['POST', "/api/store/items/{$item->id}/waste"], ['POST', "/api/store/items/{$item->id}/count"],
            ['GET', '/api/store/suppliers'], ['POST', '/api/store/suppliers'],
            ['GET', '/api/store/purchases'], ['POST', '/api/store/purchases'],
            ['POST', "/api/store/purchases/{$po}/receive"], ['POST', "/api/store/purchases/{$po}/cancel"],
            ['GET', '/api/store/import'], ['POST', '/api/store/import'],
            ['GET', '/api/reports/store-stock'], ['GET', '/api/reports/store-issues'], ['GET', '/api/reports/store-purchases'],
            ['GET', '/api/reports/store-waste'], ['GET', '/api/reports/store-counts'],
        ];
        foreach ($blocked as $user) {
            foreach ($calls as [$method, $url]) {
                $this->actingAs($user, 'sanctum')->json($method, $url)->assertStatus(403);
            }
        }
        $this->assertSame('5.000', $item->fresh()->current_stock);

        // Store staff run the store but do not see owner reports or the one-time move
        $this->actingAs($this->store, 'sanctum')->getJson('/api/reports/store-stock')->assertStatus(403);
        $this->actingAs($this->store, 'sanctum')->getJson('/api/store/import')->assertStatus(403);
        $this->actingAs($this->store, 'sanctum')->getJson('/api/stalls')->assertOk();
        $this->actingAs($this->owner, 'sanctum')->getJson('/api/store/items')->assertOk();
    }

    public function test_stall_manager_sees_only_what_their_stall_received(): void
    {
        $item = $this->item('10');
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/issue", ['stall_id' => $this->stallA->id, 'quantity' => '1'])->assertOk();
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/issue", ['stall_id' => $this->stallB->id, 'quantity' => '2'])->assertOk();
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/waste", ['quantity' => '1', 'reason' => 'spilt'])->assertOk();
        $manager = $this->person('stall_manager', $this->stallA->id);

        // Asking for another stall is ignored, not obeyed
        $rows = $this->actingAs($manager, 'sanctum')->getJson("/api/store/movements?stall_id={$this->stallB->id}")->assertOk()->json('data.data');
        $this->assertCount(1, $rows);
        $this->assertSame($this->stallA->id, $rows[0]['stall_id']);
        $this->assertSame('issue_to_stall', $rows[0]['movement_type']);
        $this->assertSame($item->name, $rows[0]['item']['name']);

        $this->actingAs($this->person('kitchen_staff', $this->stallA->id), 'sanctum')->getJson('/api/store/movements')->assertStatus(403);
        $this->actingAs($this->person('cashier'), 'sanctum')->getJson('/api/store/movements')->assertStatus(403);
    }

    public function test_store_staff_account_needs_no_stall_and_keeps_none(): void
    {
        $base = ['name' => 'Rakesh', 'password' => 'password123', 'role' => 'store_staff'];
        $this->actingAs($this->owner, 'sanctum')->postJson('/api/staff', $base + ['email' => Str::random(10) . '@store.test'])->assertStatus(201)->assertJsonPath('data.stall_id', null);

        $id = $this->actingAs($this->owner, 'sanctum')->postJson('/api/staff', $base + ['email' => Str::random(10) . '@store.test', 'stall_id' => $this->stallA->id])->assertStatus(201)->assertJsonPath('data.stall_id', null)->json('data.id');

        $manager = $this->person('stall_manager', $this->stallA->id);
        $this->actingAs($this->owner, 'sanctum')->putJson("/api/staff/{$manager->id}", ['role' => 'store_staff'])->assertOk()->assertJsonPath('data.stall_id', null);

        // A stall manager still needs a stall
        $this->actingAs($this->owner, 'sanctum')->putJson("/api/staff/{$id}", ['role' => 'stall_manager'])->assertStatus(422);
    }

    public function test_store_staff_with_an_old_stall_assignment_can_still_run_the_store(): void
    {
        $old = $this->person('store_staff', $this->stallA->id);
        $this->actingAs($old, 'sanctum')->getJson('/api/store/items')->assertOk();
    }

    public function test_move_merges_old_stock_once_and_leaves_old_rows_alone(): void
    {
        $name = 'Basmati ' . Str::random(6);
        $a = InventoryItem::create(['stall_id' => $this->stallA->id, 'name' => $name, 'unit' => 'kg', 'current_stock' => '4.5', 'minimum_alert_stock' => 1, 'unit_cost' => 90]);
        $b = InventoryItem::create(['stall_id' => $this->stallB->id, 'name' => strtoupper($name) . ' ', 'unit' => 'KG', 'current_stock' => '1.5', 'minimum_alert_stock' => 3, 'unit_cost' => 95]);
        $otherUnit = InventoryItem::create(['stall_id' => $this->stallB->id, 'name' => $name, 'unit' => 'g', 'current_stock' => '100', 'minimum_alert_stock' => 0, 'unit_cost' => 1]);
        $liter = InventoryItem::create(['stall_id' => $this->stallA->id, 'name' => "Oil {$name}", 'unit' => 'liter', 'current_stock' => '2', 'minimum_alert_stock' => 0, 'unit_cost' => 150]);
        $supplierName = 'Old Supplier ' . Str::random(6);
        Supplier::create(['stall_id' => $this->stallA->id, 'name' => $supplierName, 'phone' => '111']);
        Supplier::create(['stall_id' => $this->stallB->id, 'name' => strtolower($supplierName)]);

        $before = StoreItem::count();
        $preview = $this->actingAs($this->owner, 'sanctum')->getJson('/api/store/import')->assertOk()->json('data');
        $this->assertSame($before, StoreItem::count()); // looking changes nothing
        $group = collect($preview['groups'])->first(fn ($g) => $g['name'] === $name && $g['unit'] === 'kg');
        $this->assertSame('6.000', $group['quantity']);
        $this->assertSame(2, $group['rows']);
        $this->assertTrue(collect($preview['warnings'])->contains(fn ($w) => str_contains($w, $name) && str_contains($w, 'more than one unit')));
        $this->assertTrue(collect($preview['warnings'])->contains(fn ($w) => str_contains($w, $name) && str_contains($w, 'different prices')));

        $this->actingAs($this->owner, 'sanctum')->postJson('/api/store/import')->assertOk();

        $merged = StoreItem::where('name', $name)->where('unit', 'kg')->firstOrFail();
        $this->assertSame('6.000', $merged->current_stock);
        $this->assertSame('3.000', $merged->minimum_alert_stock);
        $this->assertHistoryAddsUp($merged);
        $this->assertSame('100.000', StoreItem::where('name', $name)->where('unit', 'g')->firstOrFail()->current_stock);
        $this->assertSame('l', StoreItem::where('name', "Oil {$name}")->firstOrFail()->unit);
        $supplier = StoreSupplier::whereRaw('lower(name) = ?', [strtolower($supplierName)])->get();
        $this->assertCount(1, $supplier);
        $this->assertSame('111', $supplier->first()->phone);

        // Old rows are history: unchanged, and never counted again
        $this->assertSame('4.500', $a->fresh()->current_stock);
        $this->assertSame('1.500', $b->fresh()->current_stock);
        $this->assertSame('100.000', $otherUnit->fresh()->current_stock);
        $this->assertSame('2.000', $liter->fresh()->current_stock);

        $this->actingAs($this->owner, 'sanctum')->getJson('/api/store/import')->assertJsonPath('data.pending_items', 0)->assertJsonPath('data.pending_suppliers', 0);
        $this->actingAs($this->owner, 'sanctum')->postJson('/api/store/import')->assertOk()->assertJsonPath('data.items_moved', 0);
        $this->assertSame('6.000', $merged->fresh()->current_stock);

        // A row added later moves on its own and adds to the same item
        InventoryItem::create(['stall_id' => $this->stallA->id, 'name' => $name, 'unit' => 'kg', 'current_stock' => '1', 'minimum_alert_stock' => 0, 'unit_cost' => 90]);
        $this->actingAs($this->owner, 'sanctum')->postJson('/api/store/import')->assertOk()->assertJsonPath('data.items_moved', 1);
        $this->assertSame('7.000', $merged->fresh()->current_stock);
        $this->assertHistoryAddsUp($merged);
    }

    public function test_reports_totals_and_filters(): void
    {
        $this->travelTo('2026-11-07 06:00:00'); // 11:30 in India
        $item = $this->item('20', '100', ['minimum_alert_stock' => 30]);
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/issue", ['stall_id' => $this->stallA->id, 'quantity' => '3'])->assertOk();
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/return", ['stall_id' => $this->stallA->id, 'quantity' => '1', 'reason' => 'extra'])->assertOk();
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/issue", ['stall_id' => $this->stallB->id, 'quantity' => '2'])->assertOk();
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/waste", ['quantity' => '1', 'reason' => 'spoiled'])->assertOk();
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/count", ['counted_stock' => '12'])->assertOk();

        $range = 'start_date=2026-11-07&end_date=2026-11-07';
        $rows = collect($this->actingAs($this->owner, 'sanctum')->getJson("/api/reports/store-issues?{$range}")->assertOk()->json('data.rows'))->where('item_name', $item->name)->values();
        $this->assertCount(2, $rows);
        $a = $rows->firstWhere('stall_id', $this->stallA->id);
        $this->assertSame(['3.000', '1.000', '2.000', '200.00'], [$a['issued'], $a['returned'], $a['net'], $a['net_value']]);

        $filtered = $this->actingAs($this->owner, 'sanctum')->getJson("/api/reports/store-issues?{$range}&stall_id={$this->stallB->id}")->json('data.rows');
        $this->assertTrue(collect($filtered)->every(fn ($r) => $r['stall_id'] === $this->stallB->id));

        $waste = collect($this->actingAs($this->owner, 'sanctum')->getJson("/api/reports/store-waste?{$range}")->assertOk()->json('data.rows'))->firstWhere('item_name', $item->name);
        $this->assertSame(['1.000', '100.00', 'spoiled'], [$waste['quantity'], $waste['value'], $waste['reason']]);

        // 20 - 3 + 1 - 2 - 1 = 15 in the app, 12 counted
        $count = collect($this->actingAs($this->owner, 'sanctum')->getJson("/api/reports/store-counts?{$range}")->assertOk()->json('data.rows'))->firstWhere('item_name', $item->name);
        $this->assertSame(['15.000', '12.000', '-3.000', '300.00'], [$count['previous_stock'], $count['new_stock'], $count['difference'], $count['value']]);

        $stock = collect($this->actingAs($this->owner, 'sanctum')->getJson('/api/reports/store-stock')->assertOk()->json('data.items'))->firstWhere('id', $item->id);
        $this->assertSame('1200.00', $stock['stock_value']);
        $this->assertTrue($stock['is_low']);

        $history = $this->actingAs($this->owner, 'sanctum')->getJson("/api/store/movements?store_item_id={$item->id}&date_from=2026-11-08")->assertOk()->json('data.total');
        $this->assertSame(0, $history);
        $this->assertHistoryAddsUp($item);
    }

    public function test_purchase_report_keeps_open_and_received_apart_and_skips_cancelled(): void
    {
        $item = $this->item('0', '10');
        $supplier = $this->supplier();
        $order = fn (string $qty) => $this->actingAs($this->store, 'sanctum')->postJson('/api/store/purchases', [
            'store_supplier_id' => $supplier->id, 'order_date' => '2026-11-07', 'items' => [['store_item_id' => $item->id, 'quantity' => $qty, 'unit_price' => '10']],
        ])->assertStatus(201)->json('data.id');

        $received = $order('5');
        $order('2');
        $cancelled = $order('9');
        $outOfRange = $this->actingAs($this->store, 'sanctum')->postJson('/api/store/purchases', [
            'store_supplier_id' => $supplier->id, 'order_date' => '2026-11-08', 'items' => [['store_item_id' => $item->id, 'quantity' => 1, 'unit_price' => '10']],
        ])->assertStatus(201);
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/purchases/{$received}/receive")->assertOk();
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/purchases/{$cancelled}/cancel", ['reason' => 'no'])->assertOk();

        $row = collect($this->actingAs($this->owner, 'sanctum')->getJson('/api/reports/store-purchases?start_date=2026-11-07&end_date=2026-11-07')->assertOk()->json('data.suppliers'))->firstWhere('supplier_id', $supplier->id);
        $this->assertEquals(2, $row['purchase_orders']);
        $this->assertEquals(1, $row['open_orders']);
        $this->assertEquals(50, $row['received_total']);
        $this->assertEquals(20, $row['open_total']);

        $list = $this->actingAs($this->store, 'sanctum')->getJson('/api/store/purchases?date_from=2026-11-08&date_to=2026-11-08')->assertOk()->json('data.data');
        $this->assertTrue(collect($list)->pluck('id')->contains($outOfRange->json('data.id')));
        $this->assertFalse(collect($list)->pluck('id')->contains($received));
    }

    public function test_a_late_night_entry_belongs_to_the_india_day(): void
    {
        $this->travelTo('2026-11-07 19:00:00'); // 00:30 on 8 November in India
        $item = $this->item('5');

        $this->assertSame('2026-11-08', StoreMovement::where('store_item_id', $item->id)->value('business_date'));
    }

    public function test_money_rounds_half_up_to_paise(): void
    {
        $item = $this->item('10', '0.15');
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/issue", ['stall_id' => $this->stallA->id, 'quantity' => '0.1'])->assertOk();

        $this->assertSame('0.02', StoreMovement::where('store_item_id', $item->id)->where('movement_type', 'issue_to_stall')->value('value'));
    }

    public function test_a_stall_with_store_issues_is_never_deleted(): void
    {
        $item = $this->item('5');
        $stall = $this->stall('C');
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/issue", ['stall_id' => $stall->id, 'quantity' => '1'])->assertOk();

        $result = app(BulkDeleteService::class)->deleteStalls([$stall->id], $this->owner->id);

        $this->assertSame(0, $result['summary']['deleted']);
        $this->assertStringContainsString('central store issue', $result['failed'][0]['reason']);
    }

    public function test_every_change_is_in_the_audit_log(): void
    {
        $item = $this->item('5');
        $this->actingAs($this->store, 'sanctum')->postJson("/api/store/items/{$item->id}/waste", ['quantity' => '1', 'reason' => 'spoiled'])->assertOk();

        $this->assertDatabaseHas('audit_logs', ['action' => 'store_item_created', 'entity_id' => (string) $item->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'store_movement_created', 'entity_type' => 'StoreMovement', 'user_id' => $this->store->id]);
    }

    public function test_unit_aliases(): void
    {
        $this->assertSame('l', StoreStockService::normalizeUnit(' Liter '));
        $this->assertSame('kg', StoreStockService::normalizeUnit('KG'));
        $this->assertSame('bucket', StoreStockService::normalizeUnit('Bucket'));
    }
}
