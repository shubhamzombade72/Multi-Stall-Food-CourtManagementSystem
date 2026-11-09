<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;

/**
 * Backup and backup verification for the built-in (SQLite) database. A backup is only reported as good after
 * the copy has been opened as a separate database and checked; "the copy command exited 0" proves nothing.
 */
class SqliteBackup
{
    /** Writes a consistent copy of the live database to $destination (VACUUM INTO) and verifies it. */
    public static function create(string $destination, ?string $connection = null): array
    {
        $source = DB::connection($connection);
        if ($source->getDriverName() !== 'sqlite') {
            throw new \RuntimeException('Backups of this kind are only for the built-in database. Use the server backup script (pg_dump) for a shared server.');
        }
        if (file_exists($destination)) {
            throw new \RuntimeException('The backup file already exists; choose another name.');
        }
        if (!is_dir(dirname($destination))) {
            throw new \RuntimeException('The backup folder does not exist.');
        }

        $pdo = $source->getPdo();
        $pdo->exec('VACUUM INTO ' . $pdo->quote($destination));

        $report = self::verify($destination);
        if (!$report['ok']) {
            @unlink($destination);
        }

        return $report;
    }

    /**
     * After a restore: lets the PIN saved on this PC keep working. That PIN opens a session token the restored data has
     * never seen, so this PC's session rows are copied in from $from (the data as it was just before the restore).
     * Only for the same active account with the same role; anything else reports kept=false and the password is needed.
     * Rows are copied with their ids because a token names its row by id. The token's own hash is never reported.
     */
    public static function keepSession(string $from, int $userId, string $email, string $role, ?string $connection = null): array
    {
        $target = DB::connection($connection);
        if ($target->getDriverName() !== 'sqlite') {
            throw new \RuntimeException('Only the built-in database is restored this way.');
        }

        $user = $target->table('users')->where('id', $userId)->first();
        if (!$user || strcasecmp((string) $user->email, $email) !== 0) {
            return ['ok' => true, 'kept' => false, 'reason' => 'account_not_in_backup'];
        }
        if (!$user->is_active) {
            return ['ok' => true, 'kept' => false, 'reason' => 'account_inactive'];
        }
        if ($user->role !== $role) {
            return ['ok' => true, 'kept' => false, 'reason' => 'role_changed'];
        }

        $type = (new User())->getMorphClass();
        $rows = [];
        if (is_file($from) && filesize($from) > 0) {
            $name = 'fc_backup_previous';
            Config::set("database.connections.{$name}", ['driver' => 'sqlite', 'database' => $from, 'prefix' => '', 'foreign_key_constraints' => false]);
            DB::purge($name);
            try {
                $rows = DB::connection($name)->table('personal_access_tokens')->where('tokenable_type', $type)->where('tokenable_id', $userId)->get()
                    ->map(fn ($row) => (array) $row)->all();
            } finally {
                DB::purge($name);
            }
        }

        if ($rows !== []) {
            $target->transaction(function () use ($target, $rows, $type, $userId) {
                // This account's older tokens were revoked by its later login, so they must not come back with the backup.
                $target->table('personal_access_tokens')->where('tokenable_type', $type)->where('tokenable_id', $userId)->delete();
                $target->table('personal_access_tokens')->whereIn('id', array_column($rows, 'id'))->delete();
                $target->table('personal_access_tokens')->insert($rows);
            });
        }

        $kept = $target->table('personal_access_tokens')->where('tokenable_type', $type)->where('tokenable_id', $userId)->exists();

        return ['ok' => true, 'kept' => $kept, 'reason' => $kept ? null : 'no_session'];
    }

    /**
     * Opens $file as its own database and checks that it is intact and usable by this program version:
     * integrity and foreign-key checks, the core tables exist, every migration of this version is recorded,
     * and the accounts table can be read.
     */
    public static function verify(string $file): array
    {
        $report = ['ok' => false, 'bytes' => is_file($file) ? filesize($file) : 0, 'integrity' => null, 'migrations_current' => false, 'users' => null, 'tables' => 0, 'problems' => []];
        if (!is_file($file) || $report['bytes'] === 0) {
            $report['problems'][] = 'The backup file is missing or empty.';

            return $report;
        }

        $name = 'fc_backup_verify';
        Config::set("database.connections.{$name}", ['driver' => 'sqlite', 'database' => $file, 'prefix' => '', 'foreign_key_constraints' => true]);
        DB::purge($name);

        try {
            $db = DB::connection($name);
            $report['integrity'] = (string) ($db->selectOne('PRAGMA integrity_check')->integrity_check ?? 'unknown');
            if ($report['integrity'] !== 'ok') {
                $report['problems'][] = 'The database file is damaged.';
            }
            if ($db->select('PRAGMA foreign_key_check') !== []) {
                $report['problems'][] = 'The data has broken references.';
            }

            $tables = collect($db->select("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'"))->pluck('name');
            $report['tables'] = $tables->count();
            foreach (['users', 'migrations', 'settings', 'orders', 'stalls'] as $required) {
                if (!$tables->contains($required)) {
                    $report['problems'][] = "The backup has no '{$required}' data.";
                }
            }

            if ($tables->contains('migrations')) {
                $migrator = app('migrator');
                $expected = array_keys($migrator->getMigrationFiles(array_merge($migrator->paths(), [database_path('migrations')])));
                $ran = $db->table('migrations')->pluck('migration')->all();
                $report['migrations_current'] = array_diff($expected, $ran) === [];
                if (!$report['migrations_current']) {
                    $report['problems'][] = 'The backup comes from an older program version (it will be upgraded when restored).';
                }
            }
            if ($tables->contains('users')) {
                $report['users'] = $db->table('users')->count();
            }
        } catch (\Throwable $e) {
            $report['problems'][] = 'The backup could not be opened as a database.';
        } finally {
            DB::purge($name);
        }

        // An older-version backup is restorable (migrations run afterwards), so it is not a failure by itself
        $fatal = array_filter($report['problems'], fn ($p) => !str_contains($p, 'older program version'));
        $report['ok'] = $fatal === [] && $report['integrity'] === 'ok';

        return $report;
    }
}
