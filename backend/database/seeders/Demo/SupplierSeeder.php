<?php

namespace Database\Seeders\Demo;

use App\Models\Supplier;
use Database\Seeders\Demo\Data\DemoCatalog;

/**
 * 100 suppliers. A supplier belongs to exactly one stall in this schema (suppliers.stall_id is required), so every stall gets 2.
 * Names combine a prefix, a trade and a city, so no two are alike.
 */
class SupplierSeeder extends DemoSeederBase
{
    protected function seed(): int
    {
        $stalls = self::stallIds();
        if (count($stalls) < 50) {
            throw new \RuntimeException('StallSeeder must run before SupplierSeeder');
        }
        $prefixes = DemoCatalog::supplierPrefixes();
        $types = DemoCatalog::supplierTypes();
        $cities = DemoCatalog::cities();
        $first = DemoCatalog::firstNames();
        $last = DemoCatalog::lastNames();
        $localities = DemoCatalog::localities();

        $created = 0;
        for ($i = 0; $i < 100; $i++) {
            $stallId = $stalls[self::stallCode(intdiv($i, 2) + 1)];
            [$trade] = $types[$i % count($types)];
            [$city] = $cities[$i % count($cities)];
            $name = $prefixes[$i % count($prefixes)] . ' ' . $trade . ', ' . $city;
            if (Supplier::where('stall_id', $stallId)->where('name', $name)->exists()) {
                continue;
            }
            Supplier::create([
                'stall_id' => $stallId,
                'name' => $name,
                'contact_person' => $first[($i * 7) % count($first)] . ' ' . $last[($i * 5) % count($last)],
                'phone' => self::fictionalPhone(800000 + $i),
                'email' => 'orders.supplier' . sprintf('%03d', $i + 1) . '@' . DemoCatalog::EMAIL_DOMAIN,
                'address' => sprintf('Shop %d, %s, %s', 10 + ($i * 3) % 90, $localities[$i % count($localities)], $city),
                'is_active' => true,
            ]);
            $created++;
        }

        return $created;
    }
}
