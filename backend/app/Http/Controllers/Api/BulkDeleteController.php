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

    /** Read-only: which of the selected stalls can be deleted for good, which cannot and why. Same owner rule and id validation as the delete. */
    public function stallPreview(Request $request, BulkDeleteService $service)
    {
        $ids = $this->ownerIds($request, 'stalls');
        if ($ids instanceof \Illuminate\Http\JsonResponse) {
            return $ids;
        }

        return response()->json(['success' => true] + $service->previewStalls($ids));
    }

    /** @return array<int, int>|\Illuminate\Http\JsonResponse the validated ids, or the 403 for a non-owner */
    private function ownerIds(Request $request, string $label)
    {
        if (!$request->user()->isOwner()) {
            return response()->json(['success' => false, 'message' => "Only the owner can bulk delete {$label}."], 403);
        }

        return $request->validate([
            'ids' => ['required', 'array', 'min:1', 'max:' . BulkDeleteService::MAX_IDS],
            'ids.*' => ['integer', 'min:1', 'distinct'],
        ], [
            'ids.max' => 'At most ' . BulkDeleteService::MAX_IDS . " {$label} can be deleted per request.",
        ])['ids'];
    }

    private function run(Request $request, \Closure $action, string $label)
    {
        $ids = $this->ownerIds($request, $label);
        if ($ids instanceof \Illuminate\Http\JsonResponse) {
            return $ids;
        }

        $result = $action($ids, $request->user()->id);
        $s = $result['summary'];

        return response()->json([
            'success' => true,
            'message' => "{$s['deleted']} of {$s['requested']} {$label} deleted" . ($s['failed'] ? ", {$s['failed']} could not be deleted." : '.'),
        ] + $result);
    }
}
