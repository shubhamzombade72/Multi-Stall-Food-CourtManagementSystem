<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DiningTable;
use App\Models\StallKitchenTicket;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class WaiterController extends Controller
{
    public function getActiveTables()
    {
        $tables = DiningTable::with(['orders' => function ($q) {
            $q->whereNotIn('status', ['completed', 'cancelled'])->latest();
        }])->where('is_active', true)->orderBy('table_number')->get();

        return response()->json([
            'success' => true,
            'data' => $tables,
        ]);
    }

    public function getReadyTickets()
    {
        // Ready tickets ready to be picked up by waiters and served to customers
        $tickets = StallKitchenTicket::with([
            'order.table:id,table_number,section',
            'ticketItems.orderItem',
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

        $ticket = StallKitchenTicket::with('order.kitchenTickets')->findOrFail($ticketId);

        DB::transaction(function () use ($ticket, $waiter) {
            $ticket->update([
                'status' => 'picked_up',
                'picked_up_at' => now(),
                'served_by_waiter_id' => $waiter->id,
            ]);

            $ticket->ticketItems()->update(['status' => 'served']);

            // Check if all tickets for parent order are now served
            $parentOrder = $ticket->order;
            $allTickets = $parentOrder->kitchenTickets()->get();
            $allServed = $allTickets->every(function ($t) {
                return in_array($t->status, ['picked_up', 'cancelled']);
            });

            if ($allServed) {
                $parentOrder->update(['status' => 'served']);
            }
        });

        return response()->json([
            'success' => true,
            'message' => 'Food marked as served to table',
            'data' => $ticket->fresh(['order.table', 'stall']),
        ]);
    }
}

