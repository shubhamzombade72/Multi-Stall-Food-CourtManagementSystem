<?php

namespace Database\Seeders\Demo;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * 200 purchase orders (4 per stall): 70% received, 15% ordered, 10% draft, 5% cancelled, dated over the last ~70 days.
 * The stock ledger stays consistent: only "received" orders add stock, each through a purchase_inward movement exactly as
 * PurchaseController::receive does (previous_stock + quantity = new_stock, reference = the purchase number), and a handful of
 * kitchen-issue / waste movements are replayed in the same chronological pass, so every item's current_stock equals its
 * last ledger row and never goes negative. Stock quantities are never edited directly.
 */
class PurchaseOrderSeeder extends DemoSeederBase
{
    public const COUNT = 200;

    protected function seed(): int
    {
        $existing = DB::table('purchase_orders')->where('purchase_number', 'like', 'PO-________-D____')->count();
        if ($existing >= self::COUNT) {
            return 0;
        }
        if ($existing > 0) {
            throw new \RuntimeException("Found {$existing} demo purchase orders (expected 0 or " . self::COUNT . '); refusing to build a partial ledger.');
        }

        $stalls = self::stallIds();
        $now = now();
        $items = DB::table('inventory_items')->whereIn('stall_id', $stalls)->orderBy('id')->get()->groupBy('stall_id');
        $suppliers = DB::table('suppliers')->whereIn('stall_id', $stalls)->orderBy('id')->get()->groupBy('stall_id');
        $managers = DB::table('users')->where('role', 'stall_manager')->whereIn('stall_id', $stalls)->pluck('id', 'stall_id');
        if ($items->isEmpty() || $managers->isEmpty()) {
            throw new \RuntimeException('Stall, staff, supplier and inventory seeders must run before PurchaseOrderSeeder');
        }
        $stock = DB::table('inventory_items')->whereIn('stall_id', $stalls)->pluck('current_stock', 'id')->map(fn ($v) => (float) $v)->all();
        $stallOrder = array_values($stalls);

        $events = []; // ts, seq, item, stall, type, qty, ref, user, reason
        $seq = 0;
        $poCount = 0;

        for ($n = 1; $n <= self::COUNT; $n++) {
            $stallId = $stallOrder[($n - 1) % 50];
            $stallItems = $items[$stallId]->values();
            $stallSuppliers = $suppliers[$stallId]->values();
            $supplier = $stallSuppliers[intdiv($n - 1, 50) % $stallSuppliers->count()];
            $manager = $managers[$stallId];

            $daysAgo = max(3, 70 - intdiv(($n - 1) * 66, self::COUNT) - self::pick("po-jit:{$n}", 0, 2));
            $orderDate = $now->copy()->subDays($daysAgo)->startOfDay();
            $r = $n % 20;
            $status = $r < 14 ? 'received' : ($r < 17 ? 'ordered' : ($r < 19 ? 'draft' : 'cancelled'));
            $number = sprintf('PO-%s-D%04d', $orderDate->format('Ymd'), $n);

            $lineCount = 3 + self::pick("po-lines:{$n}", 0, 2);
            $start = self::pick("po-start:{$n}", 0, $stallItems->count() - 1);
            $lines = [];
            $total = '0.00';
            for ($k = 0; $k < $lineCount; $k++) {
                $item = $stallItems[($start + $k * 3) % $stallItems->count()];
                $integral = in_array($item->unit, ['piece', 'packet', 'box'], true);
                $qty = (float) $item->minimum_alert_stock * (1.5 + self::pick("po-q:{$n}:{$k}", 0, 25) / 10);
                $qty = $integral ? max(1, (float) round($qty)) : max(0.5, round($qty * 2) / 2);
                $price = number_format((float) $item->unit_cost * (0.97 + self::pick("po-p:{$n}:{$k}", 0, 8) / 100), 2, '.', '');
                $line = bcmul((string) $qty, $price, 2);
                $total = bcadd($total, $line, 2);
                $lines[] = ['item' => $item, 'qty' => $qty, 'price' => $price, 'total' => $line];
            }

            $created = $orderDate->copy()->setTime(9 + self::pick("po-h:{$n}", 0, 6), self::pick("po-m:{$n}", 0, 59));
            $poId = DB::table('purchase_orders')->insertGetId([
                'uuid' => self::uuid("po:{$number}"),
                'purchase_number' => $number,
                'stall_id' => $stallId,
                'supplier_id' => $supplier->id,
                'created_by_user_id' => $manager,
                'order_date' => $orderDate->toDateString(),
                'total_amount' => $total,
                'status' => $status,
                'notes' => 'Demo purchase order',
                'created_at' => $created,
                'updated_at' => $status === 'received' ? $created->copy()->addDay() : $created,
            ]);
            foreach ($lines as $l) {
                DB::table('purchase_order_items')->insert([
                    'purchase_order_id' => $poId,
                    'inventory_item_id' => $l['item']->id,
                    'quantity' => $l['qty'],
                    'unit_price' => $l['price'],
                    'total_price' => $l['total'],
                    'created_at' => $created,
                    'updated_at' => $created,
                ]);
                if ($status === 'received') {
                    $events[] = [$created->copy()->addDay()->setTime(11, 0), $seq++, $l['item']->id, $stallId, 'purchase_inward', $l['qty'], $number, $manager, "PO Inward Receipt #{$number}"];
                }
            }
            $poCount++;
        }

        // Kitchen issues and waste, spread over the same period (5 per item)
        foreach ($items as $stallId => $stallItems) {
            foreach ($stallItems as $item) {
                for ($k = 1; $k <= 5; $k++) {
                    $ts = $now->copy()->subDays(max(1, 70 - $k * 13 - self::pick("c-d:{$item->id}:{$k}", 0, 6)))->setTime(15, self::pick("c-m:{$item->id}:{$k}", 0, 59));
                    $waste = self::pick("c-w:{$item->id}:{$k}", 1, 8) === 1;
                    $events[] = [$ts, $seq++, $item->id, $stallId, $waste ? 'waste_loss' : 'consumption', null, "DEMO-CONS-{$item->id}-{$k}", $managers[$stallId], $waste ? 'Spoilage / wastage (demo data)' : 'Issued to kitchen (demo data)'];
                }
                // About 1 item in 10 ends below its alert level so the low-stock screens have data
                if (self::pick("c-low:{$item->id}", 1, 10) === 1) {
                    $events[] = [$now->copy()->subHours(5), $seq++, $item->id, $stallId, 'consumption', 'LOW', "DEMO-CONS-{$item->id}-L", $managers[$stallId], 'Issued to kitchen (demo data)'];
                }
            }
        }

        usort($events, fn ($a, $b) => [$a[0]->getTimestamp(), $a[1]] <=> [$b[0]->getTimestamp(), $b[1]]);

        $minAlert = DB::table('inventory_items')->whereIn('stall_id', $stalls)->pluck('minimum_alert_stock', 'id')->map(fn ($v) => (float) $v)->all();
        $rows = [];
        foreach ($events as [$ts, , $itemId, $stallId, $type, $qty, $ref, $userId, $reason]) {
            $prev = $stock[$itemId];
            if ($type !== 'purchase_inward') {
                $want = $qty === 'LOW'
                    ? $prev - $minAlert[$itemId] * 0.6
                    : $prev * (0.04 + self::pick("c-f:{$ref}", 0, 8) / 100);
                $qty = round(min($want, $prev * 0.9), 3);
                if ($qty <= 0) {
                    continue;
                }
                $new = round($prev - $qty, 3);
            } else {
                $new = round($prev + $qty, 3);
            }
            $stock[$itemId] = $new;
            $rows[] = [
                'stall_id' => $stallId,
                'inventory_item_id' => $itemId,
                'movement_type' => $type,
                'quantity' => $qty,
                'previous_stock' => $prev,
                'new_stock' => $new,
                'reference_id' => $ref,
                'performed_by_user_id' => $userId,
                'reason' => $reason,
                'created_at' => $ts,
                'updated_at' => $ts,
            ];
        }
        foreach (array_chunk($rows, 500) as $chunk) {
            DB::table('stock_movements')->insert($chunk);
        }
        foreach ($stock as $itemId => $value) {
            DB::table('inventory_items')->where('id', $itemId)->update(['current_stock' => $value, 'updated_at' => $now]);
        }

        return $poCount;
    }
}
