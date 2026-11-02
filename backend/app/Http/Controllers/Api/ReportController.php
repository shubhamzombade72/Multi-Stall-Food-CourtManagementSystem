<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\DiningTable;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Stall;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ReportController extends Controller
{
    public function dashboardStats(Request $request)
    {
        $user = $request->user();
        if (!$user->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Owner access required.'], 403);
        }

        $today = now()->toDateString();

        $todayOrders = Order::whereDate('created_at', $today)->get();
        $todayRevenue = $todayOrders->where('payment_status', 'paid')->sum('total_amount');
        $activeOrdersCount = $todayOrders->whereNotIn('status', ['completed', 'cancelled'])->count();
        $occupiedTablesCount = DiningTable::where('status', 'occupied')->count();
        $totalTablesCount = DiningTable::where('is_active', true)->count();
        $stallsCount = Stall::where('is_active', true)->count();

        // Stall-wise sales today
        $stallSalesToday = OrderItem::join('orders', 'order_items.order_id', '=', 'orders.id')
            ->join('stalls', 'order_items.stall_id', '=', 'stalls.id')
            ->whereDate('orders.created_at', $today)
            ->where('orders.payment_status', 'paid')
            ->select(
                'stalls.id',
                'stalls.name',
                'stalls.code',
                DB::raw('SUM(order_items.subtotal) as total_sales'),
                DB::raw('COUNT(order_items.id) as total_items')
            )
            ->groupBy('stalls.id', 'stalls.name', 'stalls.code')
            ->get();

        // Recent 5 orders
        $recentOrders = Order::with(['table:id,table_number', 'items.stall:id,name,code'])
            ->orderByDesc('id')
            ->limit(5)
            ->get();

        // Everything below is read straight from the database; no profit, commission or settlement is derived.
        $pending = Order::where('payment_status', 'unpaid')->where('status', '!=', 'cancelled');
        $paymentMethods = DB::table('payments')
            ->whereDate('created_at', $today)->where('status', 'success')
            ->select('payment_method', DB::raw('COUNT(*) as count'), DB::raw('SUM(amount) as total'))
            ->groupBy('payment_method')->get();
        $lowStock = \App\Models\InventoryItem::with('stall:id,name')
            ->whereColumn('current_stock', '<=', 'minimum_alert_stock')
            ->orderBy('current_stock')->get(['id', 'stall_id', 'name', 'unit', 'current_stock', 'minimum_alert_stock']);
        $closing = \App\Models\DailyClosing::where('closing_date', $today)->first(['id', 'closing_date', 'status', 'created_at']);
        $staff = \App\Models\User::select('role', DB::raw('COUNT(*) FILTER (WHERE is_active) as active'), DB::raw('COUNT(*) as total'))
            ->groupBy('role')->get();
        $recentActivity = AuditLog::with('user:id,name,role')->orderByDesc('id')->limit(8)
            ->get(['id', 'user_id', 'action', 'entity_type', 'entity_id', 'created_at']);
        $purchasesToday = \App\Models\PurchaseOrder::whereDate('created_at', $today)
            ->select(DB::raw('COUNT(*) as count'), DB::raw('COALESCE(SUM(total_amount),0) as total'))->first();

        return response()->json([
            'success' => true,
            'data' => [
                'today_revenue' => number_format($todayRevenue, 2, '.', ''),
                'today_orders_count' => $todayOrders->count(),
                'active_orders_count' => $activeOrdersCount,
                'completed_orders_count' => $todayOrders->where('status', 'completed')->count(),
                'occupied_tables' => "{$occupiedTablesCount}/{$totalTablesCount}",
                'total_stalls' => $stallsCount,
                'stall_sales' => $stallSalesToday,
                'recent_orders' => $recentOrders,
                'pending_bills' => ['count' => (clone $pending)->count(), 'amount' => (string) ((clone $pending)->sum('total_amount'))],
                'payment_methods_today' => $paymentMethods,
                'low_stock_items' => $lowStock,
                'purchases_today' => $purchasesToday,
                'closing_today' => $closing,
                'staff_by_role' => $staff,
                'recent_activity' => $recentActivity,
                'server_time' => now()->toIso8601String(),
            ]
        ]);
    }

    /** Payments taken per cashier on a date (owner only). */
    public function cashierActivity(Request $request)
    {
        if (!$request->user()->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Owner access required.'], 403);
        }
        $request->validate(['date' => 'nullable|date']);
        $date = $request->query('date', now()->toDateString());

        $rows = DB::table('payments')
            ->join('users', 'users.id', '=', 'payments.cashier_id')
            ->whereDate('payments.created_at', $date)
            ->where('payments.status', 'success')
            ->select(
                'users.id as cashier_id',
                'users.name as cashier_name',
                'payments.payment_method',
                DB::raw('COUNT(*) as payments_count'),
                DB::raw('SUM(payments.amount) as total_amount')
            )
            ->groupBy('users.id', 'users.name', 'payments.payment_method')
            ->orderBy('users.name')
            ->get();

        return response()->json(['success' => true, 'data' => ['date' => $date, 'rows' => $rows]]);
    }

    /** Quantity and revenue per menu item over a date range (paid orders only, owner only). */
    public function menuPerformance(Request $request)
    {
        if (!$request->user()->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Owner access required.'], 403);
        }
        $request->validate([
            'start_date' => 'nullable|date',
            'end_date' => 'nullable|date|after_or_equal:start_date',
        ]);
        $start = $request->query('start_date', now()->subDays(7)->toDateString());
        $end = $request->query('end_date', now()->toDateString());

        $rows = OrderItem::join('orders', 'order_items.order_id', '=', 'orders.id')
            ->join('stalls', 'order_items.stall_id', '=', 'stalls.id')
            ->whereBetween(DB::raw('DATE(orders.created_at)'), [$start, $end])
            ->where('orders.payment_status', 'paid')
            ->select(
                'order_items.menu_item_id',
                'order_items.item_name',
                'stalls.name as stall_name',
                DB::raw('SUM(order_items.quantity) as quantity_sold'),
                DB::raw('SUM(order_items.subtotal) as revenue')
            )
            ->groupBy('order_items.menu_item_id', 'order_items.item_name', 'stalls.name')
            ->orderByDesc('revenue')
            ->get();

        return response()->json(['success' => true, 'data' => ['start_date' => $start, 'end_date' => $end, 'items' => $rows]]);
    }

    public function stallSalesReport(Request $request)
    {
        if (!$request->user()->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Owner access required.'], 403);
        }

        $request->validate([
            'start_date' => 'nullable|date',
            'end_date' => 'nullable|date|after_or_equal:start_date',
        ]);

        $startDate = $request->query('start_date', now()->subDays(7)->toDateString());
        $endDate = $request->query('end_date', now()->toDateString());

        $report = OrderItem::join('orders', 'order_items.order_id', '=', 'orders.id')
            ->join('stalls', 'order_items.stall_id', '=', 'stalls.id')
            ->whereBetween(DB::raw('DATE(orders.created_at)'), [$startDate, $endDate])
            ->where('orders.payment_status', 'paid')
            ->select(
                'stalls.id as stall_id',
                'stalls.name as stall_name',
                'stalls.code as stall_code',
                DB::raw('COUNT(DISTINCT orders.id) as orders_count'),
                DB::raw('SUM(order_items.quantity) as items_quantity_sold'),
                DB::raw('SUM(order_items.subtotal) as total_revenue')
            )
            ->groupBy('stalls.id', 'stalls.name', 'stalls.code')
            ->orderByDesc('total_revenue')
            ->get();

        return response()->json([
            'success' => true,
            'data' => [
                'start_date' => $startDate,
                'end_date' => $endDate,
                'stalls_performance' => $report,
            ]
        ]);
    }

    public function auditLogs(Request $request)
    {
        $user = $request->user();
        if (!$user->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
        }

        $request->validate([
            'action' => 'nullable|string|max:300',
            'entity_type' => 'nullable|string|max:60',
            'user_id' => 'nullable|integer',
            'date_from' => 'nullable|date',
            'date_to' => 'nullable|date|after_or_equal:date_from',
            'per_page' => 'nullable|integer|min:1|max:200',
        ]);

        $query = AuditLog::with('user:id,name,role', 'stall:id,name')->orderByDesc('id');
        // action may be a comma-separated list, e.g. login history = login_success,login_failed,...
        if ($request->filled('action')) {
            $query->whereIn('action', array_filter(array_map('trim', explode(',', $request->query('action')))));
        }
        foreach (['entity_type', 'user_id'] as $field) {
            if ($request->filled($field)) {
                $query->where($field, $request->query($field));
            }
        }
        $this->applyDateRange($query, $request, 'created_at');

        return response()->json([
            'success' => true,
            'data' => $query->paginate($request->integer('per_page', 50)),
        ]);
    }

    private function applyDateRange($query, Request $request, string $column): void
    {
        if ($request->filled('date_from')) {
            $query->whereDate($column, '>=', $request->query('date_from'));
        }
        if ($request->filled('date_to')) {
            $query->whereDate($column, '<=', $request->query('date_to'));
        }
    }

    /** Owner-only guard + a validated [start, end] date range (defaults: last 7 days). */
    private function ownerRange(Request $request): array|\Illuminate\Http\JsonResponse
    {
        if (!$request->user()->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Owner access required.'], 403);
        }
        $request->validate([
            'start_date' => 'nullable|date',
            'end_date' => 'nullable|date|after_or_equal:start_date',
            'stall_id' => 'nullable|integer',
        ]);

        return [
            $request->query('start_date', now()->subDays(6)->toDateString()),
            $request->query('end_date', now()->toDateString()),
        ];
    }

    /** Day-by-day sales: orders taken, cancelled, paid, and the paid amounts (subtotal, tax, total). */
    public function salesSummary(Request $request)
    {
        $range = $this->ownerRange($request);
        if (!is_array($range)) {
            return $range;
        }

        $rows = Order::query()
            ->whereBetween(DB::raw('DATE(created_at)'), $range)
            ->selectRaw('DATE(created_at) as day')
            ->selectRaw('COUNT(*) as orders_count')
            ->selectRaw("COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_count")
            ->selectRaw("COUNT(*) FILTER (WHERE payment_status = 'paid') as paid_count")
            ->selectRaw("COALESCE(SUM(subtotal) FILTER (WHERE payment_status = 'paid'), 0) as paid_subtotal")
            ->selectRaw("COALESCE(SUM(tax_amount) FILTER (WHERE payment_status = 'paid'), 0) as paid_tax")
            ->selectRaw("COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'paid'), 0) as paid_total")
            ->groupBy(DB::raw('DATE(created_at)'))
            ->orderBy('day')
            ->get();

        $byChannel = Order::query()
            ->whereBetween(DB::raw('DATE(created_at)'), $range)
            ->where('status', '!=', 'cancelled')
            ->select('order_channel', DB::raw('COUNT(*) as orders_count'))
            ->selectRaw("COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'paid'), 0) as paid_total")
            ->groupBy('order_channel')
            ->get();

        return response()->json(['success' => true, 'data' => [
            'start_date' => $range[0], 'end_date' => $range[1], 'days' => $rows, 'by_channel' => $byChannel,
        ]]);
    }

    /** Successful payments by method and by day. */
    public function paymentSummary(Request $request)
    {
        $range = $this->ownerRange($request);
        if (!is_array($range)) {
            return $range;
        }

        $base = fn () => \App\Models\Payment::query()
            ->where('status', 'success')
            ->whereBetween(DB::raw('DATE(created_at)'), $range);

        return response()->json(['success' => true, 'data' => [
            'start_date' => $range[0],
            'end_date' => $range[1],
            'by_method' => $base()->select('payment_method', DB::raw('COUNT(*) as payments_count'), DB::raw('SUM(amount) as total_amount'))
                ->groupBy('payment_method')->orderByDesc('total_amount')->get(),
            'by_day' => $base()->selectRaw('DATE(created_at) as day, COUNT(*) as payments_count, SUM(amount) as total_amount')
                ->groupBy(DB::raw('DATE(created_at)'))->orderBy('day')->get(),
        ]]);
    }

    /** Purchases by supplier: orders raised, received value, still open. */
    public function purchaseReport(Request $request)
    {
        $range = $this->ownerRange($request);
        if (!is_array($range)) {
            return $range;
        }

        $rows = DB::table('purchase_orders')
            ->join('suppliers', 'suppliers.id', '=', 'purchase_orders.supplier_id')
            ->join('stalls', 'stalls.id', '=', 'purchase_orders.stall_id')
            ->whereBetween('purchase_orders.order_date', $range)
            ->when($request->filled('stall_id'), fn ($q) => $q->where('purchase_orders.stall_id', $request->query('stall_id')))
            ->select('suppliers.id as supplier_id', 'suppliers.name as supplier_name', 'stalls.name as stall_name')
            ->selectRaw('COUNT(*) as purchase_orders')
            ->selectRaw("COUNT(*) FILTER (WHERE purchase_orders.status = 'ordered') as open_orders")
            ->selectRaw("COALESCE(SUM(purchase_orders.total_amount) FILTER (WHERE purchase_orders.status = 'received'), 0) as received_total")
            ->selectRaw("COALESCE(SUM(purchase_orders.total_amount) FILTER (WHERE purchase_orders.status = 'ordered'), 0) as open_total")
            ->groupBy('suppliers.id', 'suppliers.name', 'stalls.name')
            ->orderByDesc('received_total')
            ->get();

        return response()->json(['success' => true, 'data' => ['start_date' => $range[0], 'end_date' => $range[1], 'suppliers' => $rows]]);
    }

    /** Current stock per item with its value at the last purchase cost (current_stock x unit_cost). */
    public function inventoryReport(Request $request)
    {
        $range = $this->ownerRange($request);
        if (!is_array($range)) {
            return $range;
        }

        $items = \App\Models\InventoryItem::with('stall:id,name')
            ->when($request->filled('stall_id'), fn ($q) => $q->where('stall_id', $request->query('stall_id')))
            ->orderBy('stall_id')->orderBy('name')
            ->get()
            ->map(fn ($i) => [
                'id' => $i->id,
                'stall_name' => $i->stall?->name,
                'name' => $i->name,
                'unit' => $i->unit,
                'current_stock' => $i->current_stock,
                'minimum_alert_stock' => $i->minimum_alert_stock,
                'unit_cost' => $i->unit_cost,
                'stock_value' => bcmul((string) $i->current_stock, (string) $i->unit_cost, 2),
                'is_low' => bccomp((string) $i->current_stock, (string) $i->minimum_alert_stock, 3) <= 0,
            ]);

        return response()->json(['success' => true, 'data' => [
            'items' => $items,
            'total_value' => $items->reduce(fn ($sum, $i) => bcadd($sum, $i['stock_value'], 2), '0.00'),
            'low_stock_count' => $items->where('is_low', true)->count(),
        ]]);
    }

    /** Audited actions per staff member in the range, including sign-ins and denied requests. */
    public function staffActivity(Request $request)
    {
        $range = $this->ownerRange($request);
        if (!is_array($range)) {
            return $range;
        }

        $rows = AuditLog::query()
            ->join('users', 'users.id', '=', 'audit_logs.user_id')
            ->whereBetween(DB::raw('DATE(audit_logs.created_at)'), $range)
            ->select('users.id as user_id', 'users.name', 'users.role', 'users.is_active')
            ->selectRaw('COUNT(*) as actions')
            ->selectRaw("COUNT(*) FILTER (WHERE audit_logs.action = 'login_success') as logins")
            ->selectRaw("COUNT(*) FILTER (WHERE audit_logs.action = 'access_denied') as denied_requests")
            ->selectRaw('MAX(audit_logs.created_at) as last_activity_at')
            ->groupBy('users.id', 'users.name', 'users.role', 'users.is_active')
            ->orderByDesc('actions')
            ->get();

        return response()->json(['success' => true, 'data' => ['start_date' => $range[0], 'end_date' => $range[1], 'staff' => $rows]]);
    }
}

