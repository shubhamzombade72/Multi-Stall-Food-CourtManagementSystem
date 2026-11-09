<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The central raw material store. These are new tables on purpose: inventory_items, suppliers and purchase_orders have
 * a required stall_id, and making it optional means rebuilding those tables on SQLite. Client updates run each migration
 * inside a transaction, where SQLite ignores "foreign_keys = off", so dropping the old table would cascade-delete its
 * stock history and purchase lines. The old per-stall tables are left exactly as they are.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('store_items', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('unit', 20);
            $table->decimal('current_stock', 12, 3)->default(0);
            $table->decimal('minimum_alert_stock', 12, 3)->default(0);
            $table->decimal('unit_cost', 12, 2)->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
            $table->unique(['name', 'unit']);
        });

        Schema::create('store_suppliers', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique();
            $table->string('contact_person', 100)->nullable();
            $table->string('phone', 20)->nullable();
            $table->string('email', 100)->nullable();
            $table->string('address', 500)->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('store_purchase_orders', function (Blueprint $table) {
            $table->id();
            $table->string('purchase_number')->unique();
            $table->foreignId('store_supplier_id')->constrained('store_suppliers')->restrictOnDelete();
            $table->foreignId('created_by_user_id')->constrained('users')->restrictOnDelete();
            // Plain date column with no Eloquent date cast, so it holds YYYY-MM-DD on both PostgreSQL and SQLite
            $table->date('order_date')->index();
            $table->decimal('total_amount', 12, 2)->default(0);
            $table->string('status', 20)->default('ordered')->index(); // ordered, received, cancelled
            $table->text('notes')->nullable();
            $table->timestamp('received_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->string('cancel_reason')->nullable();
            $table->timestamps();
        });

        Schema::create('store_purchase_order_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_purchase_order_id')->constrained('store_purchase_orders')->cascadeOnDelete();
            $table->foreignId('store_item_id')->constrained('store_items')->restrictOnDelete();
            $table->decimal('quantity', 12, 3);
            $table->decimal('unit_price', 12, 2);
            $table->decimal('total_price', 12, 2);
            $table->timestamps();
        });

        Schema::create('store_movements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_item_id')->constrained('store_items')->restrictOnDelete();
            // The stall that received or returned the goods; empty for anything that stays inside the store
            $table->foreignId('stall_id')->nullable()->constrained('stalls')->restrictOnDelete();
            $table->string('movement_type', 30); // opening_stock, purchase_inward, issue_to_stall, return_from_stall, waste_loss, stock_count
            $table->decimal('quantity', 12, 3); // signed: positive adds to the store
            $table->decimal('previous_stock', 12, 3);
            $table->decimal('new_stock', 12, 3);
            $table->decimal('unit_cost', 12, 2); // the price at that moment, so old values never change
            $table->decimal('value', 14, 2);
            // India's calendar day as text, because timestamps are UTC and date columns differ between the two engines
            $table->string('business_date', 10);
            $table->string('reference_id')->nullable();
            $table->foreignId('performed_by_user_id')->constrained('users')->restrictOnDelete();
            $table->string('reason')->nullable();
            $table->timestamps();
            $table->index(['business_date', 'movement_type']);
            $table->index(['stall_id', 'business_date']);
            $table->index(['store_item_id', 'id']);
        });

        // What the one-time move has already taken from the old per-stall tables, so it can never count anything twice
        Schema::create('store_imports', function (Blueprint $table) {
            $table->id();
            $table->string('source_type', 30); // inventory_item, supplier
            $table->unsignedBigInteger('source_id');
            $table->unsignedBigInteger('target_id');
            $table->decimal('quantity', 12, 3)->nullable();
            $table->foreignId('performed_by_user_id')->constrained('users')->restrictOnDelete();
            $table->timestamps();
            $table->unique(['source_type', 'source_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('store_imports');
        Schema::dropIfExists('store_movements');
        Schema::dropIfExists('store_purchase_order_items');
        Schema::dropIfExists('store_purchase_orders');
        Schema::dropIfExists('store_suppliers');
        Schema::dropIfExists('store_items');
    }
};
