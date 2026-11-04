<?php

namespace Database\Seeders\Demo;

use App\Models\Stall;
use Database\Seeders\Demo\Data\DemoCatalog;

/**
 * 50 stalls DM-001..DM-050. The stalls table only has name, code, description, phone and is_active, so the cuisine, hours,
 * location, owner and dummy contact details are written into the description (marker "[DEMO DATA]").
 */
class StallSeeder extends DemoSeederBase
{
    private const HOURS = ['08:00-20:00', '09:00-21:00', '10:00-22:00', '11:00-23:00', '07:00-15:00', '12:00-24:00', '09:00-23:00'];
    private const LOCATIONS = ['Ground Floor, Block A', 'Ground Floor, Block B', 'First Floor, Block A', 'First Floor, Block B', 'Food Street, Wing C'];

    protected function seed(): int
    {
        $first = DemoCatalog::firstNames();
        $last = DemoCatalog::lastNames();
        $created = 0;
        foreach (DemoCatalog::stalls() as $i => [$cuisine, $name]) {
            $no = $i + 1;
            $code = self::stallCode($no);
            if (Stall::where('code', $code)->exists()) {
                continue;
            }
            $slug = strtolower(str_replace('-', '', $code));
            $owner = $first[($no * 7) % count($first)] . ' ' . $last[($no * 11) % count($last)];
            Stall::create([
                'uuid' => self::uuid("stall:{$code}"),
                'name' => $name,
                'code' => $code,
                'description' => sprintf(
                    '%s %s stall. Owner: %s. Location: %s, Counter %02d. Hours: %s. Email: stall.%s@%s. UPI: demo.%s@testbank (dummy, not a real account).',
                    DemoCatalog::MARKER,
                    $cuisine,
                    $owner,
                    self::LOCATIONS[$no % count(self::LOCATIONS)],
                    $no,
                    self::HOURS[($no * 3) % count(self::HOURS)],
                    $slug,
                    DemoCatalog::EMAIL_DOMAIN,
                    $slug,
                ),
                'contact_phone' => '+91 5' . sprintf('%04d %05d', 1000 + $no, 10000 + $no),
                'is_active' => true,
            ]);
            $created++;
        }

        return $created;
    }
}
