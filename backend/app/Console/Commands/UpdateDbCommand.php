<?php

namespace App\Console\Commands;

use App\Services\Update\IntegritySnapshot;
use App\Services\Update\LocalMigrationEngine;
use Illuminate\Console\Command;

/**
 * The database side of a managed update, called by the desktop bootstrapper. Every action prints one JSON line.
 *
 *   status    [--manifest=]         what is pending and whether the last run finished
 *   preflight --manifest=           everything that would stop an apply; changes nothing except creating its own tables
 *   apply     --manifest= --release=
 *   snapshot                        counts and totals of business data
 *   compare   --before= --after=    differences between two snapshot files
 *   resolve   --before=             after a failure: is the database still as it was before?
 *   describe                        table/column map of this database (the release builder uses it)
 */
class UpdateDbCommand extends Command
{
    protected $signature = 'foodcourt:update-db {action} {--manifest=} {--release=} {--before=} {--after=}';

    protected $description = 'Managed database migration for the desktop updater (prints one JSON line)';

    public function handle(): int
    {
        if (config('database.default') !== 'sqlite') {
            return $this->finish(['ok' => false, 'problems' => ['Managed migrations are for the built-in SQLite database only.']]);
        }

        try {
            $engine = new LocalMigrationEngine();

            return match ($this->argument('action')) {
                'status' => $this->finish($engine->status($this->database())),
                'preflight' => $this->preflight($engine),
                'apply' => $this->finish($engine->apply($this->database(), (string) $this->option('release'))),
                'snapshot' => $this->finish(['ok' => true, 'snapshot' => (new IntegritySnapshot())->take()]),
                'compare' => $this->compare(),
                'resolve' => $this->finish($engine->resolveIfUnchanged($this->readJson((string) $this->option('before')))),
                'describe' => $this->finish(['ok' => true, 'schema' => $engine->schema(), 'fingerprint' => LocalMigrationEngine::fingerprint($engine->schema())]),
                default => $this->finish(['ok' => false, 'problems' => ['Unknown action.']]),
            };
        } catch (\Throwable $e) {
            return $this->finish(['ok' => false, 'code' => 'exception', 'problems' => [mb_substr($e->getMessage(), 0, 500)]]);
        }
    }

    private function preflight(LocalMigrationEngine $engine): int
    {
        $engine->ensureTables();
        $problems = $engine->preflight($this->database());

        return $this->finish(['ok' => $problems === [], 'problems' => $problems, 'code' => $problems === [] ? null : 'preflight']);
    }

    private function compare(): int
    {
        $problems = IntegritySnapshot::compare($this->readJson((string) $this->option('before')), $this->readJson((string) $this->option('after')), $this->database()['expected_new_rows'] ?? []);

        return $this->finish(['ok' => $problems === [], 'problems' => $problems]);
    }

    private function database(): array
    {
        $file = $this->option('manifest');
        if (!$file) {
            return [];
        }

        return $this->readJson((string) $file)['database'] ?? [];
    }

    private function readJson(string $file): array
    {
        $data = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
        if (!is_array($data)) {
            throw new \RuntimeException('A required update file could not be read.');
        }

        return $data;
    }

    private function finish(array $report): int
    {
        $this->line(json_encode($report));

        return ($report['ok'] ?? false) ? self::SUCCESS : self::FAILURE;
    }
}
