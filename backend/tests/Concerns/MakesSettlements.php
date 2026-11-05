<?php

namespace Tests\Concerns;

use App\Models\DailyClosing;
use App\Models\MenuItem;
use App\Models\Stall;
use App\Models\StallOwner;
use App\Models\StallSettlementRecord;
use App\Models\User;
use App\Services\PayoutService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Builds isolated settlement fixtures (own stalls, owners, closings) so payout tests never depend on or disturb seeded data. */
trait MakesSettlements
{
    private static int $dateCursor = 0;

    protected function owner(): User
    {
        return User::where('role', 'owner')->where('is_active', true)->first()
            ?? User::create([
                'name' => 'Test Owner',
                'email' => 'owner.' . Str::random(6) . '@test.com',
                'password' => bcrypt('password'),
                'role' => 'owner',
                'is_active' => true,
            ]);
    }

    /** A business date nobody else uses: far in the future, one new day per call. */
    protected function freshDate(): string
    {
        $base = Carbon::create(2041, 1, 1)->addDays(random_int(0, 40000) + (self::$dateCursor++));
        while (DailyClosing::where('closing_date', $base->toDateString())->exists()) {
            $base->addDay();
        }

        return $base->toDateString();
    }

    protected function makeOwner(string $name = 'Rajesh Patil'): StallOwner
    {
        return StallOwner::create(['name' => $name . ' ' . Str::random(4), 'phone' => '9800000000']);
    }

    protected function makeStall(string $name = 'Pizza Corner', ?StallOwner $owner = null): Stall
    {
        return Stall::create([
            'name' => $name . ' ' . Str::random(4),
            'code' => 'T' . strtoupper(Str::random(8)),
            'is_active' => true,
            'stall_owner_id' => $owner?->id,
        ]);
    }

    protected function makeClosing(string $date): DailyClosing
    {
        return DailyClosing::firstOrCreate(['closing_date' => $date], [
            'closed_by_user_id' => $this->owner()->id,
            'total_net_sales' => 0,
            'status' => 'closed',
        ]);
    }

    /** A settlement exactly as day closing creates it: payable = gross, nothing paid yet. */
    protected function makeSettlement(string $date, string $gross, ?Stall $stall = null, ?StallOwner $owner = null): StallSettlementRecord
    {
        $stall ??= $this->makeStall('Pizza Corner', $owner);
        $closing = $this->makeClosing($date);

        return StallSettlementRecord::create([
            'closing_id' => $closing->id,
            'stall_id' => $stall->id,
            'stall_gross_sales' => $gross,
            'stall_item_count' => 10,
            'settlement_amount' => 0,
            'settlement_status' => 'calculated',
            'payable_at_close' => $gross,
            'adjustment_amount' => 0,
            'net_payable' => $gross,
            'paid_amount' => 0,
            'remaining_amount' => $gross,
            'payout_status' => PayoutService::deriveStatus(PayoutService::money($gross), '0.00'),
        ]);
    }

    /** POST a payout through the real endpoint. */
    protected function pay(StallSettlementRecord $s, string $amount, string $method = 'cash', ?string $reference = null, ?string $key = null, array $extra = [])
    {
        return $this->actingAs($this->owner(), 'sanctum')->postJson("/api/settlements/{$s->id}/payouts", [
            'amount' => $amount,
            'payment_method' => $method,
            'transaction_reference' => $reference,
            'idempotency_key' => $key ?? 'test-' . Str::uuid(),
            'received_by' => 'Test Receiver',
        ] + $extra);
    }

    /** Insert a paid order with one line for $stall at $date, bypassing the ordering API (day-closing tests need exact sales). */
    protected function insertPaidSale(Stall $stall, string $date, string $amount): void
    {
        $orderId = DB::table('orders')->insertGetId([
            'uuid' => (string) Str::uuid(),
            'order_number' => 'T-' . strtoupper(Str::random(10)),
            'order_type' => 'takeaway',
            'order_channel' => 'cashier_pos',
            'status' => 'completed',
            'subtotal' => $amount,
            'tax_amount' => 0,
            'discount_amount' => 0,
            'total_amount' => $amount,
            'payment_status' => 'paid',
            'created_at' => $date . ' 12:00:00',
            'updated_at' => $date . ' 12:00:00',
        ]);
        $catId = DB::table('menu_categories')->value('id') ?? DB::table('menu_categories')->insertGetId([
            'stall_id' => $stall->id,
            'name' => 'Main Category',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $menuItemId = MenuItem::query()->value('id') ?? DB::table('menu_items')->insertGetId([
            'uuid' => (string) Str::uuid(),
            'stall_id' => $stall->id,
            'category_id' => $catId,
            'name' => 'Test dish',
            'price' => $amount,
            'is_available' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('order_items')->insert([
            'order_id' => $orderId,
            'stall_id' => $stall->id,
            'menu_item_id' => $menuItemId,
            'item_name' => 'Test dish',
            'unit_price' => $amount,
            'quantity' => 1,
            'subtotal' => $amount,
            'status' => 'served',
            'created_at' => $date . ' 12:00:00',
            'updated_at' => $date . ' 12:00:00',
        ]);
    }
}
