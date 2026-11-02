<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CashierClosing;
use App\Models\Payment;
use App\Models\User;
use App\Services\AuditService;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Cashier-wise closing: at the end of a business day a cashier counts the cash from sales and records it
 * against the cash payments they took. variance = counted - expected, nothing more: what happens to a
 * shortage or excess, and to payments taken after a closing, are owner decisions not encoded here.
 */
class CashierClosingController extends Controller
{
    private function resolveCashier(Request $request): User|\Illuminate\Http\JsonResponse
    {
        $user = $request->user();
        if ($user->isCashier()) {
            if ($request->filled('cashier_id') && (int) $request->input('cashier_id') !== $user->id) {
                return response()->json(['success' => false, 'message' => 'Cashiers can only close their own counter.'], 403);
            }

            return $user;
        }
        if ($user->isOwner()) {
            $request->validate(['cashier_id' => 'required|integer']);
            $cashier = User::find($request->input('cashier_id'));
            if (!$cashier || !in_array($cashier->role, ['cashier', 'owner'], true)) {
                return response()->json(['success' => false, 'message' => 'Selected user does not take payments.'], 422);
            }

            return $cashier;
        }

        return response()->json(['success' => false, 'message' => 'Unauthorized. Owner or Cashier access required.'], 403);
    }

    /** Payments taken by $cashierId on $date, as expected cash and non-cash totals. */
    public static function totals(int $cashierId, string $date): array
    {
        $rows = Payment::where('cashier_id', $cashierId)
            ->whereDate('created_at', $date)
            ->where('status', 'success')
            ->get(['payment_method', 'amount']);

        $cash = '0.00';
        $nonCash = '0.00';
        foreach ($rows as $p) {
            if ($p->payment_method === 'cash') {
                $cash = bcadd($cash, (string) $p->amount, 2);
            } else {
                $nonCash = bcadd($nonCash, (string) $p->amount, 2);
            }
        }

        return ['payments_count' => $rows->count(), 'expected_cash' => $cash, 'non_cash_total' => $nonCash];
    }

    public function preview(Request $request)
    {
        $request->validate(['date' => 'required|date']);
        $cashier = $this->resolveCashier($request);
        if (!$cashier instanceof User) {
            return $cashier;
        }

        $date = $request->query('date');

        return response()->json([
            'success' => true,
            'data' => [
                'cashier' => $cashier->only(['id', 'name']),
                'date' => $date,
                'totals' => self::totals($cashier->id, $date),
                'closing' => CashierClosing::with('closedBy:id,name')->where('cashier_id', $cashier->id)->whereDate('business_date', $date)->first(),
            ],
        ]);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'date' => 'required|date|before_or_equal:today',
            'counted_cash' => 'required|numeric|min:0|max:99999999',
            'notes' => 'nullable|string|max:500',
        ]);
        $cashier = $this->resolveCashier($request);
        if (!$cashier instanceof User) {
            return $cashier;
        }

        try {
            $closing = DB::transaction(function () use ($validated, $cashier, $request) {
                $totals = self::totals($cashier->id, $validated['date']);
                $counted = bcadd((string) $validated['counted_cash'], '0', 2);

                return CashierClosing::create([
                    'cashier_id' => $cashier->id,
                    'business_date' => $validated['date'],
                    'payments_count' => $totals['payments_count'],
                    'expected_cash' => $totals['expected_cash'],
                    'counted_cash' => $counted,
                    'variance' => bcsub($counted, $totals['expected_cash'], 2),
                    'non_cash_total' => $totals['non_cash_total'],
                    'notes' => $validated['notes'] ?? null,
                    'closed_by_user_id' => $request->user()->id,
                ]);
            });
        } catch (UniqueConstraintViolationException) {
            return response()->json(['success' => false, 'message' => 'This cashier has already been closed for that date.'], 422);
        }

        AuditService::log('cashier_closed', 'CashierClosing', $closing->id, null, null, $closing->only([
            'cashier_id', 'business_date', 'expected_cash', 'counted_cash', 'variance', 'non_cash_total',
        ]));

        return response()->json(['success' => true, 'message' => 'Cashier closing recorded', 'data' => $closing->load('cashier:id,name', 'closedBy:id,name')], 201);
    }

    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user->isOwner() && !$user->isCashier()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Owner or Cashier access required.'], 403);
        }

        $request->validate([
            'date_from' => 'nullable|date',
            'date_to' => 'nullable|date|after_or_equal:date_from',
            'cashier_id' => 'nullable|integer',
            'per_page' => 'nullable|integer|min:1|max:200',
        ]);

        $query = CashierClosing::with('cashier:id,name', 'closedBy:id,name')->orderByDesc('business_date')->orderByDesc('id');
        if ($user->isCashier()) {
            $query->where('cashier_id', $user->id);
        } elseif ($request->filled('cashier_id')) {
            $query->where('cashier_id', $request->query('cashier_id'));
        }
        if ($request->filled('date_from')) {
            $query->whereDate('business_date', '>=', $request->query('date_from'));
        }
        if ($request->filled('date_to')) {
            $query->whereDate('business_date', '<=', $request->query('date_to'));
        }

        return response()->json(['success' => true, 'data' => $query->paginate($request->integer('per_page', 30))]);
    }
}
