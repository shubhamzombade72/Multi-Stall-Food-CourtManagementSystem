<?php

namespace Tests\Feature;

use App\Models\SettlementPayout;
use App\Models\SettlementPayoutAudit;
use App\Models\StallSettlementRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use LogicException;
use Tests\Concerns\MakesSettlements;
use Tests\TestCase;

/**
 * Settlement payout ledger: every scenario from the requirement, on isolated data (own stalls, owners and far-future
 * business dates, rolled back after each test). Process-level scenarios (concurrency, restart) live in
 * SettlementPayoutProcessTest.
 */
class SettlementPayoutTest extends TestCase
{
    use DatabaseTransactions;
    use MakesSettlements;

    // ---- 1, 7: full cash payout ---------------------------------------------------------------------------------------

    public function test_01_full_cash_payout_marks_the_settlement_paid_and_creates_a_permanent_record(): void
    {
        $s = $this->makeSettlement($this->freshDate(), '5000.00');

        $res = $this->pay($s, '5000.00', 'cash')->assertStatus(201);
        $res->assertJsonPath('success', true)->assertJsonPath('duplicate', false);

        $p = $res->json('data.payout');
        $this->assertMatchesRegularExpression('/^PAY-\d{6}$/', $p['payout_number']);
        $this->assertSame('5000.00', $p['amount']);
        $this->assertSame('5000.00', $p['payable_at_time']);
        $this->assertSame('0.00', $p['balance_after']);
        $this->assertSame('cash', $p['payment_method']);
        $this->assertSame($this->owner()->id, $p['paid_by_user_id']);

        $s->refresh();
        $this->assertSame('paid', $s->payout_status);
        $this->assertSame('5000.00', $s->paid_amount);
        $this->assertSame('0.00', $s->remaining_amount);
        $this->assertSame('paid', $s->settlement_status);          // legacy column in step
        $this->assertSame('5000.00', $s->settlement_amount);

        $this->assertDatabaseHas('settlement_payout_audits', ['settlement_id' => $s->id, 'payout_id' => $p['id'], 'action' => 'payout_recorded']);
    }

    // ---- 2: partial ---------------------------------------------------------------------------------------------------

    public function test_02_partial_payout_leaves_the_balance_pending(): void
    {
        $s = $this->makeSettlement($this->freshDate(), '5000.00');

        $this->pay($s, '3000.00')->assertStatus(201)->assertJsonPath('data.payout.balance_after', '2000.00');

        $s->refresh();
        $this->assertSame('partially_paid', $s->payout_status);
        $this->assertSame('3000.00', $s->paid_amount);
        $this->assertSame('2000.00', $s->remaining_amount);
        $this->assertSame('calculated', $s->settlement_status, 'a partial payment must not look like a completed settlement');
    }

    // ---- 3, 8, 9: three payouts by three methods ----------------------------------------------------------------------

    public function test_03_three_separate_transactions_cash_upi_bank_complete_the_settlement(): void
    {
        $s = $this->makeSettlement($this->freshDate(), '5000.00');

        $this->pay($s, '2000.00', 'cash')->assertStatus(201);
        $this->assertSame(['partially_paid', '2000.00', '3000.00'], $this->figures($s));

        $this->pay($s, '2000.00', 'upi', 'UPI123456789')->assertStatus(201)->assertJsonPath('data.payout.transaction_reference', 'UPI123456789');
        $this->assertSame(['partially_paid', '4000.00', '1000.00'], $this->figures($s));

        $this->pay($s, '1000.00', 'bank_transfer', 'NEFT-998877')->assertStatus(201)->assertJsonPath('data.payout.balance_after', '0.00');
        $this->assertSame(['paid', '5000.00', '0.00'], $this->figures($s));

        $rows = SettlementPayout::where('settlement_id', $s->id)->orderBy('id')->get();
        $this->assertSame(['cash', 'upi', 'bank_transfer'], $rows->pluck('payment_method')->all());
        $this->assertSame('5000.00', number_format((float) $rows->sum('amount'), 2, '.', ''));
        $this->assertCount(3, $rows->pluck('payout_number')->unique());
    }

    public function test_08_09_upi_and_bank_transfer_require_a_transaction_reference_but_cash_and_other_do_not(): void
    {
        $s = $this->makeSettlement($this->freshDate(), '5000.00');

        $this->pay($s, '100.00', 'upi')->assertStatus(422)->assertJsonPath('success', false);
        $this->pay($s, '100.00', 'bank_transfer', '   ')->assertStatus(422);
        $this->pay($s, '100.00', 'cash')->assertStatus(201);
        $this->pay($s, '100.00', 'other')->assertStatus(201);
        $this->pay($s, '100.00', 'cheque')->assertStatus(422);   // unsupported method
        $this->assertSame(2, SettlementPayout::where('settlement_id', $s->id)->count());
    }

    // ---- 4: one stall paid, another unpaid + the day-closing screen figures -------------------------------------------

    public function test_04_one_stall_paid_another_partial_another_pending_and_the_summary_separates_the_four_numbers(): void
    {
        $date = $this->freshDate();
        $pizza = $this->makeStall('Pizza Corner');
        $misal = $this->makeStall('Misal House');
        $biryani = $this->makeStall('Biryani Point');
        $s1 = $this->makeSettlement($date, '5000.00', $pizza);
        $s2 = $this->makeSettlement($date, '8000.00', $misal);
        $s3 = $this->makeSettlement($date, '6000.00', $biryani);
        foreach ([[$pizza, '5000.00'], [$misal, '8000.00'], [$biryani, '6000.00']] as [$stall, $amt]) {
            $this->insertPaidSale($stall, $date, $amt);
        }

        $this->pay($s1, '5000.00')->assertStatus(201);
        $this->pay($s2, '3000.00')->assertStatus(201);

        $this->assertSame('paid', $s1->fresh()->payout_status);
        $this->assertSame('partially_paid', $s2->fresh()->payout_status);
        $this->assertSame('5000.00', $s2->fresh()->remaining_amount);
        $this->assertSame('pending', $s3->fresh()->payout_status);
        $this->assertSame('6000.00', $s3->fresh()->remaining_amount);

        $summary = $this->actingAs($this->owner(), 'sanctum')->getJson("/api/settlements/daily-summary?date={$date}")
            ->assertOk()->json('data.payout_summary');
        $this->assertSame('19000.00', $summary['sales_calculated']);
        $this->assertSame('19000.00', $summary['settlement_payable_at_close']);
        $this->assertSame('8000.00', $summary['payout_made']);
        $this->assertSame('11000.00', $summary['outstanding']);
        $this->assertSame([1, 1, 1], [$summary['stalls_paid'], $summary['stalls_partially_paid'], $summary['stalls_pending']]);
    }

    // ---- 5, 6: five stalls, one owner; consolidated payout ------------------------------------------------------------

    public function test_05_five_stalls_of_one_owner_roll_up_in_the_owner_wise_view(): void
    {
        $date = $this->freshDate();
        $owner = $this->makeOwner();
        $gross = ['1000.00', '2000.00', '3000.00', '4000.00', '5000.00'];
        $records = collect($gross)->map(fn ($g, $i) => $this->makeSettlement($date, $g, $this->makeStall("Stall {$i}", $owner), $owner));

        $this->pay($records[0], '1000.00');              // fully paid
        $this->pay($records[1], '500.00');               // partly paid, by UPI below
        $this->pay($records[1], '500.00', 'upi', 'UPI-OWNER-1');

        $row = $this->ownerRow($owner->id, $date);
        $this->assertSame(5, $row['stall_count']);
        $this->assertSame('15000.00', $row['net_payable']);
        $this->assertSame('2000.00', $row['paid']);
        $this->assertSame('13000.00', $row['outstanding']);
        $this->assertEqualsCanonicalizing(['cash', 'upi'], $row['methods_used']->all() ?? $row['methods_used']);
        $this->assertCount(5, $row['stalls']);
        $this->assertCount(3, $row['payouts']);
        $this->assertContains('UPI-OWNER-1', array_column($row['payouts'], 'transaction_reference'));
    }

    public function test_06_consolidated_owner_payout_is_allocated_across_stalls_and_counted_once(): void
    {
        $date = $this->freshDate();
        $owner = $this->makeOwner();
        $records = collect(['1000.00', '2000.00', '3000.00', '4000.00', '5000.00'])
            ->map(fn ($g, $i) => $this->makeSettlement($date, $g, $this->makeStall("C{$i}", $owner), $owner));

        // Allocations that do not add up to the payment are refused outright
        $bad = $this->consolidated($owner->id, '5000.00', [[$records[0]->id, '1000.00'], [$records[1]->id, '2000.00']]);
        $bad->assertStatus(422);
        $this->assertSame(0, SettlementPayout::whereIn('settlement_id', $records->pluck('id'))->count());

        // A single allocation larger than that stall's balance is refused
        $this->consolidated($owner->id, '1500.00', [[$records[0]->id, '1500.00']])->assertStatus(422);

        // Valid: 1000 + 2000 + 1500 + 500 = 5000, four of the five stalls
        $res = $this->consolidated($owner->id, '5000.00', [
            [$records[0]->id, '1000.00'], [$records[1]->id, '2000.00'], [$records[2]->id, '1500.00'], [$records[3]->id, '500.00'],
        ], 'bank_transfer', 'NEFT-CONS-1')->assertStatus(201);

        $c = $res->json('data');
        $this->assertMatchesRegularExpression('/^CPAY-\d{6}$/', $c['consolidated_number']);
        $this->assertSame('5000.00', $c['total_amount']);
        $this->assertCount(4, $c['allocations']);
        $this->assertSame('5000.00', number_format(array_sum(array_column($c['allocations'], 'amount')), 2, '.', ''));

        $this->assertSame(['paid', '1000.00', '0.00'], $this->figures($records[0]));
        $this->assertSame(['paid', '2000.00', '0.00'], $this->figures($records[1]));
        $this->assertSame(['partially_paid', '1500.00', '1500.00'], $this->figures($records[2]));
        $this->assertSame(['partially_paid', '500.00', '3500.00'], $this->figures($records[3]));
        $this->assertSame(['pending', '0.00', '5000.00'], $this->figures($records[4]));

        // The payment is counted ONCE: owner paid = 5000 (not 5 x 5000, not 4 x 5000)
        $row = $this->ownerRow($owner->id, $date);
        $this->assertSame('15000.00', $row['net_payable']);
        $this->assertSame('5000.00', $row['paid']);
        $this->assertSame('10000.00', $row['outstanding']);
        $this->assertSame(['CPAY-' . substr($c['consolidated_number'], 5)], array_values(array_unique(array_filter(array_column($row['payouts'], 'consolidated_number')))));

        // Each allocation row is a normal ledger row: history filters by owner and shows 4 rows adding up to the payment
        $hist = $this->actingAs($this->owner(), 'sanctum')->getJson("/api/settlements/payouts?stall_owner_id={$owner->id}")->assertOk();
        $this->assertCount(4, $hist->json('data.data'));
        $this->assertSame('5000.00', $hist->json('totals.completed_paid'));

        $this->assertTrue($this->reconcile($date)['ok']);
    }

    public function test_06b_consolidated_auto_allocation_pays_the_oldest_balances_first_and_cannot_exceed_the_total_outstanding(): void
    {
        $owner = $this->makeOwner();
        $d1 = $this->freshDate();
        $d2 = $this->freshDate();
        $stall = $this->makeStall('Auto', $owner);
        $older = $this->makeSettlement($d1 < $d2 ? $d1 : $d2, '1000.00', $stall, $owner);
        $newer = $this->makeSettlement($d1 < $d2 ? $d2 : $d1, '1000.00', $stall, $owner);

        $this->consolidated($owner->id, '1500.00', null, 'upi', 'UPI-AUTO', true)->assertStatus(201);
        $this->assertSame(['paid', '1000.00', '0.00'], $this->figures($older));
        $this->assertSame(['partially_paid', '500.00', '500.00'], $this->figures($newer));

        $this->consolidated($owner->id, '600.00', null, 'cash', null, true)->assertStatus(422);   // only 500 is left
        $this->assertSame(['partially_paid', '500.00', '500.00'], $this->figures($newer));
    }

    public function test_06c_a_consolidated_payout_is_reversed_as_a_whole_and_cannot_be_reversed_through_one_stall(): void
    {
        $date = $this->freshDate();
        $owner = $this->makeOwner();
        $a = $this->makeSettlement($date, '1000.00', $this->makeStall('R1', $owner), $owner);
        $b = $this->makeSettlement($date, '2000.00', $this->makeStall('R2', $owner), $owner);
        $res = $this->consolidated($owner->id, '3000.00', [[$a->id, '1000.00'], [$b->id, '2000.00']])->assertStatus(201);
        $cid = $res->json('data.id');
        $childId = SettlementPayout::where('consolidated_payout_id', $cid)->value('id');

        $this->actingAs($this->owner(), 'sanctum')->postJson("/api/settlements/payouts/{$childId}/reverse", ['reason' => 'wrong owner paid'])
            ->assertStatus(422);

        $this->actingAs($this->owner(), 'sanctum')->postJson("/api/settlements/consolidated-payouts/{$cid}/reverse", ['reason' => 'wrong owner paid'])
            ->assertOk()->assertJsonPath('data.status', 'reversed');

        $this->assertSame(['pending', '0.00', '1000.00'], $this->figures($a));
        $this->assertSame(['pending', '0.00', '2000.00'], $this->figures($b));
        $this->assertSame(2, SettlementPayout::where('consolidated_payout_id', $cid)->where('entry_type', 'reversal')->count());
        $this->assertSame(2, SettlementPayout::where('consolidated_payout_id', $cid)->where('entry_type', 'payment')->count(), 'originals are kept');
        $this->actingAs($this->owner(), 'sanctum')->postJson("/api/settlements/consolidated-payouts/{$cid}/reverse", ['reason' => 'again'])->assertStatus(422);
        $this->assertTrue($this->reconcile($date)['ok']);
    }

    // ---- 10: duplicate submission -------------------------------------------------------------------------------------

    public function test_10_a_duplicate_submission_does_not_create_a_second_payout(): void
    {
        $s = $this->makeSettlement($this->freshDate(), '5000.00');

        $first = $this->pay($s, '2000.00', 'cash', null, 'dup-key-0001')->assertStatus(201);
        $second = $this->pay($s, '2000.00', 'cash', null, 'dup-key-0001')->assertStatus(200)->assertJsonPath('duplicate', true);

        $this->assertSame($first->json('data.payout.id'), $second->json('data.payout.id'));
        $this->assertSame(1, SettlementPayout::where('settlement_id', $s->id)->count());
        $this->assertSame(['partially_paid', '2000.00', '3000.00'], $this->figures($s));

        // The same key reused for a different amount is a client bug, not a retry
        $this->pay($s, '999.00', 'cash', null, 'dup-key-0001')->assertStatus(409);
        $this->assertSame(1, SettlementPayout::where('settlement_id', $s->id)->count());

        // A key is mandatory: without one a double-click could not be told from a second payment
        $this->actingAs($this->owner(), 'sanctum')->postJson("/api/settlements/{$s->id}/payouts", ['amount' => '10.00', 'payment_method' => 'cash'])->assertStatus(422);
    }

    public function test_10b_a_duplicate_consolidated_submission_does_not_pay_twice(): void
    {
        $date = $this->freshDate();
        $owner = $this->makeOwner();
        $a = $this->makeSettlement($date, '1000.00', $this->makeStall('D1', $owner), $owner);
        $alloc = [[$a->id, '400.00']];

        $this->consolidated($owner->id, '400.00', $alloc, 'cash', null, false, 'cons-dup-0001')->assertStatus(201);
        $this->consolidated($owner->id, '400.00', $alloc, 'cash', null, false, 'cons-dup-0001')->assertStatus(200)->assertJsonPath('duplicate', true);

        $this->assertSame(1, SettlementPayout::where('settlement_id', $a->id)->count());
        $this->assertSame(['partially_paid', '400.00', '600.00'], $this->figures($a));
    }

    // ---- 11: overpayment ----------------------------------------------------------------------------------------------

    public function test_11_overpayment_is_refused_and_changes_nothing(): void
    {
        $s = $this->makeSettlement($this->freshDate(), '5000.00');
        $this->pay($s, '3000.00')->assertStatus(201);

        $res = $this->pay($s, '2000.01')->assertStatus(422);
        $this->assertStringContainsString('exceeds the outstanding balance', $res->json('message'));
        $this->assertSame(['partially_paid', '3000.00', '2000.00'], $this->figures($s));
        $this->assertSame(1, SettlementPayout::where('settlement_id', $s->id)->count());

        $this->pay($s, '2000.00')->assertStatus(201);                 // exactly the balance is fine
        $this->pay($s, '0.01')->assertStatus(422);                    // nothing left
        $this->pay($s, '0.00')->assertStatus(422);
        $this->pay($s, '-5.00')->assertStatus(422);
        $this->assertSame(['paid', '5000.00', '0.00'], $this->figures($s));
    }

    // ---- 13: reversal -------------------------------------------------------------------------------------------------

    public function test_13_a_reversed_payout_restores_the_balance_and_keeps_the_original_and_an_audited_reversal(): void
    {
        $s = $this->makeSettlement($this->freshDate(), '5000.00');
        $payoutId = $this->pay($s, '5000.00', 'upi', 'UPI-WRONG-1')->assertStatus(201)->json('data.payout.id');
        $this->assertSame('paid', $s->fresh()->payout_status);

        $res = $this->actingAs($this->owner(), 'sanctum')->postJson("/api/settlements/payouts/{$payoutId}/reverse", ['reason' => 'UPI failed at bank'])
            ->assertStatus(201);
        $this->assertSame('reversal', $res->json('data.reversal.entry_type'));
        $this->assertSame($payoutId, $res->json('data.reversal.reverses_payout_id'));

        $this->assertSame(['pending', '0.00', '5000.00'], $this->figures($s));
        $original = SettlementPayout::find($payoutId);
        $this->assertSame('reversed', $original->status);
        $this->assertSame('5000.00', $original->amount, 'the original transaction is preserved untouched');
        $this->assertSame(2, SettlementPayout::where('settlement_id', $s->id)->count());
        $this->assertDatabaseHas('settlement_payout_audits', ['payout_id' => $payoutId, 'action' => 'payout_reversed']);
        // Every ledger row stores a plain date (10 chars), so business-date filters match reversal rows on SQLite too
        foreach (DB::table('settlement_payouts')->where('settlement_id', $s->id)->pluck('business_date') as $d) {
            $this->assertSame(10, strlen((string) $d), 'business_date must be a plain date, got ' . $d);
        }

        // Cannot be reversed twice, and the reversal row itself cannot be reversed
        $this->actingAs($this->owner(), 'sanctum')->postJson("/api/settlements/payouts/{$payoutId}/reverse", ['reason' => 'again'])->assertStatus(422);
        $this->actingAs($this->owner(), 'sanctum')->postJson('/api/settlements/payouts/' . $res->json('data.reversal.id') . '/reverse', ['reason' => 'undo'])->assertStatus(422);

        // The balance can be paid again, correctly
        $this->pay($s, '5000.00', 'upi', 'UPI-RIGHT-1')->assertStatus(201);
        $this->assertSame(['paid', '5000.00', '0.00'], $this->figures($s));
        $this->assertTrue($this->reconcile($s->closing->closing_date->toDateString())['ok']);
    }

    public function test_13b_failed_attempts_are_recorded_but_never_reduce_the_balance(): void
    {
        $s = $this->makeSettlement($this->freshDate(), '5000.00');

        $res = $this->pay($s, '5000.00', 'upi', 'UPI-FAILED', null, ['outcome' => 'failed', 'failure_reason' => 'Bank declined'])->assertStatus(201);
        $this->assertSame('failed', $res->json('data.payout.status'));
        $this->assertSame(['pending', '0.00', '5000.00'], $this->figures($s));
        $this->assertDatabaseHas('settlement_payout_audits', ['settlement_id' => $s->id, 'action' => 'payout_failed']);

        $this->pay($s, '5000.00')->assertStatus(201);   // a failed row never blocks the real payment
        $this->assertSame(['paid', '5000.00', '0.00'], $this->figures($s));
    }

    public function test_13c_payout_rows_are_permanent_records_that_cannot_be_edited_or_deleted(): void
    {
        $s = $this->makeSettlement($this->freshDate(), '5000.00');
        $id = $this->pay($s, '1000.00')->json('data.payout.id');
        $payout = SettlementPayout::find($id);

        $attempts = [
            'edit amount' => fn () => $payout->update(['amount' => '1.00']),
            'edit method' => fn () => $payout->update(['payment_method' => 'cash']),
            'delete payout' => fn () => $payout->delete(),
            'edit audit' => fn () => SettlementPayoutAudit::where('payout_id', $id)->first()->update(['action' => 'x']),
            'delete audit' => fn () => SettlementPayoutAudit::where('payout_id', $id)->first()->delete(),
        ];
        foreach ($attempts as $what => $attempt) {
            try {
                $attempt();
                $this->fail("history was modified: {$what}");
            } catch (LogicException) {
                $this->addToAssertionCount(1);
            }
        }
        $this->assertSame('1000.00', SettlementPayout::find($id)->amount);
    }

    // ---- adjustments & zero / negative payables ------------------------------------------------------------------------

    public function test_adjustments_change_the_payable_with_an_audit_entry_and_never_below_what_is_paid(): void
    {
        $s = $this->makeSettlement($this->freshDate(), '5000.00');
        $this->pay($s, '3000.00')->assertStatus(201);
        $api = fn (string $amt, string $why) => $this->actingAs($this->owner(), 'sanctum')->postJson("/api/settlements/{$s->id}/adjustments", ['amount' => $amt, 'reason' => $why]);

        $api('-500.00', 'Stall wastage deduction')->assertOk();
        $s->refresh();
        $this->assertSame('4500.00', $s->net_payable);
        $this->assertSame('5000.00', $s->payable_at_close, 'the closing snapshot never moves');
        $this->assertSame('1500.00', $s->remaining_amount);

        $api('-1600.00', 'too much')->assertStatus(422);      // payable would fall below the 3000 already paid
        $api('0', 'noop')->assertStatus(422);
        $api('250.00', 'Late sale added')->assertOk();
        $this->assertSame('4750.00', $s->fresh()->net_payable);
        $this->assertSame(2, SettlementPayoutAudit::where('settlement_id', $s->id)->where('action', 'adjustment')->count());

        $this->pay($s, '1750.00')->assertStatus(201);
        $this->assertSame(['paid', '4750.00', '0.00'], $this->figures($s));
    }

    public function test_zero_and_negative_payables_are_not_forced_into_paid_or_pending(): void
    {
        $zero = $this->makeSettlement($this->freshDate(), '0.00');
        $this->assertSame('nothing_due', $zero->payout_status);
        $this->pay($zero, '10.00')->assertStatus(422);

        $neg = $this->makeSettlement($this->freshDate(), '100.00');
        $this->actingAs($this->owner(), 'sanctum')->postJson("/api/settlements/{$neg->id}/adjustments", ['amount' => '-150.00', 'reason' => 'Penalty exceeds sales'])->assertOk();
        $neg->refresh();
        $this->assertSame('negative_balance', $neg->payout_status);
        $this->assertSame('-50.00', $neg->net_payable);
        $this->pay($neg, '10.00')->assertStatus(422);
    }

    // ---- 14: day closing without payout -------------------------------------------------------------------------------

    public function test_14_day_closing_records_what_is_owed_but_never_marks_anything_paid(): void
    {
        $date = $this->freshDate();
        $pizza = $this->makeStall('Closing Pizza');
        $misal = $this->makeStall('Closing Misal');
        $this->insertPaidSale($pizza, $date, '5000.00');
        $this->insertPaidSale($misal, $date, '8000.00');

        $res = $this->actingAs($this->owner(), 'sanctum')->postJson('/api/settlements/close-day', ['date' => $date])->assertStatus(201);

        $rows = collect($res->json('data.settlements'))->keyBy('stall_id');
        foreach ([[$pizza, '5000.00'], [$misal, '8000.00']] as [$stall, $amt]) {
            $r = $rows[$stall->id];
            $this->assertSame($amt, $r['stall_gross_sales']);
            $this->assertSame($amt, $r['payable_at_close']);
            $this->assertSame($amt, $r['net_payable']);
            $this->assertSame('0.00', $r['paid_amount']);
            $this->assertSame($amt, $r['remaining_amount']);
            $this->assertSame('pending', $r['payout_status']);
            $this->assertSame('calculated', $r['settlement_status']);
        }
        $this->assertSame(0, SettlementPayout::where('business_date', $date)->count(), 'closing creates no payout');

        // Day closing and payout confirmation are separate actions
        $this->pay(StallSettlementRecord::find($rows[$pizza->id]['id']), '5000.00')->assertStatus(201);
        $summary = $this->actingAs($this->owner(), 'sanctum')->getJson("/api/settlements/daily-summary?date={$date}")->json('data');
        $this->assertTrue($summary['is_closed']);
        $this->assertSame('5000.00', $summary['payout_summary']['payout_made']);
    }

    // ---- 16: history stays accurate -----------------------------------------------------------------------------------

    public function test_16_historical_dates_and_closing_snapshots_stay_accurate_after_later_payout_activity(): void
    {
        $dayA = $this->freshDate();
        $dayB = $this->freshDate();
        $stall = $this->makeStall('History');
        $a = $this->makeSettlement($dayA, '1200.00', $stall);
        $b = $this->makeSettlement($dayB, '3400.00', $stall);
        $closingBefore = $a->closing->only(['total_net_sales', 'status', 'closing_date']);

        $this->pay($a, '1200.00');
        $this->pay($b, '1000.00', 'upi', 'UPI-B-1');
        $this->actingAs($this->owner(), 'sanctum')->postJson("/api/settlements/{$a->id}/adjustments", ['amount' => '-200.00', 'reason' => 'late correction'])->assertStatus(422);
        $this->actingAs($this->owner(), 'sanctum')->postJson("/api/settlements/{$b->id}/adjustments", ['amount' => '100.00', 'reason' => 'late correction'])->assertOk();

        $a->refresh();
        $b->refresh();
        $this->assertSame('1200.00', $a->payable_at_close);
        $this->assertSame('1200.00', $a->stall_gross_sales);
        $this->assertSame('3400.00', $b->payable_at_close, 'a later adjustment does not rewrite what was owed at closing');
        $this->assertSame('3500.00', $b->net_payable);
        $this->assertEquals($closingBefore, $a->closing->fresh()->only(['total_net_sales', 'status', 'closing_date']));

        $hist = fn (string $qs) => $this->actingAs($this->owner(), 'sanctum')->getJson("/api/settlements/payouts?{$qs}")->assertOk()->json('data.data');
        $this->assertCount(1, $hist("business_date={$dayA}&stall_id={$stall->id}"));
        $this->assertCount(1, $hist("business_date={$dayB}&stall_id={$stall->id}"));
        $this->assertSame($dayB, $hist("business_date={$dayB}&stall_id={$stall->id}")[0]['business_date']);
        [$lo, $hi] = $dayA < $dayB ? [$dayA, $dayB] : [$dayB, $dayA];
        $this->assertCount(2, $hist("date_from={$lo}&date_to={$hi}&stall_id={$stall->id}"));
        $this->assertCount(1, $hist("date_from={$lo}&date_to={$lo}&stall_id={$stall->id}"));
        $this->assertCount(1, $hist("payment_method=upi&stall_id={$stall->id}"));
        $this->assertCount(1, $hist("q=UPI-B-1&stall_id={$stall->id}"));
        $this->assertCount(2, $hist("status=completed&stall_id={$stall->id}"));
        $this->assertCount(0, $hist("status=reversed&stall_id={$stall->id}"));
    }

    // ---- detail, receipt, authorisation, reconciliation ---------------------------------------------------------------

    public function test_payout_detail_exposes_the_full_audit_history_and_a_receipt(): void
    {
        $owner = $this->makeOwner('Receipt Owner');
        $s = $this->makeSettlement($this->freshDate(), '5000.00', $this->makeStall('Receipt Stall', $owner), $owner);
        $id = $this->pay($s, '2000.00', 'upi', 'UPI-RCPT')->json('data.payout.id');
        $this->actingAs($this->owner(), 'sanctum')->postJson("/api/settlements/payouts/{$id}/reverse", ['reason' => 'test reversal'])->assertStatus(201);

        $detail = $this->actingAs($this->owner(), 'sanctum')->getJson("/api/settlements/payouts/{$id}")->assertOk()->json('data');
        $this->assertSame(['payout_recorded', 'payout_reversed'], array_column($detail['payout']['audits'], 'action'));
        $this->assertNotNull($detail['reversal']);

        $drawer = $this->actingAs($this->owner(), 'sanctum')->getJson("/api/settlements/{$s->id}/payouts")->assertOk()->json('data');
        $this->assertCount(2, $drawer['settlement']['payouts']);
        $this->assertGreaterThanOrEqual(3, count($drawer['audit']));

        $receipt = $this->actingAs($this->owner(), 'sanctum')->getJson("/api/settlements/payouts/{$id}/receipt")->assertOk()->json('data');
        $this->assertSame('2000.00', $receipt['amount']);
        $this->assertSame('3000.00', $receipt['balance_after']);
        $this->assertSame('2000.00', $receipt['paid_to_date']);
        $this->assertStringContainsString('not proof of an electronic transfer', $receipt['disclaimer']);
    }

    public function test_only_the_owner_can_see_or_change_payouts(): void
    {
        $s = $this->makeSettlement($this->freshDate(), '1000.00');
        $cashier = User::where('role', 'cashier')->firstOrFail();

        foreach ([
            ['post', "/api/settlements/{$s->id}/payouts", ['amount' => '10', 'payment_method' => 'cash', 'idempotency_key' => 'cashier-key-1']],
            ['get', '/api/settlements/payouts', []],
            ['get', '/api/settlements/owners', []],
            ['get', '/api/settlements/reconciliation', []],
            ['post', "/api/settlements/{$s->id}/adjustments", ['amount' => '5', 'reason' => 'nope']],
        ] as [$verb, $url, $body]) {
            $this->actingAs($cashier, 'sanctum')->{$verb . 'Json'}($url, $body)->assertStatus(403);
        }
        $this->assertSame(0, SettlementPayout::where('settlement_id', $s->id)->count());
    }

    public function test_reconciliation_proves_payable_equals_paid_plus_outstanding_and_catches_tampering(): void
    {
        $date = $this->freshDate();
        $a = $this->makeSettlement($date, '5000.00', $this->makeStall('Rec A'));
        $b = $this->makeSettlement($date, '8000.00', $this->makeStall('Rec B'));
        $this->pay($a, '5000.00');
        $this->pay($b, '3000.00', 'upi', 'UPI-REC');

        $r = $this->reconcile($date);
        $this->assertTrue($r['ok'], json_encode($r['discrepancies']));
        $this->assertSame(2, $r['settlements_checked']);
        $this->assertSame(['13000.00', '8000.00', '5000.00'], [$r['totals']['net_payable'], $r['totals']['paid'], $r['totals']['outstanding']]);

        // Someone edits the cache directly in the database: reconciliation flags it
        \Illuminate\Support\Facades\DB::table('stall_settlement_records')->where('id', $b->id)->update(['paid_amount' => '7000.00', 'remaining_amount' => '1000.00', 'payout_status' => 'partially_paid']);
        $r = $this->reconcile($date);
        $this->assertFalse($r['ok']);
        $this->assertNotEmpty($r['discrepancies']);
    }

    public function test_legacy_pay_endpoint_records_a_ledger_payout_with_the_same_guards(): void
    {
        $s = $this->makeSettlement($this->freshDate(), '2000.00');
        $call = fn (string $amt) => $this->actingAs($this->owner(), 'sanctum')->postJson("/api/settlements/{$s->id}/pay", [
            'amount_paid' => $amt, 'paid_to_representative' => 'Marco', 'payment_method' => 'cash',
        ]);

        $call('3000.00')->assertStatus(422);               // overpayment refused here too
        $call('2000.00')->assertOk();
        $this->assertSame(1, SettlementPayout::where('settlement_id', $s->id)->count());
        $this->assertSame('paid', $s->fresh()->payout_status);
        $call('1.00')->assertStatus(422);                  // already settled
    }

    // ---- helpers ------------------------------------------------------------------------------------------------------

    /** [payout_status, paid, remaining] */
    private function figures(StallSettlementRecord $s): array
    {
        $s->refresh();

        return [$s->payout_status, $s->paid_amount, $s->remaining_amount];
    }

    private function consolidated(int $ownerId, string $total, ?array $allocations, string $method = 'cash', ?string $ref = null, bool $auto = false, ?string $key = null)
    {
        return $this->actingAs($this->owner(), 'sanctum')->postJson("/api/settlements/owners/{$ownerId}/payouts", array_filter([
            'total_amount' => $total,
            'auto' => $auto ?: null,
            'allocations' => $allocations ? array_map(fn ($a) => ['settlement_id' => $a[0], 'amount' => $a[1]], $allocations) : null,
            'payment_method' => $method,
            'transaction_reference' => $ref,
            'received_by' => 'Owner Rep',
            'idempotency_key' => $key ?? 'cons-' . uniqid('', true),
        ], fn ($v) => $v !== null));
    }

    private function ownerRow(int $ownerId, string $date): array
    {
        $json = $this->actingAs($this->owner(), 'sanctum')->getJson("/api/settlements/owners?stall_owner_id={$ownerId}&date_from={$date}&date_to={$date}")->assertOk()->json('data.owners');
        $this->assertCount(1, $json);
        $row = $json[0];
        $row['methods_used'] = collect($row['methods_used']);

        return $row;
    }

    private function reconcile(string $from, ?string $to = null): array
    {
        return $this->actingAs($this->owner(), 'sanctum')->getJson('/api/settlements/reconciliation?date_from=' . $from . '&date_to=' . ($to ?? $from))->assertOk()->json('data');
    }
}
