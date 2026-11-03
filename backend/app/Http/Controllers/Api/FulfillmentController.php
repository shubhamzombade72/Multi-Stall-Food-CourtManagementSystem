<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\FulfillmentService;
use Illuminate\Http\Request;

class FulfillmentController extends Controller
{
    public function __construct(private readonly FulfillmentService $fulfillment)
    {
    }

    /** GET /orders/board?cursor= — tracking board feed (owner, cashier, waiter). */
    public function board(Request $request)
    {
        if (!$this->fulfillment->canMarkServed($request->user())) {
            return response()->json(['success' => false, 'message' => 'Only the owner, cashier or waiter can view the order board.'], 403);
        }
        $validated = $request->validate(['cursor' => 'nullable|string|max:200']);

        $page = $this->fulfillment->board($validated['cursor'] ?? null);

        return response()->json([
            'success' => true,
            'data' => [
                'server_time' => now()->toIso8601String(),
                'delay_minutes' => (int) SettingsController::current('order_tracking')['delay_minutes'],
            ] + $page,
        ]);
    }

    /** POST /orders/{id}/serve-remaining — Serve All Remaining for the confirmed items (durably idempotent). */
    public function serveRemaining(Request $request, $id)
    {
        // Role check first, so a refused call never consumes the idempotency key
        if (!$this->fulfillment->canMarkServed($request->user())) {
            return response()->json(['success' => false, 'message' => 'Only the owner, cashier or waiter can mark food as served.', 'error' => 'forbidden'], 403);
        }
        $validated = $request->validate([
            'idempotency_key' => 'required|string|min:8|max:64',
            'item_ids' => 'required|array|min:1|max:200',
            'item_ids.*' => 'required|integer|distinct',
        ]);

        $result = $this->fulfillment->serveRemaining(
            (int) $id,
            $request->user(),
            $validated['idempotency_key'],
            $validated['item_ids'],
        );

        return response()->json([
            'success' => true,
            'message' => $result['replayed'] ? 'Already served (repeated request)' : 'Remaining items served',
            'data' => [
                'replayed' => $result['replayed'],
                'served_item_ids' => $result['served_item_ids'],
                'order' => $this->fulfillment->boardOrder($result['order_id']),
            ],
        ]);
    }

    /** PATCH /ticket-items/{id}/status — move one item forward (Preparing / Ready / Served). */
    public function updateItemStatus(Request $request, $id)
    {
        $validated = $request->validate([
            'status' => 'required|in:preparing,ready,served',
            'expected_version' => 'nullable|integer|min:0',
        ]);

        $result = $this->fulfillment->transitionItem(
            (int) $id,
            $validated['status'],
            $request->user(),
            isset($validated['expected_version']) ? (int) $validated['expected_version'] : null,
        );

        return response()->json([
            'success' => true,
            'message' => $result['changed'] ? 'Item updated' : 'Item already has this status',
            'data' => [
                'changed' => $result['changed'],
                'item' => FulfillmentService::presentItem($result['item']),
            ],
        ]);
    }
}
