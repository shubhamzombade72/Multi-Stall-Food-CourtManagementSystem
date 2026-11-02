<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->string('tracking_token', 64)->nullable()->unique()->after('uuid');
            $table->string('idempotency_key', 64)->nullable()->unique()->after('tracking_token');
            $table->index(['status', 'payment_status'], 'orders_status_payment_index');
            $table->index('created_at', 'orders_created_at_index');
            $table->index('table_id', 'orders_table_id_index');
            $table->index('waiter_id', 'orders_waiter_id_index');
            $table->index('cashier_id', 'orders_cashier_id_index');
        });

        // Populate existing orders with secure random tracking tokens
        $orders = DB::table('orders')->whereNull('tracking_token')->get();
        foreach ($orders as $order) {
            DB::table('orders')->where('id', $order->id)->update([
                'tracking_token' => 'trk_' . Str::random(32),
            ]);
        }

        Schema::table('order_items', function (Blueprint $table) {
            $table->index('stall_id', 'order_items_stall_id_index');
            $table->index('status', 'order_items_status_index');
        });

        Schema::table('stall_kitchen_tickets', function (Blueprint $table) {
            $table->index('stall_id', 'stall_tickets_stall_id_index');
            $table->index('status', 'stall_tickets_status_index');
        });

        Schema::table('payments', function (Blueprint $table) {
            $table->index('status', 'payments_status_index');
            $table->index('created_at', 'payments_created_at_index');
        });

        Schema::table('stall_settlement_records', function (Blueprint $table) {
            $table->unique(['closing_id', 'stall_id'], 'closing_stall_unique');
        });
    }

    public function down(): void
    {
        Schema::table('stall_settlement_records', function (Blueprint $table) {
            $table->dropUnique('closing_stall_unique');
        });

        Schema::table('payments', function (Blueprint $table) {
            $table->dropIndex('payments_status_index');
            $table->dropIndex('payments_created_at_index');
        });

        Schema::table('stall_kitchen_tickets', function (Blueprint $table) {
            $table->dropIndex('stall_tickets_stall_id_index');
            $table->dropIndex('stall_tickets_status_index');
        });

        Schema::table('order_items', function (Blueprint $table) {
            $table->dropIndex('order_items_stall_id_index');
            $table->dropIndex('order_items_status_index');
        });

        Schema::table('orders', function (Blueprint $table) {
            $table->dropIndex('orders_status_payment_index');
            $table->dropIndex('orders_created_at_index');
            $table->dropIndex('orders_table_id_index');
            $table->dropIndex('orders_waiter_id_index');
            $table->dropIndex('orders_cashier_id_index');
            $table->dropColumn(['tracking_token', 'idempotency_key']);
        });
    }
};

