<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Stall;
use App\Services\AuditService;
use Illuminate\Http\Request;

class StallController extends Controller
{
    public function index(Request $request)
    {
        // Ordering screens only ever see open stalls; the owner can ask for inactive ones to manage them
        $includeInactive = $request->boolean('include_inactive') && $request->user('sanctum')?->isOwner();

        $stalls = Stall::with(['categories.menuItems' => function ($q) {
            $q->where('is_available', true);
        }])->when(!$includeInactive, fn ($q) => $q->where('is_active', true))->orderBy('id')->get();

        // Assigned stall managers, for the owner's stall directory only (this endpoint is also public)
        if ($request->user('sanctum')?->isOwner()) {
            $stalls->load(['users' => fn ($q) => $q->where('role', 'stall_manager')->select('id', 'name', 'stall_id', 'is_active')]);
        }

        return response()->json([
            'success' => true,
            'data' => $stalls,
        ]);
    }

    public function show(Request $request, $id)
    {
        $user = $request->user();
        if (!$user->isOwner() && !($user->isStallManager() && $user->stall_id == $id)) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
        }

        $stall = Stall::with(['categories.menuItems', 'users:id,name,role,stall_id,is_active', 'suppliers'])->findOrFail($id);

        return response()->json([
            'success' => true,
            'data' => $stall,
        ]);
    }

    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
        }

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'code' => 'required|string|unique:stalls,code|max:50',
            'description' => 'nullable|string',
            'contact_phone' => 'nullable|string|max:20',
            'logo_url' => 'nullable|string',
        ]);

        $stall = Stall::create($validated);

        AuditService::log('stall_created', 'Stall', $stall->id, $stall->id, null, $stall->only(['name', 'code']), $user->id);

        return response()->json([
            'success' => true,
            'message' => 'Stall created successfully',
            'data' => $stall,
        ], 201);
    }

    public function update(Request $request, $id)
    {
        $user = $request->user();
        if (!$user->isOwner() && !($user->isStallManager() && $user->stall_id == $id)) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
        }

        // Only the owner can activate / deactivate a stall
        if ($request->has('is_active') && !$user->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Only the owner can activate or deactivate a stall'], 403);
        }

        $stall = Stall::findOrFail($id);

        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'description' => 'nullable|string',
            'contact_phone' => 'nullable|string|max:20',
            'logo_url' => 'nullable|url|max:500',
            'is_active' => 'sometimes|boolean',
        ]);

        $old = $stall->only(array_keys($validated));
        $stall->update($validated);

        AuditService::log('stall_updated', 'Stall', $stall->id, $stall->id, $old, $stall->only(array_keys($validated)), $user->id);

        return response()->json([
            'success' => true,
            'message' => 'Stall updated successfully',
            'data' => $stall,
        ]);
    }
}

