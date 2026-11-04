<?php

namespace Database\Seeders\Demo;

use Database\Seeders\Demo\Data\DemoCatalog;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Orchestrates the Indian demo dataset (see docs/engineering/indian-demo-dataset-report.md).
 *
 *   php artisan foodcourt:seed-indian-demo          (recommended)
 *   php artisan db:seed --class="Database\Seeders\Demo\IndianDemoSeeder"
 *
 * It is NOT called from DatabaseSeeder, refuses to run unless the database is a demo/test database (DemoGuard), never deletes
 * anything and can be run repeatedly: each seeder only creates what is missing.
 */
class IndianDemoSeeder extends Seeder
{
    public function run(): void
    {
        $db = DemoGuard::assertSafe();
        $this->command?->getOutput()->writeln("Seeding Indian demo dataset into {$db['driver']} database '{$db['database']}'");

        $this->call([
            FoodCourtSeeder::class,
            StallSeeder::class,
            TableSeeder::class,
            MenuCategorySeeder::class,
            MenuItemSeeder::class,
            StaffSeeder::class,
            SupplierSeeder::class,
            CustomerSeeder::class,
            InventorySeeder::class,
            PurchaseOrderSeeder::class,
            OrderSeeder::class,
        ]);
    }

    /** @return array<string, int> how much demo data exists right now (counts only demo-keyed rows, so it is exact on a shared test DB too). */
    public static function counts(): array
    {
        $p = DemoCatalog::STALL_PREFIX;
        $stalls = DB::table('stalls')->where('code', 'like', $p . '%')->pluck('id');

        return [
            'food_court' => DB::table('settings')->where('key', 'business_profile')->count(),
            'stalls' => $stalls->count(),
            'tables' => DB::table('dining_tables')->whereRaw("table_number like 'T-___'")->count(),
            'menu_categories' => DB::table('menu_categories')->whereIn('stall_id', $stalls)->count(),
            'menu_items' => DB::table('menu_items')->whereIn('stall_id', $stalls)->count(),
            'suppliers' => DB::table('suppliers')->whereIn('stall_id', $stalls)->count(),
            'customers' => DB::table('customers')->where('phone', 'like', '+915%')->count(),
            'staff_users' => DB::table('users')->where('email', 'like', '%@demo.' . DemoCatalog::EMAIL_DOMAIN)->count(),
            'orders' => DB::table('orders')->where('idempotency_key', 'like', 'demo-order-%')->count(),
            'order_items' => DB::table('order_items')->join('orders', 'orders.id', '=', 'order_items.order_id')->where('orders.idempotency_key', 'like', 'demo-order-%')->count(),
            'kitchen_tickets' => DB::table('stall_kitchen_tickets')->whereIn('stall_id', $stalls)->count(),
            'payments' => DB::table('payments')->join('orders', 'orders.id', '=', 'payments.order_id')->where('orders.idempotency_key', 'like', 'demo-order-%')->count(),
            'purchase_orders' => DB::table('purchase_orders')->whereIn('stall_id', $stalls)->count(),
            'purchase_order_items' => DB::table('purchase_order_items')->join('purchase_orders', 'purchase_orders.id', '=', 'purchase_order_items.purchase_order_id')->whereIn('purchase_orders.stall_id', $stalls)->count(),
            'inventory_items' => DB::table('inventory_items')->whereIn('stall_id', $stalls)->count(),
            'stock_movements' => DB::table('stock_movements')->whereIn('stall_id', $stalls)->count(),
        ];
    }
}
