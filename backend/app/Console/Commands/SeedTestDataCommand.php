<?php

namespace App\Console\Commands;

use App\Services\TestData\BulkTestDataService;
use Illuminate\Console\Command;

class SeedTestDataCommand extends Command
{
    protected $signature = 'foodcourt:seed-test-data {--force : Allow running when APP_ENV=production}';

    protected $description = 'Create (idempotently) 50 test stalls (TST-001..TST-050) with 20 menu items each. Safe to re-run: existing records are never changed or duplicated.';

    public function handle(BulkTestDataService $service): int
    {
        if (app()->environment('production') && !$this->option('force')) {
            $this->error('Refusing to create test data in production. Pass --force if you really mean it.');

            return self::FAILURE;
        }

        $before = $service->counts();
        $this->info("Test data already present: {$before['stalls']} stalls, {$before['items']} menu items.");

        $bar = $this->output->createProgressBar(BulkTestDataService::STALL_COUNT);
        $bar->start();
        $summary = $service->run(function (int $done, int $total, string $code, string $status) use ($bar) {
            $bar->advance();
            if (str_starts_with($status, 'FAILED')) {
                $this->newLine();
                $this->warn("{$code}: {$status}");
            }
        });
        $bar->finish();
        $this->newLine(2);

        $this->table(['Metric', 'Count'], [
            ['Stalls created this run', $summary['stalls_created']],
            ['Stalls already present (skipped)', $summary['stalls_existing']],
            ['Menu items created this run', $summary['items_created']],
            ['Menu items already present (skipped)', $summary['items_existing']],
            ['Menu categories created this run', $summary['categories_created']],
            ['Failed stalls', count($summary['failed'])],
        ]);

        $totals = $summary['total_in_database'];
        $this->info("Creation summary: {$totals['stalls']} stalls, {$totals['items']} menu items, {$summary['grand_total']} total test records in the database.");

        if ($summary['failed']) {
            foreach ($summary['failed'] as $f) {
                $this->error("{$f['stall']}: {$f['reason']}");
            }
            $this->warn('Some stalls failed and were rolled back. Run the command again to retry them.');

            return self::FAILURE;
        }

        return self::SUCCESS;
    }
}
