<?php

namespace Database\Seeders\Demo;

use Database\Seeders\Demo\Data\DemoCatalog;
use Illuminate\Support\Facades\DB;

/**
 * 12 inventory items per stall (600) drawn from the stall's ingredient group (vegetables and staples for a thali stall, buns and
 * cheese for a burger stall, ...). There is no recipe / dish-to-ingredient link in the schema, so linkage is by group only.
 * Stock is never written directly: every item starts at 0 and receives an opening-stock "manual_adjustment" ledger row, and
 * current_stock is the result of that movement (previous_stock + quantity = new_stock). PurchaseOrderSeeder extends the ledger.
 */
class InventorySeeder extends DemoSeederBase
{
    public const PER_STALL = 12;
    /** Opening stock is dated this many days ago, before the first purchase order. */
    public const HISTORY_DAYS = 75;

    protected function seed(): int
    {
        $stalls = self::stallIds();
        $groups = DemoCatalog::ingredients();
        $staples = $groups['staples'];
        $now = now();
        $openingAt = $now->copy()->subDays(self::HISTORY_DAYS)->setTime(9, 0);
        $created = 0;

        foreach (DemoCatalog::stalls() as $i => [, , , , $group]) {
            $no = $i + 1;
            $stallId = $stalls[self::stallCode($no)] ?? throw new \RuntimeException('StallSeeder must run first');
            $managerId = DB::table('users')->where('stall_id', $stallId)->where('role', 'stall_manager')->value('id')
                ?? throw new \RuntimeException('StaffSeeder must run before InventorySeeder');

            $pool = array_merge(
                array_map(fn ($k) => $staples[($no + $k) % count($staples)], [0, 1, 2]),
                $this->rotate($groups[$group], $no)
            );
            $chosen = [];
            foreach ($pool as $line) {
                $f = explode('|', $line);
                if (!isset($chosen[$f[0]])) {
                    $chosen[$f[0]] = $f;
                }
                if (count($chosen) === self::PER_STALL) {
                    break;
                }
            }

            $existing = DB::table('inventory_items')->where('stall_id', $stallId)->pluck('name')->flip();
            foreach ($chosen as $name => [, $unit, $cost, $min, $typical]) {
                if ($existing->has($name)) {
                    continue;
                }
                $opening = round((float) $typical * (0.6 + self::pick("open:{$no}:{$name}", 0, 80) / 100), 3);
                $itemId = DB::table('inventory_items')->insertGetId([
                    'stall_id' => $stallId,
                    'name' => $name,
                    'unit' => $unit,
                    'current_stock' => 0,
                    'minimum_alert_stock' => $min,
                    'unit_cost' => $cost,
                    'created_at' => $openingAt,
                    'updated_at' => $openingAt,
                ]);
                // The ledger row and the stock it produces are written together
                DB::table('stock_movements')->insert([
                    'stall_id' => $stallId,
                    'inventory_item_id' => $itemId,
                    'movement_type' => 'manual_adjustment',
                    'quantity' => $opening,
                    'previous_stock' => 0,
                    'new_stock' => $opening,
                    'reference_id' => 'DEMO-OPENING',
                    'performed_by_user_id' => $managerId,
                    'reason' => 'Opening stock (demo data)',
                    'created_at' => $openingAt,
                    'updated_at' => $openingAt,
                ]);
                DB::table('inventory_items')->where('id', $itemId)->update(['current_stock' => $opening]);
                $created++;
            }
        }

        return $created;
    }

    /** @param string[] $lines @return string[] */
    private function rotate(array $lines, int $no): array
    {
        $shift = ($no * 5) % count($lines);

        return array_merge(array_slice($lines, $shift), array_slice($lines, 0, $shift));
    }
}
