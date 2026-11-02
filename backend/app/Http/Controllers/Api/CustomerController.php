<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\Order;
use App\Services\AuditService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Customer directory for the owner and the cashier counter. A customer's order history is every order
 * placed with the same phone number. No loyalty points or rewards (not an approved requirement).
 */
class CustomerController extends Controller
{
    private function denyUnlessOwnerOrCashier(Request $request)
    {
        $user = $request->user();
        if ($user->isOwner() || $user->isCashier()) {
            return null;
        }

        return response()->json(['success' => false, 'message' => 'Unauthorized. Owner or Cashier access required.'], 403);
    }

    /** Phone numbers are stored digits-only (a leading + is kept) so lookups match however they were typed. */
    public static function normalizePhone(?string $phone): ?string
    {
        if ($phone === null) {
            return null;
        }
        $normalized = (str_starts_with(trim($phone), '+') ? '+' : '') . preg_replace('/\D+/', '', $phone);

        return $normalized === '' || $normalized === '+' ? null : $normalized;
    }

    public function index(Request $request)
    {
        if ($denied = $this->denyUnlessOwnerOrCashier($request)) {
            return $denied;
        }

        $request->validate([
            'search' => 'nullable|string|max:100',
            'per_page' => 'nullable|integer|min:1|max:200',
        ]);

        // Paid order count and spend per customer, matched on phone
        $stats = Order::query()
            ->select('customer_phone', DB::raw('COUNT(*) as orders_count'), DB::raw('MAX(created_at) as last_order_at'))
            ->selectRaw("COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'paid'), 0) as total_paid")
            ->whereNotNull('customer_phone')
            ->where('status', '!=', 'cancelled')
            ->groupBy('customer_phone');

        $query = Customer::query()
            ->leftJoinSub($stats, 'stats', 'stats.customer_phone', '=', 'customers.phone')
            ->select('customers.*', DB::raw('COALESCE(stats.orders_count, 0) as orders_count'), DB::raw('COALESCE(stats.total_paid, 0) as total_paid'), 'stats.last_order_at');

        if ($request->filled('search')) {
            $term = '%' . addcslashes($request->query('search'), '%_\\') . '%';
            $query->where(fn ($q) => $q->where('customers.name', 'ilike', $term)
                ->orWhere('customers.phone', 'ilike', $term)
                ->orWhere('customers.email', 'ilike', $term));
        }

        return response()->json([
            'success' => true,
            'data' => $query->orderBy('customers.name')->paginate($request->integer('per_page', 25)),
        ]);
    }

    /** POS lookup by phone: the saved profile, if any. */
    public function lookup(Request $request)
    {
        if ($denied = $this->denyUnlessOwnerOrCashier($request)) {
            return $denied;
        }

        $request->validate(['phone' => 'required|string|max:20']);
        $phone = self::normalizePhone($request->query('phone'));

        return response()->json([
            'success' => true,
            'data' => $phone ? Customer::where('phone', $phone)->first() : null,
        ]);
    }

    public function show(Request $request, $id)
    {
        if ($denied = $this->denyUnlessOwnerOrCashier($request)) {
            return $denied;
        }

        $customer = Customer::findOrFail($id);
        $orders = Order::with(['table:id,table_number', 'items.stall:id,name'])
            ->where('customer_phone', $customer->phone)
            ->orderByDesc('id')
            ->limit(100)
            ->get(['id', 'order_number', 'table_id', 'order_type', 'order_channel', 'status', 'payment_status', 'total_amount', 'created_at']);

        return response()->json([
            'success' => true,
            'data' => [
                'customer' => $customer,
                'orders' => $orders,
                'summary' => [
                    'orders_count' => $orders->where('status', '!=', 'cancelled')->count(),
                    'total_paid' => $orders->where('payment_status', 'paid')->reduce(fn ($sum, $o) => bcadd($sum, (string) $o->total_amount, 2), '0.00'),
                ],
            ],
        ]);
    }

    public function store(Request $request)
    {
        if ($denied = $this->denyUnlessOwnerOrCashier($request)) {
            return $denied;
        }

        $request->merge(['phone' => self::normalizePhone($request->input('phone'))]);
        $validated = $request->validate([
            'name' => 'required|string|max:100',
            'phone' => 'required|string|min:6|max:20|unique:customers,phone',
            'email' => 'nullable|email|max:100',
            'notes' => 'nullable|string|max:1000',
        ], ['phone.unique' => 'A customer with this phone number already exists.']);

        $customer = Customer::create($validated + ['created_by_user_id' => $request->user()->id]);
        AuditService::log('customer_created', 'Customer', $customer->id, null, null, $customer->only(['name', 'phone']));

        return response()->json(['success' => true, 'message' => 'Customer saved', 'data' => $customer], 201);
    }

    public function update(Request $request, $id)
    {
        if ($denied = $this->denyUnlessOwnerOrCashier($request)) {
            return $denied;
        }

        $customer = Customer::findOrFail($id);
        if ($request->has('phone')) {
            $request->merge(['phone' => self::normalizePhone($request->input('phone'))]);
        }
        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:100',
            'phone' => 'sometimes|required|string|min:6|max:20|unique:customers,phone,' . $customer->id,
            'email' => 'nullable|email|max:100',
            'notes' => 'nullable|string|max:1000',
        ], ['phone.unique' => 'A customer with this phone number already exists.']);

        $old = $customer->only(array_keys($validated));
        $customer->update($validated);
        AuditService::log('customer_updated', 'Customer', $customer->id, null, $old, $customer->only(array_keys($validated)));

        return response()->json(['success' => true, 'message' => 'Customer updated', 'data' => $customer]);
    }
}
