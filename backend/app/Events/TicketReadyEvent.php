<?php

namespace App\Events;

use App\Models\StallKitchenTicket;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class TicketReadyEvent implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public StallKitchenTicket $ticket;

    public function __construct(StallKitchenTicket $ticket)
    {
        $this->ticket = $ticket->load(['order.table', 'stall']);
    }

    public function broadcastOn(): array
    {
        $channels = [
            new PrivateChannel('waiters'),
            new PrivateChannel('cashier'),
            new PrivateChannel('stall.' . $this->ticket->stall_id),
        ];

        if ($this->ticket->order?->tracking_token) {
            $channels[] = new Channel('orders.track.' . $this->ticket->order->tracking_token);
        }

        return $channels;
    }

    public function broadcastAs(): string
    {
        return 'TicketReady';
    }

    public function broadcastWith(): array
    {
        return [
            'ticket_id' => $this->ticket->id,
            'ticket_number' => $this->ticket->ticket_number,
            'stall_id' => $this->ticket->stall_id,
            'stall_name' => $this->ticket->stall?->name,
            'order_id' => $this->ticket->order_id,
            'table_number' => $this->ticket->order?->table?->table_number,
            'ready_at' => now()->toIso8601String(),
        ];
    }
}
