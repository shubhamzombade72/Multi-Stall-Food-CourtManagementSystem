<?php

namespace Tests\Feature;

use App\Models\DailyClosing;
use App\Models\Stall;
use App\Models\User;
use Tests\TestCase;

class SettlementTest extends TestCase
{
    public function test_owner_can_view_daily_summary_and_close_day(): void
    {
        $owner = User::where('role', 'owner')->first() ?? User::create([
            'name' => 'Food Court Owner',
            'email' => 'owner@foodcourt.com',
            'password' => bcrypt('password'),
            'role' => 'owner',
            'is_active' => true,
        ]);
        $this->assertNotNull($owner);

        // 1. View daily summary
        $summaryResponse = $this->actingAs($owner)
            ->getJson('/api/settlements/daily-summary');

        $summaryResponse->assertStatus(200);
        $summaryResponse->assertJsonPath('success', true);
        $this->assertArrayHasKey('summary', $summaryResponse->json('data'));

        // 2. Perform daily closing
        $closeDate = now()->addDays(rand(20, 500))->toDateString(); // use unique date for test idempotency
        DailyClosing::where('closing_date', $closeDate)->delete();

        $closingResponse = $this->actingAs($owner)
            ->postJson('/api/settlements/close-day', [
                'date' => $closeDate,
                'notes' => 'Test EOD closing note',
            ]);

        $closingResponse->assertStatus(201);
        $closingResponse->assertJsonPath('success', true);

        $closingId = $closingResponse->json('data.id');
        $closing = DailyClosing::with('settlements')->find($closingId);

        $this->assertNotNull($closing);
        $this->assertEquals(Stall::count(), $closing->settlements->count(), "Settlement record must be created for each active stall");
    }

    public function test_owner_can_review_stall_bills_for_settlement(): void
    {
        $owner = User::where('role', 'owner')->first() ?? User::create([
            'name' => 'Food Court Owner',
            'email' => 'owner@foodcourt.com',
            'password' => bcrypt('password'),
            'role' => 'owner',
            'is_active' => true,
        ]);

        $cashier = User::where('role', 'cashier')->where('is_active', true)->first() ?? User::create([
            'name' => 'Test Cashier',
            'email' => 'cashier.test@foodcourt.com',
            'password' => bcrypt('password'),
            'role' => 'cashier',
            'is_active' => true,
        ]);

        // Cashier cannot access stall bills
        $this->actingAs($cashier)->getJson('/api/settlements/stall-bills')->assertStatus(403);

        // Owner can access stall bills
        $response = $this->actingAs($owner)->getJson('/api/settlements/stall-bills');
        $response->assertStatus(200);
        $response->assertJsonPath('success', true);
        $this->assertArrayHasKey('bills', $response->json('data'));
        $this->assertArrayHasKey('total_bills', $response->json('data'));
        $this->assertArrayHasKey('total_sales', $response->json('data'));
    }
}
