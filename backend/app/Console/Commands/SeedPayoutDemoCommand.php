<?php

namespace App\Console\Commands;

use App\Http\Controllers\Api\SettlementController;
use App\Models\DailyClosing;
use App\Models\Setting;
use App\Models\Stall;
use App\Models\StallOwner;
use App\Models\StallSettlementRecord;
use App\Models\SettlementPayout;
use App\Models\User;
use App\Services\PayoutService;
use Illuminate\Console\Command;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Builds the dummy-data database shipped in the DEMO installer: a small food court with stall owners, four business days
 * of paid sales, day closings run through the real closing code, and payouts recorded through the real payout service
 * (full, partial, multi-transaction, UPI/bank references, a failed attempt, a reversal, a consolidated owner payout).
 *
 * Refuses to touch a database that already has users. Demo accounts share a known password: never for real use.
 */
class SeedPayoutDemoCommand extends Command
{
    protected $signature = 'foodcourt:seed-payout-demo';

    protected $description = 'Fill an EMPTY database with demo stalls, owners, sales, day closings and stall payouts (demo installer only).';

    /** stall => [owner, dishes [name => price], daily sales for D0 (today), D1, D2, D3 (D3 stays unclosed)] */
    private const STALLS = [
        'Pizza Corner' => ['Rajesh Patil', ['Margherita Slice' => 150, 'Farmhouse Slice' => 200, 'Garlic Bread' => 100, 'Cold Drink' => 50], [5000, 4500, 4800, 3000]],
        'Misal House' => ['Sunita Joshi', ['Kolhapuri Misal' => 100, 'Sabudana Khichdi' => 150, 'Pav Extra' => 50, 'Taak' => 50], [8000, 7200, 6500, 4000]],
        'Biryani Point' => ['Sunita Joshi', ['Chicken Biryani' => 250, 'Veg Biryani' => 200, 'Raita' => 50, 'Gulab Jamun' => 50], [6000, 5400, 5100, 3500]],
        'Thali House' => ['Meena Shah', ['Gujarati Thali' => 200, 'Mini Thali' => 150, 'Chaas' => 50, 'Papad' => 50], [4000, 3500, 3800, 2000]],
        'Dosa Dhaba' => ['Anand Kulkarni', ['Masala Dosa' => 100, 'Idli Plate' => 150, 'Filter Coffee' => 50, 'Vada' => 50], [2400, 2000, 2200, 1000]],
        'Chaat Chowk' => ['Anand Kulkarni', ['Pani Puri' => 50, 'Sev Puri' => 100, 'Bhel' => 100, 'Lassi' => 50], [1800, 1600, 1700, 1000]],
        'Kebab Kingdom' => ['Anand Kulkarni', ['Seekh Kebab' => 250, 'Tikka Roll' => 150, 'Mint Chutney' => 50, 'Soda' => 50], [3200, 2800, 3000, 1000]],
        'Juice Junction' => ['Anand Kulkarni', ['Mosambi Juice' => 100, 'Sugarcane Juice' => 50, 'Water Bottle' => 50, 'Fruit Bowl' => 100], [1500, 1200, 1400, 1000]],
        'Sweet Tooth' => ['Anand Kulkarni', ['Jalebi' => 100, 'Rasmalai' => 150, 'Ice Cream' => 100, 'Kulfi' => 50], [2100, 1900, 2000, 1000]],
    ];

    public function handle(): int
    {
        if (User::query()->exists()) {
            $this->error('This database already has users. The payout demo data only goes into an empty database.');

            return self::FAILURE;
        }

        mt_srand(20261104); // the same demo data on every build

        $owner = $this->users();
        $cashier = User::where('role', 'cashier')->firstOrFail();
        $stalls = $this->stallsAndMenus();

        $today = Carbon::today();
        $days = [3 => $today->copy()->subDays(3), 2 => $today->copy()->subDays(2), 1 => $today->copy()->subDay(), 0 => $today->copy()];

        // Sales: D3 .. D0 (index = days ago)
        foreach ([3, 2, 1, 0] as $ago) {
            $this->salesForDay($days[$ago]->toDateString(), $stalls, $cashier, 3 - $ago);
        }

        // Day closings run through the real closing code (D3 stays open on purpose, so closing can be tried live)
        $settle = app(SettlementController::class);
        foreach ([2, 1, 0] as $ago) {
            $req = Request::create('/api/settlements/close-day', 'POST', ['date' => $days[$ago]->toDateString(), 'notes' => 'Demo data closing']);
            $req->setUserResolver(fn () => $owner);
            $res = $settle->closeDay($req);
            $this->line("Closed {$days[$ago]->toDateString()}: HTTP {$res->getStatusCode()}");
        }

        $this->payouts($owner, $days);
        $this->line('Reconciliation: ' . json_encode(app(PayoutService::class)->reconcile()['ok']));

        return self::SUCCESS;
    }

    private function users(): User
    {
        $owner = User::create(['name' => 'Food Court Owner', 'email' => 'owner@foodcourt.com', 'password' => 'password123', 'role' => 'owner', 'phone' => '+91 98765 00001', 'is_active' => true]);
        User::create(['name' => 'Central Cashier', 'email' => 'cashier@foodcourt.com', 'password' => 'password123', 'role' => 'cashier', 'phone' => '+91 98765 00002', 'is_active' => true]);
        Setting::updateOrCreate(['key' => 'business_profile'], ['value' => ['name' => 'Mangalmurti Food Court (DEMO DATA)', 'legal_name' => null, 'address' => 'Demo address, Pune', 'phone' => null, 'email' => null, 'gstin' => null, 'opening_time' => '10:00', 'closing_time' => '22:00']]);
        // The demo database comes with its owner, so the first-run Welcome screen is already done
        Setting::updateOrCreate(['key' => 'system_setup'], ['value' => ['completed_at' => now()->toIso8601String(), 'recovery_key_hash' => null]]);

        return $owner;
    }

    /** @return array<string, array{stall: Stall, items: array<int, array{id:int,name:string,price:int}>, sales: int[]}> */
    private function stallsAndMenus(): array
    {
        $owners = [];
        $out = [];
        foreach (self::STALLS as $name => [$ownerName, $dishes, $sales]) {
            $owners[$ownerName] ??= StallOwner::create(['name' => $ownerName, 'phone' => '98' . random_int(10000000, 99999999), 'upi_id' => Str::slug($ownerName, '') . '@upi']);
            $stall = Stall::create([
                'name' => $name,
                'code' => 'DEMO-' . strtoupper(Str::substr(Str::slug($name, ''), 0, 6)),
                'description' => 'Demo stall',
                'contact_phone' => '98' . random_int(10000000, 99999999),
                'stall_owner_id' => $owners[$ownerName]->id,
                'is_active' => true,
            ]);
            $cat = DB::table('menu_categories')->insertGetId(['stall_id' => $stall->id, 'name' => 'Menu', 'display_order' => 1, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
            $items = [];
            foreach ($dishes as $dish => $price) {
                $id = DB::table('menu_items')->insertGetId([
                    'uuid' => (string) Str::uuid(), 'stall_id' => $stall->id, 'category_id' => $cat, 'name' => $dish, 'price' => $price,
                    'is_veg' => true, 'is_available' => true, 'preparation_time_minutes' => 10, 'created_at' => now(), 'updated_at' => now(),
                ]);
                $items[] = ['id' => $id, 'name' => $dish, 'price' => $price];
            }
            $out[$name] = ['stall' => $stall, 'items' => $items, 'sales' => $sales];
        }

        return $out;
    }

    /** Paid takeaway bills whose stall lines add up to exactly each stall's daily target. */
    private function salesForDay(string $date, array $stalls, User $cashier, int $dayIndex): void
    {
        $lines = [];
        foreach ($stalls as $s) {
            $target = $s['sales'][3 - $dayIndex]; // dayIndex 0 = D3 ... 3 = D0
            $left = $target;
            while ($left > 0) {
                $item = $s['items'][array_rand($s['items'])];
                $qty = random_int(1, 3);
                while ($qty > 1 && $item['price'] * $qty > $left) {
                    $qty--;
                }
                if ($item['price'] > $left) {
                    $item = collect($s['items'])->firstWhere('price', 50); // every stall has a ₹50 dish, all dish prices and targets are multiples of 50
                    $qty = 1;
                }
                $lines[] = ['stall_id' => $s['stall']->id, 'item' => $item, 'qty' => $qty];
                $left -= $item['price'] * $qty;
            }
        }
        shuffle($lines);

        foreach (array_chunk($lines, 3) as $n => $chunk) {
            $subtotal = array_sum(array_map(fn ($l) => $l['item']['price'] * $l['qty'], $chunk));
            $tax = round($subtotal * 0.05, 2);
            $total = $subtotal + $tax;
            $at = $date . ' ' . sprintf('%02d:%02d:00', random_int(10, 21), random_int(0, 59));
            $orderId = DB::table('orders')->insertGetId([
                'uuid' => (string) Str::uuid(), 'order_number' => 'D' . str_replace('-', '', $date) . '-' . str_pad((string) ($n + 1), 4, '0', STR_PAD_LEFT),
                'order_type' => 'takeaway', 'order_channel' => 'cashier_pos', 'cashier_id' => $cashier->id, 'status' => 'completed',
                'subtotal' => $subtotal, 'tax_amount' => $tax, 'tax_rate_percent' => '5.00', 'tax_mode' => 'exclusive', 'discount_amount' => 0, 'total_amount' => $total,
                'payment_status' => 'paid', 'created_at' => $at, 'updated_at' => $at,
            ]);
            foreach ($chunk as $l) {
                DB::table('order_items')->insert([
                    'order_id' => $orderId, 'stall_id' => $l['stall_id'], 'menu_item_id' => $l['item']['id'], 'item_name' => $l['item']['name'],
                    'unit_price' => $l['item']['price'], 'quantity' => $l['qty'], 'subtotal' => $l['item']['price'] * $l['qty'], 'status' => 'served',
                    'created_at' => $at, 'updated_at' => $at,
                ]);
            }
            $cash = $n % 5 < 2;
            DB::table('payments')->insert([
                'uuid' => (string) Str::uuid(), 'payment_number' => 'P' . str_replace('-', '', $date) . '-' . str_pad((string) ($n + 1), 4, '0', STR_PAD_LEFT),
                'order_id' => $orderId, 'cashier_id' => $cashier->id, 'payment_method' => $cash ? 'cash' : 'upi_qr', 'amount' => $total,
                'cash_tendered' => $cash ? ceil($total / 10) * 10 : null, 'change_returned' => $cash ? ceil($total / 10) * 10 - $total : null,
                'transaction_reference' => $cash ? null : 'DEMO-UPI-' . strtoupper(Str::random(8)), 'status' => 'success', 'created_at' => $at, 'updated_at' => $at,
            ]);
        }
    }

    private function settlement(string $date, string $stallName): StallSettlementRecord
    {
        return StallSettlementRecord::whereHas('closing', fn ($q) => $q->where('closing_date', $date))
            ->whereHas('stall', fn ($q) => $q->where('name', $stallName))->firstOrFail();
    }

    private function at(Carbon $day, int $h, int $m): Carbon
    {
        $t = $day->copy()->setTime($h, $m);

        return $t->isFuture() ? now()->subMinute() : $t;
    }

    private function payouts(User $owner, array $days): void
    {
        $svc = app(PayoutService::class);
        $pay = function (Carbon $day, string $stall, string $amount, string $method, ?string $ref, int $h, int $m, array $extra = []) use ($svc, $owner) {
            $s = $this->settlement($day->toDateString(), $stall);

            return $svc->record($owner, $s->id, [
                'amount' => $amount, 'payment_method' => $method, 'transaction_reference' => $ref,
                'received_by' => $s->stall->owner->name, 'paid_at' => $this->at($day, $h, $m),
                'idempotency_key' => 'demo-' . $day->toDateString() . '-' . Str::slug($stall) . '-' . Str::random(6),
            ] + $extra)[0];
        };
        $anand = StallOwner::where('name', 'Anand Kulkarni')->firstOrFail();

        // ---- two days ago: everything settled, with a reversal and a consolidated owner payout
        [$d2, $d1, $d0] = [$days[2], $days[1], $days[0]];
        $pay($d2, 'Pizza Corner', '4800.00', 'cash', null, 22, 30);
        $pay($d2, 'Misal House', '2500.00', 'cash', null, 22, 35);
        $pay($d2, 'Misal House', '2000.00', 'upi', 'UPI4455667788', 22, 40);
        $pay($d2, 'Misal House', '2000.00', 'bank_transfer', 'NEFT-SBIN-2026110201', 22, 45);
        $wrong = $pay($d2, 'Biryani Point', '5100.00', 'upi', 'UPI-WRONG-ACCT-01', 22, 50);
        $svc->reverse($owner, $wrong->id, 'Paid to the wrong UPI ID; payment was returned by the bank.');
        $pay($d2, 'Biryani Point', '5100.00', 'bank_transfer', 'IMPS-HDFC-9988776655', 23, 5);
        $pay($d2, 'Thali House', '3800.00', 'cash', null, 22, 55);
        $svc->recordConsolidated($owner, $anand->id, [
            'total_amount' => '10300.00', 'auto' => true, 'payment_method' => 'bank_transfer', 'transaction_reference' => 'NEFT-ANAND-2026110201',
            'received_by' => 'Anand Kulkarni', 'paid_at' => $this->at($d2, 23, 20), 'idempotency_key' => 'demo-consolidated-' . $d2->toDateString(),
            'notes' => 'One transfer for all five of the owner\'s stalls',
        ]);

        // ---- yesterday: a mix of paid, partial, pending and a failed attempt
        $pay($d1, 'Pizza Corner', '4500.00', 'upi', 'UPI1234509876', 22, 30);
        $pay($d1, 'Misal House', '4000.00', 'cash', null, 22, 35);
        $pay($d1, 'Thali House', '1000.00', 'upi', 'UPI-FAILED-0001', 22, 40, ['outcome' => 'failed', 'failure_reason' => 'UPI app timed out, no money moved']);
        $svc->recordConsolidated($owner, $anand->id, [
            'total_amount' => '5000.00', 'auto' => true, 'payment_method' => 'upi', 'transaction_reference' => 'UPI-ANAND-PART-01',
            'received_by' => 'Anand Kulkarni', 'paid_at' => $this->at($d1, 23, 0), 'idempotency_key' => 'demo-consolidated-' . $d1->toDateString(),
            'notes' => 'Part payment to the owner, allocated oldest first',
        ]);

        // ---- today (04-11-2026 when built): the exact scenario from the requirement
        $pay($d0, 'Pizza Corner', '5000.00', 'cash', null, 21, 30);
        $pay($d0, 'Misal House', '3000.00', 'cash', null, 21, 35);

        $this->line('Payout rows: ' . SettlementPayout::count() . ', closings: ' . DailyClosing::count());
    }
}
