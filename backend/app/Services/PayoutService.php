<?php

namespace App\Services;

use App\Models\ConsolidatedPayout;
use App\Models\SettlementPayout;
use App\Models\SettlementPayoutAudit;
use App\Models\StallOwner;
use App\Models\StallSettlementRecord;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * The payout ledger.
 *
 * Rules enforced here, never in the UI:
 *  - a calculated payable is not a payment: only a confirmed payout row counts as paid;
 *  - a payout can never exceed the outstanding balance, computed from the ledger under a row lock;
 *  - the same idempotency key never creates a second payout;
 *  - failed payouts and reversal rows never reduce the outstanding balance wrongly: Total Paid is the sum of completed,
 *    non-reversed payment rows, and nothing else;
 *  - rows are never deleted or edited: a correction is a reversal row plus an audit entry.
 *
 * Lock order is always owner -> settlements (ascending id) -> payout rows, so concurrent requests cannot deadlock.
 */
class PayoutService
{
    public const METHODS = ['cash', 'upi', 'bank_transfer', 'other'];

    /** Methods that leave a trace outside the app and therefore must carry a transaction reference. */
    public const REFERENCE_REQUIRED = ['upi', 'bank_transfer'];

    public static function money(mixed $value): string
    {
        return number_format(round((float) $value, 2), 2, '.', '');
    }

    /** pending | partially_paid | paid | nothing_due | negative_balance | overpaid (the last is a reconciliation alarm) */
    public static function deriveStatus(string $net, string $paid): string
    {
        if (bccomp($net, '0', 2) < 0) {
            return 'negative_balance';
        }
        if (bccomp($net, '0', 2) === 0) {
            return bccomp($paid, '0', 2) === 0 ? 'nothing_due' : 'overpaid';
        }

        return match (true) {
            bccomp($paid, '0', 2) <= 0 => 'pending',
            bccomp($paid, $net, 2) < 0 => 'partially_paid',
            bccomp($paid, $net, 2) === 0 => 'paid',
            default => 'overpaid',
        };
    }

    /** Total Paid = sum of completed, non-reversed payment rows. */
    public function paidTotal(int $settlementId): string
    {
        return self::money(
            DB::table('settlement_payouts')
                ->where('settlement_id', $settlementId)
                ->where('entry_type', 'payment')
                ->where('status', 'completed')
                ->sum('amount')
        );
    }

    /** Recompute the cached figures on a (locked) settlement from the ledger. */
    public function refresh(StallSettlementRecord $record): StallSettlementRecord
    {
        $net = bcadd(self::money($record->stall_gross_sales), self::money($record->adjustment_amount), 2);
        $paid = $this->paidTotal($record->id);
        $status = self::deriveStatus($net, $paid);

        $last = SettlementPayout::where('settlement_id', $record->id)
            ->where('entry_type', 'payment')->where('status', 'completed')->orderByDesc('paid_at')->orderByDesc('id')->first();

        $record->forceFill([
            'net_payable' => $net,
            'paid_amount' => $paid,
            'remaining_amount' => bcsub($net, $paid, 2),
            'payout_status' => $status,
            'last_payout_at' => $last?->paid_at,
            // legacy columns kept in step so older screens and reports still read correctly
            'settlement_amount' => $paid,
            'settlement_status' => $status === 'paid' ? 'paid' : 'calculated',
            'paid_at' => $status === 'paid' ? $last?->paid_at : null,
            'payment_method' => $status === 'paid' ? $last?->payment_method : null,
            'paid_to_representative' => $status === 'paid' ? $last?->received_by : null,
        ])->save();

        return $record;
    }

    // ---------------------------------------------------------------- single-stall payouts

    /**
     * Record one payout (or a failed attempt) against a stall settlement.
     *
     * @return array{0: SettlementPayout, 1: bool} the payout and whether it was a duplicate of an earlier identical request
     */
    public function record(User $user, int $settlementId, array $d): array
    {
        $key = $d['idempotency_key'] ?? null;

        try {
            return DB::transaction(fn () => $this->recordLocked($user, $settlementId, $d));
        } catch (UniqueConstraintViolationException) {
            // Lost a race on the idempotency key against a request for a different settlement
            $existing = $key ? SettlementPayout::where('idempotency_key', $key)->first() : null;
            if ($existing && $this->sameRequest($existing, $settlementId, $d)) {
                return [$existing, true];
            }
            throw new PayoutException('This idempotency key was already used for a different payout.', 409);
        }
    }

    private function recordLocked(User $user, int $settlementId, array $d): array
    {
        $outcome = $d['outcome'] ?? 'completed';
        $key = $d['idempotency_key'] ?? null;

        $record = StallSettlementRecord::with(['closing', 'stall'])->whereKey($settlementId)->lockForUpdate()->first();
        if (!$record) {
            throw new PayoutException('Settlement record not found.', 404);
        }

        if ($key && ($existing = SettlementPayout::where('idempotency_key', $key)->first())) {
            if (!$this->sameRequest($existing, $settlementId, $d)) {
                throw new PayoutException('This idempotency key was already used for a different payout.', 409);
            }

            return [$existing, true];
        }

        $amount = self::money($d['amount']);
        $this->assertPayoutInput($amount, $d);

        $net = bcadd(self::money($record->stall_gross_sales), self::money($record->adjustment_amount), 2);
        $paid = $this->paidTotal($record->id);
        $remaining = bcsub($net, $paid, 2);

        if ($outcome === 'completed') {
            if (bccomp($net, '0', 2) <= 0) {
                throw new PayoutException('This settlement has no payable balance, so no payout can be recorded.');
            }
            if (bccomp($amount, $remaining, 2) > 0) {
                throw new PayoutException("Payout of ₹{$amount} exceeds the outstanding balance of ₹{$remaining}.");
            }
        }

        $payout = $this->insertPayout($record, $user, [
            'status' => $outcome,
            'payable_at_time' => $net,
            'amount' => $amount,
            'balance_after' => $outcome === 'completed' ? bcsub($remaining, $amount, 2) : $remaining,
            'failure_reason' => $outcome === 'failed' ? ($d['failure_reason'] ?? null) : null,
            'idempotency_key' => $key,
        ] + $this->commonFields($d));

        $this->audit($record->id, $payout->id, null, $outcome === 'completed' ? 'payout_recorded' : 'payout_failed', $user, [
            'amount' => $amount,
            'method' => $d['payment_method'],
            'reference' => $d['transaction_reference'] ?? null,
            'net_payable' => $net,
            'paid_before' => $paid,
            'remaining_after' => $payout->balance_after,
            'idempotency_key' => $key,
        ]);

        $this->refresh($record);

        return [$payout->load(['stall', 'owner', 'paidBy']), false];
    }

    // ---------------------------------------------------------------- consolidated owner payouts

    /**
     * One payment to an owner covering several stall settlements. The amount is split into allocations (explicit, or oldest
     * first with auto = true); allocations add up exactly to the payment and each one is its own ledger row.
     *
     * @return array{0: ConsolidatedPayout, 1: bool}
     */
    public function recordConsolidated(User $user, int $ownerId, array $d): array
    {
        $key = $d['idempotency_key'];

        try {
            return DB::transaction(fn () => $this->consolidatedLocked($user, $ownerId, $d));
        } catch (UniqueConstraintViolationException) {
            $existing = ConsolidatedPayout::where('idempotency_key', $key)->first();
            if ($existing && $existing->stall_owner_id === $ownerId && bccomp(self::money($existing->total_amount), self::money($d['total_amount']), 2) === 0) {
                return [$existing->load(['owner', 'allocations.stall']), true];
            }
            throw new PayoutException('This idempotency key was already used for a different payout.', 409);
        }
    }

    private function consolidatedLocked(User $user, int $ownerId, array $d): array
    {
        $key = $d['idempotency_key'];
        $total = self::money($d['total_amount']);

        // The owner row is the mutex for everything consolidated for this owner
        $owner = StallOwner::whereKey($ownerId)->lockForUpdate()->first();
        if (!$owner) {
            throw new PayoutException('Stall owner not found.', 404);
        }

        if ($existing = ConsolidatedPayout::where('idempotency_key', $key)->first()) {
            if ($existing->stall_owner_id !== $owner->id || bccomp(self::money($existing->total_amount), $total, 2) !== 0) {
                throw new PayoutException('This idempotency key was already used for a different payout.', 409);
            }

            return [$existing->load(['owner', 'allocations.stall']), true];
        }

        $this->assertPayoutInput($total, $d);

        $auto = (bool) ($d['auto'] ?? false);
        if ($auto) {
            $ids = StallSettlementRecord::query()
                ->join('stalls', 'stalls.id', '=', 'stall_settlement_records.stall_id')
                ->join('daily_closings', 'daily_closings.id', '=', 'stall_settlement_records.closing_id')
                ->where('stalls.stall_owner_id', $owner->id)
                ->where('stall_settlement_records.remaining_amount', '>', 0)
                ->orderBy('daily_closings.closing_date')->orderBy('stall_settlement_records.id')
                ->pluck('stall_settlement_records.id')->all();
            $requested = [];
        } else {
            $requested = collect($d['allocations'] ?? [])->map(fn ($a) => [
                'settlement_id' => (int) $a['settlement_id'],
                'amount' => self::money($a['amount']),
            ]);
            $ids = $requested->pluck('settlement_id')->all();
            if (count($ids) === 0) {
                throw new PayoutException('Provide the allocation of this payment to the stall settlements, or ask for automatic allocation.');
            }
            if (count($ids) !== count(array_unique($ids))) {
                throw new PayoutException('A settlement can appear only once in the allocations.');
            }
        }

        $records = StallSettlementRecord::with(['closing', 'stall'])->whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get()->keyBy('id');
        if ($records->count() !== count($ids)) {
            throw new PayoutException('One or more settlements in the allocation were not found.', 404);
        }

        $remaining = [];
        foreach ($records as $r) {
            if ((int) $r->stall->stall_owner_id !== $owner->id) {
                throw new PayoutException("Settlement #{$r->id} ({$r->stall->name}) does not belong to {$owner->name}.");
            }
            $net = bcadd(self::money($r->stall_gross_sales), self::money($r->adjustment_amount), 2);
            $remaining[$r->id] = bcsub($net, $this->paidTotal($r->id), 2);
        }

        $allocations = [];
        if ($auto) {
            $left = $total;
            foreach ($ids as $id) {
                if (bccomp($left, '0', 2) <= 0) {
                    break;
                }
                if (bccomp($remaining[$id], '0', 2) <= 0) {
                    continue;
                }
                $part = bccomp($left, $remaining[$id], 2) <= 0 ? $left : $remaining[$id];
                $allocations[$id] = $part;
                $left = bcsub($left, $part, 2);
            }
            if (bccomp($left, '0', 2) > 0) {
                $outstanding = array_reduce($remaining, fn ($c, $v) => bcadd($c, bccomp($v, '0', 2) > 0 ? $v : '0', 2), '0.00');
                throw new PayoutException("Payout of ₹{$total} exceeds the owner's outstanding balance of ₹{$outstanding}.");
            }
        } else {
            $sum = '0.00';
            foreach ($requested as $a) {
                if (bccomp($a['amount'], '0', 2) <= 0) {
                    throw new PayoutException('Every allocation must be greater than zero.');
                }
                if (bccomp($a['amount'], $remaining[$a['settlement_id']], 2) > 0) {
                    $r = $records[$a['settlement_id']];
                    throw new PayoutException("Allocation of ₹{$a['amount']} to {$r->stall->name} exceeds its outstanding balance of ₹{$remaining[$r->id]}.");
                }
                $allocations[$a['settlement_id']] = $a['amount'];
                $sum = bcadd($sum, $a['amount'], 2);
            }
            if (bccomp($sum, $total, 2) !== 0) {
                throw new PayoutException("Allocations add up to ₹{$sum}, but the payout is ₹{$total}. They must match exactly.");
            }
        }

        $common = $this->commonFields($d);
        $consolidated = ConsolidatedPayout::create([
            'stall_owner_id' => $owner->id,
            'total_amount' => $total,
            'payment_method' => $common['payment_method'],
            'transaction_reference' => $common['transaction_reference'],
            'paid_at' => $common['paid_at'],
            'paid_by_user_id' => $user->id,
            'received_by' => $common['received_by'],
            'notes' => $common['notes'],
            'status' => 'completed',
            'idempotency_key' => $key,
        ]);
        $consolidated->forceFill(['consolidated_number' => 'CPAY-' . str_pad((string) $consolidated->id, 6, '0', STR_PAD_LEFT)])->save();

        foreach ($allocations as $settlementId => $part) {
            $r = $records[$settlementId];
            $net = bcadd(self::money($r->stall_gross_sales), self::money($r->adjustment_amount), 2);
            $payout = $this->insertPayout($r, $user, [
                'status' => 'completed',
                'consolidated_payout_id' => $consolidated->id,
                'payable_at_time' => $net,
                'amount' => $part,
                'balance_after' => bcsub($remaining[$settlementId], $part, 2),
                'idempotency_key' => $key . ':' . $settlementId,
            ] + $common);
            $this->audit($r->id, $payout->id, $consolidated->id, 'payout_recorded', $user, [
                'amount' => $part,
                'method' => $common['payment_method'],
                'consolidated_number' => $consolidated->consolidated_number,
                'consolidated_total' => $total,
                'remaining_after' => $payout->balance_after,
            ]);
            $this->refresh($r);
        }

        return [$consolidated->load(['owner', 'paidBy', 'allocations.stall']), false];
    }

    // ---------------------------------------------------------------- reversals

    /**
     * Reverse one completed payout. The original row stays; a reversal row and an audit entry record the correction.
     *
     * @return array{0: SettlementPayout, 1: bool} the reversal row and whether it repeated an earlier identical request
     */
    public function reverse(User $user, int $payoutId, string $reason, ?string $key = null): array
    {
        $probe = SettlementPayout::find($payoutId);
        if (!$probe) {
            throw new PayoutException('Payout not found.', 404);
        }
        if ($probe->entry_type !== 'payment') {
            throw new PayoutException('A reversal entry cannot itself be reversed.');
        }
        if ($probe->consolidated_payout_id) {
            $n = ConsolidatedPayout::find($probe->consolidated_payout_id)?->consolidated_number;
            throw new PayoutException("This payout is part of consolidated payout {$n}. Reverse the consolidated payout instead.");
        }

        return DB::transaction(function () use ($user, $probe, $reason, $key) {
            $record = StallSettlementRecord::with(['closing', 'stall'])->whereKey($probe->settlement_id)->lockForUpdate()->first();
            $payout = SettlementPayout::whereKey($probe->id)->lockForUpdate()->first();

            if ($key && ($existing = SettlementPayout::where('idempotency_key', $key)->first())) {
                if ($existing->reverses_payout_id !== $payout->id) {
                    throw new PayoutException('This idempotency key was already used for a different request.', 409);
                }

                return [$existing, true];
            }

            return [$this->reverseLocked($user, $record, $payout, $reason, $key, null), false];
        });
    }

    /** @return ConsolidatedPayout the consolidated payout with all its allocations reversed */
    public function reverseConsolidated(User $user, int $consolidatedId, string $reason): ConsolidatedPayout
    {
        $probe = ConsolidatedPayout::find($consolidatedId);
        if (!$probe) {
            throw new PayoutException('Consolidated payout not found.', 404);
        }

        return DB::transaction(function () use ($user, $probe, $reason) {
            StallOwner::whereKey($probe->stall_owner_id)->lockForUpdate()->first();
            $consolidated = ConsolidatedPayout::whereKey($probe->id)->lockForUpdate()->first();
            if ($consolidated->status !== 'completed') {
                throw new PayoutException('This consolidated payout has already been reversed.');
            }

            $children = SettlementPayout::where('consolidated_payout_id', $consolidated->id)
                ->where('entry_type', 'payment')->where('status', 'completed')->orderBy('settlement_id')->get();
            $records = StallSettlementRecord::with(['closing', 'stall'])->whereIn('id', $children->pluck('settlement_id'))
                ->orderBy('id')->lockForUpdate()->get()->keyBy('id');

            foreach ($children as $child) {
                $child = SettlementPayout::whereKey($child->id)->lockForUpdate()->first();
                $this->reverseLocked($user, $records[$child->settlement_id], $child, $reason, null, $consolidated->id);
            }

            $consolidated->forceFill(['status' => 'reversed', 'reversed_at' => now()])->save();

            return $consolidated->load(['owner', 'paidBy', 'payouts.stall']);
        });
    }

    private function reverseLocked(User $user, StallSettlementRecord $record, SettlementPayout $payout, string $reason, ?string $key, ?int $consolidatedId): SettlementPayout
    {
        if ($payout->status === 'reversed') {
            throw new PayoutException('This payout has already been reversed.');
        }
        if ($payout->status !== 'completed') {
            throw new PayoutException('Only a completed payout can be reversed.');
        }

        $net = bcadd(self::money($record->stall_gross_sales), self::money($record->adjustment_amount), 2);
        $paidBefore = $this->paidTotal($record->id);
        $balanceAfter = bcsub($net, bcsub($paidBefore, self::money($payout->amount), 2), 2);

        $reversal = SettlementPayout::create([
            'entry_type' => 'reversal',
            'status' => 'completed',
            'settlement_id' => $record->id,
            'consolidated_payout_id' => $payout->consolidated_payout_id,
            'business_date' => $payout->business_date->toDateString(), // a plain date string: SQLite would store a Carbon as a datetime and date filters would miss it
            'stall_id' => $payout->stall_id,
            'stall_owner_id' => $payout->stall_owner_id,
            'payable_at_time' => $net,
            'amount' => $payout->amount,
            'balance_after' => $balanceAfter,
            'payment_method' => $payout->payment_method,
            'transaction_reference' => $payout->transaction_reference,
            'paid_at' => now(),
            'paid_by_user_id' => $user->id,
            'notes' => $reason,
            'reverses_payout_id' => $payout->id,
            'reversal_reason' => $reason,
            'idempotency_key' => $key,
        ]);
        $this->assignNumber($reversal);

        $payout->forceFill(['status' => 'reversed', 'reversed_at' => now()])->save();

        $this->audit($record->id, $payout->id, $consolidatedId, 'payout_reversed', $user, [
            'reason' => $reason,
            'amount' => self::money($payout->amount),
            'reversal_number' => $reversal->payout_number,
            'remaining_after' => $balanceAfter,
        ]);
        $this->audit($record->id, $reversal->id, $consolidatedId, 'reversal_recorded', $user, ['reverses' => $payout->payout_number, 'reason' => $reason]);

        $this->refresh($record);

        return $reversal->load(['stall', 'owner', 'paidBy']);
    }

    // ---------------------------------------------------------------- adjustments

    /** A signed, audited adjustment to what is payable after closing. It can never push the payable below what is already paid. */
    public function adjust(User $user, int $settlementId, string $amount, string $reason): StallSettlementRecord
    {
        $amount = self::money($amount);
        if (bccomp($amount, '0', 2) === 0) {
            throw new PayoutException('An adjustment cannot be zero.');
        }

        return DB::transaction(function () use ($user, $settlementId, $amount, $reason) {
            $record = StallSettlementRecord::with(['closing', 'stall'])->whereKey($settlementId)->lockForUpdate()->first();
            if (!$record) {
                throw new PayoutException('Settlement record not found.', 404);
            }

            $oldAdj = self::money($record->adjustment_amount);
            $newAdj = bcadd($oldAdj, $amount, 2);
            $newNet = bcadd(self::money($record->stall_gross_sales), $newAdj, 2);
            $paid = $this->paidTotal($record->id);

            // Once money has been paid out the payable cannot drop below it; with nothing paid, a negative balance is a legitimate state
            if (bccomp($paid, '0', 2) > 0 && bccomp($newNet, $paid, 2) < 0) {
                throw new PayoutException("This adjustment would make the payable ₹{$newNet}, below the ₹{$paid} already paid. Reverse a payout first.");
            }

            $record->forceFill(['adjustment_amount' => $newAdj])->save();
            $this->audit($record->id, null, null, 'adjustment', $user, [
                'amount' => $amount, 'reason' => $reason, 'adjustment_before' => $oldAdj, 'adjustment_after' => $newAdj,
                'net_payable_after' => $newNet,
            ]);

            return $this->refresh($record);
        });
    }

    // ---------------------------------------------------------------- reconciliation

    /**
     * Prove the books balance: every settlement's cached figures equal what the ledger says, PAID means paid in full, and the
     * grand totals satisfy payable = paid + outstanding.
     */
    public function reconcile(?string $from = null, ?string $to = null): array
    {
        $query = StallSettlementRecord::query()
            ->join('daily_closings', 'daily_closings.id', '=', 'stall_settlement_records.closing_id')
            ->select('stall_settlement_records.*', 'daily_closings.closing_date')
            ->when($from, fn ($q) => $q->where('daily_closings.closing_date', '>=', $from))
            ->when($to, fn ($q) => $q->where('daily_closings.closing_date', '<=', $to))
            ->orderBy('stall_settlement_records.id');

        $problems = [];
        $payable = $paidSum = $outstanding = '0.00';
        $checked = 0;

        $query->chunkById(200, function ($records) use (&$problems, &$payable, &$paidSum, &$outstanding, &$checked) {
            foreach ($records as $r) {
                $checked++;
                $net = bcadd(self::money($r->stall_gross_sales), self::money($r->adjustment_amount), 2);
                $paid = $this->paidTotal($r->id);
                $remaining = bcsub($net, $paid, 2);
                $expect = self::deriveStatus($net, $paid);
                $flag = function (string $what) use (&$problems, $r) {
                    $problems[] = ['settlement_id' => $r->id, 'issue' => $what];
                };

                if (bccomp(self::money($r->net_payable), $net, 2) !== 0) $flag("net_payable {$r->net_payable} != gross+adjustment {$net}");
                if (bccomp(self::money($r->paid_amount), $paid, 2) !== 0) $flag("paid_amount {$r->paid_amount} != ledger {$paid}");
                if (bccomp(self::money($r->remaining_amount), $remaining, 2) !== 0) $flag("remaining_amount {$r->remaining_amount} != payable-paid {$remaining}");
                if ($r->payout_status !== $expect) $flag("payout_status {$r->payout_status} != derived {$expect}");
                if (bccomp($net, '0', 2) > 0 && bccomp($paid, $net, 2) > 0) $flag("overpaid: paid {$paid} exceeds payable {$net}");
                if ($r->payout_status === 'paid' && bccomp($paid, $net, 2) !== 0) $flag("marked PAID but ledger {$paid} != payable {$net}");
                if (bccomp(self::money($r->payable_at_close), self::money($r->stall_gross_sales), 2) !== 0) $flag('payable_at_close snapshot differs from gross sales');
                if (($r->settlement_status === 'paid') !== ($r->payout_status === 'paid')) $flag('legacy settlement_status out of step with payout_status');

                $payable = bcadd($payable, $net, 2);
                $paidSum = bcadd($paidSum, $paid, 2);
                $outstanding = bcadd($outstanding, $remaining, 2);
            }
        }, 'stall_settlement_records.id', 'id');

        // Reversal rows must mirror exactly one reversed original
        SettlementPayout::where('entry_type', 'reversal')->with('reverses')->chunkById(200, function ($rows) use (&$problems) {
            foreach ($rows as $rev) {
                $orig = $rev->reverses;
                if (!$orig || $orig->status !== 'reversed' || bccomp(self::money($orig->amount), self::money($rev->amount), 2) !== 0) {
                    $problems[] = ['payout_id' => $rev->id, 'issue' => 'reversal does not mirror a reversed original'];
                }
            }
        });

        // Consolidated payments: allocations add up exactly to the payment
        $consolidatedChecked = 0;
        ConsolidatedPayout::query()->chunkById(200, function ($rows) use (&$problems, &$consolidatedChecked) {
            foreach ($rows as $c) {
                $consolidatedChecked++;
                $children = SettlementPayout::where('consolidated_payout_id', $c->id)->where('entry_type', 'payment')->get();
                $sum = self::money($children->sum('amount'));
                if (bccomp($sum, self::money($c->total_amount), 2) !== 0) {
                    $problems[] = ['consolidated_payout_id' => $c->id, 'issue' => "allocations {$sum} != total {$c->total_amount}"];
                }
                $expectChild = $c->status === 'completed' ? 'completed' : 'reversed';
                if ($children->contains(fn ($p) => $p->status !== $expectChild)) {
                    $problems[] = ['consolidated_payout_id' => $c->id, 'issue' => "child status out of step with {$c->status} consolidated payout"];
                }
            }
        });

        if (bccomp($payable, bcadd($paidSum, $outstanding, 2), 2) !== 0) {
            $problems[] = ['issue' => "grand total: payable {$payable} != paid {$paidSum} + outstanding {$outstanding}"];
        }

        return [
            'ok' => count($problems) === 0,
            'settlements_checked' => $checked,
            'consolidated_checked' => $consolidatedChecked,
            'totals' => ['net_payable' => $payable, 'paid' => $paidSum, 'outstanding' => $outstanding],
            'discrepancies' => $problems,
        ];
    }

    // ---------------------------------------------------------------- internals

    private function assertPayoutInput(string $amount, array $d): void
    {
        if (bccomp($amount, '0', 2) <= 0) {
            throw new PayoutException('The payout amount must be greater than zero.');
        }
        $method = $d['payment_method'] ?? null;
        if (!in_array($method, self::METHODS, true)) {
            throw new PayoutException('Unsupported payment method.');
        }
        if (in_array($method, self::REFERENCE_REQUIRED, true) && trim((string) ($d['transaction_reference'] ?? '')) === '') {
            throw new PayoutException('A transaction reference is required for UPI and bank transfer payouts.');
        }
        if (!empty($d['paid_at']) && Carbon::parse($d['paid_at'])->isAfter(now()->addMinutes(5))) {
            throw new PayoutException('The payment time cannot be in the future.');
        }
    }

    /** Fields every payout row shares, normalised from the request. */
    private function commonFields(array $d): array
    {
        return [
            'payment_method' => $d['payment_method'],
            'transaction_reference' => isset($d['transaction_reference']) && trim($d['transaction_reference']) !== '' ? trim($d['transaction_reference']) : null,
            'paid_at' => !empty($d['paid_at']) ? Carbon::parse($d['paid_at']) : now(),
            'received_by' => $d['received_by'] ?? null,
            'notes' => $d['notes'] ?? null,
        ];
    }

    private function sameRequest(SettlementPayout $existing, int $settlementId, array $d): bool
    {
        return (int) $existing->settlement_id === $settlementId
            && bccomp(self::money($existing->amount), self::money($d['amount']), 2) === 0
            && $existing->payment_method === ($d['payment_method'] ?? null);
    }

    private function insertPayout(StallSettlementRecord $record, User $user, array $attrs): SettlementPayout
    {
        $payout = SettlementPayout::create([
            'entry_type' => 'payment',
            'settlement_id' => $record->id,
            'business_date' => Carbon::parse($record->closing->closing_date)->toDateString(),
            'stall_id' => $record->stall_id,
            'stall_owner_id' => $record->stall->stall_owner_id,
            'paid_by_user_id' => $user->id,
        ] + $attrs);

        return $this->assignNumber($payout);
    }

    private function assignNumber(SettlementPayout $payout): SettlementPayout
    {
        $payout->forceFill(['payout_number' => 'PAY-' . str_pad((string) $payout->id, 6, '0', STR_PAD_LEFT)])->save();

        return $payout;
    }

    private function audit(int $settlementId, ?int $payoutId, ?int $consolidatedId, string $action, User $user, array $details): void
    {
        SettlementPayoutAudit::create([
            'settlement_id' => $settlementId,
            'payout_id' => $payoutId,
            'consolidated_payout_id' => $consolidatedId,
            'action' => $action,
            'user_id' => $user->id,
            'details' => $details,
            'created_at' => now(),
        ]);
    }
}
