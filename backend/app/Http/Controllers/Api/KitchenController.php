<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\StallKitchenTicket;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class KitchenController extends Controller
{
    public function getTickets(Request $request)
    {
        $user = $request->user();

        $query = StallKitchenTicket::with([
            'order.table:id,table_number,section',
            'ticketItems.orderItem',
            'stall:id,name,code',
        ]);

        // Strict stall isolation: kitchen staff can ONLY see their own stall's tickets
        if (!$user->isOwner()) {
            if (!$user->stall_id) {
                return response()->json(['success' => false, 'message' => 'No stall assigned to kitchen user'], 403);
            }
            $query->where('stall_id', $user->stall_id);
        } elseif ($request->has('stall_id')) {
            $query->where('stall_id', $request->query('stall_id'));
        }

        // Active tickets for KDS screen: pending, accepted, preparing, ready
        if ($request->has('status')) {
            $query->where('status', $request->query('status'));
        } else {
            $query->whereIn('status', ['pending', 'accepted', 'preparing', 'ready']);
        }

        $tickets = $query->orderBy('created_at')->get();

        return response()->json([
            'success' => true,
            'data' => $tickets,
        ]);
    }

    public function updateTicketStatus(Request $request, $ticketId)
    {
        $user = $request->user();

        $ticket = StallKitchenTicket::with('order.kitchenTickets', 'ticketItems')->findOrFail($ticketId);

        // Strict security: ensure kitchen staff belongs to this stall
        if (!$user->isOwner() && ($user->stall_id != $ticket->stall_id)) {
            return response()->json(['success' => false, 'message' => 'Unauthorized to update another stall\'s ticket'], 403);
        }

        $validated = $request->validate([
            'status' => 'required|in:accepted,preparing,ready,picked_up',
        ]);

        $newStatus = $validated['status'];

        DB::transaction(function () use ($ticket, $newStatus) {
            $updates = ['status' => $newStatus];

            if ($newStatus === 'accepted' && !$ticket->accepted_at) {
                $updates['accepted_at'] = now();
            } elseif ($newStatus === 'ready' && !$ticket->ready_at) {
                $updates['ready_at'] = now();
            } elseif ($newStatus === 'picked_up' && !$ticket->picked_up_at) {
                $updates['picked_up_at'] = now();
            }

            $ticket->update($updates);

            // Update item statuses inside this ticket
            $ticket->ticketItems()->update(['status' => $newStatus]);

            // Update Parent Order status dynamically
            $parentOrder = $ticket->order;
            $allTickets = $parentOrder->kitchenTickets()->get();

            $totalTickets = $allTickets->count();
            $readyOrPickedUp = $allTickets->whereIn('status', ['ready', 'picked_up'])->count();
            $preparingCount = $allTickets->whereIn('status', ['accepted', 'preparing'])->count();

            if ($readyOrPickedUp === $totalTickets) {
                $parentOrder->update(['status' => 'ready']);
            } elseif ($readyOrPickedUp > 0 || $preparingCount > 0) {
                $parentOrder->update(['status' => 'partially_ready']);
            }
        });

        return response()->json([
            'success' => true,
            'message' => "Ticket status updated to {$newStatus}",
            'data' => $ticket->fresh(['order.table', 'ticketItems.orderItem', 'stall']),
        ]);
    }
}

