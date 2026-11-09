<?php

namespace App\Services;

use App\Models\Stall;
use App\Models\StoreItem;
use App\Models\StoreMovement;
use App\Models\Supplier;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The single writer of central store stock: every change updates current_stock and adds a history row together, so
 * the history always adds up to the stock figure. Callers hold a transaction and the locked item row.
 */
class StoreStockService
{
    private const UNIT_ALIASES = ['liter' => 'l', 'litre' => 'l', 'ltr' => 'l', 'kgs' => 'kg', 'gm' => 'g', 'gram' => 'g', 'piece' => 'pcs', 'pc' => 'pcs', 'pkt' => 'packet'];

    public static function decimal(mixed $value, int $scale = 3): string
    {
        return bcadd((string) $value, '0', $scale);
    }

    public function lockItem(int $id): StoreItem
    {
        return StoreItem::whereKey($id)->lockForUpdate()->firstOrFail();
    }

    public function record(StoreItem $item, string $type, string $delta, User $user, ?int $stallId = null, ?string $reference = null, ?string $reason = null): StoreMovement
    {
        $previous = self::decimal($item->current_stock);
        $new = bcadd($previous, $delta, 3);
        $cost = self::decimal($item->unit_cost, 2);
        $abs = ltrim($delta, '-');
        // Half-up to paise, without going through a float
        $value = bcadd(bcmul($abs, $cost, 5), '0.005', 2);

        $item->update(['current_stock' => $new]);

        $movement = StoreMovement::create([
            'store_item_id' => $item->id,
            'stall_id' => $stallId,
            'movement_type' => $type,
            'quantity' => $delta,
            'previous_stock' => $previous,
            'new_stock' => $new,
            'unit_cost' => $cost,
            'value' => $value,
            'business_date' => StoreMovement::businessToday(),
            'reference_id' => $reference,
            'performed_by_user_id' => $user->id,
            'reason' => $reason,
        ]);

        AuditService::log('store_movement_created', 'StoreMovement', $movement->id, $stallId, null, [
            'item' => $item->name, 'movement_type' => $type, 'quantity' => $delta, 'new_stock' => $new, 'value' => $value, 'reason' => $reason,
        ]);

        return $movement;
    }

    /** How much of this item the stall has been issued and not yet returned. */
    public function outstandingAtStall(int $itemId, int $stallId): string
    {
        $net = StoreMovement::where('store_item_id', $itemId)->where('stall_id', $stallId)
            ->whereIn('movement_type', [StoreMovement::ISSUE, StoreMovement::RETURN])
            ->pluck('quantity')
            ->reduce(fn (string $sum, $q) => bcadd($sum, (string) $q, 3), '0.000');

        return bcmul($net, '-1', 3);
    }

    // ------------------------------------------------------------------ one-time move from the old per-stall tables

    public static function normalizeUnit(string $unit): string
    {
        $unit = mb_strtolower(trim($unit));

        return self::UNIT_ALIASES[$unit] ?? $unit;
    }

    /** What the move would do. Changes nothing. */
    public function importPreview(): array
    {
        $groups = $this->pendingItemGroups();
        $suppliers = $this->pendingSuppliers();

        $warnings = [];
        foreach ($groups->groupBy(fn ($g) => mb_strtolower($g['name'])) as $sameName) {
            if ($sameName->count() > 1) {
                $warnings[] = "{$sameName->first()['name']} has more than one unit (" . $sameName->pluck('unit')->implode(', ') . '), so these stay separate items.';
            }
        }
        foreach ($groups as $g) {
            if ($g['price_differs']) {
                $warnings[] = "{$g['name']} had different prices across stalls. The latest price is used.";
            }
            if (!in_array($g['unit'], StoreItem::UNITS, true)) {
                $warnings[] = "{$g['name']} uses the unit \"{$g['unit']}\", which is not on the standard list. It is kept as it is.";
            }
        }
        $open = DB::table('purchase_orders')->where('status', 'ordered')->count();
        if ($open > 0) {
            $warnings[] = "{$open} old purchase order(s) were never received. They are not moved, so their stock is not counted.";
        }

        return [
            'pending_items' => $groups->sum('rows'),
            'pending_suppliers' => $suppliers->count(),
            'groups' => $groups->map(fn ($g) => collect($g)->except(['source_ids'])->all())->values(),
            'warnings' => $warnings,
        ];
    }

    public function runImport(User $user): array
    {
        return DB::transaction(function () use ($user) {
            $itemsMoved = 0;
            foreach ($this->pendingItemGroups() as $group) {
                $existing = StoreItem::whereRaw('lower(name) = ?', [mb_strtolower($group['name'])])->where('unit', $group['unit'])->lockForUpdate()->first();
                $item = $existing ?: StoreItem::create([
                    'name' => $group['name'],
                    'unit' => $group['unit'],
                    'current_stock' => 0,
                    'minimum_alert_stock' => $group['minimum_alert_stock'],
                    'unit_cost' => $group['unit_cost'],
                ]);
                if (bccomp($group['quantity'], '0', 3) > 0) {
                    $this->record($item, StoreMovement::OPENING, $group['quantity'], $user, null, 'old-stall-stock', 'Moved from: ' . mb_substr(implode(', ', $group['stalls']), 0, 200));
                }
                foreach ($group['source_ids'] as $sourceId => $quantity) {
                    $this->logImport('inventory_item', $sourceId, $item->id, $quantity, $user);
                    $itemsMoved++;
                }
            }

            $suppliersMoved = 0;
            foreach ($this->pendingSuppliers()->groupBy(fn ($s) => mb_strtolower(trim($s->name))) as $rows) {
                $first = $rows->first();
                $name = trim($first->name);
                $target = \App\Models\StoreSupplier::whereRaw('lower(name) = ?', [mb_strtolower($name)])->first();
                $target ??= \App\Models\StoreSupplier::create([
                    'name' => $name,
                    'contact_person' => $rows->pluck('contact_person')->filter()->first(),
                    'phone' => $rows->pluck('phone')->filter()->first(),
                    'email' => $rows->pluck('email')->filter()->first(),
                    'address' => mb_substr((string) $rows->pluck('address')->filter()->first(), 0, 500) ?: null,
                    'is_active' => $rows->contains(fn ($s) => (bool) $s->is_active),
                ]);
                foreach ($rows as $row) {
                    $this->logImport('supplier', $row->id, $target->id, null, $user);
                    $suppliersMoved++;
                }
            }

            AuditService::log('store_import_completed', 'StoreImport', 0, null, null, ['items_moved' => $itemsMoved, 'suppliers_moved' => $suppliersMoved]);

            return ['items_moved' => $itemsMoved, 'suppliers_moved' => $suppliersMoved];
        });
    }

    private function logImport(string $type, int $sourceId, int $targetId, ?string $quantity, User $user): void
    {
        DB::table('store_imports')->insert([
            'source_type' => $type, 'source_id' => $sourceId, 'target_id' => $targetId, 'quantity' => $quantity,
            'performed_by_user_id' => $user->id, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    /** Old stock rows not moved yet, merged by same name and unit. */
    private function pendingItemGroups(): Collection
    {
        $done = DB::table('store_imports')->where('source_type', 'inventory_item')->pluck('source_id');
        $stallNames = Stall::pluck('name', 'id');

        return DB::table('inventory_items')->whereNotIn('id', $done)->orderBy('id')->get()
            ->groupBy(fn ($r) => mb_strtolower(trim($r->name)) . '|' . self::normalizeUnit($r->unit))
            ->map(function (Collection $rows) use ($stallNames) {
                // The newest row sets the price, the same rule purchases use ("last price")
                $latest = $rows->sortBy([['updated_at', 'desc'], ['id', 'desc']])->first();

                return [
                    'name' => trim($rows->first()->name),
                    'unit' => self::normalizeUnit($rows->first()->unit),
                    'quantity' => $rows->reduce(fn (string $sum, $r) => bcadd($sum, self::decimal($r->current_stock), 3), '0.000'),
                    'minimum_alert_stock' => $rows->reduce(fn (string $max, $r) => bccomp(self::decimal($r->minimum_alert_stock), $max, 3) > 0 ? self::decimal($r->minimum_alert_stock) : $max, '0.000'),
                    'unit_cost' => self::decimal($latest->unit_cost, 2),
                    'price_differs' => $rows->map(fn ($r) => self::decimal($r->unit_cost, 2))->unique()->count() > 1,
                    'stalls' => $rows->map(fn ($r) => $stallNames[$r->stall_id] ?? "Stall {$r->stall_id}")->unique()->values()->all(),
                    'rows' => $rows->count(),
                    'source_ids' => $rows->mapWithKeys(fn ($r) => [$r->id => self::decimal($r->current_stock)])->all(),
                ];
            })
            ->values();
    }

    private function pendingSuppliers(): Collection
    {
        $done = DB::table('store_imports')->where('source_type', 'supplier')->pluck('source_id');

        return Supplier::whereNotIn('id', $done)->orderBy('id')->get();
    }
}
