<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('daily_closings', function (Blueprint $table) {
            $table->id();
            $table->date('closing_date')->unique();
            $table->foreignId('closed_by_user_id')->constrained('users')->cascadeOnDelete();
            $table->integer('total_orders_count')->default(0);
            $table->decimal('total_gross_sales', 12, 2)->default(0);
            $table->decimal('total_discounts', 12, 2)->default(0);
            $table->decimal('total_net_sales', 12, 2)->default(0);
            $table->decimal('total_cash_collected', 12, 2)->default(0);
            $table->decimal('total_digital_collected', 12, 2)->default(0);
            $table->string('status')->default('closed'); // open, closed
            $table->text('notes')->nullable();
            $table->timestamps();
        });

        Schema::create('stall_settlement_records', function (Blueprint $table) {
            $table->id();
            $table->foreignId('closing_id')->constrained('daily_closings')->cascadeOnDelete();
            $table->foreignId('stall_id')->constrained('stalls')->cascadeOnDelete();
            $table->decimal('stall_gross_sales', 12, 2)->default(0);
            $table->integer('stall_item_count')->default(0);
            $table->decimal('settlement_amount', 12, 2)->default(0);
            $table->string('settlement_status')->default('calculated'); // calculated, approved, paid
            $table->string('paid_to_representative')->nullable();
            $table->timestamp('paid_at')->nullable();
            $table->string('payment_method')->nullable(); // cash, bank_transfer, upi
            $table->text('notes')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stall_settlement_records');
        Schema::dropIfExists('daily_closings');
    }
};

