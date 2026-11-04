<?php

namespace Database\Seeders\Demo;

use App\Services\TaxService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * 2,000 sample orders written the way OrderController / BillingController / FulfillmentService write them:
 *  - prices come from the menu, GST from TaxService::calculate() (the same rule the POS uses), subtotal + tax = total;
 *  - one kitchen ticket per stall, ticket items mirror order items, statuses follow the derived ladder
 *    (pending -> preparing -> ready -> served; ticket picked_up; order served);
 *  - a payment equals the bill total exactly, and a paid bill is "completed" (as BillingController does);
 *  - a cancelled bill is unpaid with everything cancelled;
 *  - 1,940 historical orders over the last 60 days (about 94% paid, 6% cancelled) and 60 live orders from the last ~3 hours in
 *    five states: just confirmed, preparing, partly ready (multi-stall), ready, and served but unpaid. Some live takeaway
 *    orders are already paid while the kitchen is still cooking (pay-at-counter), which the board supports.
 * Dine-in orders that are still live occupy distinct tables, which are then marked occupied. Everything is keyed on
 * idempotency_key "demo-order-NNNN"; an existing order is never touched.
 */
class OrderSeeder extends DemoSeederBase
{
    public const TOTAL = 2000;
    public const LIVE = 60;
    private const HOURS = [9, 10, 11, 12, 12, 12, 13, 13, 13, 14, 14, 15, 16, 17, 18, 19, 19, 19, 20, 20, 20, 21, 21, 22];

    protected function seed(): int
    {
        $now = now()->startOfMinute();
        $stalls = self::stallIds();
        $menu = DB::table('menu_items')->whereIn('stall_id', $stalls)->where('is_available', true)->orderBy('id')->get(['id', 'stall_id', 'name', 'price'])->groupBy('stall_id');
        $stallList = array_values(array_filter($stalls, fn ($id) => isset($menu[$id])));
        if (count($stallList) < 50) {
            throw new \RuntimeException('Stall and menu seeders must run before OrderSeeder');
        }
        // popularity: a fixed shuffle, then weight 1/sqrt(rank) so some stalls are busier than others
        usort($stallList, fn ($a, $b) => self::pick("pop:{$a}", 0, 100000) <=> self::pick("pop:{$b}", 0, 100000));
        $cum = [];
        $acc = 0.0;
        foreach ($stallList as $rank => $id) {
            $acc += 1 / sqrt($rank + 1);
            $cum[] = $acc;
        }

        $tables = DB::table('dining_tables')->where('status', 'available')->whereRaw("table_number like 'T-___'")->orderBy('id')->get(['id', 'capacity'])->values();
        $customers = DB::table('customers')->where('phone', 'like', '+915%')->orderBy('id')->get(['name', 'phone'])->values();
        $cashiers = DB::table('users')->where('role', 'cashier')->where('email', 'like', '%@demo.%')->orderBy('id')->pluck('id')->values();
        $waiters = DB::table('users')->where('role', 'waiter')->where('email', 'like', '%@demo.%')->orderBy('id')->pluck('id')->values();
        if ($tables->isEmpty() || $customers->isEmpty() || $cashiers->isEmpty() || $waiters->isEmpty()) {
            throw new \RuntimeException('Table, customer and staff seeders must run before OrderSeeder');
        }
        $existing = DB::table('orders')->where('idempotency_key', 'like', 'demo-order-%')->pluck('idempotency_key')->flip();

        $times = $this->timeline($now);
        $created = 0;
        $occupied = [];

        for ($i = 1; $i <= self::TOTAL; $i++) {
            $key = sprintf('demo-order-%04d', $i);
            $live = $i > self::TOTAL - self::LIVE;
            $j = $i - (self::TOTAL - self::LIVE); // 1..60 for live orders
            $ts = $times[$i - 1];
            if ($existing->has($key)) {
                continue;
            }

            // --- shape of the order
            $dineIn = self::pick("type:{$i}", 1, 100) <= 60;
            $channel = $dineIn ? (['waiter_app', 'waiter_app', 'waiter_app', 'qr_customer', 'cashier_pos'][self::pick("ch:{$i}", 0, 4)]) : 'cashier_pos';
            $group = $live ? ($j - 1) % 5 : null; // 0 confirmed, 1 preparing, 2 partly ready, 3 ready, 4 served (unpaid)
            $r = self::pick("stalls:{$i}", 1, 100);
            $stallCount = $r <= 70 ? 1 : ($r <= 92 ? 2 : 3);
            if ($group === 2) {
                $stallCount = max(2, $stallCount);
            }
            $chosen = [];
            for ($s = 0; count($chosen) < $stallCount && $s < 30; $s++) {
                $v = (self::pick("sp:{$i}:{$s}", 0, 9999) / 10000) * $acc;
                foreach ($cum as $idx => $c) {
                    if ($v <= $c) {
                        $chosen[$stallList[$idx]] = true;
                        break;
                    }
                }
            }
            $chosen = array_keys($chosen);

            $lines = []; // stall => [[menu row, qty, note]]
            $subtotal = '0.00';
            foreach ($chosen as $sIdx => $stallId) {
                $dishes = $menu[$stallId]->values();
                $count = min($dishes->count(), 1 + self::pick("n:{$i}:{$sIdx}", 0, 3));
                $used = [];
                for ($d = 0; count($used) < $count && $d < 20; $d++) {
                    $m = $dishes[self::pick("d:{$i}:{$sIdx}:{$d}", 0, $dishes->count() - 1)];
                    if (isset($used[$m->id])) {
                        continue;
                    }
                    $used[$m->id] = true;
                    $q = self::pick("q:{$i}:{$sIdx}:{$d}", 1, 10);
                    $qty = $q <= 6 ? 1 : ($q <= 9 ? 2 : 3);
                    $note = self::pick("note:{$i}:{$sIdx}:{$d}", 1, 100) <= 8 ? ['Less spicy', 'Extra spicy', 'No onion', 'Pack separately', 'Extra chutney'][self::pick("nt:{$i}:{$d}", 0, 4)] : null;
                    $lines[$stallId][] = [$m, $qty, $note];
                    $subtotal = bcadd($subtotal, bcmul((string) $m->price, (string) $qty, 2), 2);
                }
            }
            $priced = TaxService::calculate($subtotal);

            // --- who, where
            $tableId = null;
            $guests = null;
            if ($dineIn) {
                if ($live) {
                    $idx = ($j * 37) % $tables->count();
                    while (in_array($tables[$idx]->id, $occupied, true)) { // every live dine-in order gets its own table
                        $idx = ($idx + 1) % $tables->count();
                    }
                    $table = $tables[$idx];
                    $occupied[] = $table->id;
                } else {
                    $table = $tables[self::pick("tbl:{$i}", 0, $tables->count() - 1)];
                }
                $tableId = $table->id;
                $guests = self::pick("g:{$i}", 1, (int) $table->capacity);
            }
            $customer = self::pick("cust:{$i}", 1, 100) <= 45 ? $customers[self::pick("cu:{$i}", 0, $customers->count() - 1)] : null;
            $waiterId = $channel === 'waiter_app' ? $waiters[self::pick("w:{$i}", 0, $waiters->count() - 1)] : null;
            $counterCashier = $cashiers[self::pick("c:{$i}", 0, $cashiers->count() - 1)];
            $cashierId = $channel === 'cashier_pos' ? $counterCashier : null;

            // --- lifecycle
            $cancelled = !$live && self::pick("cx:{$i}", 1, 100) <= 6;
            $payUpfront = $live && $group <= 2 && !$dineIn && $j % 3 === 0; // paid at the counter, kitchen still cooking
            $paid = !$live ? !$cancelled : $payUpfront;
            $ticketState = $cancelled ? 'cancelled' : (!$live ? 'picked_up' : ['pending', 'preparing', 'preparing', 'ready', 'picked_up'][$group]);
            $orderStatus = $cancelled ? 'cancelled' : ($paid ? 'completed' : (!$live ? 'completed' : ['confirmed', 'partially_ready', 'partially_ready', 'ready', 'served'][$group]));
            $maxPrep = 8 + self::pick("prep:{$i}", 0, 12);

            $orderId = DB::table('orders')->insertGetId([
                'uuid' => self::uuid("order:{$key}"),
                'order_number' => sprintf('ORD-%s-D%04d', $ts->format('Ymd'), $i),
                'tracking_token' => 'trk_' . substr(hash('sha256', "demo-track-{$i}"), 0, 36),
                'idempotency_key' => $key,
                'table_id' => $tableId,
                'order_type' => $dineIn ? 'dine_in' : 'takeaway',
                'order_channel' => $channel,
                'customer_name' => $customer?->name,
                'customer_phone' => $customer?->phone,
                'waiter_id' => $waiterId,
                'cashier_id' => $paid ? ($cashierId ?? $counterCashier) : $cashierId,
                'status' => $orderStatus,
                'subtotal' => $priced['subtotal'],
                'tax_amount' => $priced['tax_amount'],
                'tax_rate_percent' => $priced['tax_rate_percent'],
                'tax_mode' => $priced['tax_mode'],
                'discount_amount' => 0,
                'total_amount' => $priced['total_amount'],
                'payment_status' => $paid ? 'paid' : 'unpaid',
                'notes' => self::pick("on:{$i}", 1, 100) <= 10 ? 'Please serve hot' : null,
                'guest_count' => $guests,
                'created_at' => $ts,
                'updated_at' => $ts,
            ]);

            $lastServed = $ts;
            $ticketNo = 0;
            foreach ($lines as $stallId => $stallLines) {
                $ticketNo++;
                // partly-ready orders: the first stall is ready, the rest are still preparing
                $state = ($group === 2 && $ticketNo > 1) ? 'preparing' : ($group === 2 ? 'ready' : $ticketState);
                $itemState = match ($state) { 'picked_up' => 'served', 'cancelled' => 'cancelled', default => $state };
                $accepted = $state === 'pending' || $state === 'cancelled' ? null : $this->at($ts, 1 + self::pick("acc:{$i}:{$ticketNo}", 0, 2), $now);
                $ready = in_array($state, ['ready', 'picked_up'], true) ? $this->at($ts, $maxPrep + $ticketNo, $now) : null;
                $pickedUp = $state === 'picked_up' ? $this->at($ready ?? $ts, 1 + self::pick("pk:{$i}:{$ticketNo}", 0, 5), $now) : null;
                $servedBy = $waiterId ?? $counterCashier;

                $ticketId = DB::table('stall_kitchen_tickets')->insertGetId([
                    'uuid' => self::uuid("ticket:{$key}:{$stallId}"),
                    'ticket_number' => sprintf('KKT-%s-D%04d%d', $ts->format('Ymd'), $i, $ticketNo),
                    'order_id' => $orderId,
                    'stall_id' => $stallId,
                    'status' => $state,
                    'accepted_at' => $accepted,
                    'ready_at' => $ready,
                    'picked_up_at' => $pickedUp,
                    'served_by_waiter_id' => $state === 'picked_up' ? $waiterId : null,
                    'created_at' => $ts,
                    'updated_at' => $pickedUp ?? $ready ?? $accepted ?? $ts,
                ]);
                foreach ($stallLines as [$m, $qty, $note]) {
                    $orderItemId = DB::table('order_items')->insertGetId([
                        'order_id' => $orderId,
                        'stall_id' => $stallId,
                        'menu_item_id' => $m->id,
                        'item_name' => $m->name,
                        'unit_price' => $m->price,
                        'quantity' => $qty,
                        'subtotal' => bcmul((string) $m->price, (string) $qty, 2),
                        'status' => $itemState,
                        'special_instructions' => $note,
                        'created_at' => $ts,
                        'updated_at' => $pickedUp ?? $ready ?? $ts,
                    ]);
                    DB::table('stall_ticket_items')->insert([
                        'ticket_id' => $ticketId,
                        'order_item_id' => $orderItemId,
                        'quantity' => $qty,
                        'status' => $itemState,
                        'ready_at' => $ready,
                        'served_at' => $pickedUp,
                        'served_by_user_id' => $pickedUp ? $servedBy : null,
                        'version' => ['pending' => 0, 'cancelled' => 0, 'preparing' => 1, 'ready' => 2, 'served' => 3][$itemState],
                        'created_at' => $ts,
                        'updated_at' => $pickedUp ?? $ready ?? $accepted ?? $ts,
                    ]);
                }
                if ($pickedUp && $pickedUp > $lastServed) {
                    $lastServed = $pickedUp;
                }
            }

            if ($paid) {
                $payAt = $live ? $ts->copy()->addMinutes(1) : $this->at($lastServed, self::pick("pay:{$i}", 0, 15), $now);
                $this->pay($i, $orderId, $payAt, $cashierId ?? $counterCashier, $priced['total_amount']);
                DB::table('orders')->where('id', $orderId)->update(['updated_at' => $payAt]);
            }
            $created++;
        }

        if ($occupied) {
            DB::table('dining_tables')->whereIn('id', $occupied)->update(['status' => 'occupied']);
        }

        return $created;
    }

    /** Oldest-first timestamps: 1,940 across the last 60 days in lunch/dinner peaks, then 60 live ones in the last ~3 hours. */
    private function timeline(Carbon $now): array
    {
        $historic = self::TOTAL - self::LIVE;
        $ts = [];
        for ($h = 1; $h <= $historic; $h++) {
            $daysAgo = 60 - intdiv(($h - 1) * 60, $historic);
            $hour = self::HOURS[self::pick("hr:{$h}", 0, count(self::HOURS) - 1)];
            $ts[] = $now->copy()->subDays($daysAgo)->setTime($hour, self::pick("mn:{$h}", 0, 59), 0);
        }
        usort($ts, fn ($a, $b) => $a <=> $b);
        for ($j = 1; $j <= self::LIVE; $j++) {
            $ts[] = $now->copy()->subMinutes(170 - (int) round(($j - 1) * 2.7));
        }

        return $ts;
    }

    private function at(Carbon $from, int $minutes, Carbon $cap): Carbon
    {
        $t = $from->copy()->addMinutes($minutes);

        return $t > $cap ? $cap->copy() : $t;
    }

    /** One payment that settles the whole bill for exactly the total (cash also records tendered and change). */
    private function pay(int $i, int $orderId, Carbon $at, int $cashierId, string $total): void
    {
        $r = self::pick("pm:{$i}", 1, 100);
        $method = $r <= 35 ? 'cash' : ($r <= 80 ? 'upi_qr' : 'card');
        $tendered = $total;
        $change = '0.00';
        $reference = null;
        if ($method === 'cash') {
            $step = [10, 50, 100, 500][self::pick("tn:{$i}", 0, 3)];
            $tendered = (string) (ceil((float) $total / $step) * $step);
            $tendered = bcadd($tendered, '0', 2);
            $change = bcsub($tendered, $total, 2);
        } elseif ($method === 'upi_qr') {
            $reference = sprintf('%012d', 400000000000 + $i * 7919);
        } else {
            $reference = sprintf('CARD-DEMO-%06d', $i);
        }
        DB::table('payments')->insert([
            'uuid' => self::uuid("payment:demo-order-{$i}"),
            'payment_number' => sprintf('PAY-%s-D%05d', $at->format('Ymd'), $i),
            'order_id' => $orderId,
            'cashier_id' => $cashierId,
            'payment_method' => $method,
            'amount' => $total,
            'cash_tendered' => $tendered,
            'change_returned' => $change,
            'transaction_reference' => $reference,
            'status' => 'success',
            'created_at' => $at,
            'updated_at' => $at,
        ]);
    }
}
