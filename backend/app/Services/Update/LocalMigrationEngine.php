<?php

namespace App\Services\Update;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Applies a release's migrations to the client's own database (SQLite), under the rules in the update design:
 *
 *  - a migration runs only if its file matches the checksum in the manifest the desktop app already signature-checked
 *  - a pending migration that the manifest does not list stops everything, before any change
 *  - order and dependencies come from the manifest; recorded migrations whose file changed stop everything
 *  - one engine at a time: an OS file lock that dies with the process, plus a ledger row that survives it, so a crash
 *    during a migration is recognised next time instead of being retried
 *  - each migration is one transaction, opened here: Laravel's SQLite grammar reports no schema transactions, so its own
 *    migrator would leave a failed migration half applied. The first failure stops the run
 *  - integrity and foreign keys are checked inside that transaction, so a migration that breaks them is undone too; the
 *    schema is compared with the manifest at the end
 *
 * The ledger and lock tables are created directly here and not by a migration, because they must exist on any database
 * before its first managed migration.
 */
class LocalMigrationEngine
{
    public const LEDGER_TABLE = 'update_migration_ledger';
    public const STATE_TABLE = 'update_db_state';

    /** @var resource|null */
    private $lockHandle = null;

    public function __construct(private ?string $connection = null, private ?string $migrationsPath = null)
    {
        $this->migrationsPath ??= database_path('migrations');
    }

    private function db()
    {
        return DB::connection($this->connection);
    }

    public function ensureTables(): void
    {
        $this->db()->statement('CREATE TABLE IF NOT EXISTS ' . self::LEDGER_TABLE . ' (
            migration_id TEXT PRIMARY KEY,
            checksum TEXT NOT NULL,
            status TEXT NOT NULL,
            release_version TEXT,
            started_at TEXT NOT NULL,
            finished_at TEXT,
            error TEXT
        )');
        $this->db()->statement('CREATE TABLE IF NOT EXISTS ' . self::STATE_TABLE . ' (key TEXT PRIMARY KEY, value TEXT)');
    }

    // ------------------------------------------------------------------ locking
    public function lockFile(): string
    {
        return $this->db()->getDatabaseName() . '.update.lock';
    }

    public function acquireLock(): bool
    {
        $handle = fopen($this->lockFile(), 'c');
        if (!$handle || !flock($handle, LOCK_EX | LOCK_NB)) {
            if ($handle) {
                fclose($handle);
            }

            return false;
        }
        ftruncate($handle, 0);
        fwrite($handle, (string) getmypid());
        fflush($handle);
        $this->lockHandle = $handle;

        return true;
    }

    public function releaseLock(): void
    {
        if ($this->lockHandle) {
            flock($this->lockHandle, LOCK_UN);
            fclose($this->lockHandle);
            $this->lockHandle = null;
        }
    }

    // ------------------------------------------------------------------ inspection
    public function migrationFiles(): array
    {
        $files = glob(rtrim($this->migrationsPath, '/\\') . '/*.php') ?: [];
        sort($files);
        $out = [];
        foreach ($files as $file) {
            $out[basename($file, '.php')] = $file;
        }

        return $out;
    }

    private function fileChecksum(string $file): string
    {
        // Line endings are normalised so a checkout with CRLF and a package built with LF agree
        return hash('sha256', str_replace("\r\n", "\n", (string) file_get_contents($file)));
    }

    /** Names Laravel has recorded as run. */
    public function ran(): array
    {
        return Schema::connection($this->connection)->hasTable('migrations') ? $this->db()->table('migrations')->pluck('migration')->all() : [];
    }

    public function ledger(): array
    {
        return Schema::connection($this->connection)->hasTable(self::LEDGER_TABLE)
            ? $this->db()->table(self::LEDGER_TABLE)->get()->keyBy('migration_id')->map(fn ($r) => (array) $r)->all()
            : [];
    }

    /** Rows left in `running` or `failed`: the last run did not finish cleanly. */
    public function unresolved(): array
    {
        return array_values(array_filter($this->ledger(), fn ($r) => in_array($r['status'], ['running', 'failed'], true)));
    }

    public function status(array $manifest = []): array
    {
        $ran = $this->ran();
        $files = array_keys($this->migrationFiles());
        $state = Schema::connection($this->connection)->hasTable(self::STATE_TABLE)
            ? $this->db()->table(self::STATE_TABLE)->pluck('value', 'key')->all()
            : [];

        return [
            'ok' => true,
            'pending' => array_values(array_diff($files, $ran)),
            'applied' => count($ran),
            'unresolved' => $this->unresolved(),
            'state' => $state,
            'integrity' => $this->integrity(),
            'schema_fingerprint' => isset($manifest['schema']) ? self::fingerprint(self::project($this->schema(), $manifest['schema'])) : null,
        ];
    }

    public function integrity(): string
    {
        return (string) ($this->db()->selectOne('PRAGMA integrity_check')->integrity_check ?? 'unknown');
    }

    public function foreignKeyProblems(): int
    {
        return count($this->db()->select('PRAGMA foreign_key_check'));
    }

    // ------------------------------------------------------------------ validation (nothing changes here)
    /**
     * Every reason this manifest must not be applied. `$database` is the manifest's database section.
     * @return string[] problems; empty means it may run
     */
    public function preflight(array $database): array
    {
        $problems = [];
        if (($database['engine'] ?? null) !== 'sqlite') {
            $problems[] = 'This release does not describe a SQLite database.';
        }
        if ($this->integrity() !== 'ok') {
            $problems[] = 'The database file failed its integrity check.';

            return $problems;
        }
        foreach ($this->unresolved() as $row) {
            $problems[] = "Migration {$row['migration_id']} did not finish last time ({$row['status']}). Recovery has to run first.";
        }

        $listed = [];
        foreach ($database['migrations'] ?? [] as $m) {
            $id = $m['id'] ?? '';
            if (isset($listed[$id])) {
                $problems[] = "Migration {$id} is listed twice.";
            }
            $listed[$id] = $m;
        }

        $files = $this->migrationFiles();
        foreach ($files as $id => $file) {
            if (!isset($listed[$id])) {
                $problems[] = "Migration {$id} is present but not listed in the signed release.";

                continue;
            }
            if (!hash_equals((string) $listed[$id]['sha256'], $this->fileChecksum($file))) {
                $problems[] = "Migration {$id} does not match its checksum.";
            }
        }
        foreach ($listed as $id => $m) {
            if (!isset($files[$id])) {
                $problems[] = "Migration {$id} is listed but its file is missing.";
            }
        }

        $ledger = $this->ledger();
        foreach ($ledger as $id => $row) {
            if (in_array($row['status'], ['applied', 'adopted'], true) && isset($listed[$id]) && !hash_equals($row['checksum'], (string) $listed[$id]['sha256'])) {
                $problems[] = "Migration {$id} was already applied with different contents.";
            }
        }

        $ran = $this->ran();
        $seen = array_fill_keys($ran, true);
        foreach ($database['migrations'] ?? [] as $m) {
            foreach ($m['depends_on'] ?? [] as $dep) {
                if (!isset($seen[$dep])) {
                    $problems[] = "Migration {$m['id']} depends on {$dep}, which comes later or is missing.";
                }
            }
            $seen[$m['id']] = true;
        }

        return $problems;
    }

    // ------------------------------------------------------------------ apply
    /**
     * Runs what is pending. Never continues after a failure and never re-runs anything already recorded.
     * @return array report with ok, applied, adopted, failed, schema_fingerprint, problems
     */
    public function apply(array $database, string $releaseVersion): array
    {
        $report = ['ok' => false, 'applied' => [], 'adopted' => [], 'failed' => null, 'problems' => [], 'schema_fingerprint' => null];
        if (!$this->acquireLock()) {
            $report['problems'][] = 'Another update is already working on this database.';
            $report['code'] = 'locked';

            return $report;
        }

        try {
            $this->ensureTables();
            $problems = $this->preflight($database);
            if ($problems) {
                $report['problems'] = $problems;
                $report['code'] = 'preflight';

                return $report;
            }

            $files = $this->migrationFiles();
            $ran = array_fill_keys($this->ran(), true);
            $ledger = $this->ledger();
            $now = fn () => now()->toIso8601String();

            foreach ($database['migrations'] ?? [] as $m) {
                $id = $m['id'];
                if (isset($ran[$id])) {
                    // Applied before managed updates existed (or by a normal start): record it, never re-run it
                    if (!isset($ledger[$id])) {
                        $this->db()->table(self::LEDGER_TABLE)->insert(['migration_id' => $id, 'checksum' => $m['sha256'], 'status' => 'adopted', 'release_version' => $releaseVersion, 'started_at' => $now(), 'finished_at' => $now()]);
                        $report['adopted'][] = $id;
                    }

                    continue;
                }

                $this->db()->table(self::LEDGER_TABLE)->insert(['migration_id' => $id, 'checksum' => $m['sha256'], 'status' => 'running', 'release_version' => $releaseVersion, 'started_at' => $now()]);
                try {
                    $this->db()->transaction(function () use ($files, $id) {
                        $this->runOne($files[$id]);
                        if (!in_array($id, $this->ran(), true)) {
                            throw new \RuntimeException('The migration did not record itself as applied.');
                        }
                        if ($this->integrity() !== 'ok') {
                            throw new \RuntimeException('The database failed its integrity check after this migration.');
                        }
                        if ($this->foreignKeyProblems() > 0) {
                            throw new \RuntimeException('This migration left broken references.');
                        }
                    });
                } catch (\Throwable $e) {
                    $this->db()->table(self::LEDGER_TABLE)->where('migration_id', $id)->update(['status' => 'failed', 'finished_at' => $now(), 'error' => mb_substr($e->getMessage(), 0, 2000)]);
                    $report['failed'] = $id;
                    $report['problems'][] = "Migration {$id} failed: " . mb_substr($e->getMessage(), 0, 500);
                    $report['code'] = 'migration_failed';

                    return $report;
                }
                $this->db()->table(self::LEDGER_TABLE)->where('migration_id', $id)->update(['status' => 'applied', 'finished_at' => $now()]);
                $report['applied'][] = $id;
            }

            $schemaProblems = self::compareSchema($this->schema(), $database['schema'] ?? []);
            if ($schemaProblems) {
                $report['problems'] = $schemaProblems;
                $report['code'] = 'schema_mismatch';

                return $report;
            }
            $report['schema_fingerprint'] = self::fingerprint(self::project($this->schema(), $database['schema'] ?? []));
            if (!empty($database['schema_fingerprint']) && !hash_equals($database['schema_fingerprint'], $report['schema_fingerprint'])) {
                $report['problems'][] = 'The database schema does not match this release.';
                $report['code'] = 'schema_mismatch';

                return $report;
            }

            $this->db()->table(self::STATE_TABLE)->updateOrInsert(['key' => 'schema_version'], ['value' => $releaseVersion]);
            // An installer's manifest lists migrations only, and describes no schema to fingerprint
            if (!empty($database['schema'])) {
                $this->db()->table(self::STATE_TABLE)->updateOrInsert(['key' => 'schema_fingerprint'], ['value' => $report['schema_fingerprint']]);
            }
            if (!empty($database['min_app_version'])) {
                $this->db()->table(self::STATE_TABLE)->updateOrInsert(['key' => 'min_app_version'], ['value' => $database['min_app_version']]);
            }
            $report['ok'] = true;

            return $report;
        } finally {
            $this->releaseLock();
        }
    }

    private function runOne(string $file): void
    {
        $migrator = app('migrator');
        $migrator->usingConnection($this->connection ?: config('database.default'), function () use ($migrator, $file) {
            if (!$migrator->repositoryExists()) {
                $migrator->getRepository()->createRepository();
            }
            $migrator->run([$file], ['pretend' => false, 'step' => false]);
        });
    }

    /**
     * After a failed or interrupted run. Clears `running` and `failed` rows only when the database demonstrably matches the
     * pre-update snapshot, which means nothing has to be restored. The caller restores the recovery point otherwise.
     */
    public function resolveIfUnchanged(array $before): array
    {
        if (!$this->acquireLock()) {
            return ['ok' => false, 'unchanged' => false, 'problems' => ['Another update is already working on this database.'], 'code' => 'locked'];
        }

        try {
            $after = (new IntegritySnapshot($this->connection))->take();
            $differences = IntegritySnapshot::compare($before, $after);
            $schemaSame = ($before['schema_sha256'] ?? null) === ($after['schema_sha256'] ?? null);
            $unchanged = $after['integrity'] === 'ok' && $differences === [] && $schemaSame;
            if ($unchanged) {
                $this->ensureTables();
                $this->db()->table(self::LEDGER_TABLE)->whereIn('status', ['running', 'failed'])->delete();
            }

            return ['ok' => true, 'unchanged' => $unchanged, 'differences' => $differences, 'schema_same' => $schemaSame, 'integrity' => $after['integrity']];
        } finally {
            $this->releaseLock();
        }
    }

    // ------------------------------------------------------------------ schema description
    /** table => [ column => type ] for every application table. */
    public function schema(): array
    {
        $out = [];
        $tables = $this->db()->select("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name");
        foreach ($tables as $table) {
            if (in_array($table->name, [self::LEDGER_TABLE, self::STATE_TABLE], true)) {
                continue;
            }
            $columns = [];
            foreach ($this->db()->select('PRAGMA table_info(' . $this->db()->getPdo()->quote($table->name) . ')') as $column) {
                $columns[$column->name] = strtolower((string) $column->type);
            }
            ksort($columns);
            $out[$table->name] = $columns;
        }
        ksort($out);

        return $out;
    }

    /** Only what the release describes, so a harmless extra table on one client does not change the fingerprint. */
    public static function project(array $actual, array $expected): array
    {
        $out = [];
        foreach ($expected as $table => $columns) {
            foreach (array_keys($columns) as $column) {
                if (isset($actual[$table][$column])) {
                    $out[$table][$column] = $actual[$table][$column];
                }
            }
            if (isset($out[$table])) {
                ksort($out[$table]);
            }
        }
        ksort($out);

        return $out;
    }

    public static function fingerprint(array $schema): string
    {
        return hash('sha256', json_encode($schema));
    }

    /** @return string[] */
    public static function compareSchema(array $actual, array $expected): array
    {
        $problems = [];
        foreach ($expected as $table => $columns) {
            if (!isset($actual[$table])) {
                $problems[] = "Table {$table} is missing after the update.";

                continue;
            }
            foreach ($columns as $column => $type) {
                if (!array_key_exists($column, $actual[$table])) {
                    $problems[] = "Column {$table}.{$column} is missing after the update.";
                } elseif ($actual[$table][$column] !== $type) {
                    $problems[] = "Column {$table}.{$column} has the wrong type.";
                }
            }
        }

        return $problems;
    }
}
