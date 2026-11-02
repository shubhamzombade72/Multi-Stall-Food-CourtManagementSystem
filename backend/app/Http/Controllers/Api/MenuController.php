<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MenuCategory;
use App\Models\MenuItem;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

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

        if (!MenuCategory::where('id', $validated['category_id'])->where('stall_id', $validated['stall_id'])->exists()) {
            return response()->json(['success' => false, 'message' => 'The category does not belong to this stall.'], 422);
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

        if (isset($validated['category_id'])
            && !MenuCategory::where('id', $validated['category_id'])->where('stall_id', $item->stall_id)->exists()) {
            return response()->json(['success' => false, 'message' => 'The category does not belong to this stall.'], 422);
        }

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

    private function canManageStall($user, $stallId): bool
    {
        return $user->isOwner() || ($user->isStallManager() && $user->stall_id == $stallId);
    }

    public function storeCategory(Request $request)
    {
        $validated = $request->validate([
            'stall_id' => 'required|exists:stalls,id',
            'name' => 'required|string|max:100',
            'display_order' => 'nullable|integer|min:0|max:1000',
        ]);

        if (!$this->canManageStall($request->user(), $validated['stall_id'])) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Only the owner or this stall\'s manager can add categories.'], 403);
        }

        $category = MenuCategory::create($validated + ['display_order' => $validated['display_order'] ?? 0, 'is_active' => true]);

        return response()->json(['success' => true, 'message' => 'Category created', 'data' => $category->load('stall:id,name')], 201);
    }

    public function updateCategory(Request $request, $id)
    {
        $category = MenuCategory::findOrFail($id);
        if (!$this->canManageStall($request->user(), $category->stall_id)) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
        }

        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:100',
            'display_order' => 'sometimes|integer|min:0|max:1000',
            'is_active' => 'sometimes|boolean',
        ]);
        $category->update($validated);

        return response()->json(['success' => true, 'message' => 'Category updated', 'data' => $category->fresh('stall:id,name')]);
    }

    /**
     * Upload a product photo. Only images (jpg/png/webp, max 2 MB) are accepted; the stored name is random,
     * so a client-supplied filename can never choose the path.
     */
    public function uploadImage(Request $request, $id)
    {
        $item = MenuItem::findOrFail($id);
        if (!$this->canManageStall($request->user(), $item->stall_id)) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
        }

        $request->validate([
            'image' => 'required|file|mimes:jpg,jpeg,png,webp|mimetypes:image/jpeg,image/png,image/webp|max:2048',
        ]);

        $file = $request->file('image');
        $name = Str::random(32) . '.' . $file->extension();
        $file->storeAs('menu-images', $name, 'local');

        $old = $item->image_url;
        $item->update(['image_url' => url('/api/public/menu-images/' . $name)]);
        if ($old && preg_match('#/menu-images/([A-Za-z0-9]{32}\.(?:jpg|jpeg|png|webp))$#', $old, $m)) {
            Storage::disk('local')->delete('menu-images/' . $m[1]);
        }

        return response()->json(['success' => true, 'message' => 'Image uploaded', 'data' => $item->fresh(['stall', 'category'])]);
    }

    /** Public, read-only image delivery. The filename must match the server-generated pattern exactly. */
    public function showImage(string $file)
    {
        if (!preg_match('/^[A-Za-z0-9]{32}\.(jpg|jpeg|png|webp)$/', $file) || !Storage::disk('local')->exists('menu-images/' . $file)) {
            abort(404);
        }

        return response()->file(Storage::disk('local')->path('menu-images/' . $file), [
            'Cache-Control' => 'public, max-age=86400',
            'X-Content-Type-Options' => 'nosniff',
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

