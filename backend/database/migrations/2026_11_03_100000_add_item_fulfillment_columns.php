<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stall_ticket_items', function (Blueprint $table) {
            $table->timestamp('ready_at')->nullable();
            $table->timestamp('served_at')->nullable()->index();
            $table->foreignId('served_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->unsignedInteger('version')->default(0);
        });

        Schema::table('orders', function (Blueprint $table) {
            $table->unsignedSmallInteger('guest_count')->nullable();
        });

        Schema::create('fulfillment_operations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained('orders')->cascadeOnDelete();
            $table->string('idempotency_key', 64);
            $table->string('operation', 32);
            $table->char('request_hash', 64);
            $table->foreignId('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->json('result');
            $table->timestamp('created_at')->useCurrent();

            $table->unique(['order_id', 'idempotency_key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fulfillment_operations');

        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn('guest_count');
        });

        Schema::table('stall_ticket_items', function (Blueprint $table) {
            $table->dropForeign(['served_by_user_id']);
            $table->dropIndex(['served_at']);
            $table->dropColumn(['ready_at', 'served_at', 'served_by_user_id', 'version']);
        });
    }
};
