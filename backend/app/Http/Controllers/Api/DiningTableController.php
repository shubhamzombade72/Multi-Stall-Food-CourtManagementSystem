<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DiningTable;
use App\Models\Stall;
use App\Services\AuditService;
use Illuminate\Http\Request;

class DiningTableController extends Controller
{
    public function index(Request $request)
    {
        $isOwner = (bool) $request->user('sanctum')?->isOwner();

        // Inactive tables are listed only for the owner's table management screen
        $tables = DiningTable::when(!($isOwner && $request->boolean('include_inactive')), fn ($q) => $q->where('is_active', true))
            ->orderBy('section')
            ->orderBy('table_number')
            ->get();

        // Only the owner may read QR secrets (needed to print table QR codes)
        if ($isOwner) {
            $tables->each->makeVisible('qr_token');
        }

        return response()->json([
            'success' => true,
            'data' => $tables,
        ]);
    }

    /** Distinct floor sections in use, for the section picker. */
    public function sections()
    {
        return response()->json([
            'success' => true,
            'data' => DiningTable::query()->distinct()->orderBy('section')->pluck('section'),
        ]);
    }

    public function update(Request $request, $id)
    {
        if (!$request->user()->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
        }

        $table = DiningTable::findOrFail($id);
        $validated = $request->validate([
            'table_number' => 'sometimes|required|string|max:20|unique:dining_tables,table_number,' . $table->id,
            'capacity' => 'sometimes|required|integer|min:1|max:50',
            'section' => 'sometimes|required|string|max:50',
            'is_active' => 'sometimes|boolean',
        ]);

        if (array_key_exists('is_active', $validated) && !$validated['is_active'] && $table->status === 'occupied') {
            return response()->json(['success' => false, 'message' => 'An occupied table cannot be deactivated. Settle or move its order first.'], 422);
        }

        $old = $table->only(array_keys($validated));
        $table->update($validated);
        AuditService::log('table_updated', 'DiningTable', $table->id, null, $old, $table->only(array_keys($validated)));

        return response()->json(['success' => true, 'message' => 'Table updated', 'data' => $table->makeVisible('qr_token')]);
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
            'capacity' => 'required|integer|min:1|max:50',
            'section' => 'nullable|string|max:50',
        ]);

        // refresh() so the response carries database defaults (section "Main Hall", status, is_active)
        $table = DiningTable::create(array_filter($validated, fn ($v) => $v !== null))->refresh();
        AuditService::log('table_created', 'DiningTable', $table->id, null, null, $table->only(['table_number', 'capacity', 'section']));

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

        $old = $table->status;
        $table->update($validated);
        if ($old !== $table->status) {
            AuditService::log('table_status_changed', 'DiningTable', $table->id, null, ['status' => $old], ['status' => $table->status]);
        }

        return response()->json([
            'success' => true,
            'message' => 'Table status updated successfully',
            'data' => $table,
        ]);
    }
}

