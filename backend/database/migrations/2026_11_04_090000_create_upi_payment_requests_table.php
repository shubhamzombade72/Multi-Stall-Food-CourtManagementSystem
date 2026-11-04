<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One row per UPI QR shown for a bill. It is a payment REQUEST (never proof of payment): it snapshots the
 * merchant UPI ID, payee name and amount that went into the QR so a reprint always shows the original data,
 * and it is closed (status=paid) only when a cashier-verified payment is recorded against it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('upi_payment_requests', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->foreignId('order_id')->constrained('orders')->cascadeOnDelete();
            $table->string('reference', 40)->unique();
            $table->string('vpa', 256);
            $table->string('payee_name', 100);
            $table->decimal('amount', 12, 2);
            $table->text('upi_uri');
            $table->string('status', 20)->default('pending'); // pending | paid | superseded | cancelled
            $table->foreignId('payment_id')->nullable()->unique()->constrained('payments')->nullOnDelete();
            $table->foreignId('created_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['order_id', 'status']);
        });

        // A bank reference (UTR) can settle only one UPI payment: blocks duplicate/replayed confirmations even
        // under concurrent requests. Partial index, supported by both PostgreSQL and SQLite.
        DB::statement("CREATE UNIQUE INDEX payments_upi_reference_unique ON payments (transaction_reference) WHERE payment_method = 'upi_qr' AND transaction_reference IS NOT NULL");
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS payments_upi_reference_unique');
        Schema::dropIfExists('upi_payment_requests');
    }
};
