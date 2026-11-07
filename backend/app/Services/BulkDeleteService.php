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
 *  - a stall that has order lines, kitchen tickets, settlement records, purchase orders, stock movements, assigned staff,
 *    suppliers or inventory is never deleted (deactivate it instead);
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
                $failed[] = ['id' => $id, 'name' => $result['name'], 'code' => $result['code'], 'reason' => $result['reason']];
            }
        }

        return [
            'summary' => ['requested' => count($deleted) + count($failed), 'deleted' => count($deleted), 'failed' => count($failed)],
            'deleted' => $deleted,
            'failed' => $failed,
        ];
    }

    private function deleteStall(int $id, int $userId): array
    {
        $stall = Stall::whereKey($id)->lockForUpdate()->first();
        if (!$stall) {
            return ['ok' => false, 'name' => null, 'code' => null, 'reason' => 'Not found (it may already have been deleted).'];
        }

        $links = [
            'order line(s)' => DB::table('order_items')->where('stall_id', $id)->count(),
            'kitchen ticket(s)' => DB::table('stall_kitchen_tickets')->where('stall_id', $id)->count(),
            'settlement record(s)' => DB::table('stall_settlement_records')->where('stall_id', $id)->count(),
            'purchase order(s)' => DB::table('purchase_orders')->where('stall_id', $id)->count(),
            'stock movement(s)' => DB::table('stock_movements')->where('stall_id', $id)->count(),
            'assigned staff account(s)' => DB::table('users')->where('stall_id', $id)->count(),
            'supplier(s)' => DB::table('suppliers')->where('stall_id', $id)->count(),
            'inventory item(s)' => DB::table('inventory_items')->where('stall_id', $id)->count(),
            'central store issue(s)' => DB::table('store_movements')->where('stall_id', $id)->count(),
        ];
        $blockers = [];
        foreach ($links as $label => $n) {
            if ($n > 0) {
                $blockers[] = "{$n} {$label}";
            }
        }
        if ($blockers) {
            return [
                'ok' => false, 'name' => $stall->name, 'code' => $stall->code,
                'reason' => 'Linked to business records (' . implode(', ', $blockers) . '). Deactivate the stall instead of deleting it.',
            ];
        }

        // Order lines are matched by stall above; this also catches an order line that points at one of this stall's items.
        $itemIds = MenuItem::where('stall_id', $id)->pluck('id');
        if ($itemIds->isNotEmpty() && DB::table('order_items')->whereIn('menu_item_id', $itemIds)->exists()) {
            return ['ok' => false, 'name' => $stall->name, 'code' => $stall->code, 'reason' => 'Its menu items appear in past orders. Deactivate the stall instead of deleting it.'];
        }

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
