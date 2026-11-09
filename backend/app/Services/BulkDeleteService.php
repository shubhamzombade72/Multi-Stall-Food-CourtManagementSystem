<?php

namespace App\Services;

use App\Models\MenuItem;
use App\Models\Stall;
use Illuminate\Support\Facades\DB;

/**
 * Safe bulk deletion of stalls and menu items.
 *
 * Rules (the database would otherwise cascade-delete order lines, kitchen tickets and settlements, so the checks are explicit):
 *  - a menu item that appears on any order line is never deleted (mark it Sold Out instead);
 *  - a stall that has order lines, kitchen tickets, settlement records, settlement payouts, purchase orders, stock movements,
 *    central-store issues, assigned staff, suppliers or inventory is never deleted (deactivate it instead). That verdict lives in
 *    stallEligibility(), which the read-only preview and the real delete both use, so they can never disagree;
 *  - a stall with none of those is deleted together with its own menu categories and menu items, which are reported;
 *  - every record is handled in its own transaction, so one blocked record never stops or rolls back the others.
 */
class BulkDeleteService
{
    public const MAX_IDS = 200;

    /** @param array<int, int|string> $ids @return array<string, mixed> */
    public function deleteStalls(array $ids, int $userId): array
    {
        return $this->process($ids, fn (int $id) => $this->deleteStall($id, $userId));
    }

    /** @param array<int, int|string> $ids @return array<string, mixed> */
    public function deleteMenuItems(array $ids, int $userId): array
    {
        return $this->process($ids, fn (int $id) => $this->deleteItem($id, $userId));
    }

    private function process(array $ids, \Closure $one): array
    {
        $deleted = [];
        $failed = [];
        foreach (array_values(array_unique(array_map('intval', $ids))) as $id) {
            try {
                $result = DB::transaction(fn () => $one($id));
            } catch (\Throwable $e) {
                report($e);
                $result = ['ok' => false, 'name' => null, 'code' => null, 'reason' => 'Unexpected error; nothing was deleted for this record.'];
            }
            if ($result['ok']) {
                $deleted[] = ['id' => $id, 'name' => $result['name'], 'code' => $result['code']] + ($result['extra'] ?? []);
            } else {
                $failed[] = ['id' => $id, 'name' => $result['name'], 'code' => $result['code'], 'reason' => $result['reason']]
                    + array_intersect_key($result, ['blockers' => 1, 'can_deactivate' => 1]);
            }
        }

        return [
            'summary' => ['requested' => count($deleted) + count($failed), 'deleted' => count($deleted), 'failed' => count($failed)],
            'deleted' => $deleted,
            'failed' => $failed,
        ];
    }

    /**
     * The single source of truth for "can this stall be deleted for good?". Read-only.
     * `history` blockers are sales / kitchen / money records that must never be erased (the answer is Deactivate);
     * `setup` blockers are working data that has to be reassigned or removed first (or the stall deactivated).
     *
     * @return array{eligible: bool, blockers: list<array{key: string, label: string, count: int, kind: string}>, menu_items: int, categories: int}
     */
    public function stallEligibility(Stall $stall): array
    {
        $id = $stall->id;
        $itemIds = MenuItem::where('stall_id', $id)->select('id');
        // [key => [label, kind, count]]; menu_items_on_orders catches an order line that points at one of this stall's dishes under another stall id
        $links = [
            'order_items' => ['order line(s)', 'history', DB::table('order_items')->where('stall_id', $id)->count()],
            'kitchen_tickets' => ['kitchen ticket(s)', 'history', DB::table('stall_kitchen_tickets')->where('stall_id', $id)->count()],
            'settlement_records' => ['settlement record(s)', 'history', DB::table('stall_settlement_records')->where('stall_id', $id)->count()],
            'settlement_payouts' => ['settlement payout(s)', 'history', DB::table('settlement_payouts')->where('stall_id', $id)->count()],
            'purchase_orders' => ['purchase order(s)', 'history', DB::table('purchase_orders')->where('stall_id', $id)->count()],
            'stock_movements' => ['stock movement(s)', 'history', DB::table('stock_movements')->where('stall_id', $id)->count()],
            'store_movements' => ['central store issue(s)', 'history', DB::table('store_movements')->where('stall_id', $id)->count()],
            'menu_items_on_orders' => ['order line(s) for its dishes under another stall', 'history', DB::table('order_items')->whereIn('menu_item_id', $itemIds)->where('stall_id', '<>', $id)->count()],
            'staff' => ['assigned staff account(s)', 'setup', DB::table('users')->where('stall_id', $id)->count()],
            'suppliers' => ['supplier(s)', 'setup', DB::table('suppliers')->where('stall_id', $id)->count()],
            'inventory_items' => ['inventory item(s)', 'setup', DB::table('inventory_items')->where('stall_id', $id)->count()],
        ];
        $blockers = [];
        foreach ($links as $key => [$label, $kind, $count]) {
            if ($count > 0) {
                $blockers[] = ['key' => $key, 'label' => $label, 'count' => $count, 'kind' => $kind];
            }
        }

        return [
            'eligible' => $blockers === [],
            'blockers' => $blockers,
            'menu_items' => MenuItem::where('stall_id', $id)->count(),
            'categories' => DB::table('menu_categories')->where('stall_id', $id)->count(),
        ];
    }

    /** Plain-language refusal text for a stall that is not eligible. */
    public function stallBlockedReason(array $eligibility): string
    {
        $list = implode(', ', array_map(fn ($b) => "{$b['count']} {$b['label']}", $eligibility['blockers']));
        $hasHistory = (bool) array_filter($eligibility['blockers'], fn ($b) => $b['kind'] === 'history');

        return $hasHistory
            ? "Linked to business records ({$list}). Deactivate the stall instead of deleting it."
            : "Still has setup data ({$list}). Reassign or remove it first, or deactivate the stall instead of deleting it.";
    }

    /**
     * Read-only preview for the delete dialog: one verdict per stall, in the order asked, plus the ids that do not exist.
     * It takes no lock and writes nothing; the real delete re-checks under a row lock.
     *
     * @param array<int, int|string> $ids
     * @return array{stalls: list<array<string, mixed>>, missing: list<int>}
     */
    public function previewStalls(array $ids): array
    {
        $ids = array_values(array_unique(array_map('intval', $ids)));
        $stalls = Stall::whereIn('id', $ids)->get()->keyBy('id');
        $out = [];
        $missing = [];
        foreach ($ids as $id) {
            $stall = $stalls->get($id);
            if (!$stall) {
                $missing[] = $id;
                continue;
            }
            $e = $this->stallEligibility($stall);
            $out[] = [
                'id' => $stall->id, 'name' => $stall->name, 'code' => $stall->code, 'is_active' => (bool) $stall->is_active,
                'eligible' => $e['eligible'], 'can_deactivate' => (bool) $stall->is_active,
                'menu_items' => $e['menu_items'], 'categories' => $e['categories'], 'blockers' => $e['blockers'],
                'reason' => $e['eligible'] ? null : $this->stallBlockedReason($e),
            ];
        }

        return ['stalls' => $out, 'missing' => $missing];
    }

    private function deleteStall(int $id, int $userId): array
    {
        // The row lock serialises this with order creation, which takes a shared lock on the stalls it orders from
        $stall = Stall::whereKey($id)->lockForUpdate()->first();
        if (!$stall) {
            return ['ok' => false, 'name' => null, 'code' => null, 'reason' => 'Not found (it may already have been deleted).'];
        }

        $eligibility = $this->stallEligibility($stall);
        if (!$eligibility['eligible']) {
            return [
                'ok' => false, 'name' => $stall->name, 'code' => $stall->code,
                'reason' => $this->stallBlockedReason($eligibility),
                'blockers' => $eligibility['blockers'], 'can_deactivate' => (bool) $stall->is_active,
            ];
        }

        $itemIds = MenuItem::where('stall_id', $id)->pluck('id');
        $removedItems = $itemIds->count();
        $removedCategories = DB::table('menu_categories')->where('stall_id', $id)->count();
        $snapshot = $stall->only(['id', 'name', 'code']) + ['menu_items_removed' => $removedItems, 'categories_removed' => $removedCategories];

        $stall->delete(); // menu_categories / menu_items cascade; nothing else references this stall any more
        AuditService::log('stall_deleted', 'Stall', $id, null, $snapshot, null, $userId);

        return ['ok' => true, 'name' => $snapshot['name'], 'code' => $snapshot['code'], 'extra' => ['menu_items_removed' => $removedItems, 'categories_removed' => $removedCategories]];
    }

    private function deleteItem(int $id, int $userId): array
    {
        $item = MenuItem::whereKey($id)->lockForUpdate()->first();
        if (!$item) {
            return ['ok' => false, 'name' => null, 'code' => null, 'reason' => 'Not found (it may already have been deleted).'];
        }

        $uses = DB::table('order_items')->where('menu_item_id', $id)->count();
        if ($uses > 0) {
            return [
                'ok' => false, 'name' => $item->name, 'code' => null,
                'reason' => "Used on {$uses} past order line(s); deleting it would erase order history. Mark it Sold Out instead.",
            ];
        }

        $snapshot = $item->only(['id', 'name', 'stall_id', 'category_id', 'price']);
        $item->delete();
        AuditService::log('menu_item_deleted', 'MenuItem', $id, $snapshot['stall_id'], $snapshot, null, $userId);

        return ['ok' => true, 'name' => $snapshot['name'], 'code' => null];
    }
}
