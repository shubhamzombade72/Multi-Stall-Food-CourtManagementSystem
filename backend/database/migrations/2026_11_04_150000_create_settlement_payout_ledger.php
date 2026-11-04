<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Settlement payout ledger.
 *
 * A calculated payable is NOT a payment. Money counts as paid only when an authorised user confirms a payout, and every
 * confirmation is a permanent row in settlement_payouts. Rows are never deleted or edited in place: a correction is a
 * reversal row that points at the original. Payout totals on stall_settlement_records are a cache that is always
 * recomputed from the ledger under a row lock.
 *
 * Portable across SQLite (single-PC desktop) and PostgreSQL (shared host): no enums, no partial indexes, no DB triggers.
 */
return new class extends Migration
{
    public function up(): void
    {
        // SQLite (the single-PC desktop database) stored closing dates as "2026-11-02 00:00:00", so a lookup by the plain
        // date "2026-11-02" never found the closing: the day looked open after closing. Store plain dates from now on
        // (DailyClosing casts date:Y-m-d) and normalise the rows written by earlier versions.
        if (DB::getDriverName() === 'sqlite') {
            DB::statement('UPDATE daily_closings SET closing_date = substr(closing_date, 1, 10) WHERE length(closing_date) > 10');
        }

        // Who a stall's money is owed to. One person can own many stalls (owner-wise consolidated payouts).
        Schema::create('stall_owners', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('phone', 20)->nullable();
            $table->string('upi_id', 100)->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::table('stalls', function (Blueprint $table) {
            $table->foreignId('stall_owner_id')->nullable()->after('contact_phone')->constrained('stall_owners')->nullOnDelete();
        });

        // Settlement register: payable snapshot + cached payout totals
        Schema::table('stall_settlement_records', function (Blueprint $table) {
            $table->decimal('payable_at_close', 12, 2)->default(0);   // immutable snapshot taken at day closing
            $table->decimal('adjustment_amount', 12, 2)->default(0);  // signed, audited adjustments after closing
            $table->decimal('net_payable', 12, 2)->default(0);        // stall_gross_sales + adjustment_amount
            $table->decimal('paid_amount', 12, 2)->default(0);        // cache: sum of completed, non-reversed payouts
            $table->decimal('remaining_amount', 12, 2)->default(0);   // cache: net_payable - paid_amount
            $table->string('payout_status', 20)->default('pending');  // pending | partially_paid | paid | nothing_due | negative_balance
            $table->timestamp('last_payout_at')->nullable();
            $table->index(['payout_status']);
        });

        Schema::create('consolidated_payouts', function (Blueprint $table) {
            $table->id();
            $table->string('consolidated_number', 24)->nullable()->unique(); // CPAY-000001
            $table->foreignId('stall_owner_id')->constrained('stall_owners')->restrictOnDelete();
            $table->decimal('total_amount', 12, 2);
            $table->string('payment_method', 20);
            $table->string('transaction_reference', 100)->nullable();
            $table->timestamp('paid_at');
            $table->foreignId('paid_by_user_id')->constrained('users')->restrictOnDelete();
            $table->string('received_by', 100)->nullable();
            $table->text('notes')->nullable();
            $table->string('status', 20)->default('completed'); // completed | reversed
            $table->timestamp('reversed_at')->nullable();
            $table->string('idempotency_key', 100)->unique();
            $table->timestamps();
        });

        Schema::create('settlement_payouts', function (Blueprint $table) {
            $table->id();
            $table->string('payout_number', 24)->nullable()->unique(); // PAY-000125, assigned from the id inside the same transaction
            $table->string('entry_type', 10)->default('payment');       // payment | reversal
            $table->string('status', 12)->default('completed');         // completed | failed | reversed
            $table->foreignId('settlement_id')->constrained('stall_settlement_records')->restrictOnDelete();
            $table->foreignId('consolidated_payout_id')->nullable()->constrained('consolidated_payouts')->restrictOnDelete();
            $table->date('business_date');
            $table->foreignId('stall_id')->constrained('stalls')->restrictOnDelete();
            $table->foreignId('stall_owner_id')->nullable()->constrained('stall_owners')->nullOnDelete();
            $table->decimal('payable_at_time', 12, 2);   // net payable of the settlement when this row was written
            $table->decimal('amount', 12, 2);            // always positive; entry_type says which direction
            $table->decimal('balance_after', 12, 2);     // outstanding balance of the settlement after this row
            $table->string('payment_method', 20);        // cash | upi | bank_transfer | other
            $table->string('transaction_reference', 100)->nullable();
            $table->timestamp('paid_at');
            $table->foreignId('paid_by_user_id')->constrained('users')->restrictOnDelete();
            $table->string('received_by', 100)->nullable();
            $table->text('notes')->nullable();
            $table->string('failure_reason')->nullable();
            $table->foreignId('reverses_payout_id')->nullable()->constrained('settlement_payouts')->restrictOnDelete();
            $table->string('reversal_reason')->nullable();
            $table->timestamp('reversed_at')->nullable();
            $table->string('idempotency_key', 120)->nullable()->unique();
            $table->timestamps();

            $table->index(['settlement_id', 'entry_type', 'status']);
            $table->index(['business_date']);
            $table->index(['stall_id']);
            $table->index(['stall_owner_id']);
            $table->index(['payment_method']);
        });

        Schema::create('settlement_payout_audits', function (Blueprint $table) {
            $table->id();
            $table->foreignId('settlement_id')->constrained('stall_settlement_records')->restrictOnDelete();
            $table->foreignId('payout_id')->nullable()->constrained('settlement_payouts')->restrictOnDelete();
            $table->foreignId('consolidated_payout_id')->nullable()->constrained('consolidated_payouts')->restrictOnDelete();
            $table->string('action', 40); // payout_recorded | payout_failed | payout_reversed | adjustment | consolidated_*
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->text('details')->nullable(); // JSON
            $table->timestamp('created_at')->useCurrent();

            $table->index(['payout_id']);
            $table->index(['settlement_id']);
        });

        $this->backfillExistingSettlements();
    }

    /**
     * Settlements that exist before this migration: payable = the gross sales that were recorded. A settlement the owner had
     * already marked paid becomes one legacy payout row; if the amount handed over differed from the gross, the difference is
     * a labelled legacy adjustment so that a PAID settlement always equals its payouts exactly.
     */
    private function backfillExistingSettlements(): void
    {
        $rows = DB::table('stall_settlement_records')
            ->join('daily_closings', 'daily_closings.id', '=', 'stall_settlement_records.closing_id')
            ->select('stall_settlement_records.*', 'daily_closings.closing_date', 'daily_closings.closed_by_user_id')
            ->orderBy('stall_settlement_records.id')
            ->get();

        foreach ($rows as $r) {
            $gross = number_format((float) $r->stall_gross_sales, 2, '.', '');
            $wasPaid = $r->settlement_status === 'paid';
            $paid = $wasPaid ? number_format((float) $r->settlement_amount, 2, '.', '') : '0.00';
            $adjustment = $wasPaid ? number_format((float) $paid - (float) $gross, 2, '.', '') : '0.00';
            $net = $wasPaid ? $paid : $gross;

            $status = $wasPaid
                ? ((float) $net > 0 ? 'paid' : 'nothing_due')
                : ((float) $net > 0 ? 'pending' : 'nothing_due');

            DB::table('stall_settlement_records')->where('id', $r->id)->update([
                'payable_at_close' => $gross,
                'adjustment_amount' => $adjustment,
                'net_payable' => $net,
                'paid_amount' => $paid,
                'remaining_amount' => number_format((float) $net - (float) $paid, 2, '.', ''),
                'payout_status' => $status,
                'last_payout_at' => $wasPaid ? $r->paid_at : null,
            ]);

            if ($wasPaid && (float) $paid > 0) {
                $id = DB::table('settlement_payouts')->insertGetId([
                    'entry_type' => 'payment',
                    'status' => 'completed',
                    'settlement_id' => $r->id,
                    'business_date' => substr((string) $r->closing_date, 0, 10),
                    'stall_id' => $r->stall_id,
                    'payable_at_time' => $net,
                    'amount' => $paid,
                    'balance_after' => '0.00',
                    'payment_method' => in_array($r->payment_method, ['cash', 'upi', 'bank_transfer'], true) ? $r->payment_method : 'other',
                    'paid_at' => $r->paid_at ?? now(),
                    'paid_by_user_id' => $r->closed_by_user_id,
                    'received_by' => $r->paid_to_representative,
                    'notes' => trim('Migrated from the pre-ledger settlement record. ' . ($r->notes ?? '')),
                    'idempotency_key' => 'legacy-settlement-' . $r->id,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
                DB::table('settlement_payouts')->where('id', $id)->update(['payout_number' => 'PAY-' . str_pad((string) $id, 6, '0', STR_PAD_LEFT)]);
                DB::table('settlement_payout_audits')->insert([
                    'settlement_id' => $r->id,
                    'payout_id' => $id,
                    'action' => 'payout_recorded',
                    'user_id' => $r->closed_by_user_id,
                    'details' => json_encode(['legacy_migration' => true, 'amount' => $paid]),
                    'created_at' => now(),
                ]);
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('settlement_payout_audits');
        Schema::dropIfExists('settlement_payouts');
        Schema::dropIfExists('consolidated_payouts');

        Schema::table('stall_settlement_records', function (Blueprint $table) {
            $table->dropIndex(['payout_status']);
            $table->dropColumn(['payable_at_close', 'adjustment_amount', 'net_payable', 'paid_amount', 'remaining_amount', 'payout_status', 'last_payout_at']);
        });

        Schema::table('stalls', function (Blueprint $table) {
            $table->dropConstrainedForeignId('stall_owner_id');
        });

        Schema::dropIfExists('stall_owners');
    }
};
