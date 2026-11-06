<?php

namespace App\Console\Commands;

use App\Services\SqliteBackup;
use Illuminate\Console\Command;

/** Used by the desktop app right after a restore, so the PIN saved on this PC keeps working. See SqliteBackup::keepSession. */
class KeepSessionCommand extends Command
{
    protected $signature = 'foodcourt:keep-session {from : The data as it was before the restore} {--user-id=} {--email=} {--role=} {--connection= : Database connection (default: the application default)}';

    protected $description = 'Carry this PC\'s sign-in into restored data (prints one JSON line)';

    public function handle(): int
    {
        try {
            $report = SqliteBackup::keepSession($this->argument('from'), (int) $this->option('user-id'), (string) $this->option('email'), (string) $this->option('role'), $this->option('connection') ?: null);
        } catch (\Throwable) {
            $this->line(json_encode(['ok' => false, 'kept' => false, 'reason' => 'failed']));

            return self::FAILURE;
        }

        $this->line(json_encode($report));

        return self::SUCCESS;
    }
}
