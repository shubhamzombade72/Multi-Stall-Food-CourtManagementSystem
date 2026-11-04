<?php

namespace Database\Seeders;

use App\Services\TestData\BulkTestDataService;
use Illuminate\Database\Seeder;

/** php artisan db:seed --class=BulkTestDataSeeder  (same as php artisan foodcourt:seed-test-data; idempotent). */
class BulkTestDataSeeder extends Seeder
{
    public function run(): void
    {
        $summary = app(BulkTestDataService::class)->run(function ($done, $total, $code, $status) {
            $this->command?->getOutput()->writeln("[{$done}/{$total}] {$code}: {$status}");
        });

        $t = $summary['total_in_database'];
        $this->command?->info("{$t['stalls']} stalls, {$t['items']} menu items, {$summary['grand_total']} total.");

        if ($summary['failed']) {
            throw new \RuntimeException(count($summary['failed']) . ' stall(s) failed; re-run the seeder to retry.');
        }
    }
}
