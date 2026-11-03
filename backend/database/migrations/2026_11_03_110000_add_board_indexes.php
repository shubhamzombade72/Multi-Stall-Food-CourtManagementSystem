<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Indexes behind the order-tracking board (GET /orders/board), which is polled every 5 s:
 * correlated EXISTS over tickets (order_id) and ticket items (ticket_id, status), and the keyset
 * ORDER BY orders(created_at, id). PostgreSQL does not index foreign keys on its own.
 * Additive only; an index that already exists (same columns, any name) is skipped.
 */
return new class extends Migration
{
    private const INDEXES = [
        ['stall_kitchen_tickets', ['order_id'], 'stall_tickets_order_id_index'],
        ['stall_ticket_items', ['ticket_id', 'status'], 'stall_ticket_items_ticket_status_index'],
        ['orders', ['created_at', 'id'], 'orders_created_at_id_index'],
    ];

    public function up(): void
    {
        foreach (self::INDEXES as [$table, $columns, $name]) {
            if (Schema::hasIndex($table, $columns) || Schema::hasIndex($table, $name)) {
                continue;
            }
            Schema::table($table, function (Blueprint $t) use ($columns, $name) {
                $t->index($columns, $name);
            });
        }
    }

    public function down(): void
    {
        foreach (self::INDEXES as [$table, , $name]) {
            if (!Schema::hasIndex($table, $name)) {
                continue; // skipped in up() because an equivalent index already existed
            }
            Schema::table($table, function (Blueprint $t) use ($name) {
                $t->dropIndex($name);
            });
        }
    }
};
