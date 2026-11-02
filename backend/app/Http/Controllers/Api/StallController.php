<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Stall;
use Illuminate\Http\Request;

class StallController extends Controller
{
    public function index()
    {
        $stalls = Stall::with(['categories.menuItems' => function ($q) {
            $q->where('is_available', true);
        }])->where('is_active', true)->get();

        return response()->json([
            'success' => true,
            'data' => $stalls,
        ]);
    }

    public function show($id)
    {
        $stall = Stall::with(['categories.menuItems', 'users', 'suppliers'])->findOrFail($id);

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

        return response()->json([
            'success' => true,
            'message' => 'Stall created successfully',
            'data' => $stall,
        ], 201);
    }

    public function update(Request $request, $id)
    {
        $user = $request->user();
        if (!$user->isOwner() && ($user->stall_id != $id)) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
        }

        $stall = Stall::findOrFail($id);

        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'description' => 'nullable|string',
            'contact_phone' => 'nullable|string|max:20',
            'logo_url' => 'nullable|string',
            'is_active' => 'sometimes|boolean',
        ]);

        $stall->update($validated);

        return response()->json([
            'success' => true,
            'message' => 'Stall updated successfully',
            'data' => $stall,
        ]);
    }
}

