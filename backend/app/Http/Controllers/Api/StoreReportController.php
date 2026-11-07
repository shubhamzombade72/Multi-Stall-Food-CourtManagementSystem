<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\StoreItem;
use App\Models\StoreMovement;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Central store reports for the owner. Issued value is information only: nothing here changes a settlement. */
class StoreReportController extends Controller
{
    private function range(Request $request): array|\Illuminate\Http\JsonResponse
    {
        if (!$request->user()->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Owner access required.'], 403);
        }
        $request->validate([
            'start_date' => 'nullable|date_format:Y-m-d',
            'end_date' => 'nullable|date_format:Y-m-d|after_or_equal:start_date',
            'stall_id' => 'nullable|integer',
        ]);
        $today = StoreMovement::businessToday();

        return [$request->query('start_date', now(StoreMovement::BUSINESS_TIMEZONE)->subDays(6)->toDateString()), $request->query('end_date', $today)];
    }

    public function stock(Request $request)
    {
        $range = $this->range($request);
        if (!is_array($range)) {
            return $range;
        }

        $items = StoreItem::where(fn ($q) => $q->where('is_active', true)->orWhere('current_stock', '>', 0))
            ->orderBy('name')->get()
            ->map(fn (StoreItem $i) => [
                'id' => $i->id,
                'name' => $i->name,
                'unit' => $i->unit,
                'current_stock' => $i->current_stock,
                'minimum_alert_stock' => $i->minimum_alert_stock,
                'unit_cost' => $i->unit_cost,
                'stock_value' => bcadd(bcmul((string) $i->current_stock, (string) $i->unit_cost, 5), '0.005', 2),
                'is_active' => $i->is_active,
                'is_low' => $i->is_active && bccomp((string) $i->current_stock, (string) $i->minimum_alert_stock, 3) <= 0,
            ]);

        return response()->json(['success' => true, 'data' => [
            'items' => $items,
            'total_value' => $items->reduce(fn (string $sum, $i) => bcadd($sum, $i['stock_value'], 2), '0.00'),
            'low_stock_count' => $items->where('is_low', true)->count(),
        ]]);
    }

    /** Issued, returned and net per day, stall and raw material. Totals in PHP so both database engines give identical figures. */
    public function issues(Request $request)
    {
        $range = $this->range($request);
        if (!is_array($range)) {
            return $range;
        }

        $movements = StoreMovement::with(['item:id,name,unit', 'stall:id,name'])
            ->whereIn('movement_type', [StoreMovement::ISSUE, StoreMovement::RETURN])
            ->whereBetween('business_date', $range)
            ->when($request->filled('stall_id'), fn ($q) => $q->where('stall_id', $request->query('stall_id')))
            ->orderByDesc('business_date')->orderBy('stall_id')->orderBy('store_item_id')->orderBy('id')
            ->get();

        $rows = [];
        foreach ($movements as $m) {
            $key = "{$m->business_date}|{$m->stall_id}|{$m->store_item_id}";
            $rows[$key] ??= [
                'day' => $m->business_date, 'stall_id' => $m->stall_id, 'stall_name' => $m->stall?->name,
                'item_name' => $m->item?->name, 'unit' => $m->item?->unit,
                'issued' => '0.000', 'returned' => '0.000', 'net' => '0.000', 'net_value' => '0.00',
            ];
            $abs = ltrim((string) $m->quantity, '-');
            if ($m->movement_type === StoreMovement::ISSUE) {
                $rows[$key]['issued'] = bcadd($rows[$key]['issued'], $abs, 3);
                $rows[$key]['net'] = bcadd($rows[$key]['net'], $abs, 3);
                $rows[$key]['net_value'] = bcadd($rows[$key]['net_value'], (string) $m->value, 2);
            } else {
                $rows[$key]['returned'] = bcadd($rows[$key]['returned'], $abs, 3);
                $rows[$key]['net'] = bcsub($rows[$key]['net'], $abs, 3);
                $rows[$key]['net_value'] = bcsub($rows[$key]['net_value'], (string) $m->value, 2);
            }
        }
        $rows = array_values($rows);

        return response()->json(['success' => true, 'data' => [
            'start_date' => $range[0],
            'end_date' => $range[1],
            'rows' => $rows,
            'total_net_value' => array_reduce($rows, fn (string $sum, $r) => bcadd($sum, $r['net_value'], 2), '0.00'),
        ]]);
    }

    public function purchases(Request $request)
    {
        $range = $this->range($request);
        if (!is_array($range)) {
            return $range;
        }

        $rows = DB::table('store_purchase_orders as po')
            ->join('store_suppliers as s', 's.id', '=', 'po.store_supplier_id')
            ->whereBetween('po.order_date', $range)
            ->where('po.status', '!=', 'cancelled')
            ->select('s.id as supplier_id', 's.name as supplier_name')
            ->selectRaw('COUNT(*) as purchase_orders')
            ->selectRaw("SUM(CASE WHEN po.status = 'ordered' THEN 1 ELSE 0 END) as open_orders")
            ->selectRaw("COALESCE(SUM(CASE WHEN po.status = 'received' THEN po.total_amount ELSE 0 END), 0) as received_total")
            ->selectRaw("COALESCE(SUM(CASE WHEN po.status = 'ordered' THEN po.total_amount ELSE 0 END), 0) as open_total")
            ->groupBy('s.id', 's.name')
            ->orderBy('s.name')
            ->get();

        return response()->json(['success' => true, 'data' => ['start_date' => $range[0], 'end_date' => $range[1], 'suppliers' => $rows]]);
    }

    public function waste(Request $request)
    {
        return $this->singleTypeRows($request, StoreMovement::WASTE);
    }

    public function counts(Request $request)
    {
        return $this->singleTypeRows($request, StoreMovement::COUNT);
    }

    private function singleTypeRows(Request $request, string $type)
    {
        $range = $this->range($request);
        if (!is_array($range)) {
            return $range;
        }

        $rows = StoreMovement::with(['item:id,name,unit', 'performedBy:id,name'])
            ->where('movement_type', $type)
            ->whereBetween('business_date', $range)
            ->orderByDesc('id')
            ->get()
            ->map(fn (StoreMovement $m) => [
                'day' => $m->business_date,
                'item_name' => $m->item?->name,
                'unit' => $m->item?->unit,
                'quantity' => ltrim((string) $m->quantity, '-'),
                'difference' => $m->quantity,
                'previous_stock' => $m->previous_stock,
                'new_stock' => $m->new_stock,
                'value' => $m->value,
                'performed_by' => $m->performedBy?->name,
                'reason' => $m->reason,
            ]);

        return response()->json(['success' => true, 'data' => ['start_date' => $range[0], 'end_date' => $range[1], 'rows' => $rows]]);
    }
}
