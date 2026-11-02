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

        return response()->json([
            'success' => true,
            'data' => [
                'today_revenue' => number_format($todayRevenue, 2, '.', ''),
                'today_orders_count' => $todayOrders->count(),
                'active_orders_count' => $activeOrdersCount,
                'occupied_tables' => "{$occupiedTablesCount}/{$totalTablesCount}",
                'total_stalls' => $stallsCount,
                'stall_sales' => $stallSalesToday,
                'recent_orders' => $recentOrders,
            ]
        ]);
    }

    public function stallSalesReport(Request $request)
    {
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

        $logs = AuditLog::with('user:id,name,role', 'stall:id,name')
            ->orderByDesc('id')
            ->paginate($request->integer('per_page', 50));

        return response()->json([
            'success' => true,
            'data' => $logs,
        ]);
    }
}

