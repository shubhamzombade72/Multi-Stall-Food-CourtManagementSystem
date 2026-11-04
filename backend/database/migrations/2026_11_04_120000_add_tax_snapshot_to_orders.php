<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Every bill keeps the GST rate and calculation mode it was priced with, so changing the GST configuration later can
 * never alter an existing bill, its receipt or the reports built from it (subtotal + tax_amount = total_amount stays true).
 *
 * Bills created before this migration were all priced with the fixed 5% exclusive rule that used to be coded in the
 * order endpoint, so those that carry tax are back-filled with exactly that: this records what really happened to them.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->decimal('tax_rate_percent', 5, 2)->default(0)->after('tax_amount');
            $table->string('tax_mode', 10)->default('none')->after('tax_rate_percent'); // exclusive | inclusive | none
        });

        DB::table('orders')->where('tax_amount', '>', 0)->update(['tax_rate_percent' => '5.00', 'tax_mode' => 'exclusive']);
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn(['tax_rate_percent', 'tax_mode']);
        });
    }
};
