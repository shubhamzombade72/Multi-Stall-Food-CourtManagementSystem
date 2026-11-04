<?php

namespace Database\Seeders\Demo;

use App\Models\Setting;

/** The schema has no food-court table: the single food court is the "business_profile" setting. Created only if the owner never saved one. */
class FoodCourtSeeder extends DemoSeederBase
{
    protected function seed(): int
    {
        if (Setting::where('key', 'business_profile')->exists()) {
            return 0;
        }
        Setting::create([
            'key' => 'business_profile',
            'value' => [
                'name' => 'Urban Food Court (Demo)',
                'legal_name' => 'Urban Food Court Demo Pvt. Ltd.',
                'address' => 'Demo Plaza, Fergusson College Road, Pune, Maharashtra 411004',
                'phone' => '+91 5000010000',
                'email' => 'info@demo.example.test',
                'gstin' => null,
                'opening_time' => '09:00',
                'closing_time' => '23:00',
            ],
        ]);

        return 1;
    }
}
