<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payment_allocations', function (Blueprint $table) {
            $table->id();
            // Restrict deletion to protect financial audit trail and ledger integrity
            $table->foreignId('payment_id')->constrained('payments')->restrictOnDelete();
            $table->foreignId('order_id')->constrained('orders')->restrictOnDelete();
            $table->foreignId('order_split_id')->nullable()->constrained('order_splits')->restrictOnDelete();
            $table->decimal('amount', 12, 2);
            $table->foreignId('allocated_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index(['order_id', 'order_split_id']);
            $table->index('payment_id');
        });

        $driver = Schema::getConnection()->getDriverName();
        if ($driver === 'sqlite') {
            // Partial unique indexes prevent duplicate allocations per payment
            DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_alloc_split ON payment_allocations (payment_id, order_split_id) WHERE order_split_id IS NOT NULL');
            DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_alloc_order ON payment_allocations (payment_id) WHERE order_split_id IS NULL');

            // Enforce amount > 0 at SQLite engine level
            DB::statement("
                CREATE TRIGGER IF NOT EXISTS chk_payment_alloc_amount_insert BEFORE INSERT ON payment_allocations
                FOR EACH ROW WHEN NEW.amount <= 0
                BEGIN
                    SELECT RAISE(ABORT, 'CHECK constraint failed: amount > 0');
                END;
            ");
            DB::statement("
                CREATE TRIGGER IF NOT EXISTS chk_payment_alloc_amount_update BEFORE UPDATE ON payment_allocations
                FOR EACH ROW WHEN NEW.amount <= 0
                BEGIN
                    SELECT RAISE(ABORT, 'CHECK constraint failed: amount > 0');
                END;
            ");
        } elseif ($driver === 'pgsql') {
            DB::statement('ALTER TABLE payment_allocations ADD CONSTRAINT chk_payment_alloc_amount CHECK (amount > 0)');
            DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_alloc_split ON payment_allocations (payment_id, order_split_id) WHERE order_split_id IS NOT NULL');
            DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_alloc_order ON payment_allocations (payment_id) WHERE order_split_id IS NULL');
        } else {
            DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_alloc_split ON payment_allocations (payment_id, order_split_id) WHERE order_split_id IS NOT NULL');
            DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_alloc_order ON payment_allocations (payment_id) WHERE order_split_id IS NULL');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_allocations');
    }
};
