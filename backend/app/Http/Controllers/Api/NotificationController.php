<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\Payment;
use App\Models\StallKitchenTicket;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * Operational notifications, derived from the records themselves (no separate table), filtered by role and
 * stall. The desktop polls this; read/unread state is kept per device. Kitchen and waiter screens also get
 * Reverb events when realtime is configured.
 */
class NotificationController extends Controller
{
    public function index(Request $request)
    {
        $request->validate(['since' => 'nullable|date']);
        $user = $request->user();
        // Look back at most 24 hours
        $since = max(Carbon::parse($request->query('since', now()->subHours(12))), now()->subDay());
        $stallId = $user->stall_id;
        $role = $user->role;
        $items = collect();

        $seesAllOrders = in_array($role, ['owner', 'cashier'], true);
        $stallKitchen = in_array($role, ['kitchen_staff', 'stall_manager'], true) && $stallId;

        if ($seesAllOrders) {
            Order::with('table:id,table_number')->where('created_at', '>=', $since)->latest()->limit(30)->get()
                ->each(fn ($o) => $items->push($this->item("order:{$o->id}", 'new_order', 'New order ' . $o->order_number,
                    ($o->table ? "Table {$o->table->table_number}" : 'Takeaway') . ' · ' . str_replace('_', ' ', $o->order_channel) . " · ₹{$o->total_amount}",
                    $o->created_at, $role === 'cashier' ? '/pos' : '/orders')));

            Order::where('status', 'cancelled')->where('updated_at', '>=', $since)->latest('updated_at')->limit(10)->get()
                ->each(fn ($o) => $items->push($this->item("cancel:{$o->id}", 'order_cancelled', "Order {$o->order_number} cancelled", 'See order notes for the reason', $o->updated_at, '/orders', 'warning')));
        }

        if ($role === 'owner') {
            Payment::with('order:id,order_number')->where('status', 'success')->where('created_at', '>=', $since)->latest()->limit(20)->get()
                ->each(fn ($p) => $items->push($this->item("payment:{$p->id}", 'payment', "Payment ₹{$p->amount} received",
                    ($p->order?->order_number ?? '') . ' · ' . str_replace('_', ' ', $p->payment_method), $p->created_at, '/payments')));
        }

        if ($stallKitchen) {
            StallKitchenTicket::with('order:id,order_number,table_id', 'order.table:id,table_number')
                ->where('stall_id', $stallId)->where('created_at', '>=', $since)->latest()->limit(30)->get()
                ->each(fn ($t) => $items->push($this->item("ticket:{$t->id}", 'kitchen_ticket', "New kitchen ticket {$t->ticket_number}",
                    ($t->order?->table ? "Table {$t->order->table->table_number}" : 'Takeaway') . ' · ' . ($t->order?->order_number ?? ''), $t->created_at, '/tracking')));
        }

        if (in_array($role, ['owner', 'cashier', 'waiter'], true)) {
            StallKitchenTicket::with('stall:id,name', 'order:id,order_number,table_id', 'order.table:id,table_number')
                ->where('status', 'ready')->where('ready_at', '>=', $since)->latest('ready_at')->limit(30)->get()
                ->each(fn ($t) => $items->push($this->item("ready:{$t->id}", 'ticket_ready', "Ready for pickup: {$t->stall?->name}",
                    ($t->order?->table ? "Table {$t->order->table->table_number}" : 'Takeaway') . ' · ' . ($t->order?->order_number ?? ''), $t->ready_at,
                    $role === 'waiter' ? '/waiter' : '/orders', 'success')));
        }



        /** @var Collection $items */
        $sorted = $items->sortByDesc('at')->values()->take(60);

        return response()->json(['success' => true, 'data' => ['items' => $sorted, 'server_time' => now()->toIso8601String()]]);
    }

    private function item(string $id, string $type, string $title, string $message, $at, string $link, string $level = 'info'): array
    {
        return [
            'id' => $id,
            'type' => $type,
            'level' => $level,
            'title' => $title,
            'message' => $message,
            'at' => Carbon::parse($at)->toIso8601String(),
            'link' => $link,
        ];
    }
}
