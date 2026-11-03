<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\StallKitchenTicket;
use App\Services\FulfillmentService;
use Illuminate\Http\Request;

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

        $request->validate([
            'status' => 'nullable|string|max:30',
            'date' => 'nullable|date',
        ]);

        // Active tickets for KDS screen: pending, accepted, preparing, ready
        if ($request->has('status')) {
            $query->where('status', $request->query('status'));
        } elseif (!$request->filled('date')) {
            $query->whereIn('status', ['pending', 'accepted', 'preparing', 'ready']);
        }

        // Ticket history: every ticket created on a given day (newest first, capped)
        if ($request->filled('date')) {
            $tickets = $query->whereDate('created_at', $request->query('date'))->orderByDesc('created_at')->limit(300)->get();
        } else {
            $tickets = $query->orderBy('created_at')->get();
        }

        return response()->json([
            'success' => true,
            'data' => $tickets,
        ]);
    }

    public function updateTicketStatus(Request $request, FulfillmentService $fulfillment, $ticketId)
    {
        $user = $request->user();

        $ticket = StallKitchenTicket::findOrFail($ticketId);

        // Strict security: only this stall's kitchen staff / manager (or the owner) may move its tickets
        $isOwnStallKitchen = ($user->isKitchenStaff() || $user->isStallManager()) && $user->stall_id == $ticket->stall_id;
        if (!$user->isOwner() && !$isOwnStallKitchen) {
            return response()->json(['success' => false, 'message' => 'Unauthorized to update another stall\'s ticket'], 403);
        }

        $validated = $request->validate([
            'status' => 'required|in:accepted,preparing,ready,picked_up',
        ]);

        $newStatus = $validated['status'];

        // Forward-only state machine (422 "Ticket cannot move from ..."), item moves, order derivation,
        // locking and post-commit broadcasts all live in the single fulfilment writer.
        $ticket = $fulfillment->applyTicketStatus((int) $ticket->id, $newStatus, $user);

        return response()->json([
            'success' => true,
            'message' => "Ticket status updated to {$newStatus}",
            'data' => $ticket->fresh(['order.table', 'ticketItems.orderItem', 'stall']),
        ]);
    }
}

