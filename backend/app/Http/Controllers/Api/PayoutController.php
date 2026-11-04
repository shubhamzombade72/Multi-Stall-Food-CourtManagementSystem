<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ConsolidatedPayout;
use App\Models\SettlementPayout;
use App\Models\SettlementPayoutAudit;
use App\Models\Stall;
use App\Models\StallOwner;
use App\Models\StallSettlementRecord;
use App\Services\PayoutException;
use App\Services\PayoutService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Payout recording, history, owner-wise consolidated payouts and reconciliation (owner only).
 * A payout row exists only because an authorised user confirmed the payment was made; nothing here moves money.
 */
class PayoutController extends Controller
{
    public function __construct(private readonly PayoutService $payouts)
    {
    }

    private function denied(Request $request): ?JsonResponse
    {
        return $request->user()?->isOwner()
            ? null
            : response()->json(['success' => false, 'message' => 'Unauthorized. Owner access required.'], 403);
    }

    /** Run a ledger action and turn its business-rule refusals into JSON errors. */
    private function guard(callable $fn): JsonResponse
    {
        try {
            return $fn();
        } catch (PayoutException $e) {
            return response()->json(['success' => false, 'message' => $e->getMessage()], $e->status);
        }
    }

    private function payoutRules(): array
    {
        return [
            'amount' => 'required|numeric|min:0.01|max:9999999999.99|decimal:0,2',
            'payment_method' => ['required', Rule::in(PayoutService::METHODS)],
            'transaction_reference' => 'nullable|string|max:100',
            'received_by' => 'nullable|string|max:100',
            'notes' => 'nullable|string|max:1000',
            'paid_at' => 'nullable|date',
            'idempotency_key' => 'required|string|min:8|max:100',
        ];
    }

    private function withKey(Request $request): void
    {
        if (!$request->filled('idempotency_key') && $request->header('Idempotency-Key')) {
            $request->merge(['idempotency_key' => $request->header('Idempotency-Key')]);
        }
    }

    // ------------------------------------------------------------ record

    public function store(Request $request, int $recordId)
    {
        if ($deny = $this->denied($request)) return $deny;
        $this->withKey($request);
        $d = $request->validate($this->payoutRules() + [
            'outcome' => ['nullable', Rule::in(['completed', 'failed'])],
            'failure_reason' => 'nullable|string|max:255',
        ]);

        return $this->guard(function () use ($request, $recordId, $d) {
            [$payout, $duplicate] = $this->payouts->record($request->user(), $recordId, $d);
            $record = StallSettlementRecord::with('stall.owner')->find($recordId);

            return response()->json([
                'success' => true,
                'duplicate' => $duplicate,
                'message' => $duplicate
                    ? 'This payout was already recorded; no second payout was created.'
                    : ($payout->status === 'failed' ? 'Failed payout attempt recorded. The outstanding balance is unchanged.' : 'Payout recorded.'),
                'data' => ['payout' => $payout, 'settlement' => $record],
            ], $duplicate ? 200 : 201);
        });
    }

    public function adjust(Request $request, int $recordId)
    {
        if ($deny = $this->denied($request)) return $deny;
        $d = $request->validate([
            'amount' => 'required|numeric|decimal:0,2|between:-9999999999.99,9999999999.99',
            'reason' => 'required|string|min:3|max:255',
        ]);

        return $this->guard(function () use ($request, $recordId, $d) {
            $record = $this->payouts->adjust($request->user(), $recordId, (string) $d['amount'], $d['reason']);

            return response()->json(['success' => true, 'message' => 'Adjustment recorded.', 'data' => $record->load('stall.owner')]);
        });
    }

    public function reverse(Request $request, int $id)
    {
        if ($deny = $this->denied($request)) return $deny;
        $this->withKey($request);
        $d = $request->validate([
            'reason' => 'required|string|min:3|max:255',
            'idempotency_key' => 'nullable|string|min:8|max:100',
        ]);

        return $this->guard(function () use ($request, $id, $d) {
            [$reversal, $duplicate] = $this->payouts->reverse($request->user(), $id, $d['reason'], $d['idempotency_key'] ?? null);

            return response()->json([
                'success' => true,
                'duplicate' => $duplicate,
                'message' => $duplicate ? 'This reversal was already recorded.' : 'Payout reversed. The original record is kept and a reversal entry was added.',
                'data' => ['reversal' => $reversal, 'settlement' => StallSettlementRecord::with('stall.owner')->find($reversal->settlement_id)],
            ], $duplicate ? 200 : 201);
        });
    }

    // ------------------------------------------------------------ read

    /** A settlement with its full payout ledger and audit trail (the "View Payout History" drawer). */
    public function settlementDetail(Request $request, int $recordId)
    {
        if ($deny = $this->denied($request)) return $deny;

        $record = StallSettlementRecord::with(['stall.owner', 'closing', 'payouts.paidBy:id,name', 'payouts.consolidated:id,consolidated_number'])->findOrFail($recordId);
        $audits = SettlementPayoutAudit::with('user:id,name')->where('settlement_id', $recordId)->orderBy('id')->get();

        return response()->json(['success' => true, 'data' => ['settlement' => $record, 'audit' => $audits]]);
    }

    public function history(Request $request)
    {
        if ($deny = $this->denied($request)) return $deny;

        $request->validate([
            'business_date' => 'nullable|date', 'date_from' => 'nullable|date', 'date_to' => 'nullable|date',
            'stall_id' => 'nullable|integer', 'stall_owner_id' => 'nullable|integer',
            'payment_method' => ['nullable', Rule::in(PayoutService::METHODS)],
            'status' => ['nullable', Rule::in(['completed', 'failed', 'reversed', 'reversal'])],
            'per_page' => 'nullable|integer|min:1|max:200',
        ]);

        $q = SettlementPayout::query()->with(['stall:id,name,code', 'owner:id,name', 'paidBy:id,name', 'consolidated:id,consolidated_number', 'settlement:id,payout_status,net_payable,paid_amount,remaining_amount'])
            ->when($request->filled('business_date'), fn ($q) => $q->where('business_date', $request->query('business_date')))
            ->when($request->filled('date_from'), fn ($q) => $q->where('business_date', '>=', $request->query('date_from')))
            ->when($request->filled('date_to'), fn ($q) => $q->where('business_date', '<=', $request->query('date_to')))
            ->when($request->filled('stall_id'), fn ($q) => $q->where('stall_id', $request->query('stall_id')))
            ->when($request->filled('stall_owner_id'), fn ($q) => $q->where('stall_owner_id', $request->query('stall_owner_id')))
            ->when($request->filled('payment_method'), fn ($q) => $q->where('payment_method', $request->query('payment_method')))
            ->when($request->filled('status'), function ($q) use ($request) {
                $s = $request->query('status');

                return $s === 'reversal' ? $q->where('entry_type', 'reversal') : $q->where('entry_type', 'payment')->where('status', $s);
            })
            ->when($request->filled('q'), function ($q) use ($request) {
                $like = '%' . $request->query('q') . '%';
                $q->where(fn ($w) => $w->where('payout_number', 'like', $like)->orWhere('transaction_reference', 'like', $like));
            });

        // Totals over the whole filter (not just the page); completed payments only, so reversals/failures never inflate them
        $paidTotal = PayoutService::money((clone $q)->where('entry_type', 'payment')->where('status', 'completed')->sum('amount'));
        $q->orderByDesc('paid_at')->orderByDesc('id');

        return response()->json([
            'success' => true,
            'data' => $q->paginate($request->integer('per_page', 25)),
            'totals' => ['completed_paid' => $paidTotal],
        ]);
    }

    public function show(Request $request, int $id)
    {
        if ($deny = $this->denied($request)) return $deny;

        $payout = SettlementPayout::with([
            'stall:id,name,code', 'owner:id,name,phone', 'paidBy:id,name', 'consolidated.allocations.stall:id,name,code',
            'settlement.closing', 'reverses:id,payout_number', 'audits.user:id,name',
        ])->findOrFail($id);

        $reversal = SettlementPayout::where('reverses_payout_id', $id)->first(['id', 'payout_number', 'paid_at', 'reversal_reason']);

        return response()->json(['success' => true, 'data' => ['payout' => $payout, 'reversal' => $reversal]]);
    }

    /** Receipt for a recorded payout. It documents a manual confirmation; it is not proof of an electronic transfer. */
    public function receipt(Request $request, int $id)
    {
        if ($deny = $this->denied($request)) return $deny;

        $payout = SettlementPayout::with(['stall:id,name,code', 'owner:id,name,phone', 'paidBy:id,name', 'consolidated:id,consolidated_number,total_amount'])->findOrFail($id);
        $paidToDate = bcsub((string) $payout->payable_at_time, (string) $payout->balance_after, 2);

        return response()->json(['success' => true, 'data' => [
            'receipt_number' => $payout->payout_number,
            'food_court' => SettingsController::current('business_profile')['name'] ?? 'Food Court',
            'entry_type' => $payout->entry_type,
            'status' => $payout->status,
            'business_date' => $payout->business_date->toDateString(),
            'stall' => $payout->stall,
            'owner' => $payout->owner,
            'payable' => $payout->payable_at_time,
            'amount' => $payout->amount,
            'paid_to_date' => $paidToDate,
            'balance_after' => $payout->balance_after,
            'payment_method' => $payout->payment_method,
            'transaction_reference' => $payout->transaction_reference,
            'paid_at' => $payout->paid_at,
            'paid_by' => $payout->paidBy?->name,
            'received_by' => $payout->received_by,
            'notes' => $payout->notes,
            'consolidated' => $payout->consolidated,
            'disclaimer' => 'Manual payout record confirmed by the paying user. This is not proof of an electronic transfer.',
        ]]);
    }

    // ------------------------------------------------------------ owner-wise

    /**
     * Per-owner consolidated view over a date range: payable, paid and outstanding across every stall the owner holds,
     * with the per-stall breakdown and the payout trail. Totals come from the settlement registers, so a consolidated
     * payment is counted once, never once per stall.
     */
    public function owners(Request $request)
    {
        if ($deny = $this->denied($request)) return $deny;

        $from = $request->query('date_from');
        $to = $request->query('date_to');

        $records = StallSettlementRecord::query()
            ->join('daily_closings', 'daily_closings.id', '=', 'stall_settlement_records.closing_id')
            ->select('stall_settlement_records.*', 'daily_closings.closing_date')
            ->when($from, fn ($q) => $q->where('daily_closings.closing_date', '>=', $from))
            ->when($to, fn ($q) => $q->where('daily_closings.closing_date', '<=', $to))
            ->with('stall:id,name,code,stall_owner_id')
            ->get();

        $owners = StallOwner::with('stalls:id,name,code,stall_owner_id')
            ->when($request->filled('stall_owner_id'), fn ($q) => $q->whereKey($request->query('stall_owner_id')))
            ->orderBy('name')->get();

        $payouts = SettlementPayout::query()
            ->with(['stall:id,name,code', 'consolidated:id,consolidated_number,total_amount,status'])
            ->where('entry_type', 'payment')
            ->whereIn('settlement_id', $records->pluck('id'))
            ->orderBy('paid_at')->get();

        $build = function (?StallOwner $owner, $ownerRecords) use ($payouts) {
            $ids = $ownerRecords->pluck('id')->all();
            $own = $payouts->whereIn('settlement_id', $ids);
            $stalls = $ownerRecords->groupBy('stall_id')->map(function ($rs) use ($own) {
                $first = $rs->first();
                $net = $rs->sum(fn ($r) => (float) $r->net_payable);
                $paid = $rs->sum(fn ($r) => (float) $r->paid_amount);

                return [
                    'stall_id' => $first->stall_id,
                    'stall_name' => $first->stall?->name,
                    'sales' => PayoutService::money($rs->sum(fn ($r) => (float) $r->stall_gross_sales)),
                    'net_payable' => PayoutService::money($net),
                    'paid' => PayoutService::money($paid),
                    'outstanding' => PayoutService::money($net - $paid),
                    'methods' => $own->whereIn('settlement_id', $rs->pluck('id'))->where('status', 'completed')->pluck('payment_method')->unique()->values(),
                ];
            })->values();

            $net = $ownerRecords->sum(fn ($r) => (float) $r->net_payable);
            $paid = $ownerRecords->sum(fn ($r) => (float) $r->paid_amount);

            return [
                'owner' => $owner ? $owner->only(['id', 'name', 'phone', 'upi_id']) : ['id' => null, 'name' => 'Unassigned stalls', 'phone' => null, 'upi_id' => null],
                'stall_count' => $stalls->count(),
                'net_payable' => PayoutService::money($net),
                'paid' => PayoutService::money($paid),
                'outstanding' => PayoutService::money($net - $paid),
                'methods_used' => $own->where('status', 'completed')->pluck('payment_method')->unique()->values(),
                'stalls' => $stalls,
                // Each ledger row once; a consolidated payment shows its allocation to the stall, plus the consolidated reference
                'payouts' => $own->map(fn ($p) => [
                    'payout_number' => $p->payout_number, 'business_date' => $p->business_date->toDateString(),
                    'stall' => $p->stall?->name, 'amount' => $p->amount, 'payment_method' => $p->payment_method,
                    'transaction_reference' => $p->transaction_reference, 'paid_at' => $p->paid_at, 'status' => $p->status,
                    'consolidated_number' => $p->consolidated?->consolidated_number,
                ])->values(),
            ];
        };

        $result = $owners->map(fn ($o) => $build($o, $records->filter(fn ($r) => (int) $r->stall?->stall_owner_id === $o->id)))
            ->filter(fn ($row) => $row['stall_count'] > 0 || !$request->filled('date_from'))->values();

        $unassigned = $records->filter(fn ($r) => !$r->stall?->stall_owner_id);
        if ($unassigned->isNotEmpty() && !$request->filled('stall_owner_id')) {
            $result->push($build(null, $unassigned));
        }

        $net = $records->sum(fn ($r) => (float) $r->net_payable);
        $paid = $records->sum(fn ($r) => (float) $r->paid_amount);

        return response()->json(['success' => true, 'data' => [
            'owners' => $result,
            'grand_total' => ['net_payable' => PayoutService::money($net), 'paid' => PayoutService::money($paid), 'outstanding' => PayoutService::money($net - $paid)],
        ]]);
    }

    /** Settlements of one owner that still have a balance (the allocation worksheet for a consolidated payout). */
    public function ownerOutstanding(Request $request, int $ownerId)
    {
        if ($deny = $this->denied($request)) return $deny;
        $owner = StallOwner::findOrFail($ownerId);

        $rows = StallSettlementRecord::query()
            ->join('stalls', 'stalls.id', '=', 'stall_settlement_records.stall_id')
            ->join('daily_closings', 'daily_closings.id', '=', 'stall_settlement_records.closing_id')
            ->where('stalls.stall_owner_id', $ownerId)
            ->where('stall_settlement_records.remaining_amount', '>', 0)
            ->orderBy('daily_closings.closing_date')->orderBy('stall_settlement_records.id')
            ->get(['stall_settlement_records.id', 'stalls.name as stall_name', 'daily_closings.closing_date as business_date',
                'stall_settlement_records.net_payable', 'stall_settlement_records.paid_amount', 'stall_settlement_records.remaining_amount']);

        return response()->json(['success' => true, 'data' => ['owner' => $owner, 'settlements' => $rows,
            'outstanding' => PayoutService::money($rows->sum(fn ($r) => (float) $r->remaining_amount))]]);
    }

    public function storeConsolidated(Request $request, int $ownerId)
    {
        if ($deny = $this->denied($request)) return $deny;
        $this->withKey($request);
        $d = $request->validate([
            'total_amount' => 'required|numeric|min:0.01|max:9999999999.99|decimal:0,2',
            'auto' => 'nullable|boolean',
            'allocations' => 'nullable|array',
            'allocations.*.settlement_id' => 'required_with:allocations|integer',
            'allocations.*.amount' => 'required_with:allocations|numeric|decimal:0,2',
            'payment_method' => ['required', Rule::in(PayoutService::METHODS)],
            'transaction_reference' => 'nullable|string|max:100',
            'received_by' => 'nullable|string|max:100',
            'notes' => 'nullable|string|max:1000',
            'paid_at' => 'nullable|date',
            'idempotency_key' => 'required|string|min:8|max:100',
        ]);

        return $this->guard(function () use ($request, $ownerId, $d) {
            [$consolidated, $duplicate] = $this->payouts->recordConsolidated($request->user(), $ownerId, $d);

            return response()->json([
                'success' => true,
                'duplicate' => $duplicate,
                'message' => $duplicate ? 'This payout was already recorded; no second payout was created.' : 'Consolidated payout recorded and allocated.',
                'data' => $consolidated,
            ], $duplicate ? 200 : 201);
        });
    }

    public function showConsolidated(Request $request, int $id)
    {
        if ($deny = $this->denied($request)) return $deny;

        return response()->json(['success' => true, 'data' => ConsolidatedPayout::with(['owner', 'paidBy:id,name', 'payouts.stall:id,name,code'])->findOrFail($id)]);
    }

    public function reverseConsolidated(Request $request, int $id)
    {
        if ($deny = $this->denied($request)) return $deny;
        $d = $request->validate(['reason' => 'required|string|min:3|max:255']);

        return $this->guard(fn () => response()->json([
            'success' => true,
            'message' => 'Consolidated payout reversed across all its allocations.',
            'data' => $this->payouts->reverseConsolidated($request->user(), $id, $d['reason']),
        ]));
    }

    // ------------------------------------------------------------ reconciliation

    public function reconciliation(Request $request)
    {
        if ($deny = $this->denied($request)) return $deny;

        return response()->json(['success' => true, 'data' => $this->payouts->reconcile($request->query('date_from'), $request->query('date_to'))]);
    }
}
