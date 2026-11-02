# Realtime Communication & Broadcasting Implementation

> **⚠ SUPERSEDED (Phase 3, 2026-11-02).** The events and public channels described here never broadcast
> (every event threw on a non-existent `diningTable` relation) and the channels were unauthenticated.
> Current design, private channels and live Reverb test results: `docs/staging/realtime-security-report.md`.

## Multi-Stall Food Court Management System

**Document Version**: 2.0 (Post-Remediation Verification)  
**Package**: `laravel/reverb` (v1.12.0)  
**Modules**: Event Broadcasting, Channels, WebSockets, Polling Fallback

---

## 1. Realtime Architectural Solution

During the production readiness audit, the system had polling loops in the frontends but lacked an active WebSocket server engine.

In Phase 2 remediation:
1. `laravel/reverb` was installed and integrated into the Laravel backend via Composer.
2. Broadcasting configuration was generated in `config/broadcasting.php` and `config/reverb.php`.
3. Dedicated Broadcast Events implementing `ShouldBroadcastNow` were developed to push instant updates across WebSockets without requiring a Redis or database queue delay.
4. An authoritative **dual-mode strategy** was established:
   - **Active Realtime Push (WebSockets via Reverb)**: Delivers sub-100ms ticket updates to KDS, waiter dish readiness alerts, and live dashboard metrics.
   - **Silent HTTP Polling Fallback**: All frontends (Desktop POS, Customer QR, Android KDS) maintain resilient polling intervals (4s - 10s) with error suppression. If the Reverb daemon stops or network drops, applications seamlessly continue operating over standard HTTP REST endpoints without user disruption.

---

## 2. Broadcast Events & Channel Map

| Broadcast Event | Channel(s) | Trigger / Origin | Subscribers / Audience |
|---|---|---|---|
| `OrderCreatedEvent` | `orders`, `stalls.{stallId}`, `orders.track.{trackingToken}` | `OrderController::store` | Cashier POS, Stall Kitchen Displays, Customer QR Tracker |
| `TicketStatusUpdatedEvent` | `stalls.{stallId}`, `orders`, `orders.track.{trackingToken}` | `KitchenController::updateTicketStatus` | Stall KDS, Cashier POS, Customer QR Tracker |
| `TicketReadyEvent` | `waiters`, `orders`, `stalls.{stallId}`, `orders.track.{trackingToken}` | `KitchenController::updateTicketStatus` (when status='ready') | Waiter Ready Dishes Screen, Cashier POS |
| `PaymentCompletedEvent` | `orders`, `orders.track.{trackingToken}` | `BillingController::processPayment` | Cashier POS, Customer QR Tracker |

---

## 3. Broadcast Event Code References

### 3.1 `OrderCreatedEvent.php`
```php
namespace App\Events;

use App\Models\Order;
use Illuminate\Broadcasting\Channel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;

class OrderCreatedEvent implements ShouldBroadcastNow
{
    public Order $order;

    public function __construct(Order $order)
    {
        $this->order = $order->load(['items.menuItem', 'diningTable', 'kitchenTickets']);
    }

    public function broadcastOn(): array
    {
        $channels = [new Channel('orders')];
        if ($this->order->tracking_token) {
            $channels[] = new Channel('orders.track.' . $this->order->tracking_token);
        }
        foreach ($this->order->kitchenTickets as $ticket) {
            $channels[] = new Channel('stalls.' . $ticket->stall_id);
        }
        return $channels;
    }

    public function broadcastAs(): string
    {
        return 'OrderCreated';
    }
}
```

### 3.2 `TicketReadyEvent.php`
```php
namespace App\Events;

use App\Models\StallKitchenTicket;
use Illuminate\Broadcasting\Channel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;

class TicketReadyEvent implements ShouldBroadcastNow
{
    public StallKitchenTicket $ticket;

    public function __construct(StallKitchenTicket $ticket)
    {
        $this->ticket = $ticket->load(['order.diningTable', 'stall']);
    }

    public function broadcastOn(): array
    {
        $channels = [
            new Channel('waiters'),
            new Channel('orders'),
            new Channel('stalls.' . $this->ticket->stall_id),
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
}
```

---

## 4. Polling Fallback Architecture Across Frontends

To ensure zero downtime when running locally or on edge servers without an active Reverb process:
- **Cashier POS (`PosPage.tsx`)**: Auto-refreshes pending bills every 8 seconds (`setInterval(loadPendingBills, 8000)`).
- **Owner Dashboard (`DashboardPage.tsx`)**: Auto-refreshes revenue and stats every 10 seconds (`setInterval(fetchStats, 10000)`).
- **Customer QR (`OrderTrackPage.tsx`)**: Polls order tracking status every 4 seconds (`setInterval(fetchOrder, 4000)`).
- **Kitchen KDS (`KdsScreen.tsx`)**: Polls stall tickets every 4 seconds (`setInterval(fetchTickets, 4000)`).
- **Waiter Ready Dishes (`ReadyDishesScreen.tsx`)**: Polls ready items every 5 seconds (`setInterval(fetchReadyDishes, 5000)`).

All controller broadcast dispatches are enclosed in `try ... catch (\Throwable $e)` blocks, ensuring that even if Reverb is offline, HTTP requests succeed with 100% reliability.

