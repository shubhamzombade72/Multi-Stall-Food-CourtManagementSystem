<?php

namespace Database\Seeders\Demo;

use App\Models\MenuItem;
use Database\Seeders\Demo\Data\DemoCatalog;
use Database\Seeders\Demo\Data\DishPools;
use Illuminate\Support\Facades\DB;

/**
 * 30 dishes per stall (1,500). The schema has no SKU, food-type or tax column: the SKU (DM001-D01) is written into the
 * description, veg / non-veg / egg is is_veg plus an "Egg dish" tag in the description, and GST is never set per item
 * (the app applies the Food Court Settings rate to every item). Idempotent: each dish has a uuid derived from its SKU.
 */
class MenuItemSeeder extends DemoSeederBase
{
    public const PER_STALL = 30;

    /** @return array<int, array{name:string,price:int,type:string,prep:int,secondary:bool}> the 30 dishes of stall $no (pure). */
    public static function menuFor(int $no): array
    {
        [, , $pools, $focus, , $hasSecond] = DemoCatalog::stalls()[$no - 1];
        $all = DishPools::all();

        $dishes = [];
        $seen = [];
        $add = function (array $poolNames) use (&$dishes, &$seen, $all) {
            foreach ($poolNames as $p) {
                foreach ($all[$p] as $line) {
                    $f = explode('|', $line);
                    if (isset($seen[$f[0]])) {
                        continue;
                    }
                    $seen[$f[0]] = true;
                    $dishes[] = ['name' => $f[0], 'price' => (int) $f[1], 'type' => $f[2], 'prep' => (int) $f[3], 'secondary' => ($f[4] ?? '') === 'S'];
                }
            }
        };
        $add($pools);
        if (count($dishes) < self::PER_STALL) {
            $add(['sides']);
        }
        if (count($dishes) < self::PER_STALL) {
            throw new \RuntimeException("Stall {$no} has only " . count($dishes) . ' dishes in its pools');
        }

        // Focus dishes first, the rest rotated per stall so stalls sharing a pool do not get identical menus
        $match = $focus ? array_values(array_filter($dishes, fn ($d) => preg_match($focus, $d['name']))) : [];
        $rest = array_values(array_filter($dishes, fn ($d) => !$focus || !preg_match($focus, $d['name'])));
        if ($rest) {
            $shift = ($no * 7) % count($rest);
            $rest = array_merge(array_slice($rest, $shift), array_slice($rest, 0, $shift));
        }
        $menu = array_slice(array_merge($match, $rest), 0, self::PER_STALL);

        if (!$hasSecond) {
            foreach ($menu as &$d) {
                $d['secondary'] = false;
            }
            unset($d);
        } elseif (count(array_filter($menu, fn ($d) => $d['secondary'])) < 3) {
            for ($k = 1; $k <= 4; $k++) {
                $menu[count($menu) - $k]['secondary'] = true;
            }
        }

        return $menu;
    }

    protected function seed(): int
    {
        $stallIds = self::stallIds();
        $created = 0;
        foreach (DemoCatalog::stalls() as $i => [$cuisine, $stallName]) {
            $no = $i + 1;
            $stallId = $stallIds[self::stallCode($no)] ?? throw new \RuntimeException('StallSeeder must run first');
            $cats = DB::table('menu_categories')->where('stall_id', $stallId)->pluck('id', 'name');
            $primary = $cats[DemoCatalog::primaryCategory($cuisine)] ?? throw new \RuntimeException('MenuCategorySeeder must run first');
            $secondary = $cats[DemoCatalog::SECONDARY_CATEGORY] ?? $primary;

            $menu = self::menuFor($no);
            $uuids = [];
            foreach ($menu as $k => $d) {
                $uuids[$k] = self::uuid(sprintf('item:DM%03d-D%02d', $no, $k + 1));
            }
            $existing = DB::table('menu_items')->whereIn('uuid', $uuids)->pluck('uuid')->flip();

            $now = now();
            $rows = [];
            foreach ($menu as $k => $d) {
                if ($existing->has($uuids[$k])) {
                    continue;
                }
                $sku = sprintf('DM%03d-D%02d', $no, $k + 1);
                $kind = match ($d['type']) {
                    'V' => 'Vegetarian',
                    'E' => 'Egg dish',
                    default => 'Non-vegetarian',
                };
                $rows[] = [
                    'uuid' => $uuids[$k],
                    'stall_id' => $stallId,
                    'category_id' => $d['secondary'] ? $secondary : $primary,
                    'name' => $d['name'],
                    'description' => sprintf('%s: freshly made %s favourite from %s. %s. SKU %s.', $d['name'], $cuisine, $stallName, $kind, $sku),
                    'price' => number_format($d['price'], 2, '.', ''),
                    'is_veg' => $d['type'] === 'V',
                    'is_available' => (($no * 31 + $k) % 20) !== 0, // ~5% shown as sold out
                    'preparation_time_minutes' => $d['prep'],
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
            foreach (array_chunk($rows, 100) as $chunk) {
                MenuItem::insert($chunk);
            }
            $created += count($rows);
        }

        return $created;
    }
}
