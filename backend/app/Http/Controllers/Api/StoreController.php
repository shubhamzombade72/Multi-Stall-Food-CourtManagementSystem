<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Stall;
use App\Models\StoreItem;
use App\Models\StoreMovement;
use App\Services\AuditService;
use App\Services\StoreStockService;
use App\Support\Sql;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * The central raw material store. Owner and Store Staff run it; a Stall Manager only sees what their stall received.
 * Stock changes only by hand here or when a purchase order is received: sales never touch it.
 */
class StoreController extends Controller
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

    public function index(Request $request)
    {
        if ($denied = $this->denyUnlessStore($request)) {
            return $denied;
        }
        $request->validate(['search' => 'nullable|string|max:100']);

        $query = StoreItem::query();
        if (!$request->boolean('include_inactive')) {
            $query->where('is_active', true);
        }
        if ($request->boolean('low_stock_only')) {
            $query->where('is_active', true)->whereColumn('current_stock', '<=', 'minimum_alert_stock');
        }
        if ($request->filled('search')) {
            $query->where('name', Sql::like(), '%' . addcslashes($request->query('search'), '%_\\') . '%');
        }

        return response()->json(['success' => true, 'data' => $query->orderBy('name')->get()]);
    }

    public function store(Request $request)
    {
        if ($denied = $this->denyUnlessStore($request)) {
            return $denied;
        }
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'unit' => ['required', Rule::in(StoreItem::UNITS)],
            'minimum_alert_stock' => 'required|numeric|min:0|max:999999',
            'unit_cost' => 'required|numeric|min:0|max:9999999',
            'opening_stock' => 'nullable|numeric|min:0|max:999999',
        ]);
        $validated['name'] = trim($validated['name']);
        if ($this->nameTaken($validated['name'], $validated['unit'])) {
            return response()->json(['success' => false, 'message' => "{$validated['name']} in {$validated['unit']} already exists."], 422);
        }

        $item = DB::transaction(function () use ($validated, $request) {
            $item = StoreItem::create(collect($validated)->except('opening_stock')->all() + ['current_stock' => 0]);
            AuditService::log('store_item_created', 'StoreItem', $item->id, null, null, $item->only(['name', 'unit', 'unit_cost']));
            $opening = StoreStockService::decimal($validated['opening_stock'] ?? 0);
            if (bccomp($opening, '0', 3) > 0) {
                $this->stock->record($item, StoreMovement::OPENING, $opening, $request->user(), null, null, 'Opening stock');
            }

            return $item;
        });

        return response()->json(['success' => true, 'message' => 'Raw material added', 'data' => $item->fresh()], 201);
    }

    public function update(Request $request, $id)
    {
        if ($denied = $this->denyUnlessStore($request)) {
            return $denied;
        }
        $item = StoreItem::findOrFail($id);
        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'unit' => 'sometimes|required|string|max:20',
            'minimum_alert_stock' => 'sometimes|required|numeric|min:0|max:999999',
            'unit_cost' => 'sometimes|required|numeric|min:0|max:9999999',
            'is_active' => 'sometimes|boolean',
        ]);
        $name = isset($validated['name']) ? ($validated['name'] = trim($validated['name'])) : $item->name;
        $unit = $validated['unit'] ?? $item->unit;

        if ($unit !== $item->unit) {
            if (!in_array($unit, StoreItem::UNITS, true)) {
                return response()->json(['success' => false, 'message' => 'Choose a unit from the list.'], 422);
            }
            // Changing kg to g would silently turn 5 kg into 5 g
            if ($item->movements()->exists()) {
                return response()->json(['success' => false, 'message' => 'The unit cannot change once this raw material has stock history. Add a new raw material instead.'], 422);
            }
        }
        if ($this->nameTaken($name, $unit, $item->id)) {
            return response()->json(['success' => false, 'message' => "{$name} in {$unit} already exists."], 422);
        }

        $old = $item->only(array_keys($validated));
        $item->update($validated);
        AuditService::log('store_item_updated', 'StoreItem', $item->id, null, $old, $item->only(array_keys($validated)));

        return response()->json(['success' => true, 'message' => 'Raw material updated', 'data' => $item->fresh()]);
    }

    private function nameTaken(string $name, string $unit, ?int $exceptId = null): bool
    {
        return StoreItem::whereRaw('lower(name) = ?', [mb_strtolower($name)])->where('unit', $unit)
            ->when($exceptId, fn ($q) => $q->where('id', '!=', $exceptId))
            ->exists();
    }

    public function issue(Request $request, $id)
    {
        if ($denied = $this->denyUnlessStore($request)) {
            return $denied;
        }
        $validated = $request->validate([
            'stall_id' => 'required|integer',
            'quantity' => 'required|numeric|min:0.001|max:999999',
            'reason' => 'nullable|string|max:255',
        ]);
        if (!Stall::whereKey($validated['stall_id'])->where('is_active', true)->exists()) {
            return response()->json(['success' => false, 'message' => 'Choose an active stall.'], 422);
        }

        return $this->takeOut($request, (int) $id, $validated['quantity'], StoreMovement::ISSUE, (int) $validated['stall_id'], $validated['reason'] ?? null);
    }

    public function waste(Request $request, $id)
    {
        if ($denied = $this->denyUnlessStore($request)) {
            return $denied;
        }
        $validated = $request->validate([
            'quantity' => 'required|numeric|min:0.001|max:999999',
            'reason' => 'required|string|max:255',
        ]);

        return $this->takeOut($request, (int) $id, $validated['quantity'], StoreMovement::WASTE, null, $validated['reason']);
    }

    private function takeOut(Request $request, int $id, $quantity, string $type, ?int $stallId, ?string $reason)
    {
        $error = null;
        $item = DB::transaction(function () use ($request, $id, $quantity, $type, $stallId, $reason, &$error) {
            $item = $this->stock->lockItem($id);
            if ($type === StoreMovement::ISSUE && !$item->is_active) {
                $error = "{$item->name} is inactive and cannot be issued.";

                return null;
            }
            $qty = StoreStockService::decimal($quantity);
            if (bccomp($qty, StoreStockService::decimal($item->current_stock), 3) > 0) {
                $error = 'Quantity is more than the ' . (float) $item->current_stock . " {$item->unit} in the store.";

                return null;
            }
            $this->stock->record($item, $type, bcmul($qty, '-1', 3), $request->user(), $stallId, null, $reason);

            return $item->fresh();
        });

        return $error
            ? response()->json(['success' => false, 'message' => $error], 422)
            : response()->json(['success' => true, 'message' => 'Stock updated', 'data' => $item]);
    }

    public function returnFromStall(Request $request, $id)
    {
        if ($denied = $this->denyUnlessStore($request)) {
            return $denied;
        }
        $validated = $request->validate([
            'stall_id' => 'required|integer|exists:stalls,id',
            'quantity' => 'required|numeric|min:0.001|max:999999',
            'reason' => 'required|string|max:255',
        ]);

        $error = null;
        $item = DB::transaction(function () use ($request, $id, $validated, &$error) {
            $item = $this->stock->lockItem((int) $id);
            $qty = StoreStockService::decimal($validated['quantity']);
            $outstanding = $this->stock->outstandingAtStall($item->id, (int) $validated['stall_id']);
            if (bccomp($qty, $outstanding, 3) > 0) {
                $error = 'This stall has only been issued ' . (float) $outstanding . " {$item->unit} that has not come back.";

                return null;
            }
            $this->stock->record($item, StoreMovement::RETURN, $qty, $request->user(), (int) $validated['stall_id'], null, $validated['reason']);

            return $item->fresh();
        });

        return $error
            ? response()->json(['success' => false, 'message' => $error], 422)
            : response()->json(['success' => true, 'message' => 'Stock returned to the store', 'data' => $item]);
    }

    /** A physical count: the store figure becomes what was counted, and the difference goes in the history. */
    public function count(Request $request, $id)
    {
        if ($denied = $this->denyUnlessStore($request)) {
            return $denied;
        }
        $validated = $request->validate([
            'counted_stock' => 'required|numeric|min:0|max:999999',
            'reason' => 'nullable|string|max:255',
        ]);

        $item = DB::transaction(function () use ($request, $id, $validated) {
            $item = $this->stock->lockItem((int) $id);
            $delta = bcsub(StoreStockService::decimal($validated['counted_stock']), StoreStockService::decimal($item->current_stock), 3);
            $this->stock->record($item, StoreMovement::COUNT, $delta, $request->user(), null, null, $validated['reason'] ?? null);

            return $item->fresh();
        });

        return response()->json(['success' => true, 'message' => 'Count saved', 'data' => $item]);
    }

    public function movements(Request $request)
    {
        $user = $request->user();
        $isStore = $user->isOwner() || $user->isStoreStaff();
        if (!$isStore && !($user->isStallManager() && $user->stall_id)) {
            return response()->json(['success' => false, 'message' => 'Unauthorized.'], 403);
        }
        $request->validate([
            'movement_type' => 'nullable|string|max:30',
            'store_item_id' => 'nullable|integer',
            'stall_id' => 'nullable|integer',
            'date_from' => 'nullable|date_format:Y-m-d',
            'date_to' => 'nullable|date_format:Y-m-d',
            'per_page' => 'nullable|integer|min:1|max:200',
        ]);

        $query = StoreMovement::with(['item:id,name,unit', 'stall:id,name,code', 'performedBy:id,name']);
        if ($isStore) {
            if ($request->filled('stall_id')) {
                $query->where('stall_id', $request->query('stall_id'));
            }
        } else {
            // A manager's own stall only, and never the store's purchases, waste or counts
            $query->where('stall_id', $user->stall_id)->whereIn('movement_type', [StoreMovement::ISSUE, StoreMovement::RETURN]);
        }
        foreach (['movement_type', 'store_item_id'] as $field) {
            if ($request->filled($field)) {
                $query->where($field, $request->query($field));
            }
        }
        if ($request->filled('date_from')) {
            $query->where('business_date', '>=', $request->query('date_from'));
        }
        if ($request->filled('date_to')) {
            $query->where('business_date', '<=', $request->query('date_to'));
        }

        return response()->json(['success' => true, 'data' => $query->orderByDesc('id')->paginate($request->integer('per_page', 25))]);
    }

    public function importPreview(Request $request)
    {
        if (!$request->user()->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Owner access required.'], 403);
        }

        return response()->json(['success' => true, 'data' => $this->stock->importPreview()]);
    }

    public function import(Request $request)
    {
        if (!$request->user()->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Owner access required.'], 403);
        }

        return response()->json(['success' => true, 'message' => 'Old stock moved to the central store', 'data' => $this->stock->runImport($request->user())]);
    }
}
