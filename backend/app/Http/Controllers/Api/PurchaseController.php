<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InventoryItem;
use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderItem;
use App\Models\StockMovement;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PurchaseController extends Controller
{
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

        if (!$user->isOwner() && ($user->stall_id != $validated['stall_id'])) {
            return response()->json(['success' => false, 'message' => 'Unauthorized to create purchase for another stall'], 403);
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

        if (!$user->isOwner() && ($user->stall_id != $purchaseOrder->stall_id)) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
        }

        if ($purchaseOrder->status === 'received') {
            return response()->json(['success' => false, 'message' => 'Purchase order has already been received into stock.'], 422);
        }

        DB::transaction(function () use ($purchaseOrder, $user) {
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
        });

        return response()->json([
            'success' => true,
            'message' => 'Goods received successfully. Stock inventory updated.',
            'data' => $purchaseOrder->fresh(['stall', 'supplier', 'items.inventoryItem']),
        ]);
    }
}

