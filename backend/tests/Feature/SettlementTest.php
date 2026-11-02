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
        $owner = User::where('email', 'owner@foodcourt.com')->first();
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
}
