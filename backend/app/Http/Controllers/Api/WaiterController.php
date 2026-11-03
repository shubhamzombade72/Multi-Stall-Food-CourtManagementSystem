<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DiningTable;
use App\Models\StallKitchenTicket;
use App\Services\FulfillmentService;
use Illuminate\Http\Request;

class WaiterController extends Controller
{
    public function getActiveTables(Request $request)
    {
        $user = $request->user();
        if (!$user->isWaiter() && !$user->isOwner() && !$user->isCashier()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
        }

        $tables = DiningTable::with(['orders' => function ($q) {
            $q->whereNotIn('status', ['completed', 'cancelled'])->latest();
        }])->where('is_active', true)->orderBy('table_number')->get();

        return response()->json([
            'success' => true,
            'data' => $tables,
        ]);
    }

    public function getReadyTickets(Request $request)
    {
        $user = $request->user();
        if (!$user->isWaiter() && !$user->isOwner() && !$user->isCashier()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 403);
        }

        // Ready tickets ready to be picked up by waiters and served to customers
        $tickets = StallKitchenTicket::with([
            'order:id,order_number,table_id,status',
            'order.table:id,table_number,section',
            'ticketItems.orderItem:id,item_name,quantity,special_instructions',
            'stall:id,name,code',
        ])
        ->where('status', 'ready')
        ->orderBy('ready_at')
        ->get();

        return response()->json([
            'success' => true,
            'data' => $tickets,
        ]);
    }

    public function markTicketServed(Request $request, FulfillmentService $fulfillment, $ticketId)
    {
        $waiter = $request->user();
        if (!$waiter->isWaiter() && !$waiter->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Only waiters can confirm serving.'], 403);
        }

        // Locks order -> ticket -> items, serves the ticket's unserved items (versioned, mirrored, audited)
        // and derives the order status. Not ready -> 422 "Ticket is '...', only ready tickets can be served."
        $result = $fulfillment->serveTicket((int) $ticketId, $waiter);

        // Idempotent: a repeated tap (or offline retry) on an already-served ticket is a no-op
        return response()->json([
            'success' => true,
            'message' => $result['already'] ? 'Food already marked as served' : 'Food marked as served to table',
            'data' => $result['ticket']->fresh(['order.table', 'stall']),
        ]);
    }
}
