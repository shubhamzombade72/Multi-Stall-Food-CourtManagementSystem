<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\Demo\DemoGuard;
use Database\Seeders\Demo\DemoIntegrity;
use Database\Seeders\Demo\IndianDemoSeeder;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** The Indian demo dataset: exact counts, idempotency, financial/ledger integrity, safety guard and stall isolation. Runs on the test database (inside a rolled-back transaction). */
class IndianDemoDatasetTest extends TestCase
{
    use DatabaseTransactions;

    public function test_guard_refuses_production_and_non_demo_databases(): void
    {
        config(['database.connections.' . config('database.default') . '.database' => 'foodcourt_db']);
        try {
            DemoGuard::assertSafe();
            $this->fail('the default development database must be refused');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString("not a demo/test database", $e->getMessage());
        }

        config(['database.connections.' . config('database.default') . '.database' => 'foodcourt_demo_db']);
        $this->app['env'] = 'production';
        try {
            DemoGuard::assertSafe();
            $this->fail('production must be refused even for a demo-named database');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('production', $e->getMessage());
        }
    }

    public function test_seeders_create_exact_counts_pass_every_integrity_check_and_are_idempotent(): void
    {
        $realStalls = DB::table('stalls')->where('code', 'not like', 'DM-%')->count();

        $this->seed(IndianDemoSeeder::class);
        $counts = IndianDemoSeeder::counts();

        $this->assertSame(1, $counts['food_court']);
        $this->assertSame(50, $counts['stalls']);
        $this->assertSame(500, $counts['tables']);
        $this->assertGreaterThanOrEqual(50, $counts['menu_categories']);
        $this->assertLessThanOrEqual(80, $counts['menu_categories']);
        $this->assertSame(1500, $counts['menu_items']);
        $this->assertSame(100, $counts['suppliers']);
        $this->assertSame(1000, $counts['customers']);
        $this->assertSame(150, $counts['staff_users']);
        $this->assertSame(2000, $counts['orders']);
        $this->assertGreaterThan(2000, $counts['order_items']);
        $this->assertSame(200, $counts['purchase_orders']);
        $this->assertSame(600, $counts['inventory_items']);
        $this->assertSame($realStalls, DB::table('stalls')->where('code', 'not like', 'DM-%')->count(), 'existing stalls are untouched');

        $failed = array_filter(DemoIntegrity::violations());
        $this->assertSame([], $failed, 'integrity violations: ' . json_encode($failed));

        // role mix and passwords
        $roles = DB::table('users')->where('email', 'like', '%@demo.%')->selectRaw('role, count(*) n')->groupBy('role')->pluck('n', 'role')->all();
        $this->assertSame(['cashier' => 8, 'kitchen_staff' => 75, 'owner' => 1, 'stall_manager' => 50, 'store_staff' => 4, 'waiter' => 12], $roles);
        $owner = User::where('email', 'owner@demo.example.test')->firstOrFail();
        $this->assertTrue(password_verify('DemoOwner#2026', $owner->password));
        $this->assertTrue(password_verify('DemoStaff#2026', User::where('email', 'cashier01@demo.example.test')->firstOrFail()->password));

        // order mix is realistic
        $o = DB::table('orders')->where('idempotency_key', 'like', 'demo-order-%');
        $this->assertGreaterThan(0, (clone $o)->where('order_type', 'dine_in')->count());
        $this->assertGreaterThan(0, (clone $o)->where('order_type', 'takeaway')->count());
        $this->assertGreaterThan(0, (clone $o)->where('status', 'cancelled')->count());
        $this->assertGreaterThan(0, (clone $o)->where('status', 'partially_ready')->count());
        $this->assertGreaterThan(0, (clone $o)->where('status', 'ready')->count());
        $this->assertGreaterThan(0, (clone $o)->where('status', 'served')->count());
        $this->assertGreaterThan(0, (clone $o)->where('status', 'confirmed')->count());
        $this->assertGreaterThan(1, DB::table('payments')->distinct()->count('payment_method'));
        $multi = DB::table('stall_kitchen_tickets')->join('orders', 'orders.id', '=', 'stall_kitchen_tickets.order_id')
            ->where('orders.idempotency_key', 'like', 'demo-order-%')->select('stall_kitchen_tickets.order_id')->groupBy('stall_kitchen_tickets.order_id')->havingRaw('count(*) > 1')->get()->count();
        $this->assertGreaterThan(100, $multi, 'multi-stall orders exist');

        // run again: nothing new, nothing duplicated
        $before = [$counts, DB::table('stock_movements')->count(), DB::table('users')->count()];
        $this->seed(IndianDemoSeeder::class);
        $this->assertSame($before, [IndianDemoSeeder::counts(), DB::table('stock_movements')->count(), DB::table('users')->count()]);
        $this->assertSame([], array_filter(DemoIntegrity::violations()));
    }

    public function test_stall_staff_cannot_see_or_change_another_stalls_data(): void
    {
        $this->seed(IndianDemoSeeder::class);
        $a = (int) DB::table('stalls')->where('code', 'DM-001')->value('id');
        $b = (int) DB::table('stalls')->where('code', 'DM-002')->value('id');
        $manager = User::where('email', 'manager.dm001@demo.example.test')->firstOrFail();
        $kitchen = User::where('email', 'kitchen.dm001a@demo.example.test')->firstOrFail();
        $this->assertSame($a, (int) $manager->stall_id);

        $rows = fn ($res) => collect($res->json('data.data') ?? $res->json('data'));

        // Reads: asking for stall B returns only stall A's rows
        foreach (['/api/inventory', '/api/inventory/movements', '/api/purchases', '/api/suppliers'] as $path) {
            $res = $this->actingAs($manager)->getJson($path . '?stall_id=' . $b)->assertOk();
            $stallIds = $rows($res)->map(fn ($r) => $r['stall_id'] ?? $r['stall']['id'] ?? null)->unique()->values()->all();
            $this->assertNotEmpty($rows($res), $path . ' should return the own stall rows');
            $this->assertSame([$a], $stallIds, "{$path} leaked another stall's rows");
        }
        // KDS: a kitchen user asking for another stall's tickets only ever gets their own
        $activeStall = (int) DB::table('stall_kitchen_tickets')->whereIn('status', ['pending', 'accepted', 'preparing', 'ready'])->orderBy('id')->value('stall_id');
        $otherStall = (int) DB::table('stalls')->where('code', 'like', 'DM-%')->where('id', '<>', $activeStall)->value('id');
        $activeKitchen = User::where('role', 'kitchen_staff')->where('stall_id', $activeStall)->firstOrFail();
        $tickets = $this->actingAs($activeKitchen)->getJson('/api/kitchen/tickets?stall_id=' . $otherStall)->assertOk()->json('data');
        $this->assertNotEmpty($tickets);
        $this->assertSame([$activeStall], collect($tickets)->pluck('stall_id')->unique()->values()->all());

        // Writes and direct reads on stall B are refused
        $bItem = DB::table('menu_items')->where('stall_id', $b)->value('id');
        $bInv = DB::table('inventory_items')->where('stall_id', $b)->value('id');
        $bPo = DB::table('purchase_orders')->where('stall_id', '<>', $a)->where('status', 'ordered')->value('id'); // any other stall's open order
        $bSupplier = DB::table('suppliers')->where('stall_id', $b)->value('id');
        $bTicket = DB::table('stall_kitchen_tickets')->where('stall_id', $b)->value('id');
        $bCat = DB::table('menu_categories')->where('stall_id', $b)->value('id');

        $this->actingAs($manager)->getJson("/api/stalls/{$b}")->assertStatus(403);
        $this->actingAs($manager)->putJson("/api/stalls/{$b}", ['name' => 'Hijack'])->assertStatus(403);
        $this->actingAs($manager)->putJson("/api/menu/{$bItem}", ['price' => 1])->assertStatus(403);
        $this->actingAs($manager)->postJson('/api/menu', ['stall_id' => $b, 'category_id' => $bCat, 'name' => 'Rogue', 'price' => 10])->assertStatus(403);
        $this->actingAs($manager)->postJson("/api/inventory/{$bInv}/adjust", ['movement_type' => 'manual_adjustment', 'quantity' => 5, 'reason' => 'x'])->assertStatus(403);
        $this->actingAs($manager)->postJson("/api/inventory/{$bInv}/stock-out", ['movement_type' => 'consumption', 'quantity' => 1])->assertStatus(403);
        $this->actingAs($manager)->postJson("/api/purchases/{$bPo}/receive")->assertStatus(403);
        $this->actingAs($manager)->getJson("/api/suppliers/{$bSupplier}")->assertStatus(403);
        $this->actingAs($kitchen)->putJson("/api/kitchen/tickets/{$bTicket}/status", ['status' => 'accepted'])->assertStatus(403);
        $this->actingAs($manager)->getJson('/api/orders')->assertStatus(403);

        // nothing changed on stall B
        $this->assertNotSame('Hijack', DB::table('stalls')->where('id', $b)->value('name'));
        $this->assertNotSame(1, (int) DB::table('menu_items')->where('id', $bItem)->value('price'));
    }
}
