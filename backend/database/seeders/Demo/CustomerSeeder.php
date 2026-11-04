<?php

namespace Database\Seeders\Demo;

use Database\Seeders\Demo\Data\DemoCatalog;
use Illuminate\Support\Facades\DB;

/**
 * 1,000 fictional customers across 14 Indian cities. The customers table has name, phone, email and notes only, so the
 * address goes into notes. Phones use the unallocated "+915..." range and emails the reserved example.test domain.
 * phone is unique, so INSERT-or-ignore makes the seeder idempotent without touching existing customers.
 */
class CustomerSeeder extends DemoSeederBase
{
    public const COUNT = 1000;

    protected function seed(): int
    {
        $first = DemoCatalog::firstNames();
        $last = DemoCatalog::lastNames();
        $cities = DemoCatalog::cities();
        $localities = DemoCatalog::localities();
        $cashier = DB::table('users')->where('role', 'cashier')->where('email', 'like', '%@demo.%')->orderBy('id')->value('id');

        $before = DB::table('customers')->count();
        $now = now();
        $rows = [];
        for ($i = 1; $i <= self::COUNT; $i++) {
            $f = $first[($i * 7) % count($first)];
            $l = $last[($i * 13 + intdiv($i, 60)) % count($last)];
            [$city, $state] = $cities[$i % count($cities)];
            $rows[] = [
                'name' => "{$f} {$l}",
                'phone' => self::fictionalPhone($i),
                'email' => $i % 10 < 7 ? strtolower("{$f}.{$l}.{$i}") . '@' . DemoCatalog::EMAIL_DOMAIN : null,
                'notes' => sprintf('Demo customer. %d, %s, %s, %s.', 1 + ($i * 7) % 120, $localities[$i % count($localities)], $city, $state),
                'created_by_user_id' => $cashier,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }
        foreach (array_chunk($rows, 250) as $chunk) {
            DB::table('customers')->insertOrIgnore($chunk);
        }

        return DB::table('customers')->count() - $before;
    }
}
