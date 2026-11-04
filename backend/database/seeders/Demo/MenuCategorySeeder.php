<?php

namespace Database\Seeders\Demo;

use App\Models\MenuCategory;
use Database\Seeders\Demo\Data\DemoCatalog;

/** Menu categories belong to one stall each, so there is at least one per stall: 25 stalls get one, 25 get two = 75. */
class MenuCategorySeeder extends DemoSeederBase
{
    protected function seed(): int
    {
        $ids = self::stallIds();
        $created = 0;
        foreach (DemoCatalog::stalls() as $i => [$cuisine, , , , , $second]) {
            $stallId = $ids[self::stallCode($i + 1)] ?? null;
            if (!$stallId) {
                throw new \RuntimeException('StallSeeder must run before MenuCategorySeeder');
            }
            $names = [DemoCatalog::primaryCategory($cuisine)];
            if ($second) {
                $names[] = DemoCatalog::SECONDARY_CATEGORY;
            }
            foreach ($names as $order => $name) {
                $cat = MenuCategory::firstOrCreate(['stall_id' => $stallId, 'name' => $name], ['display_order' => $order + 1, 'is_active' => true]);
                $created += $cat->wasRecentlyCreated ? 1 : 0;
            }
        }

        return $created;
    }
}
