<?php

namespace App\Console\Commands;

use App\Services\SqliteBackup;
use Illuminate\Console\Command;

/** Used by the desktop app: `foodcourt:backup <file>` writes and verifies a backup, `--verify` only checks an existing one. */
class BackupCommand extends Command
{
    protected $signature = 'foodcourt:backup {file : Backup file path} {--verify : Only verify an existing backup file} {--connection= : Database connection (default: the application default)}';

    protected $description = 'Create and verify a backup of the built-in database (prints one JSON line)';

    public function handle(): int
    {
        try {
            $report = $this->option('verify')
                ? SqliteBackup::verify($this->argument('file'))
                : SqliteBackup::create($this->argument('file'), $this->option('connection') ?: null);
        } catch (\Throwable $e) {
            $this->line(json_encode(['ok' => false, 'problems' => [$e instanceof \RuntimeException ? $e->getMessage() : 'The backup failed.']]));

            return self::FAILURE;
        }

        $this->line(json_encode($report));

        return $report['ok'] ? self::SUCCESS : self::FAILURE;
    }
}
