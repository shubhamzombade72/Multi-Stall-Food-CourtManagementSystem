<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\StoreItem;
use App\Models\StoreMovement;
use App\Models\StorePurchaseOrder;
use App\Models\StoreSupplier;
use App\Services\AuditService;
use App\Services\StoreStockService;
use App\Support\Sql;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Buying for the central store. Only receiving a purchase order changes stock. Owner and Store Staff only. */
class StorePurchaseController extends Controller
{
    public function __construct(private StoreStockService $stock)
    {
    }

    private function denyUnlessStore(Request $request)
    {
        $user = $request->user();

        return $user->isOwner() || $user->isStoreStaff()
            ? null
            : response()->json(['success' => false, 'message' => 'Unauthorized. Owner or Store Staff access required.'], 403);
    }

    // ------------------------------------------------------------------ suppliers

    public function suppliers(Request $request)
    {
        if ($denied = $this->denyUnlessStore($request)) {
            return $denied;
        }
        $request->validate(['search' => 'nullable|string|max:100']);

        $query = StoreSupplier::withCount('purchaseOrders')
            ->withSum(['purchaseOrders as received_total' => fn ($q) => $q->where('status', 'received')], 'total_amount');
        if (!$request->boolean('include_inactive')) {
            $query->where('is_active', true);
        }
        if ($request->filled('search')) {
            $term = '%' . addcslashes($request->query('search'), '%_\\') . '%';
            $query->where(fn ($q) => $q->where('name', Sql::like(), $term)
                ->orWhere('contact_person', Sql::like(), $term)
                ->orWhere('phone', Sql::like(), $term));
        }

        return response()->json(['success' => true, 'data' => $query->orderBy('name')->get()]);
    }

    private function supplierRules(string $required): array
    {
        return [
            'name' => "{$required}|string|max:255",
            'contact_person' => 'nullable|string|max:100',
            'phone' => 'nullable|string|max:20',
            'email' => 'nullable|email|max:100',
            'address' => 'nullable|string|max:500',
            'is_active' => 'sometimes|boolean',
        ];
    }

    private function supplierNameTaken(string $name, ?int $exceptId = null): bool
    {
        return StoreSupplier::whereRaw('lower(name) = ?', [mb_strtolower($name)])
            ->when($exceptId, fn ($q) => $q->where('id', '!=', $exceptId))
            ->exists();
    }

    public function storeSupplier(Request $request)
    {
        if ($denied = $this->denyUnlessStore($request)) {
            return $denied;
        }
        $validated = $request->validate($this->supplierRules('required'));
        $validated['name'] = trim($validated['name']);
        if ($this->supplierNameTaken($validated['name'])) {
            return response()->json(['success' => false, 'message' => 'A supplier with this name already exists.'], 422);
        }

        $supplier = StoreSupplier::create($validated);
        AuditService::log('store_supplier_created', 'StoreSupplier', $supplier->id, null, null, $supplier->only(['name', 'phone']));

        return response()->json(['success' => true, 'message' => 'Supplier added', 'data' => $supplier->fresh()], 201);
    }

    public function updateSupplier(Request $request, $id)
    {
        if ($denied = $this->denyUnlessStore($request)) {
            return $denied;
        }
        $supplier = StoreSupplier::findOrFail($id);
        $validated = $request->validate($this->supplierRules('sometimes|required'));
        if (isset($validated['name'])) {
            $validated['name'] = trim($validated['name']);
            if ($this->supplierNameTaken($validated['name'], $supplier->id)) {
                return response()->json(['success' => false, 'message' => 'A supplier with this name already exists.'], 422);
            }
        }

        $old = $supplier->only(array_keys($validated));
        $supplier->update($validated);
        AuditService::log('store_supplier_updated', 'StoreSupplier', $supplier->id, null, $old, $supplier->only(array_keys($validated)));

        return response()->json(['success' => true, 'message' => 'Supplier updated', 'data' => $supplier->fresh()]);
    }

    public function showSupplier(Request $request, $id)
    {
        if ($denied = $this->denyUnlessStore($request)) {
            return $denied;
        }
        $supplier = StoreSupplier::findOrFail($id);
        $purchases = StorePurchaseOrder::where('store_supplier_id', $supplier->id)->orderByDesc('id')->limit(100)->get();

        return response()->json(['success' => true, 'data' => [
            'supplier' => $supplier,
            'purchases' => $purchases,
            'summary' => [
                'purchase_orders' => StorePurchaseOrder::where('store_supplier_id', $supplier->id)->count(),
                'open_orders' => StorePurchaseOrder::where('store_supplier_id', $supplier->id)->where('status', 'ordered')->count(),
                'received_total' => StorePurchaseOrder::where('store_supplier_id', $supplier->id)->where('status', 'received')
                    ->pluck('total_amount')->reduce(fn (string $sum, $a) => bcadd($sum, (string) $a, 2), '0.00'),
            ],
        ]]);
    }

    // ------------------------------------------------------------------ purchase orders

    public function index(Request $request)
    {
        if ($denied = $this->denyUnlessStore($request)) {
            return $denied;
        }
        $request->validate([
            'status' => 'nullable|in:ordered,received,cancelled',
            'store_supplier_id' => 'nullable|integer',
            'date_from' => 'nullable|date_format:Y-m-d',
            'date_to' => 'nullable|date_format:Y-m-d',
            'per_page' => 'nullable|integer|min:1|max:200',
        ]);

        $query = StorePurchaseOrder::with(['supplier:id,name', 'items.item:id,name,unit', 'creator:id,name']);
        foreach (['status', 'store_supplier_id'] as $field) {
            if ($request->filled($field)) {
                $query->where($field, $request->query($field));
            }
        }
        if ($request->filled('date_from')) {
            $query->where('order_date', '>=', $request->query('date_from'));
        }
        if ($request->filled('date_to')) {
            $query->where('order_date', '<=', $request->query('date_to'));
        }

        return response()->json(['success' => true, 'data' => $query->orderByDesc('id')->paginate($request->integer('per_page', 20))]);
    }

    public function store(Request $request)
    {
        if ($denied = $this->denyUnlessStore($request)) {
            return $denied;
        }
        $validated = $request->validate([
            'store_supplier_id' => 'required|integer',
            'order_date' => 'required|date_format:Y-m-d',
            'notes' => 'nullable|string|max:1000',
            'items' => 'required|array|min:1|max:100',
            'items.*.store_item_id' => 'required|integer',
            'items.*.quantity' => 'required|numeric|min:0.001|max:999999',
            'items.*.unit_price' => 'required|numeric|min:0|max:9999999',
        ]);

        if (!StoreSupplier::whereKey($validated['store_supplier_id'])->where('is_active', true)->exists()) {
            return response()->json(['success' => false, 'message' => 'Choose an active supplier.'], 422);
        }
        $itemIds = array_values(array_unique(array_map('intval', array_column($validated['items'], 'store_item_id'))));
        if (StoreItem::whereIn('id', $itemIds)->where('is_active', true)->count() !== count($itemIds)) {
            return response()->json(['success' => false, 'message' => 'Every line must be an active raw material.'], 422);
        }

        $order = DB::transaction(function () use ($validated, $request) {
            $total = '0.00';
            $lines = [];
            foreach ($validated['items'] as $line) {
                $lineTotal = bcadd(bcmul((string) $line['quantity'], (string) $line['unit_price'], 5), '0.005', 2);
                $total = bcadd($total, $lineTotal, 2);
                $lines[] = [
                    'store_item_id' => $line['store_item_id'],
                    'quantity' => $line['quantity'],
                    'unit_price' => $line['unit_price'],
                    'total_price' => $lineTotal,
                ];
            }
            $order = StorePurchaseOrder::create([
                'store_supplier_id' => $validated['store_supplier_id'],
                'created_by_user_id' => $request->user()->id,
                'order_date' => $validated['order_date'],
                'total_amount' => $total,
                'status' => 'ordered',
                'notes' => $validated['notes'] ?? null,
            ]);
            $order->items()->createMany($lines);
            AuditService::log('store_purchase_created', 'StorePurchaseOrder', $order->id, null, null, $order->only(['purchase_number', 'store_supplier_id', 'total_amount']));

            return $order;
        });

        return response()->json(['success' => true, 'message' => 'Purchase order created', 'data' => $order->load(['supplier:id,name', 'items.item:id,name,unit'])], 201);
    }

    /** Receives the whole order: adds its stock, and each raw material takes this order's price as its last price. */
    public function receive(Request $request, $id)
    {
        if ($denied = $this->denyUnlessStore($request)) {
            return $denied;
        }

        $order = DB::transaction(function () use ($request, $id) {
            // Locked so two simultaneous clicks cannot both add the stock
            $order = StorePurchaseOrder::whereKey($id)->lockForUpdate()->firstOrFail();
            if ($order->status !== 'ordered') {
                return null;
            }
            $order->update(['status' => 'received', 'received_at' => now()]);

            // Item rows are locked in id order, the same order for every request
            $lines = $order->items()->orderBy('store_item_id')->orderBy('id')->get();
            foreach ($lines as $line) {
                $item = $this->stock->lockItem((int) $line->store_item_id);
                $item->unit_cost = $line->unit_price;
                $this->stock->record($item, StoreMovement::PURCHASE, StoreStockService::decimal($line->quantity), $request->user(), null, $order->purchase_number, "Received {$order->purchase_number}");
            }
            AuditService::log('store_purchase_received', 'StorePurchaseOrder', $order->id, null, ['status' => 'ordered'], ['status' => 'received']);

            return $order;
        });

        if (!$order) {
            return response()->json(['success' => false, 'message' => 'This purchase order is not open any more.'], 422);
        }

        return response()->json(['success' => true, 'message' => 'Goods received. Store stock updated.', 'data' => $order->fresh(['supplier:id,name', 'items.item:id,name,unit'])]);
    }

    public function cancel(Request $request, $id)
    {
        if ($denied = $this->denyUnlessStore($request)) {
            return $denied;
        }
        $validated = $request->validate(['reason' => 'required|string|max:255']);

        $order = DB::transaction(function () use ($id, $validated) {
            $order = StorePurchaseOrder::whereKey($id)->lockForUpdate()->firstOrFail();
            if ($order->status !== 'ordered') {
                return null;
            }
            $order->update(['status' => 'cancelled', 'cancelled_at' => now(), 'cancel_reason' => $validated['reason']]);
            AuditService::log('store_purchase_cancelled', 'StorePurchaseOrder', $order->id, null, ['status' => 'ordered'], ['status' => 'cancelled', 'reason' => $validated['reason']]);

            return $order;
        });

        if (!$order) {
            return response()->json(['success' => false, 'message' => 'Only an open purchase order can be cancelled.'], 422);
        }

        return response()->json(['success' => true, 'message' => 'Purchase order cancelled', 'data' => $order->fresh()]);
    }
}
