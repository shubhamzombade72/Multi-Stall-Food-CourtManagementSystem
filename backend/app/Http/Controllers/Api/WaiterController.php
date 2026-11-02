<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DiningTable;
use App\Models\StallKitchenTicket;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

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

    public function markTicketServed(Request $request, $ticketId)
    {
        $waiter = $request->user();
        if (!$waiter->isWaiter() && !$waiter->isOwner()) {
            return response()->json(['success' => false, 'message' => 'Unauthorized. Only waiters can confirm serving.'], 403);
        }

        return DB::transaction(function () use ($ticketId, $waiter) {
            $ticket = StallKitchenTicket::where('id', $ticketId)->lockForUpdate()->firstOrFail();

            // Idempotent: a repeated tap (or offline retry) on an already-served ticket is a no-op
            if ($ticket->status === 'picked_up') {
                return response()->json([
                    'success' => true,
                    'message' => 'Food already marked as served',
                    'data' => $ticket->fresh(['order.table', 'stall']),
                ]);
            }

            if ($ticket->status !== 'ready') {
                return response()->json([
                    'success' => false,
                    'message' => "Ticket is '{$ticket->status}', only ready tickets can be served.",
                ], 422);
            }

            $ticket->update([
                'status' => 'picked_up',
                'picked_up_at' => now(),
                'served_by_waiter_id' => $waiter->id,
            ]);

            $ticket->ticketItems()->update(['status' => 'served']);

            // Check if all tickets for parent order are now served (a settled order keeps 'completed')
            $parentOrder = $ticket->order()->lockForUpdate()->first();
            $allServed = $parentOrder->kitchenTickets()->get()->every(function ($t) {
                return in_array($t->status, ['picked_up', 'cancelled']);
            });

            if ($allServed && !in_array($parentOrder->status, ['completed', 'cancelled'], true)) {
                $parentOrder->update(['status' => 'served']);
            }

            return response()->json([
                'success' => true,
                'message' => 'Food marked as served to table',
                'data' => $ticket->fresh(['order.table', 'stall']),
            ]);
        });
    }
}
