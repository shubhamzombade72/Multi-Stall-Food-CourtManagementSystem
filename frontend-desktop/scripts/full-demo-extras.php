<?php
/**
 * Finishes a FULL demo database after `php artisan foodcourt:seed-indian-demo`: marks setup done, adds stall owners,
 * closes every business day up to two days ago through the real closing code, records stall payouts through the real
 * payout service (full, partial and unpaid), and fills the central raw-material store (items, suppliers, purchase
 * orders, issues to stalls, waste). Demo/test databases only (the same guard as the demo seeders).
 *
 *   cd backend && DB_CONNECTION=sqlite DB_DATABASE=<...demo.sqlite> APP_ENV=local php ../frontend-desktop/scripts/full-demo-extras.php
 */

use App\Http\Controllers\Api\SettlementController;
use App\Models\Setting;
use App\Models\Stall;
use App\Models\StallOwner;
use App\Models\StallSettlementRecord;
use App\Models\StoreItem;
use App\Models\StoreMovement;
use App\Models\StorePurchaseOrder;
use App\Models\StoreSupplier;
use App\Models\User;
use App\Services\PayoutService;
use App\Services\StoreStockService;
use Database\Seeders\Demo\DemoGuard;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

require getcwd() . '/vendor/autoload.php';
$app = require getcwd() . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
DemoGuard::assertSafe();

$say = fn (string $m) => fwrite(STDOUT, '[' . date('H:i:s') . "] {$m}\n");
mt_srand(20261108);
$owner = User::where('role', 'owner')->firstOrFail();
$today = Carbon::today();

// ------------------------------------------------------------------ setup done (skips the Welcome screen)
Setting::updateOrCreate(['key' => 'system_setup'], ['value' => ['completed_at' => now()->toIso8601String(), 'recovery_key_hash' => null]]);

// ------------------------------------------------------------------ stall owners: 20 owners, some with several stalls
if (StallOwner::count() === 0) {
    $first = ['Rajesh', 'Sunita', 'Meena', 'Anand', 'Kavita', 'Suresh', 'Priya', 'Vikram', 'Neha', 'Amit', 'Pooja', 'Rahul', 'Snehal', 'Ganesh', 'Asha', 'Mahesh', 'Deepa', 'Sachin', 'Lata', 'Nitin'];
    $last = ['Patil', 'Joshi', 'Shah', 'Kulkarni', 'Deshmukh', 'Pawar', 'Iyer', 'Reddy', 'Gupta', 'Jadhav'];
    $owners = [];
    foreach ($first as $i => $f) {
        $name = $f . ' ' . $last[$i % count($last)];
        $owners[] = StallOwner::create(['name' => $name, 'phone' => '+915' . sprintf('%09d', 900000 + $i), 'upi_id' => Str::slug($name, '') . '@upi', 'is_active' => true]);
    }
    foreach (Stall::orderBy('id')->get() as $i => $stall) {
        $stall->update(['stall_owner_id' => $owners[$i % count($owners)]->id]);
    }
    $say('20 stall owners assigned to ' . Stall::count() . ' stalls');
}

// ------------------------------------------------------------------ day closings through the real closing code
$firstDay = Carbon::parse(DB::table('orders')->min('created_at'))->startOfDay();
$lastClosed = $today->copy()->subDays(2);
$settle = app(SettlementController::class);
$closed = 0;
for ($d = $firstDay->copy(); $d->lte($lastClosed); $d->addDay()) {
    $req = Request::create('/api/settlements/close-day', 'POST', ['date' => $d->toDateString(), 'notes' => 'Demo data closing']);
    $req->setUserResolver(fn () => $owner);
    $res = $settle->closeDay($req);
    if ($res->getStatusCode() < 300) {
        $closed++;
    } else {
        $say("close {$d->toDateString()}: HTTP {$res->getStatusCode()} " . substr((string) $res->getContent(), 0, 160));
    }
}
DB::table('daily_closings')->update(['created_at' => DB::raw("closing_date || ' 22:30:00'"), 'updated_at' => DB::raw("closing_date || ' 22:30:00'")]);
$say("{$closed} business days closed ({$firstDay->toDateString()} .. {$lastClosed->toDateString()}); yesterday and today stay open");

// ------------------------------------------------------------------ stall payouts through the real payout service
$svc = app(PayoutService::class);
$methods = ['cash', 'upi', 'bank_transfer', 'upi', 'cash'];
$full = $partial = $unpaid = 0;
$records = StallSettlementRecord::with(['closing', 'stall.owner'])->where('remaining_amount', '>', 0)->orderBy('id')->get();
foreach ($records as $n => $r) {
    $date = Carbon::parse($r->closing->closing_date);
    $age = $date->diffInDays($today);
    $roll = mt_rand(1, 100);
    // older than a week: almost all paid; the last week: a mix of paid, part-paid and still owed
    if ($age > 7 ? $roll <= 3 : $roll <= 35) {
        $unpaid++;
        continue;
    }
    $remaining = (string) $r->remaining_amount;
    $amount = ($age <= 7 && $roll <= 60) ? bcdiv(bcmul($remaining, '0.5', 3), '1', 2) : $remaining;
    $method = $methods[$n % count($methods)];
    $paidAt = $date->copy()->addDay()->setTime(mt_rand(10, 18), mt_rand(0, 59));
    if ($paidAt->isFuture()) {
        $paidAt = now()->subMinutes(5);
    }
    $svc->record($owner, $r->id, [
        'amount' => $amount, 'payment_method' => $method,
        'transaction_reference' => in_array($method, PayoutService::REFERENCE_REQUIRED, true) ? strtoupper(($method === 'upi' ? 'UPI' : 'NEFT') . Str::random(10)) : null,
        'received_by' => $r->stall->owner?->name ?? 'Stall representative', 'paid_at' => $paidAt,
        'idempotency_key' => 'full-demo-' . $r->id,
    ]);
    bccomp($amount, $remaining, 2) === 0 ? $full++ : $partial++;
}
$say("payouts: {$full} paid in full, {$partial} part-paid, {$unpaid} still owed; reconcile ok = " . json_encode($svc->reconcile()['ok']));

// ------------------------------------------------------------------ central raw-material store
if (StoreItem::count() === 0) {
    $stock = app(StoreStockService::class);
    $materials = [
        ['Basmati Rice', 'kg', 95], ['Wheat Flour (Atta)', 'kg', 38], ['Maida', 'kg', 42], ['Besan', 'kg', 90], ['Toor Dal', 'kg', 140], ['Moong Dal', 'kg', 120],
        ['Chana Dal', 'kg', 95], ['Rajma', 'kg', 150], ['Sugar', 'kg', 44], ['Salt', 'kg', 20], ['Sunflower Oil', 'litre', 145], ['Mustard Oil', 'litre', 170],
        ['Desi Ghee', 'kg', 620], ['Butter', 'kg', 520], ['Paneer', 'kg', 380], ['Milk', 'litre', 60], ['Curd', 'kg', 70], ['Fresh Cream', 'litre', 240],
        ['Cheese (Mozzarella)', 'kg', 460], ['Onion', 'kg', 35], ['Tomato', 'kg', 40], ['Potato', 'kg', 28], ['Green Chilli', 'kg', 80], ['Ginger', 'kg', 160],
        ['Garlic', 'kg', 180], ['Coriander Leaves', 'kg', 90], ['Capsicum', 'kg', 70], ['Cabbage', 'kg', 30], ['Chicken', 'kg', 230], ['Mutton', 'kg', 720],
        ['Eggs', 'pcs', 7], ['Pav Buns', 'pcs', 4], ['Burger Buns', 'pcs', 9], ['Garam Masala', 'kg', 650], ['Red Chilli Powder', 'kg', 320], ['Turmeric Powder', 'kg', 260],
        ['Tea Leaves', 'kg', 480], ['Coffee Powder', 'kg', 720], ['Paper Plates', 'pcs', 2], ['Takeaway Boxes', 'pcs', 6],
    ];
    $items = DB::transaction(function () use ($materials, $stock, $owner) {
        $out = [];
        foreach ($materials as [$name, $unit, $cost]) {
            $item = StoreItem::create(['name' => $name, 'unit' => $unit, 'minimum_alert_stock' => $unit === 'pcs' ? 200 : 10, 'unit_cost' => $cost, 'current_stock' => 0, 'is_active' => true]);
            $m = $stock->record($item, StoreMovement::OPENING, StoreStockService::decimal($unit === 'pcs' ? mt_rand(300, 1500) : mt_rand(20, 120)), $owner, null, null, 'Opening stock');
            $m->forceFill(['business_date' => $GLOBALS['today']->copy()->subDays(90)->toDateString(), 'created_at' => $GLOBALS['today']->copy()->subDays(90)->setTime(9, 0)])->save();
            $out[] = $item->fresh();
        }
        return $out;
    });
    $vendors = ['Pune Grains Traders', 'Shree Ganesh Dairy', 'Fresh Farm Vegetables', 'Mahalaxmi Oil Depot', 'Konkan Spices Co', 'Sai Poultry Supply', 'Royal Packaging', 'Annapurna Wholesale', 'Krishna Bakery Supply', 'Om Sai Provisions',
        'Deccan Fresh Meats', 'Balaji Masala Mills', 'Nashik Onion Mart', 'Shivneri Cold Storage', 'Green Leaf Traders'];
    $suppliers = DB::transaction(fn () => array_map(fn ($v, $i) => StoreSupplier::create([
        'name' => $v, 'contact_person' => ['Ramesh', 'Sanjay', 'Kiran', 'Prakash', 'Vijay'][$i % 5] . ' ' . ['More', 'Shinde', 'Kale', 'Gaikwad', 'Bhosale'][$i % 5],
        'phone' => '+915' . sprintf('%09d', 800000 + $i), 'email' => Str::slug($v) . '@example.test', 'address' => 'Market Yard, Pune', 'is_active' => true,
    ]), $vendors, array_keys($vendors)));

    $stallIds = Stall::orderBy('id')->pluck('id')->all();
    $po = $rec = $iss = 0;
    // Day by day over 90 days: 2-5 purchase orders (most received), 3-8 issues to stalls, the odd waste entry
    for ($ago = 89; $ago >= 0; $ago--) {
        $day = $today->copy()->subDays($ago);
        DB::transaction(function () use ($day, $ago, $items, $suppliers, $stallIds, $stock, $owner, &$po, &$rec, &$iss) {
            $stamp = fn (StoreMovement $m, int $h) => $m->forceFill(['business_date' => $day->toDateString(), 'created_at' => $day->copy()->setTime($h, mt_rand(0, 59))])->save();
            for ($k = mt_rand(2, 5); $k > 0; $k--) {
                $picked = [];
                for ($l = mt_rand(1, 4); $l > 0; $l--) {
                    $it = $items[mt_rand(0, count($items) - 1)];
                    $picked[$it->id] = $it;
                }
                $lines = [];
                $total = '0.00';
                foreach ($picked as $it) {
                    $qty = (string) ($it->unit === 'pcs' ? mt_rand(100, 600) : mt_rand(10, 60));
                    $price = (string) $it->unit_cost;
                    $lineTotal = bcadd(bcmul($qty, $price, 5), '0.005', 2);
                    $total = bcadd($total, $lineTotal, 2);
                    $lines[] = ['store_item_id' => $it->id, 'quantity' => $qty, 'unit_price' => $price, 'total_price' => $lineTotal];
                }
                $order = StorePurchaseOrder::create([
                    'purchase_number' => 'SPO-' . $day->format('Ymd') . '-' . strtoupper(Str::random(5)), 'store_supplier_id' => $suppliers[mt_rand(0, count($suppliers) - 1)]->id,
                    'created_by_user_id' => $owner->id, 'order_date' => $day->toDateString(), 'total_amount' => $total, 'status' => 'ordered',
                ]);
                $order->items()->createMany($lines);
                $order->forceFill(['created_at' => $day->copy()->setTime(9, mt_rand(0, 59))])->save();
                $po++;
                $roll = mt_rand(1, 100);
                if ($ago >= 2 && $roll <= 85) {
                    $order->forceFill(['status' => 'received', 'received_at' => $day->copy()->setTime(15, 0)])->save();
                    foreach ($order->items()->orderBy('store_item_id')->get() as $line) {
                        $item = $stock->lockItem((int) $line->store_item_id);
                        $item->unit_cost = $line->unit_price;
                        $stamp($stock->record($item, StoreMovement::PURCHASE, StoreStockService::decimal($line->quantity), $owner, null, $order->purchase_number, "Received {$order->purchase_number}"), 15);
                    }
                    $rec++;
                } elseif ($roll >= 97) {
                    $order->update(['status' => 'cancelled', 'cancelled_at' => $day->copy()->setTime(17, 0), 'cancel_reason' => 'Supplier could not deliver']);
                }
            }
            for ($k = mt_rand(3, 8); $k > 0; $k--) {
                $item = $stock->lockItem($items[mt_rand(0, count($items) - 1)]->id);
                $qty = $item->unit === 'pcs' ? mt_rand(20, 120) : mt_rand(2, 12);
                if (bccomp((string) $item->current_stock, (string) $qty, 3) < 0) {
                    continue;
                }
                $stamp($stock->record($item, StoreMovement::ISSUE, '-' . StoreStockService::decimal($qty), $owner, $stallIds[mt_rand(0, count($stallIds) - 1)], null, 'Issued for kitchen use'), 11);
                $iss++;
            }
            if (mt_rand(1, 6) === 1) {
                $item = $stock->lockItem($items[mt_rand(0, count($items) - 1)]->id);
                if (bccomp((string) $item->current_stock, '1', 3) >= 0) {
                    $stamp($stock->record($item, StoreMovement::WASTE, '-1.000', $owner, null, null, 'Spoiled / damaged'), 20);
                }
            }
        });
    }
    $say(count($items) . " store items, " . count($suppliers) . " store suppliers, {$po} store purchase orders ({$rec} received), {$iss} issues to stalls");
}
$say('DONE');
