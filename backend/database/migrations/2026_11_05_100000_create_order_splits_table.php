<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('order_splits', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained('orders')->cascadeOnDelete();
            $table->unsignedInteger('split_number'); // 1, 2, ...
            $table->string('split_code')->unique(); // e.g. ORD-20261105-XXXXX-S1
            $table->string('split_type'); // items, equal, custom
            $table->decimal('subtotal', 12, 2)->default(0);
            $table->decimal('tax_amount', 12, 2)->default(0);
            $table->decimal('discount_amount', 12, 2)->default(0);
            $table->decimal('total_amount', 12, 2)->default(0);
            $table->decimal('paid_amount', 12, 2)->default(0);
            $table->string('payment_status')->default('unpaid'); // unpaid, paid
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->unique(['order_id', 'split_number']);
        });

        Schema::create('order_split_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_split_id')->constrained('order_splits')->cascadeOnDelete();
            $table->foreignId('order_item_id')->constrained('order_items')->cascadeOnDelete();
            $table->string('item_name');
            $table->decimal('unit_price', 12, 2);
            $table->unsignedInteger('quantity');
            $table->decimal('subtotal', 12, 2);
            $table->timestamps();
        });

        Schema::table('payments', function (Blueprint $table) {
            $table->foreignId('order_split_id')->nullable()->after('order_id')->constrained('order_splits')->nullOnDelete();
        });

        Schema::table('upi_payment_requests', function (Blueprint $table) {
            $table->foreignId('order_split_id')->nullable()->after('order_id')->constrained('order_splits')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('upi_payment_requests', function (Blueprint $table) {
            $table->dropForeign(['order_split_id']);
            $table->dropColumn('order_split_id');
        });

        Schema::table('payments', function (Blueprint $table) {
            $table->dropForeign(['order_split_id']);
            $table->dropColumn('order_split_id');
        });

        Schema::dropIfExists('order_split_items');
        Schema::dropIfExists('order_splits');
    }
};
