<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InventoryItem;
use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderItem;
use App\Models\StockMovement;
use App\Models\Supplier;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PurchaseController extends Controller
{
    public function suppliers(Request $request)
    {
        $user = $request->user();
        $query = Supplier::with('stall:id,name,code')->where('is_active', true);

        if (!$user->isOwner()) {
            if (!$user->stall_id) {
                return response()->json(['success' => false, 'message' => 'No stall assigned'], 403);
            }
            $query->where('stall_id', $user->stall_id);
        } elseif ($request->has('stall_id')) {
            $query->where('stall_id', $request->query('stall_id'));
        }

        return response()->json([
            'success' => true,
            'data' => $query->orderBy('name')->get(),
        ]);
    }

    public function storeSupplier(Request $request)
    {
        $user = $request->user();

        if (!$request->has('stall_id') && $user->stall_id) {
            $request->merge(['stall_id' => $user->stall_id]);
        }

        $validated = $request->validate([
            'stall_id' => 'required|exists:stalls,id',
            'name' => 'required|string|max:255',
            'contact_person' => 'nullable|string|max:100',
            'phone' => 'nullable|string|max:20',
            'email' => 'nullable|email|max:100',
            'address' => 'nullable|string',
        ]);

        if (!$user->isOwner() && !($user->isStallManager() && $user->stall_id == $validated['stall_id'])) {
            return response()->json(['success' => false, 'message' => 'Unauthorized to add supplier for this stall'], 403);
        }

        $supplier = Supplier::create($validated);

        return response()->json([
            'success' => true,
            'message' => 'Supplier added successfully',
            'data' => $supplier->load('stall'),
        ], 201);
    }
    public function index(Request $request)
    {
        $user = $request->user();

        $query = PurchaseOrder::with(['stall:id,name,code', 'supplier', 'items.inventoryItem', 'creator:id,name']);

        if (!$user->isOwner()) {
            if (!$user->stall_id) {
                return response()->json(['success' => false, 'message' => 'No stall assigned'], 403);
            }
            $query->where('stall_id', $user->stall_id);
        } elseif ($request->has('stall_id')) {
            $query->where('stall_id', $request->query('stall_id'));
        }

        $purchases = $query->orderByDesc('id')->paginate($request->integer('per_page', 20));

        return response()->json([
            'success' => true,
            'data' => $purchases,
        ]);
    }

    public function store(Request $request)
    {
        $user = $request->user();

        $validated = $request->validate([
            'stall_id' => 'required|exists:stalls,id',
            'supplier_id' => 'required|exists:suppliers,id',
            'order_date' => 'required|date',
            'notes' => 'nullable|string',
            'items' => 'required|array|min:1',
            'items.*.inventory_item_id' => 'required|exists:inventory_items,id',
            'items.*.quantity' => 'required|numeric|min:0.01',
            'items.*.unit_price' => 'required|numeric|min:0',
        ]);

        if (!$user->isOwner() && !($user->isStallManager() && $user->stall_id == $validated['stall_id'])) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Only Stall Manager or Owner can create purchase orders.'], 403);
        }

        // Stall isolation: the supplier and every stock item must belong to the purchasing stall
        $supplierMatches = Supplier::where('id', $validated['supplier_id'])->where('stall_id', $validated['stall_id'])->exists();
        $itemIds = array_unique(array_column($validated['items'], 'inventory_item_id'));
        $foreignItems = InventoryItem::whereIn('id', $itemIds)->where('stall_id', '!=', $validated['stall_id'])->exists();
        if (!$supplierMatches || $foreignItems) {
            return response()->json([
                'success' => false,
                'message' => 'Supplier and inventory items must belong to the purchasing stall.',
            ], 422);
        }

        return DB::transaction(function () use ($validated, $user) {
            $totalAmount = 0;
            $itemsData = [];

            foreach ($validated['items'] as $item) {
                $lineTotal = bcmul((string) $item['quantity'], (string) $item['unit_price'], 2);
                $totalAmount = bcadd($totalAmount, $lineTotal, 2);

                $itemsData[] = [
                    'inventory_item_id' => $item['inventory_item_id'],
                    'quantity' => $item['quantity'],
                    'unit_price' => $item['unit_price'],
                    'total_price' => $lineTotal,
                ];
            }

            $purchaseOrder = PurchaseOrder::create([
                'stall_id' => $validated['stall_id'],
                'supplier_id' => $validated['supplier_id'],
                'created_by_user_id' => $user->id,
                'order_date' => $validated['order_date'],
                'total_amount' => $totalAmount,
                'status' => 'ordered',
                'notes' => $validated['notes'] ?? null,
            ]);

            foreach ($itemsData as $iData) {
                $purchaseOrder->items()->create($iData);
            }

            return response()->json([
                'success' => true,
                'message' => 'Purchase order created successfully',
                'data' => $purchaseOrder->load(['stall', 'supplier', 'items.inventoryItem']),
            ], 201);
        });
    }

    public function receive(Request $request, $id)
    {
        $user = $request->user();
        $purchaseOrder = PurchaseOrder::with('items')->findOrFail($id);

        if (!$user->isOwner() && !($user->isStallManager() && $user->stall_id == $purchaseOrder->stall_id)) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Only Stall Manager or Owner can receive purchases.'], 403);
        }

        $received = DB::transaction(function () use ($purchaseOrder, $user) {
            // Lock the PO so two simultaneous "receive" clicks cannot both add stock
            $locked = PurchaseOrder::where('id', $purchaseOrder->id)->lockForUpdate()->first();
            if ($locked->status !== 'ordered') {
                return false;
            }

            $purchaseOrder->update(['status' => 'received']);

            // Auto-increment inventory stock and log stock movements
            foreach ($purchaseOrder->items as $item) {
                $invItem = InventoryItem::where('id', $item->inventory_item_id)->lockForUpdate()->first();

                $prevStock = $invItem->current_stock;
                $newStock = bcadd((string) $prevStock, (string) $item->quantity, 3);

                $invItem->update([
                    'current_stock' => $newStock,
                    'unit_cost' => $item->unit_price,
                ]);

                StockMovement::create([
                    'stall_id' => $purchaseOrder->stall_id,
                    'inventory_item_id' => $invItem->id,
                    'movement_type' => 'purchase_inward',
                    'quantity' => $item->quantity,
                    'previous_stock' => $prevStock,
                    'new_stock' => $newStock,
                    'reference_id' => $purchaseOrder->purchase_number,
                    'performed_by_user_id' => $user->id,
                    'reason' => "PO Inward Receipt #{$purchaseOrder->purchase_number}",
                ]);
            }

            return true;
        });

        if (!$received) {
            return response()->json(['success' => false, 'message' => 'Purchase order has already been received into stock.'], 422);
        }

        return response()->json([
            'success' => true,
            'message' => 'Goods received successfully. Stock inventory updated.',
            'data' => $purchaseOrder->fresh(['stall', 'supplier', 'items.inventoryItem']),
        ]);
    }
}

