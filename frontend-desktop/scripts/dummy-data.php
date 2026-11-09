<?php
/**
 * Bulk dummy data for ONE desktop profile's database, written with the backend's own models and stock service.
 * Run by load-dummy-data.mjs with the same environment the app gives its built-in server. Never run it against real data.
 *
 *   php dummy-data.php <backend dir> <data json>
 */

use App\Models\DiningTable;
use App\Models\MenuCategory;
use App\Models\MenuItem;
use App\Models\Stall;
use App\Models\StoreItem;
use App\Models\StoreMovement;
use App\Models\StorePurchaseOrder;
use App\Models\StoreSupplier;
use App\Models\User;
use App\Services\StoreStockService;
use Illuminate\Support\Facades\DB;

[$script, $backend, $dataFile] = $argv + [null, null, null];
chdir($backend);
require $backend . '/vendor/autoload.php';
$app = require $backend . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$data = json_decode(file_get_contents($dataFile), true, 512, JSON_THROW_ON_ERROR);
$say = fn (string $m) => fwrite(STDOUT, '[' . date('H:i:s') . "] {$m}\n");
if (config('database.default') !== 'sqlite' || !config('foodcourt.embedded')) {
    throw new RuntimeException('Refusing: this only fills a desktop profile database');
}
if (Stall::count() > 0 || StoreSupplier::count() > 0) {
    throw new RuntimeException('Refusing: this database already has stalls or suppliers');
}
$owner = User::where('role', 'owner')->firstOrFail();
$stock = app(StoreStockService::class);
mt_srand(20261107);

DB::transaction(function () use ($data, $say) {
    $stalls = [];
    foreach ($data['stalls'] as $s) {
        $stalls[] = Stall::create($s);
    }
    $categories = [];
    foreach ($data['categories'] as $i => $name) {
        $categories[] = MenuCategory::create(['stall_id' => $stalls[$i]->id, 'name' => $name, 'display_order' => $i + 1, 'is_active' => true]);
    }
    foreach ($data['dishes'] as $i => $name) {
        $s = intdiv($i, 2);
        MenuItem::create([
            'stall_id' => $stalls[$s]->id, 'category_id' => $categories[$s]->id, 'name' => $name, 'description' => 'Dummy data dish',
            'price' => mt_rand(4, 90) * 5, 'is_veg' => mt_rand(1, 10) <= 7, 'is_available' => true, 'preparation_time_minutes' => mt_rand(5, 25),
        ]);
    }
    $say('50 stalls, 50 categories, 100 dishes');
    foreach ($data['tables'] as $t) {
        DiningTable::create($t);
    }
    $say(count($data['tables']) . ' tables on 40 floors');
});

$items = DB::transaction(function () use ($data, $owner, $stock) {
    $items = [];
    foreach ($data['raw_materials'] as [$name, $unit, $cost]) {
        $item = StoreItem::create(['name' => $name, 'unit' => $unit, 'minimum_alert_stock' => $unit === 'pcs' ? 50 : 5, 'unit_cost' => $cost, 'current_stock' => 0, 'is_active' => true]);
        $stock->record($item, StoreMovement::OPENING, StoreStockService::decimal(mt_rand(5, 60)), $owner, null, null, 'Opening stock');
        $items[] = $item->fresh();
    }
    return $items;
});
$say(count($items) . ' raw materials with opening stock');

$suppliers = DB::transaction(function () use ($data) {
    return array_map(fn ($s) => StoreSupplier::create($s), $data['suppliers']);
});
$say(count($suppliers) . ' suppliers');

// 10 orders per supplier, 1 to 3 lines, order dates over the last 180 days; about 30% received and 5% cancelled
$numbers = [];
$received = 0;
$cancelled = 0;
for ($batch = 0; $batch < 10; $batch++) {
    DB::transaction(function () use ($batch, $suppliers, $items, $owner, $stock, &$numbers, &$received, &$cancelled) {
        for ($n = $batch * 1000; $n < ($batch + 1) * 1000; $n++) {
            $date = now()->subDays(mt_rand(0, 180))->toDateString();
            do {
                $number = 'SPO-' . str_replace('-', '', $date) . '-' . strtoupper(\Illuminate\Support\Str::random(5));
            } while (isset($numbers[$number]));
            $numbers[$number] = true;

            $picked = [];
            for ($l = mt_rand(1, 3); $l > 0; $l--) {
                $it = $items[mt_rand(0, count($items) - 1)];
                $picked[$it->id] = $it;
            }
            $total = '0.00';
            $lines = [];
            foreach ($picked as $it) {
                $qty = (string) mt_rand(1, 40);
                $price = (string) $it->unit_cost;
                $lineTotal = bcadd(bcmul($qty, $price, 5), '0.005', 2);
                $total = bcadd($total, $lineTotal, 2);
                $lines[] = ['store_item_id' => $it->id, 'quantity' => $qty, 'unit_price' => $price, 'total_price' => $lineTotal];
            }
            $order = StorePurchaseOrder::create([
                'purchase_number' => $number, 'store_supplier_id' => $suppliers[$n % 1000]->id, 'created_by_user_id' => $owner->id,
                'order_date' => $date, 'total_amount' => $total, 'status' => 'ordered', 'notes' => $n % 7 === 0 ? 'Dummy data order' : null,
            ]);
            $order->items()->createMany($lines);

            $roll = mt_rand(1, 100);
            if ($roll <= 30) {
                $order->update(['status' => 'received', 'received_at' => now()]);
                foreach ($order->items()->orderBy('store_item_id')->get() as $line) {
                    $item = $stock->lockItem((int) $line->store_item_id);
                    $item->unit_cost = $line->unit_price;
                    $stock->record($item, StoreMovement::PURCHASE, StoreStockService::decimal($line->quantity), $owner, null, $order->purchase_number, "Received {$order->purchase_number}");
                }
                $received++;
            } elseif ($roll <= 35) {
                $order->update(['status' => 'cancelled', 'cancelled_at' => now(), 'cancel_reason' => 'Dummy data: supplier could not deliver']);
                $cancelled++;
            }
        }
    });
    $say(($batch + 1) * 1000 . " purchase orders ({$received} received, {$cancelled} cancelled)");
}
$say('DONE');
