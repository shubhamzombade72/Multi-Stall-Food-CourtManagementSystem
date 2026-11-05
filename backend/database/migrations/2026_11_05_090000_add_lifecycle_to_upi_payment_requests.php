<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * UPI request lifecycle (additive, backward compatible).
 *
 * A UPI request is only a payment REQUEST. These columns record what a human did with it:
 *   pending -> initiated -> paid (manually verified by a cashier) | failed | cancelled | superseded ; paid -> refunded (reserved)
 * `status` is already a free-form string(20), so the new states need no change to it.
 *
 * Every request that was already `paid` was confirmed by a cashier ticking "I verified the payment" (there has never been
 * a gateway), so they are backfilled as verification_method = 'manual' using the payment's own cashier and time.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('upi_payment_requests', function (Blueprint $table) {
            $table->timestamp('initiated_at')->nullable();
            $table->unsignedBigInteger('initiated_by_user_id')->nullable();
            $table->timestamp('closed_at')->nullable();
            $table->string('closed_reason', 255)->nullable();
            $table->unsignedBigInteger('verified_by_user_id')->nullable();
            $table->timestamp('verified_at')->nullable();
            $table->string('verification_method', 20)->nullable(); // manual (cashier) - 'gateway' is reserved for a future provider integration
        });

        $rows = DB::table('upi_payment_requests as r')
            ->join('payments as p', 'p.id', '=', 'r.payment_id')
            ->where('r.status', 'paid')
            ->select('r.id', 'p.cashier_id', 'p.created_at')
            ->get();
        foreach ($rows as $row) {
            DB::table('upi_payment_requests')->where('id', $row->id)->update([
                'verification_method' => 'manual',
                'verified_by_user_id' => $row->cashier_id,
                'verified_at' => $row->created_at,
            ]);
        }
    }

    public function down(): void
    {
        Schema::table('upi_payment_requests', function (Blueprint $table) {
            $table->dropColumn(['initiated_at', 'initiated_by_user_id', 'closed_at', 'closed_reason', 'verified_by_user_id', 'verified_at', 'verification_method']);
        });
    }
};
