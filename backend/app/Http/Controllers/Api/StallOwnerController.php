<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\StallOwner;
use App\Services\AuditService;
use Illuminate\Http\Request;

/** The people stalls are owned by (who settlement money is paid to). Owner role only. */
class StallOwnerController extends Controller
{
    public function index(Request $request)
    {
        if (!$request->user()->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
        }

        return response()->json(['success' => true, 'data' => StallOwner::with('stalls:id,name,code,stall_owner_id')->orderBy('name')->get()]);
    }

    public function store(Request $request)
    {
        if (!$request->user()->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
        }

        $d = $request->validate([
            'name' => 'required|string|max:255',
            'phone' => 'nullable|string|max:20',
            'upi_id' => 'nullable|string|max:100',
        ]);
        $owner = StallOwner::create($d);
        AuditService::log('stall_owner_created', 'StallOwner', $owner->id, null, null, $owner->only(['name', 'phone']), $request->user()->id);

        return response()->json(['success' => true, 'message' => 'Stall owner added', 'data' => $owner], 201);
    }

    public function update(Request $request, int $id)
    {
        if (!$request->user()->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
        }

        $owner = StallOwner::findOrFail($id);
        $d = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'phone' => 'nullable|string|max:20',
            'upi_id' => 'nullable|string|max:100',
            'is_active' => 'sometimes|boolean',
        ]);
        $old = $owner->only(array_keys($d));
        $owner->update($d);
        AuditService::log('stall_owner_updated', 'StallOwner', $owner->id, null, $old, $owner->only(array_keys($d)), $request->user()->id);

        return response()->json(['success' => true, 'message' => 'Stall owner updated', 'data' => $owner]);
    }
}
