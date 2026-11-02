<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InventoryItem;
use App\Models\StockMovement;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class InventoryController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();

        $query = InventoryItem::with('stall:id,name,code');

        if (!$user->isOwner()) {
            if (!$user->stall_id) {
                return response()->json(['success' => false, 'message' => 'No stall assigned'], 403);
            }
            $query->where('stall_id', $user->stall_id);
        } elseif ($request->has('stall_id')) {
            $query->where('stall_id', $request->query('stall_id'));
        }

        if ($request->boolean('low_stock_only', false)) {
            $query->whereColumn('current_stock', '<=', 'minimum_alert_stock');
        }

        $items = $query->orderBy('name')->get();

        return response()->json([
            'success' => true,
            'data' => $items,
        ]);
    }

    public function store(Request $request)
    {
        $user = $request->user();

        $validated = $request->validate([
            'stall_id' => 'required|exists:stalls,id',
            'name' => 'required|string|max:255',
            'unit' => 'required|string|max:20',
            'current_stock' => 'required|numeric|min:0',
            'minimum_alert_stock' => 'required|numeric|min:0',
            'unit_cost' => 'required|numeric|min:0',
        ]);

        if (!$this->canManageStock($user, $validated['stall_id'])) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
        }

        $item = InventoryItem::create($validated);

        return response()->json([
            'success' => true,
            'message' => 'Inventory item created successfully',
            'data' => $item->load('stall'),
        ], 201);
    }

    public function adjust(Request $request, $id)
    {
        $user = $request->user();
        $item = InventoryItem::findOrFail($id);

        if (!$this->canManageStock($user, $item->stall_id)) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
        }

        $validated = $request->validate([
            'new_stock' => 'required|numeric|min:0',
            'reason' => 'required|string|max:255',
            'movement_type' => 'required|in:manual_adjustment,waste_loss,consumption',
        ]);

        DB::transaction(function () use ($item, $validated, $user) {
            // Lock the row so a concurrent goods receipt cannot be lost between read and write
            $item = InventoryItem::where('id', $item->id)->lockForUpdate()->first();
            $prevStock = $item->current_stock;
            $newStock = $validated['new_stock'];
            $delta = bcsub((string) $newStock, (string) $prevStock, 3);

            $item->update(['current_stock' => $newStock]);

            StockMovement::create([
                'stall_id' => $item->stall_id,
                'inventory_item_id' => $item->id,
                'movement_type' => $validated['movement_type'],
                'quantity' => $delta,
                'previous_stock' => $prevStock,
                'new_stock' => $newStock,
                'performed_by_user_id' => $user->id,
                'reason' => $validated['reason'],
            ]);
        });

        return response()->json([
            'success' => true,
            'message' => 'Stock adjusted successfully',
            'data' => $item->fresh('stall'),
        ]);
    }

    /**
     * Stock outward (consumption issued to the kitchen, or waste/spoilage) by quantity.
     * Locked read-modify-write; stock can never go below zero.
     */
    public function stockOut(Request $request, $id)
    {
        $user = $request->user();
        $item = InventoryItem::findOrFail($id);

        if (!$this->canManageStock($user, $item->stall_id)) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
        }

        $validated = $request->validate([
            'quantity' => 'required|numeric|min:0.001|max:999999',
            'movement_type' => 'required|in:consumption,waste_loss',
            'reason' => 'required|string|max:255',
        ]);

        $result = DB::transaction(function () use ($item, $validated, $user) {
            $locked = InventoryItem::where('id', $item->id)->lockForUpdate()->first();
            $qty = bcadd((string) $validated['quantity'], '0', 3);
            $prev = bcadd((string) $locked->current_stock, '0', 3);

            if (bccomp($qty, $prev, 3) > 0) {
                return null;
            }

            $new = bcsub($prev, $qty, 3);
            $locked->update(['current_stock' => $new]);

            StockMovement::create([
                'stall_id' => $locked->stall_id,
                'inventory_item_id' => $locked->id,
                'movement_type' => $validated['movement_type'],
                'quantity' => '-' . $qty,
                'previous_stock' => $prev,
                'new_stock' => $new,
                'performed_by_user_id' => $user->id,
                'reason' => $validated['reason'],
            ]);

            return $locked->fresh('stall');
        });

        if (!$result) {
            return response()->json(['success' => false, 'message' => 'Quantity exceeds the current stock.'], 422);
        }

        return response()->json(['success' => true, 'message' => 'Stock issued', 'data' => $result]);
    }

    private function canManageStock($user, $stallId): bool
    {
        if ($user->isOwner()) {
            return true;
        }
        return ($user->isStallManager() || $user->isStoreStaff()) && $user->stall_id == $stallId;
    }

    public function movements(Request $request)
    {
        $user = $request->user();

        $query = StockMovement::with(['stall:id,name,code', 'inventoryItem:id,name,unit', 'performedBy:id,name']);

        if (!$user->isOwner()) {
            if (!$user->stall_id) {
                return response()->json(['success' => false, 'message' => 'No stall assigned'], 403);
            }
            $query->where('stall_id', $user->stall_id);
        } elseif ($request->has('stall_id')) {
            $query->where('stall_id', $request->query('stall_id'));
        }

        $request->validate([
            'movement_type' => 'nullable|string|max:30',
            'inventory_item_id' => 'nullable|integer',
            'date_from' => 'nullable|date',
            'date_to' => 'nullable|date|after_or_equal:date_from',
            'per_page' => 'nullable|integer|min:1|max:200',
        ]);
        foreach (['movement_type', 'inventory_item_id'] as $field) {
            if ($request->filled($field)) {
                $query->where($field, $request->query($field));
            }
        }
        if ($request->filled('date_from')) {
            $query->whereDate('created_at', '>=', $request->query('date_from'));
        }
        if ($request->filled('date_to')) {
            $query->whereDate('created_at', '<=', $request->query('date_to'));
        }

        $movements = $query->orderByDesc('id')->paginate($request->integer('per_page', 25));

        return response()->json([
            'success' => true,
            'data' => $movements,
        ]);
    }
}

