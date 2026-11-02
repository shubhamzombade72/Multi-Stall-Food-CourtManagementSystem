<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DiningTable;
use App\Models\Stall;
use Illuminate\Http\Request;

class DiningTableController extends Controller
{
    public function index(Request $request)
    {
        $tables = DiningTable::where('is_active', true)->orderBy('table_number')->get();

        // Only the owner may read QR secrets (needed to print table QR codes)
        if ($request->user('sanctum')?->isOwner()) {
            $tables->each->makeVisible('qr_token');
        }

        return response()->json([
            'success' => true,
            'data' => $tables,
        ]);
    }

    public function showByQrToken($qrToken)
    {
        $table = DiningTable::where('qr_token', $qrToken)->where('is_active', true)->first();

        if (!$table) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid or expired QR code. Please scan an authentic table code.',
            ], 404);
        }

        // Return table along with stalls and available menus for instant zero-install customer experience
        $stalls = Stall::with(['categories.menuItems' => function ($q) {
            $q->where('is_available', true);
        }])->where('is_active', true)->get();

        return response()->json([
            'success' => true,
            'data' => [
                'table' => [
                    'id' => $table->id,
                    'table_number' => $table->table_number,
                    'section' => $table->section,
                    'capacity' => $table->capacity,
                    'status' => $table->status,
                ],
                'stalls' => $stalls,
            ]
        ]);
    }

    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
        }

        $validated = $request->validate([
            'table_number' => 'required|string|unique:dining_tables,table_number|max:20',
            'capacity' => 'required|integer|min:1',
            'section' => 'nullable|string|max:50',
        ]);

        $table = DiningTable::create($validated);

        return response()->json([
            'success' => true,
            'message' => 'Dining table created successfully',
            'data' => $table,
        ], 201);
    }

    public function updateStatus(Request $request, $id)
    {
        $user = $request->user();
        if (!$user->isOwner() && !$user->isCashier() && !$user->isWaiter()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
        }

        $table = DiningTable::findOrFail($id);

        $validated = $request->validate([
            'status' => 'required|in:available,occupied,reserved',
        ]);

        $table->update($validated);

        return response()->json([
            'success' => true,
            'message' => 'Table status updated successfully',
            'data' => $table,
        ]);
    }
}

