<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payments', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->string('payment_number')->unique();
            $table->foreignId('order_id')->constrained('orders')->cascadeOnDelete();
            $table->foreignId('cashier_id')->constrained('users')->cascadeOnDelete();
            $table->string('payment_method'); // cash, upi_qr, card, split
            $table->decimal('amount', 12, 2);
            $table->decimal('cash_tendered', 12, 2)->nullable();
            $table->decimal('change_returned', 12, 2)->nullable();
            $table->string('transaction_reference')->nullable();
            $table->string('status')->default('success'); // success, failed, refunded
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payments');
    }
};

