<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** The Cashier Closing module is gone from the API; closings already recorded stay in the database. */
class CashierClosingRemovedTest extends TestCase
{
    use DatabaseTransactions;

    public function test_cashier_closing_endpoints_no_longer_exist(): void
    {
        foreach (['owner', 'cashier'] as $role) {
            $user = User::where('role', $role)->where('is_active', true)->firstOrFail();
            $this->actingAs($user, 'sanctum')->getJson('/api/cashier-closings')->assertNotFound();
            $this->actingAs($user, 'sanctum')->getJson('/api/cashier-closings/preview')->assertNotFound();
            $this->actingAs($user, 'sanctum')->postJson('/api/cashier-closings', ['date' => now()->toDateString(), 'counted_cash' => 1])->assertNotFound();
        }
    }

    public function test_closings_already_recorded_are_kept(): void
    {
        $cashier = User::where('role', 'cashier')->where('is_active', true)->firstOrFail();
        $id = DB::table('cashier_closings')->insertGetId([
            'cashier_id' => $cashier->id,
            'business_date' => '2096-01-15',
            'closed_by_user_id' => $cashier->id,
            'expected_cash' => '100.00',
            'counted_cash' => '100.00',
            'variance' => '0.00',
            'non_cash_total' => '0.00',
            'payments_count' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->assertDatabaseHas('cashier_closings', ['id' => $id, 'counted_cash' => '100.00']);
    }
}
