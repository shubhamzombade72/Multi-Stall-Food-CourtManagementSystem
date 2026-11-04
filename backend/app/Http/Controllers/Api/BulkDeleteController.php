<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\BulkDeleteService;
use Illuminate\Http\Request;

/** Owner-only bulk delete for the Stall Directory and the Menu Catalog. See BulkDeleteService for what is blocked. */
class BulkDeleteController extends Controller
{
    public function stalls(Request $request, BulkDeleteService $service)
    {
        return $this->run($request, fn (array $ids, int $uid) => $service->deleteStalls($ids, $uid), 'stalls');
    }

    public function menuItems(Request $request, BulkDeleteService $service)
    {
        return $this->run($request, fn (array $ids, int $uid) => $service->deleteMenuItems($ids, $uid), 'menu items');
    }

    private function run(Request $request, \Closure $action, string $label)
    {
        $user = $request->user();
        if (!$user->isOwner()) {
            return response()->json(['success' => false, 'message' => "Only the owner can bulk delete {$label}."], 403);
        }

        $validated = $request->validate([
            'ids' => ['required', 'array', 'min:1', 'max:' . BulkDeleteService::MAX_IDS],
            'ids.*' => ['integer', 'min:1', 'distinct'],
        ], [
            'ids.max' => 'At most ' . BulkDeleteService::MAX_IDS . " {$label} can be deleted per request.",
        ]);

        $result = $action($validated['ids'], $user->id);
        $s = $result['summary'];

        return response()->json([
            'success' => true,
            'message' => "{$s['deleted']} of {$s['requested']} {$label} deleted" . ($s['failed'] ? ", {$s['failed']} could not be deleted." : '.'),
        ] + $result);
    }
}
