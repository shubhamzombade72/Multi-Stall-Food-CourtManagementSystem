<?php

namespace App\Services\Update;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A description of the client's business data taken before and after a database-changing update: row counts of all
 * business tables, totals of every money and stock column, users by role, settings keys, and integrity results. Comparing
 * two snapshots proves that a migration kept the data, without any data leaving the PC: there are only numbers here.
 */
class IntegritySnapshot
{
    /** Framework and updater bookkeeping: legitimately changes during an update, and holds no business data. */
    private const IGNORED_TABLES = ['migrations', 'cache', 'cache_locks', 'jobs', 'job_batches', 'failed_jobs', 'sessions', 'password_reset_tokens', 'personal_access_tokens', LocalMigrationEngine::LEDGER_TABLE, LocalMigrationEngine::STATE_TABLE];

    /** Named totals. Columns are checked for existence, so a snapshot works on any schema version. */
    private const TOTALS = [
        'orders' => ['subtotal', 'tax_amount', 'discount_amount', 'total_amount'],
        'order_items' => ['quantity', 'subtotal'],
        'payments' => ['amount', 'cash_tendered', 'change_returned'],
        'payment_allocations' => ['amount'],
        'inventory_items' => ['current_stock', 'unit_cost'],
        'stock_movements' => ['quantity'],
        'purchase_orders' => ['total_amount'],
        'daily_closings' => ['total_orders_count', 'total_gross_sales', 'total_discounts', 'total_net_sales', 'total_cash_collected', 'total_digital_collected'],
        'stall_settlement_records' => ['stall_gross_sales', 'stall_item_count', 'settlement_amount', 'payable_at_close', 'adjustment_amount', 'net_payable', 'paid_amount', 'remaining_amount'],
        'settlement_payouts' => ['amount', 'balance_after'],
        'consolidated_payouts' => ['total_amount'],
    ];

    public function __construct(private ?string $connection = null)
    {
    }

    public function take(): array
    {
        $db = DB::connection($this->connection);
        $schema = Schema::connection($this->connection);

        $tables = collect($db->select("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'"))->pluck('name')->sort()->values();
        $counts = [];
        foreach ($tables as $table) {
            // settings are compared by key below: starting the API may add a marker, which is not a change to business data
            if ($table !== 'settings' && !in_array($table, self::IGNORED_TABLES, true) && !str_starts_with($table, 'update_')) {
                $counts[$table] = (int) $db->table($table)->count();
            }
        }

        $totals = [];
        foreach (self::TOTALS as $table => $columns) {
            if (!$tables->contains($table)) {
                continue;
            }
            foreach ($columns as $column) {
                if ($schema->hasColumn($table, $column)) {
                    // Integer hundredths of a thousandth: exact to compare, unlike a float sum
                    $totals["{$table}.{$column}"] = (int) ($db->selectOne("select coalesce(sum(round({$column} * 1000)), 0) as n from {$table}")->n ?? 0);
                }
            }
        }

        $roles = $tables->contains('users') && $schema->hasColumn('users', 'role')
            ? $db->table('users')->selectRaw('role, count(*) as n')->groupBy('role')->pluck('n', 'role')->map(fn ($n) => (int) $n)->sortKeys()->all()
            : [];
        $settings = $tables->contains('settings') ? $db->table('settings')->orderBy('key')->pluck('key')->all() : [];

        $structure = [];
        foreach ($db->select("select type, name, tbl_name, sql from sqlite_master where name not like 'sqlite_%' and name not in ('" . LocalMigrationEngine::LEDGER_TABLE . "', '" . LocalMigrationEngine::STATE_TABLE . "') order by type, name") as $row) {
            $structure[] = [$row->type, $row->name, $row->tbl_name, $row->sql];
        }

        return [
            'taken_at' => now()->toIso8601String(),
            'integrity' => (string) ($db->selectOne('PRAGMA integrity_check')->integrity_check ?? 'unknown'),
            'foreign_key_problems' => count($db->select('PRAGMA foreign_key_check')),
            'counts' => $counts,
            'totals' => $totals,
            'users_by_role' => $roles,
            'settings_keys' => $settings,
            'schema_sha256' => hash('sha256', json_encode($structure)),
        ];
    }

    /**
     * Differences that matter: a business table lost or gained rows, a total moved, a role count or settings key changed,
     * integrity or foreign keys got worse. Tables that exist only in `after` (new features) are allowed if they are empty
     * or have rows the migration deliberately seeded; a migration that does that must say so through `expectedNew`.
     * @return string[]
     */
    public static function compare(array $before, array $after, array $expectedNew = []): array
    {
        $problems = [];
        if (($after['integrity'] ?? null) !== 'ok') {
            $problems[] = 'The database failed its integrity check.';
        }
        if (($after['foreign_key_problems'] ?? 1) > ($before['foreign_key_problems'] ?? 0)) {
            $problems[] = 'The database has new broken references.';
        }
        foreach ($before['counts'] ?? [] as $table => $n) {
            $now = $after['counts'][$table] ?? null;
            if ($now === null) {
                $problems[] = "Table {$table} no longer exists.";
            } elseif ($now !== $n) {
                $problems[] = "Table {$table} had {$n} rows and now has {$now}.";
            }
        }
        foreach ($after['counts'] ?? [] as $table => $n) {
            if (!array_key_exists($table, $before['counts'] ?? []) && $n > 0 && !in_array($table, $expectedNew, true)) {
                $problems[] = "New table {$table} unexpectedly holds {$n} rows.";
            }
        }
        foreach ($before['totals'] ?? [] as $key => $n) {
            $now = $after['totals'][$key] ?? null;
            if ($now === null) {
                $problems[] = "Total {$key} can no longer be read.";
            } elseif ($now !== $n) {
                $problems[] = "Total {$key} changed.";
            }
        }
        if (($before['users_by_role'] ?? []) != ($after['users_by_role'] ?? [])) {
            $problems[] = 'The number of accounts by role changed.';
        }
        if (array_diff($before['settings_keys'] ?? [], $after['settings_keys'] ?? []) !== []) {
            $problems[] = 'Settings were lost.';
        }

        return $problems;
    }
}
