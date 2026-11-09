<?php

namespace App\Services;

use App\Events\TicketReadyEvent;
use App\Events\TicketStatusUpdatedEvent;
use App\Exceptions\FulfillmentException;
use App\Models\FulfillmentOperation;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\StallKitchenTicket;
use App\Models\StallTicketItem;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * The single writer of item fulfilment state (stall_ticket_items.status is the source of truth, D1/D2).
 *
 * Every write runs in one DB transaction (retried up to 3 times on deadlock / serialization failure) and
 * locks in this fixed order: (1) the orders row, (2) the involved stall_kitchen_tickets rows ordered by id,
 * (3) the involved stall_ticket_items rows ordered by id. Ticket and order statuses are derived here
 * (reconcileTicket / reconcileOrder), order_items.status is mirrored in the same transaction, and
 * broadcast events are dispatched only after commit (a failing broadcast is logged, never rolled back).
 */
class FulfillmentService
{
    /** Forward order of item statuses (cancelled is terminal and outside the ladder). */
    private const RANK = ['pending' => 0, 'preparing' => 1, 'ready' => 2, 'served' => 3];

    /** KDS ticket state machine (unchanged). */
    private const TICKET_SEQUENCE = ['pending', 'accepted', 'preparing', 'ready', 'picked_up'];

    /** KDS ticket status → the item status it pulls lagging items up to (accepted moves no item). */
    private const TICKET_TO_ITEM = ['accepted' => null, 'preparing' => 'preparing', 'ready' => 'ready', 'picked_up' => 'served'];

    /** Legacy item values written by the old KDS bulk copy are read as item statuses (no data rewrite). */
    public function normalize(string $status): string
    {
        return match ($status) {
            'accepted' => 'pending',
            'picked_up' => 'served',
            default => $status,
        };
    }

    // ------------------------------------------------------------------ public operations

    /**
     * Move one item forward (board / counter / kitchen per-item tap).
     *
     * @return array{changed: bool, item: StallTicketItem, events: array}
     */
    public function transitionItem(int $itemId, string $to, User $actor, ?int $expectedVersion = null): array
    {
        if (!isset(self::RANK[$to])) {
            throw FulfillmentException::invalid("Unknown item status '{$to}'.");
        }

        $probe = StallTicketItem::with('ticket:id,order_id,stall_id')->findOrFail($itemId);
        $this->authorizeItemTarget($actor, $to, (int) $probe->ticket->stall_id);

        $result = DB::transaction(function () use ($probe, $itemId, $to, $actor, $expectedVersion) {
            [$order, $tickets, $items] = $this->lockOrder((int) $probe->ticket->order_id, [(int) $probe->ticket_id]);
            $ticket = $tickets->firstWhere('id', $probe->ticket_id);
            $item = $items->firstWhere('id', $itemId);

            $current = $this->normalize($item->status);
            // D4: already in the requested status = no-op success, even when the caller's version is stale
            // (a second person tapping the same target after a concurrent identical tap).
            if ($current === $to) {
                return ['changed' => false, 'item' => $item, 'events' => []];
            }
            if ($expectedVersion !== null && (int) $item->version !== $expectedVersion) {
                throw FulfillmentException::versionConflict($item);
            }
            if ($order->status === 'cancelled') {
                throw FulfillmentException::invalid('This order is cancelled; its items cannot change.', $item);
            }
            if ($current === 'cancelled') {
                throw FulfillmentException::invalid('This item is cancelled and cannot change.', $item);
            }
            if (self::RANK[$to] < self::RANK[$current]) {
                throw FulfillmentException::invalid("Item cannot move from '{$current}' to '{$to}'.", $item);
            }

            $this->writeItem($item, $to, $actor, (int) $ticket->stall_id, 'item');

            $wasReady = $ticket->status === 'ready';
            $this->reconcileTicket($ticket, $items);
            $this->reconcileOrder($order);

            $events = [['type' => 'ticket_status', 'ticket_id' => $ticket->id]];
            if (!$wasReady && $ticket->status === 'ready') {
                $events[] = ['type' => 'ticket_ready', 'ticket_id' => $ticket->id];
            }

            return ['changed' => true, 'item' => $item, 'events' => $events];
        }, 3);

        $this->dispatchEvents($result['events']);
        $result['item'] = $result['item']->fresh();

        return $result;
    }

    /**
     * KDS ticket-level change. Keeps the forward ticket state machine; items only move up to the
     * ticket's level, never backwards (accepted → items unchanged, preparing → preparing,
     * ready → ready, picked_up → served).
     */
    public function applyTicketStatus(int $ticketId, string $ticketStatus, User $actor): StallKitchenTicket
    {
        $probe = StallKitchenTicket::findOrFail($ticketId);
        $isOwnStallKitchen = ($actor->isKitchenStaff() || $actor->isStallManager()) && $actor->stall_id == $probe->stall_id;
        if (!$actor->isOwner() && !$isOwnStallKitchen) {
            throw FulfillmentException::forbidden('Unauthorized to update another stall\'s ticket');
        }
        if (!array_key_exists($ticketStatus, self::TICKET_TO_ITEM)) {
            throw FulfillmentException::invalid("Ticket cannot move from '{$probe->status}' to '{$ticketStatus}'.");
        }

        $events = DB::transaction(function () use ($probe, $ticketStatus, $actor) {
            [$order, $tickets, $items] = $this->lockOrder((int) $probe->order_id, [(int) $probe->id]);
            $ticket = $tickets->firstWhere('id', $probe->id);

            // Tickets only move forward: pending -> accepted -> preparing -> ready -> picked_up
            $currentRank = array_search($ticket->status, self::TICKET_SEQUENCE, true);
            if ($currentRank === false || array_search($ticketStatus, self::TICKET_SEQUENCE, true) <= $currentRank) {
                if ($ticket->status === 'picked_up' && $this->servedAtCounter($items)) {
                    throw FulfillmentException::invalid('This ticket was already served at the counter.');
                }
                throw FulfillmentException::invalid("Ticket cannot move from '{$ticket->status}' to '{$ticketStatus}'.");
            }

            $updates = ['status' => $ticketStatus];
            if ($ticketStatus === 'accepted' && !$ticket->accepted_at) {
                $updates['accepted_at'] = now();
            } elseif ($ticketStatus === 'ready' && !$ticket->ready_at) {
                $updates['ready_at'] = now();
            } elseif ($ticketStatus === 'picked_up' && !$ticket->picked_up_at) {
                $updates['picked_up_at'] = now();
            }
            $ticket->update($updates);

            $target = self::TICKET_TO_ITEM[$ticketStatus];
            if ($target !== null) {
                foreach ($items as $item) {
                    $current = $this->normalize($item->status);
                    if ($current === 'cancelled' || self::RANK[$current] >= self::RANK[$target]) {
                        continue; // never backwards, never touch cancelled
                    }
                    $this->writeItem($item, $target, $actor, (int) $ticket->stall_id, 'kds');
                }
            }

            $this->reconcileTicket($ticket, $items);
            $this->reconcileOrder($order);

            $events = [['type' => 'ticket_status', 'ticket_id' => $ticket->id]];
            if ($ticketStatus === 'ready') {
                $events[] = ['type' => 'ticket_ready', 'ticket_id' => $ticket->id];
            }

            return $events;
        }, 3);

        $this->dispatchEvents($events);

        return $probe->fresh();
    }

    /**
     * Waiter Station "served" for a whole ticket. Idempotent: an already picked-up ticket is a no-op.
     *
     * @return array{already: bool, ticket: StallKitchenTicket}
     */
    public function serveTicket(int $ticketId, User $actor): array
    {
        if (!$this->canMarkServed($actor)) {
            throw FulfillmentException::forbidden('Only the owner, cashier or waiter can mark food as served.');
        }
        $probe = StallKitchenTicket::findOrFail($ticketId);

        $result = DB::transaction(function () use ($probe, $actor) {
            [$order, $tickets, $items] = $this->lockOrder((int) $probe->order_id, [(int) $probe->id]);
            $ticket = $tickets->firstWhere('id', $probe->id);

            if ($ticket->status === 'picked_up') {
                return ['already' => true, 'events' => []];
            }
            if ($ticket->status !== 'ready') {
                throw FulfillmentException::invalid("Ticket is '{$ticket->status}', only ready tickets can be served.");
            }

            $ticket->update([
                'status' => 'picked_up',
                'picked_up_at' => now(),
                'served_by_waiter_id' => $actor->id,
            ]);

            foreach ($items as $item) {
                $current = $this->normalize($item->status);
                if ($current === 'served' || $current === 'cancelled') {
                    continue;
                }
                $this->writeItem($item, 'served', $actor, (int) $ticket->stall_id, 'waiter');
            }

            $this->reconcileOrder($order);

            return ['already' => false, 'events' => [['type' => 'ticket_status', 'ticket_id' => $ticket->id]]];
        }, 3);

        $this->dispatchEvents($result['events']);

        return ['already' => $result['already'], 'ticket' => $probe->fresh()];
    }

    /**
     * Serve All Remaining with durable idempotency (fulfillment_operations, unique order_id + key).
     * Serves the confirmed $itemIds that are still unserved and not cancelled. Replaying the same key with
     * the same items returns the stored result (no writes, audits or events); the same key with other
     * items is a 409.
     *
     * @param  int[]  $itemIds
     * @return array{replayed: bool, served_item_ids: int[], order_id: int}
     */
    public function serveRemaining(int $orderId, User $actor, string $key, array $itemIds): array
    {
        if (!$this->canMarkServed($actor)) {
            throw FulfillmentException::forbidden('Only the owner, cashier or waiter can mark food as served.');
        }
        Order::findOrFail($orderId);

        $itemIds = array_values(array_unique(array_map('intval', $itemIds)));
        sort($itemIds);
        $hash = hash('sha256', 'serve_remaining|' . implode(',', $itemIds));

        try {
            $result = DB::transaction(function () use ($orderId, $actor, $key, $itemIds, $hash) {
                [$order, $tickets, $items] = $this->lockOrder($orderId, null);

                $existing = FulfillmentOperation::where('order_id', $orderId)->where('idempotency_key', $key)->first();
                if ($existing) {
                    return ['stored' => $this->storedResult($existing, $hash), 'events' => []];
                }

                if ($order->status === 'cancelled') {
                    throw FulfillmentException::invalid('This order is cancelled; its items cannot change.');
                }
                $foreign = array_diff($itemIds, $items->pluck('id')->map(fn ($id) => (int) $id)->all());
                if ($foreign) {
                    throw FulfillmentException::itemNotInOrder('Items ' . implode(', ', $foreign) . ' do not belong to this order.');
                }

                $stallByTicket = $tickets->pluck('stall_id', 'id');
                $served = [];
                $events = [];
                foreach ($items as $item) {
                    if (!in_array((int) $item->id, $itemIds, true)) {
                        continue;
                    }
                    $current = $this->normalize($item->status);
                    if ($current === 'served' || $current === 'cancelled') {
                        continue; // already served keeps its original served_at; cancelled stays cancelled
                    }
                    $this->writeItem($item, 'served', $actor, (int) $stallByTicket[$item->ticket_id], 'serve_remaining');
                    $served[] = (int) $item->id;
                    $events[] = ['type' => 'ticket_status', 'ticket_id' => (int) $item->ticket_id];
                }

                foreach ($tickets as $ticket) {
                    $this->reconcileTicket($ticket, $items);
                }
                $this->reconcileOrder($order);

                $result = ['served_item_ids' => $served, 'order_id' => (int) $order->id];
                AuditService::log(
                    action: 'order_serve_remaining',
                    entityType: 'Order',
                    entityId: $order->id,
                    stallId: null,
                    oldValues: null,
                    newValues: $result + ['requested_item_ids' => $itemIds, 'idempotency_key' => $key],
                    userId: $actor->id,
                );
                FulfillmentOperation::create([
                    'order_id' => $order->id,
                    'idempotency_key' => $key,
                    'operation' => 'serve_remaining',
                    'request_hash' => $hash,
                    'actor_user_id' => $actor->id,
                    'result' => $result,
                ]);

                return ['stored' => ['replayed' => false] + $result, 'events' => $events];
            }, 3);
        } catch (UniqueConstraintViolationException $e) {
            // A concurrent request with the same key committed first (no row lock, e.g. SQLite): replay it.
            $existing = FulfillmentOperation::where('order_id', $orderId)->where('idempotency_key', $key)->firstOrFail();

            return $this->storedResult($existing, $hash);
        }

        $this->dispatchEvents($result['events']);

        return $result['stored'];
    }

    /** Stored result of an earlier operation with this key, or 409 when the key was used for other items. */
    private function storedResult(FulfillmentOperation $op, string $hash): array
    {
        if (!hash_equals((string) $op->request_hash, $hash)) {
            throw FulfillmentException::idempotencyKeyReused();
        }
        $stored = (array) $op->result;

        return [
            'replayed' => true,
            'served_item_ids' => array_map('intval', $stored['served_item_ids'] ?? []),
            'order_id' => (int) ($stored['order_id'] ?? $op->order_id),
        ];
    }

    /**
     * Cancel every ticket and unserved item of an order (called by OrderController::cancelOrder inside its
     * own transaction, after it has locked and cancelled the order; the order row is re-locked here so the
     * lock order holds when called on its own too).
     */
    public function cancelOrderItems(Order $order, User $actor): void
    {
        DB::transaction(function () use ($order, $actor) {
            [$locked, $tickets, $items] = $this->lockOrder((int) $order->id, null);
            $stallByTicket = $tickets->pluck('stall_id', 'id');
            $served = $items->filter(fn (StallTicketItem $i) => $this->normalize($i->status) === 'served');

            foreach ($items as $item) {
                $current = $this->normalize($item->status);
                if ($current === 'cancelled' || $current === 'served') {
                    continue; // served food stays served (cancelOrder refuses that case; defensive here)
                }
                $this->writeItem($item, 'cancelled', $actor, (int) $stallByTicket[$item->ticket_id], 'cancel');
            }

            // A ticket holding served food is not cancelled; its order_items keep their mirrored status.
            $ticketIds = $tickets->pluck('id')->diff($served->pluck('ticket_id'));
            if ($ticketIds->isNotEmpty()) {
                StallKitchenTicket::whereIn('id', $ticketIds)->update(['status' => 'cancelled']);
            }
            // Covers order_items without a ticket item; never overwrites a served item's mirror.
            OrderItem::where('order_id', $locked->id)
                ->whereNotIn('id', $served->pluck('order_item_id')->all())
                ->update(['status' => 'cancelled']);
        }, 3);
    }

    // ------------------------------------------------------------------ tracking board

    public const BOARD_PAGE_SIZE = 100;

    /** A fully served order stays on the board this long after its last item was served (so green is visible). */
    public const BOARD_RECENT_SERVED_MINUTES = 10;

    /** Item statuses (incl. legacy picked_up) that count as finished. */
    private const FINISHED_ITEM_STATUSES = ['served', 'picked_up', 'cancelled'];

    /**
     * One page of the tracking board, newest first (leftover unserved orders from earlier days must not push
     * today's tables off page 1; controller ruling, final review). A fixed number of queries regardless of page size.
     *
     * @return array{total_active: int, next_cursor: ?string, orders: array}
     */
    public function board(?string $cursor, ?int $stallId = null): array
    {
        $after = $cursor !== null && $cursor !== '' ? $this->decodeBoardCursor($cursor) : null;
        $cutoff = now()->subMinutes(self::BOARD_RECENT_SERVED_MINUTES);

        // $stallId: one stall's view (kitchen staff / stall manager). Orders and items of other stalls are left out.
        $query = Order::query()
            ->where('orders.status', '!=', 'cancelled')
            ->where(function (Builder $q) use ($cutoff, $stallId) {
                $q->whereExists($this->unservedItemsOf($stallId))
                    ->orWhere(function (Builder $q) use ($cutoff, $stallId) {
                        $q->whereNotExists($this->unservedItemsOf($stallId))
                            ->whereExists(function ($sub) use ($cutoff, $stallId) {
                                $sub->selectRaw('1')
                                    ->from('stall_ticket_items as bsi')
                                    ->join('stall_kitchen_tickets as bkt', 'bkt.id', '=', 'bsi.ticket_id')
                                    ->whereColumn('bkt.order_id', 'orders.id')
                                    ->when($stallId !== null, fn ($s) => $s->where('bkt.stall_id', $stallId))
                                    ->whereIn('bsi.status', ['served', 'picked_up'])
                                    ->where('bsi.served_at', '>=', $cutoff);
                            });
                    });
            });

        if ($after) {
            [$createdAt, $id] = $after;
            $query->where(function (Builder $q) use ($createdAt, $id) {
                $q->where('orders.created_at', '<', $createdAt)
                    ->orWhere(function (Builder $q) use ($createdAt, $id) {
                        $q->where('orders.created_at', '=', $createdAt)->where('orders.id', '<', $id);
                    });
            });
        }

        $orders = $query->orderByDesc('orders.created_at')->orderByDesc('orders.id')
            ->limit(self::BOARD_PAGE_SIZE + 1)
            ->get();

        $nextCursor = null;
        if ($orders->count() > self::BOARD_PAGE_SIZE) {
            $orders = $orders->take(self::BOARD_PAGE_SIZE);
            $last = $orders->last();
            $nextCursor = base64_encode($last->created_at->format('Y-m-d H:i:s') . '|' . $last->id);
        }

        $totalActive = Order::query()
            ->where('orders.status', '!=', 'cancelled')
            ->whereExists($this->unservedItemsOf($stallId))
            ->count();

        $this->loadBoardRelations($orders, $stallId);

        return [
            'total_active' => $totalActive,
            'next_cursor' => $nextCursor,
            'orders' => $orders->map(fn (Order $o) => self::presentBoardOrder($o))->values()->all(),
        ];
    }

    /** The board shape of a single order (used by Serve All Remaining's response). */
    public function boardOrder(int $orderId): array
    {
        $orders = Order::whereKey($orderId)->get();
        $this->loadBoardRelations($orders);

        return self::presentBoardOrder($orders->firstOrFail());
    }

    /** Correlated subquery: ticket items of `orders` that are neither served nor cancelled. */
    private function unservedItemsOf(?int $stallId = null): \Closure
    {
        return function ($sub) use ($stallId) {
            $sub->selectRaw('1')
                ->from('stall_ticket_items as asi')
                ->join('stall_kitchen_tickets as akt', 'akt.id', '=', 'asi.ticket_id')
                ->whereColumn('akt.order_id', 'orders.id')
                ->when($stallId !== null, fn ($s) => $s->where('akt.stall_id', $stallId))
                ->whereNotIn('asi.status', self::FINISHED_ITEM_STATUSES);
        };
    }

    /** @return array{0: string, 1: int} */
    private function decodeBoardCursor(string $cursor): array
    {
        $decoded = base64_decode($cursor, true);
        if ($decoded === false || !preg_match('/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\|(\d+)$/', $decoded, $m)) {
            throw new FulfillmentException(422, 'invalid_cursor', 'The board cursor is invalid.');
        }

        return [$m[1], (int) $m[2]];
    }

    /** Eager-load everything presentItem needs, then wire item->ticket so no lazy query runs. */
    private function loadBoardRelations(\Illuminate\Database\Eloquent\Collection $orders, ?int $stallId = null): void
    {
        $orders->load([
            'table:id,table_number',
            'kitchenTickets' => fn ($q) => $q->select('id', 'order_id', 'stall_id')
                ->when($stallId !== null, fn ($t) => $t->where('stall_id', $stallId))
                ->orderBy('id'),
            'kitchenTickets.stall:id,name,code',
            'kitchenTickets.ticketItems' => fn ($q) => $q->orderBy('id'),
            'kitchenTickets.ticketItems.orderItem:id,item_name,special_instructions',
        ]);
        foreach ($orders as $order) {
            foreach ($order->kitchenTickets as $ticket) {
                foreach ($ticket->ticketItems as $item) {
                    $item->setRelation('ticket', $ticket);
                }
            }
        }
    }

    private static function presentBoardOrder(Order $order): array
    {
        $items = [];
        foreach ($order->kitchenTickets as $ticket) {
            foreach ($ticket->ticketItems as $item) {
                $items[] = self::presentItem($item);
            }
        }
        usort($items, fn ($a, $b) => $a['id'] <=> $b['id']);

        return [
            'id' => $order->id,
            'order_number' => $order->order_number,
            'order_type' => $order->order_type,
            'table' => $order->table ? ['id' => $order->table->id, 'table_number' => $order->table->table_number] : null,
            'guest_count' => $order->guest_count,
            'notes' => $order->notes,
            'created_at' => $order->created_at?->toIso8601String(),
            'status' => $order->status,
            'payment_status' => $order->payment_status,
            'items' => $items,
        ];
    }

    // ------------------------------------------------------------------ presentation (reused by the board)

    /** Item shape shared by the item endpoint and the tracking board. */
    public static function presentItem(StallTicketItem $item): array
    {
        $item->loadMissing(['orderItem:id,item_name,special_instructions', 'ticket:id,order_id,stall_id', 'ticket.stall:id,name,code']);
        $stall = $item->ticket?->stall;

        return [
            'id' => $item->id,
            'order_item_id' => $item->order_item_id,
            'ticket_id' => $item->ticket_id,
            'name' => $item->orderItem?->item_name,
            'quantity' => (int) $item->quantity,
            'notes' => $item->orderItem?->special_instructions,
            'stall' => $stall ? ['id' => $stall->id, 'name' => $stall->name, 'code' => $stall->code] : null,
            'status' => app(self::class)->normalize((string) $item->status),
            'version' => (int) $item->version,
            'ready_at' => $item->ready_at?->toIso8601String(),
            'served_at' => $item->served_at?->toIso8601String(),
        ];
    }

    // ------------------------------------------------------------------ authorization

    /** The one stall a kitchen staff member or stall manager watches on the board; null for everyone else. */
    public function boardStallScope(User $actor): ?int
    {
        return ($actor->isKitchenStaff() || $actor->isStallManager()) && $actor->stall_id ? (int) $actor->stall_id : null;
    }

    public function canMarkServed(User $actor): bool
    {
        return $actor->isOwner() || $actor->isCashier() || $actor->isWaiter();
    }

    /** Ready (and Preparing): the owner, or kitchen staff / stall manager of that stall. */
    public function canMarkReady(User $actor, int $stallId): bool
    {
        return $actor->isOwner()
            || (($actor->isKitchenStaff() || $actor->isStallManager()) && (int) $actor->stall_id === $stallId);
    }

    private function authorizeItemTarget(User $actor, string $to, int $stallId): void
    {
        if ($to === 'served') {
            if (!$this->canMarkServed($actor)) {
                throw FulfillmentException::forbidden('Only the owner, cashier or waiter can mark food as served.');
            }
            return;
        }
        if (!$this->canMarkReady($actor, $stallId)) {
            throw FulfillmentException::forbidden('Only this stall\'s kitchen or the owner can update this item.');
        }
    }

    // ------------------------------------------------------------------ internals

    /**
     * Lock order → tickets (by id) → items (by id). $ticketIds null = every ticket of the order.
     *
     * @return array{0: Order, 1: Collection<int, StallKitchenTicket>, 2: Collection<int, StallTicketItem>}
     */
    public function lockOrder(int $orderId, ?array $ticketIds): array
    {
        $order = Order::whereKey($orderId)->lockForUpdate()->firstOrFail();

        $ticketQuery = StallKitchenTicket::where('order_id', $orderId);
        if ($ticketIds !== null) {
            $ticketQuery->whereIn('id', $ticketIds);
        }
        $tickets = $ticketQuery->orderBy('id')->lockForUpdate()->get();

        $items = $tickets->isEmpty()
            ? new \Illuminate\Database\Eloquent\Collection()
            : StallTicketItem::whereIn('ticket_id', $tickets->pluck('id'))->orderBy('id')->lockForUpdate()->get();

        return [$order, $tickets, $items];
    }

    /**
     * Atomic versioned write of one locked item + order_items mirror + audit row.
     * 0 affected rows (version moved underneath us) → 409 with the current item.
     */
    private function writeItem(StallTicketItem $item, string $to, User $actor, int $stallId, string $via): void
    {
        $old = $item->status;
        $now = now();
        $updates = ['status' => $to];
        if ($to === 'ready' && !$item->ready_at) {
            $updates['ready_at'] = $now;
        }
        if ($to === 'served') {
            $updates['served_at'] = $item->served_at ?? $now;
            $updates['served_by_user_id'] = $actor->id;
        }

        $affected = StallTicketItem::whereKey($item->id)
            ->where('version', $item->version)
            ->update($updates + ['version' => DB::raw('version + 1')]);

        if ($affected === 0) {
            throw FulfillmentException::versionConflict(StallTicketItem::findOrFail($item->id));
        }

        $item->forceFill($updates + ['version' => (int) $item->version + 1])->syncOriginal();

        OrderItem::whereKey($item->order_item_id)->update(['status' => $to]);

        AuditService::log(
            action: 'ticket_item_status',
            entityType: 'StallTicketItem',
            entityId: $item->id,
            stallId: $stallId,
            oldValues: ['status' => $old],
            newValues: ['status' => $to, 'via' => $via],
            userId: $actor->id,
        );
    }

    /**
     * Derive the ticket from its items, forward only: all served → picked_up; all ready/served → ready.
     * Partial progress leaves the ticket where the KDS put it (so the KDS can still move it forward).
     */
    private function reconcileTicket(StallKitchenTicket $ticket, Collection $items): void
    {
        if ($ticket->status === 'cancelled') {
            return;
        }
        $statuses = $items->where('ticket_id', $ticket->id)
            ->map(fn (StallTicketItem $i) => $this->normalize($i->status))
            ->reject(fn (string $s) => $s === 'cancelled');
        if ($statuses->isEmpty()) {
            return;
        }

        if ($statuses->every(fn ($s) => $s === 'served')) {
            $target = 'picked_up';
        } elseif ($statuses->every(fn ($s) => $s === 'ready' || $s === 'served')) {
            $target = 'ready';
        } else {
            return;
        }

        $currentRank = array_search($ticket->status, self::TICKET_SEQUENCE, true);
        if ($currentRank !== false && array_search($target, self::TICKET_SEQUENCE, true) <= $currentRank) {
            return;
        }

        $updates = ['status' => $target];
        if (!$ticket->ready_at) {
            $updates['ready_at'] = now();
        }
        if ($target === 'picked_up' && !$ticket->picked_up_at) {
            $updates['picked_up_at'] = now();
        }
        $ticket->update($updates);
    }

    /**
     * Derive the order from its (non-cancelled) tickets: all picked_up → served; all ready/picked_up → ready;
     * any started → partially_ready. A paid (completed) or cancelled order is never overwritten.
     */
    private function reconcileOrder(Order $order): void
    {
        if (in_array($order->status, ['completed', 'cancelled'], true)) {
            return;
        }
        $statuses = StallKitchenTicket::where('order_id', $order->id)
            ->where('status', '!=', 'cancelled')
            ->pluck('status');
        if ($statuses->isEmpty()) {
            return;
        }

        if ($statuses->every(fn ($s) => $s === 'picked_up')) {
            $target = 'served';
        } elseif ($statuses->every(fn ($s) => $s === 'ready' || $s === 'picked_up')) {
            $target = 'ready';
        } elseif ($statuses->contains(fn ($s) => in_array($s, ['accepted', 'preparing', 'ready', 'picked_up'], true))
            || $this->hasItemProgress((int) $order->id)) {
            $target = 'partially_ready';
        } else {
            return;
        }

        if ($order->status !== $target) {
            $order->update(['status' => $target]);
        }
    }

    /**
     * True when the ticket's food was served item by item at the counter (board / waiter / Serve All),
     * i.e. no live item was served by this stall's kitchen through the KDS.
     */
    private function servedAtCounter(Collection $items): bool
    {
        $live = $items->reject(fn (StallTicketItem $i) => $this->normalize($i->status) === 'cancelled');
        if ($live->isEmpty() || $live->contains(fn (StallTicketItem $i) => $this->normalize($i->status) !== 'served')) {
            return false;
        }
        if ($live->contains(fn (StallTicketItem $i) => $i->served_by_user_id === null)) {
            return false; // legacy rows (served by the old KDS bulk copy) carry no server
        }
        $servedBy = $live->pluck('served_by_user_id')->unique()->values();

        return User::whereIn('id', $servedBy)->get()->every(fn (User $u) => $this->canMarkServed($u) && !$u->isKitchenStaff() && !$u->isStallManager());
    }

    /** Any live ticket item of the order already ready or served (items can move ahead of a pending ticket). */
    private function hasItemProgress(int $orderId): bool
    {
        return StallTicketItem::whereIn('status', ['ready', 'served', 'picked_up'])
            ->whereHas('ticket', fn ($q) => $q->where('order_id', $orderId)->where('status', '!=', 'cancelled'))
            ->exists();
    }

    /** Called only after commit. Each broadcast is isolated: a failure is logged and never rolls back. */
    private function dispatchEvents(array $events): void
    {
        $seen = [];
        foreach ($events as $e) {
            $key = $e['type'] . ':' . $e['ticket_id'];
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;

            try {
                $ticket = StallKitchenTicket::find($e['ticket_id']);
                if (!$ticket) {
                    continue;
                }
                event($e['type'] === 'ticket_ready' ? new TicketReadyEvent($ticket) : new TicketStatusUpdatedEvent($ticket));
            } catch (\Throwable $ex) {
                Log::warning('Broadcast fulfilment event failed: ' . $ex->getMessage());
            }
        }
    }
}
