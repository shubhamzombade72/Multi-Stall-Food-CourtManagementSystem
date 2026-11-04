<?php

namespace Database\Seeders\Demo;

use App\Models\DiningTable;
use Database\Seeders\Demo\Data\DemoCatalog;

/**
 * 500 tables T-001..T-500 in 8 sections. Existing tables are never modified. "Cleaning" is not a supported table status
 * (the API accepts available / occupied / reserved), so only available and reserved are seeded here; OrderSeeder marks occupied.
 */
class TableSeeder extends DemoSeederBase
{
    protected function seed(): int
    {
        $sections = DemoCatalog::sections();
        $existing = DiningTable::pluck('table_number')->flip();
        $created = 0;
        for ($n = 1; $n <= 500; $n++) {
            $number = sprintf('T-%03d', $n);
            if ($existing->has($number)) {
                continue;
            }
            $r = $n % 20;
            $capacity = $r < 4 ? 2 : ($r < 13 ? 4 : ($r < 18 ? 6 : 8)); // 20% two-seaters, 45% four, 25% six, 10% eight
            DiningTable::create([
                'table_number' => $number,
                'capacity' => $capacity,
                'section' => $sections[intdiv($n - 1, 63) % count($sections)],
                'qr_token' => 'QR-' . $number . '-' . strtoupper(substr(sha1('demo-table-' . $n), 0, 8)),
                'status' => $n % 17 === 0 ? 'reserved' : 'available',
                'is_active' => true,
            ]);
            $created++;
        }

        return $created;
    }
}
