<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Additive only: three new tables, no change to existing ones.
 *  - settings: food court profile, receipt text, enabled payment methods (key -> JSON value)
 *  - customers: customer directory; order history is matched on orders.customer_phone
 *  - cashier_closings: a cashier's end-of-day cash count against the cash payments they took
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('settings', function (Blueprint $table) {
            $table->id();
            $table->string('key', 64)->unique();
            $table->jsonb('value');
            $table->foreignId('updated_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('customers', function (Blueprint $table) {
            $table->id();
            $table->string('name', 100);
            $table->string('phone', 20)->unique();
            $table->string('email', 100)->nullable();
            $table->text('notes')->nullable();
            $table->foreignId('created_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index('name');
        });

        Schema::create('cashier_closings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('cashier_id')->constrained('users')->cascadeOnDelete();
            $table->date('business_date');
            $table->unsignedInteger('payments_count')->default(0);
            $table->decimal('expected_cash', 12, 2)->default(0);
            $table->decimal('counted_cash', 12, 2);
            $table->decimal('variance', 12, 2);
            $table->decimal('non_cash_total', 12, 2)->default(0);
            $table->text('notes')->nullable();
            $table->foreignId('closed_by_user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['cashier_id', 'business_date'], 'cashier_closing_unique');
            $table->index('business_date');
        });

        // Order history lookups for the customer directory
        Schema::table('orders', function (Blueprint $table) {
            $table->index('customer_phone', 'orders_customer_phone_index');
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropIndex('orders_customer_phone_index');
        });
        Schema::dropIfExists('cashier_closings');
        Schema::dropIfExists('customers');
        Schema::dropIfExists('settings');
    }
};
