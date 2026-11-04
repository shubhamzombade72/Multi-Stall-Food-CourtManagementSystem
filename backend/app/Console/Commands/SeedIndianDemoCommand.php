<?php

namespace App\Console\Commands;

use Database\Seeders\Demo\DemoGuard;
use Database\Seeders\Demo\DemoIntegrity;
use Database\Seeders\Demo\IndianDemoSeeder;
use Illuminate\Console\Command;

class SeedIndianDemoCommand extends Command
{
    protected $signature = 'foodcourt:seed-indian-demo {--counts : Only print the current demo record counts} {--verify : Only run the read-only integrity checks}';

    protected $description = 'Create (idempotently) the Indian demo dataset: 50 stalls, 500 tables, 1,500 dishes, 100 suppliers, 1,000 customers, 150 staff, 2,000 orders, 200 purchase orders. Demo/test databases only.';

    public function handle(): int
    {
        try {
            $db = DemoGuard::assertSafe();
        } catch (\Throwable $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }
        $this->info("Database: {$db['driver']} '{$db['database']}' (connection {$db['connection']}), APP_ENV=" . app()->environment());

        if ($this->option('verify')) {
            $bad = 0;
            $rows = [];
            foreach (DemoIntegrity::violations() as $name => $n) {
                $rows[] = [$n === 0 ? 'PASS' : 'FAIL', $name, $n];
                $bad += $n > 0 ? 1 : 0;
            }
            $this->table(['Result', 'Integrity check', 'Violations'], $rows);
            $this->line($bad === 0 ? 'All ' . count($rows) . ' integrity checks passed.' : "{$bad} integrity check(s) FAILED.");

            return $bad === 0 ? self::SUCCESS : self::FAILURE;
        }

        if (!$this->option('counts')) {
            $started = microtime(true);
            // the seeders print their own per-step progress through this command's output
            app(IndianDemoSeeder::class)->setContainer(app())->setCommand($this)->run();
            $this->info(sprintf('Seeding finished in %.1f s', microtime(true) - $started));
        }

        $rows = [];
        foreach (IndianDemoSeeder::counts() as $k => $v) {
            $rows[] = [$k, $v];
        }
        $this->table(['Entity', 'Demo records in database'], $rows);

        return self::SUCCESS;
    }
}
