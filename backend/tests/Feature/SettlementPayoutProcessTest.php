<?php

namespace Tests\Feature;

use App\Models\DailyClosing;
use App\Models\Stall;
use App\Models\StallSettlementRecord;
use Illuminate\Support\Facades\DB;
use Tests\Concerns\MakesSettlements;
use Tests\TestCase;

/**
 * Process-level payout scenarios that an in-process test cannot prove: genuinely concurrent requests (separate PHP
 * processes, separate database connections, one barrier) and a cold restart of the application.
 *
 * These tests COMMIT their data (the workers must see it), so they use their own stalls and far-future dates and delete
 * every row they created in tearDown.
 */
class SettlementPayoutProcessTest extends TestCase
{
    use MakesSettlements;

    /** @var int[] */
    private array $stallIds = [];

    protected function tearDown(): void
    {
        if ($this->stallIds) {
            $recordIds = StallSettlementRecord::whereIn('stall_id', $this->stallIds)->pluck('id');
            $closingIds = StallSettlementRecord::whereIn('stall_id', $this->stallIds)->pluck('closing_id')->unique();
            DB::table('settlement_payout_audits')->whereIn('settlement_id', $recordIds)->delete();
            DB::table('settlement_payouts')->whereIn('settlement_id', $recordIds)->where('entry_type', 'reversal')->delete();
            DB::table('settlement_payouts')->whereIn('settlement_id', $recordIds)->delete();
            DB::table('consolidated_payouts')->whereNotExists(fn ($q) => $q->select(DB::raw(1))->from('settlement_payouts')->whereColumn('settlement_payouts.consolidated_payout_id', 'consolidated_payouts.id'))->delete();
            DB::table('stall_settlement_records')->whereIn('id', $recordIds)->delete();
            DB::table('daily_closings')->whereIn('id', $closingIds)->delete();
            DB::table('stalls')->whereIn('id', $this->stallIds)->delete();
        }
        parent::tearDown();
    }

    private function committedSettlement(string $gross): StallSettlementRecord
    {
        $stall = $this->makeStall('Proc');
        $this->stallIds[] = $stall->id;

        return $this->makeSettlement($this->freshDate(), $gross, $stall);
    }

    /**
     * Launch one worker per job at the same instant and collect their JSON results.
     *
     * @param  array<int, array>  $jobs
     * @return array<int, array>
     */
    private function runWorkers(array $jobs): array
    {
        $script = base_path('tests/Support/payout_worker.php');
        $startAt = microtime(true) + 2.5;   // enough for every process to boot before the barrier drops
        $env = array_merge(getenv(), ['APP_ENV' => 'testing']);
        $running = [];

        foreach ($jobs as $i => $job) {
            $job['start_at'] = $startAt;
            $proc = proc_open([PHP_BINARY, $script, json_encode($job)], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, base_path(), $env);
            $this->assertIsResource($proc);
            $running[$i] = [$proc, $pipes];
        }

        $results = [];
        foreach ($running as $i => [$proc, $pipes]) {
            $out = stream_get_contents($pipes[1]);
            $err = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            proc_close($proc);
            $decoded = json_decode($out, true);
            $this->assertIsArray($decoded, "worker {$i} produced no JSON. stdout: {$out} stderr: {$err}");
            $results[$i] = $decoded;
        }

        return $results;
    }

    private function payJob(StallSettlementRecord $s, string $amount, string $key): array
    {
        return ['mode' => 'pay', 'user_id' => $this->owner()->id, 'settlement_id' => $s->id, 'amount' => $amount, 'key' => $key];
    }

    // ---- 12: concurrency ----------------------------------------------------------------------------------------------

    public function test_12a_concurrent_requests_that_together_overpay_let_exactly_one_through(): void
    {
        $s = $this->committedSettlement('5000.00');
        $run = uniqid('c12a-', true);

        // Six processes each try to pay 3000 against a 5000 payable at the same instant
        $results = $this->runWorkers(array_map(fn ($i) => $this->payJob($s, '3000.00', "{$run}-{$i}"), range(1, 6)));

        $ok = array_filter($results, fn ($r) => $r['ok']);
        $refused = array_filter($results, fn ($r) => !$r['ok']);
        $this->assertCount(1, $ok, json_encode($results));
        $this->assertCount(5, $refused);
        foreach ($refused as $r) {
            $this->assertSame(422, $r['status']);
            $this->assertStringContainsString('exceeds the outstanding balance', $r['message']);
        }

        $s->refresh();
        $this->assertSame('3000.00', $s->paid_amount);
        $this->assertSame('2000.00', $s->remaining_amount);
        $this->assertSame(1, DB::table('settlement_payouts')->where('settlement_id', $s->id)->count());
    }

    public function test_12b_concurrent_requests_that_exactly_fill_the_balance_never_overshoot(): void
    {
        $s = $this->committedSettlement('5000.00');
        $run = uniqid('c12b-', true);

        // Eleven processes each try to pay 500: exactly ten fit
        $results = $this->runWorkers(array_map(fn ($i) => $this->payJob($s, '500.00', "{$run}-{$i}"), range(1, 11)));

        $this->assertCount(10, array_filter($results, fn ($r) => $r['ok']), json_encode($results));
        $this->assertCount(1, array_filter($results, fn ($r) => !$r['ok']));

        $s->refresh();
        $this->assertSame('paid', $s->payout_status);
        $this->assertSame('5000.00', $s->paid_amount);
        $this->assertSame('0.00', $s->remaining_amount);
        $this->assertSame(10, DB::table('settlement_payouts')->where('settlement_id', $s->id)->count());
        $this->assertSame(10, DB::table('settlement_payouts')->where('settlement_id', $s->id)->distinct()->count('payout_number'));
    }

    public function test_12c_concurrent_duplicates_of_the_same_request_create_exactly_one_payout(): void
    {
        $s = $this->committedSettlement('5000.00');
        $key = uniqid('c12c-', true);

        $results = $this->runWorkers(array_map(fn () => $this->payJob($s, '2000.00', $key), range(1, 6)));

        $this->assertCount(6, array_filter($results, fn ($r) => $r['ok']), json_encode($results));
        $this->assertCount(1, array_filter($results, fn ($r) => !$r['duplicate']), 'only one request actually created the payout');
        $this->assertCount(1, array_unique(array_column($results, 'payout_id')));
        $this->assertSame(1, DB::table('settlement_payouts')->where('settlement_id', $s->id)->count());
        $this->assertSame('2000.00', $s->fresh()->paid_amount);
    }

    // ---- 15: restart --------------------------------------------------------------------------------------------------

    public function test_15_payout_history_survives_an_application_restart(): void
    {
        $s = $this->committedSettlement('5000.00');
        $owner = $this->owner();

        $this->actingAs($owner, 'sanctum')->postJson("/api/settlements/{$s->id}/payouts", ['amount' => '2000.00', 'payment_method' => 'cash', 'idempotency_key' => 'restart-key-0001'])->assertStatus(201);
        $this->actingAs($owner, 'sanctum')->postJson("/api/settlements/{$s->id}/payouts", ['amount' => '1500.00', 'payment_method' => 'upi', 'transaction_reference' => 'UPI-RESTART', 'idempotency_key' => 'restart-key-0002'])->assertStatus(201);
        $beforeDetail = $this->actingAs($owner, 'sanctum')->getJson("/api/settlements/{$s->id}/payouts")->json('data');

        // "Restart": drop every connection and application instance in this process, then read from a brand-new PHP process
        DB::disconnect();
        $this->refreshApplication();

        $after = $this->runWorkers([[
            'mode' => 'history', 'user_id' => $owner->id, 'settlement_id' => $s->id, 'stall_id' => $s->stall_id,
            'date' => DailyClosing::find($s->closing_id)->closing_date->toDateString(),
        ]])[0];

        $rows = $after['history']['data']['data'];
        $this->assertCount(2, $rows);
        $this->assertEqualsCanonicalizing(['2000.00', '1500.00'], array_column($rows, 'amount'));
        $this->assertContains('UPI-RESTART', array_column($rows, 'transaction_reference'));
        $this->assertSame('3500.00', $after['history']['totals']['completed_paid']);
        $this->assertSame('partially_paid', $after['detail']['data']['settlement']['payout_status']);
        $this->assertSame('1500.00', $after['detail']['data']['settlement']['remaining_amount']);
        $this->assertSame(
            array_column($beforeDetail['settlement']['payouts'], 'payout_number'),
            array_column($after['detail']['data']['settlement']['payouts'], 'payout_number'),
            'payout numbers are stable across a restart'
        );
        $this->assertCount(count($beforeDetail['audit']), $after['detail']['data']['audit']);
        $this->assertTrue($after['reconciliation']['data']['ok'], json_encode($after['reconciliation']));
    }
}
