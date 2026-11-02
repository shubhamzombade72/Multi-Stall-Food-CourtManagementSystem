<?php

namespace App\Events;

use App\Models\Order;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class OrderCreatedEvent implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public Order $order;

    public function __construct(Order $order)
    {
        $this->order = $order->load(['table', 'kitchenTickets']);
    }

    public function broadcastOn(): array
    {
        $channels = [
            new PrivateChannel('cashier'),
        ];

        // The tracking token is the customer's unguessable capability; the payload carries no PII
        if ($this->order->tracking_token) {
            $channels[] = new Channel('orders.track.' . $this->order->tracking_token);
        }

        foreach ($this->order->kitchenTickets->pluck('stall_id')->unique() as $stallId) {
            $channels[] = new PrivateChannel('stall.' . $stallId);
        }

        return $channels;
    }

    public function broadcastAs(): string
    {
        return 'OrderCreated';
    }

    public function broadcastWith(): array
    {
        // Deliberately excludes amounts and customer details: stall kitchens receive this payload too
        return [
            'order_id' => $this->order->id,
            'order_number' => $this->order->order_number,
            'table_number' => $this->order->table?->table_number,
            'status' => $this->order->status,
            'order_channel' => $this->order->order_channel,
            'created_at' => $this->order->created_at?->toIso8601String() ?? now()->toIso8601String(),
        ];
    }
}
