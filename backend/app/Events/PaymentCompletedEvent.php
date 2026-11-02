<?php

namespace App\Events;

use App\Models\Payment;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class PaymentCompletedEvent implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public Payment $payment;

    public function __construct(Payment $payment)
    {
        $this->payment = $payment->load('order');
    }

    public function broadcastOn(): array
    {
        $channels = [
            new PrivateChannel('cashier'),
        ];

        if ($this->payment->order?->tracking_token) {
            $channels[] = new Channel('orders.track.' . $this->payment->order->tracking_token);
        }

        return $channels;
    }

    public function broadcastAs(): string
    {
        return 'PaymentCompleted';
    }

    public function broadcastWith(): array
    {
        return [
            'payment_id' => $this->payment->id,
            'payment_number' => $this->payment->payment_number,
            'order_id' => $this->payment->order_id,
            'amount' => $this->payment->amount,
            'payment_method' => $this->payment->payment_method,
            'status' => $this->payment->status,
            'completed_at' => now()->toIso8601String(),
        ];
    }
}

