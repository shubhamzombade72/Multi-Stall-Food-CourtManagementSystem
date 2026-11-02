<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('role')->default('waiter'); // owner, cashier, stall_manager, kitchen_staff, waiter, store_staff
            $table->foreignId('stall_id')->nullable()->constrained('stalls')->nullOnDelete();
            $table->string('phone')->nullable();
            $table->boolean('is_active')->default(true);
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropForeign(['stall_id']);
            $table->dropColumn(['role', 'stall_id', 'phone', 'is_active']);
        });
    }
};

