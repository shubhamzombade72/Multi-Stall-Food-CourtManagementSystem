<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MenuCategory;
use App\Models\MenuItem;
use Illuminate\Http\Request;

class MenuController extends Controller
{
    public function index(Request $request)
    {
        $query = MenuItem::with(['stall:id,name,code', 'category:id,name']);

        if ($request->has('stall_id')) {
            $query->where('stall_id', $request->query('stall_id'));
        }

        if ($request->boolean('available_only', false)) {
            $query->where('is_available', true);
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
            'category_id' => 'required|exists:menu_categories,id',
            'name' => 'required|string|max:255',
            'description' => 'nullable|string',
            'price' => 'required|numeric|min:0',
            'is_veg' => 'boolean',
            'is_available' => 'boolean',
            'preparation_time_minutes' => 'integer|min:1',
            'image_url' => 'nullable|string',
        ]);

        if (!$user->isOwner() && !($user->isStallManager() && $user->stall_id == $validated['stall_id'])) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Only Stall Manager or Owner can create menu items.'], 403);
        }

        $item = MenuItem::create($validated);

        return response()->json([
            'success' => true,
            'message' => 'Menu item created successfully',
            'data' => $item->load(['stall', 'category']),
        ], 201);
    }

    public function update(Request $request, $id)
    {
        $user = $request->user();
        $item = MenuItem::findOrFail($id);

        if (!$user->isOwner() && !($user->isStallManager() && $user->stall_id == $item->stall_id)) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Only Stall Manager or Owner can update menu items.'], 403);
        }

        $validated = $request->validate([
            'category_id' => 'sometimes|required|exists:menu_categories,id',
            'name' => 'sometimes|required|string|max:255',
            'description' => 'nullable|string',
            'price' => 'sometimes|required|numeric|min:0',
            'is_veg' => 'boolean',
            'is_available' => 'boolean',
            'preparation_time_minutes' => 'integer|min:1',
            'image_url' => 'nullable|string',
        ]);

        $item->update($validated);

        return response()->json([
            'success' => true,
            'message' => 'Menu item updated successfully',
            'data' => $item->load(['stall', 'category']),
        ]);
    }

    public function toggleAvailability(Request $request, $id)
    {
        $user = $request->user();
        $item = MenuItem::findOrFail($id);

        if (!$user->isOwner() && !($user->isStallManager() && $user->stall_id == $item->stall_id)) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Only Stall Manager or Owner can toggle dish availability.'], 403);
        }

        $item->is_available = !$item->is_available;
        $item->save();

        return response()->json([
            'success' => true,
            'message' => 'Item availability toggled',
            'data' => $item,
        ]);
    }

    public function categories(Request $request)
    {
        $query = MenuCategory::with('stall:id,name');

        if ($request->has('stall_id')) {
            $query->where('stall_id', $request->query('stall_id'));
        }

        $categories = $query->orderBy('display_order')->get();

        return response()->json([
            'success' => true,
            'data' => $categories,
        ]);
    }
}

