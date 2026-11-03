# Smart table & item-level order tracking — design

Owner priority #1 (2026-11-03): the owner must see at a glance which food has reached the customer and which is still being made.

## Intent

A compact board of active orders. Each card: table/order number, guests, time, live elapsed timer, `2/4 Served`, coloured border.
Click → the items with Cooking / Ready / Served and a one-tap next step; "Serve All Remaining" for the rest. The kitchen keeps working
per ticket on the KDS; the counter/owner confirms service per item.

## Facts found in the code (source of truth today)

* An order is split into one `stall_kitchen_tickets` row per stall; each order item has one `stall_ticket_items` row (1:1 with `order_items`).
* Status is effectively per **ticket**: the KDS (`KitchenController::updateTicketStatus`) copies the ticket status onto every item,
  writing values `accepted`/`picked_up` that are not item statuses; serving is per ticket in the Waiter Station (`markTicketServed`).
* `order_items.status` is never updated after creation. `orders` has no guest count.
* Bug: a ticket-level KDS update overwrites every item, so a per-item state would be pushed backwards.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **`stall_ticket_items.status` is the single source of truth** for an item's fulfilment: `pending`, `preparing`, `ready`, `served`, `cancelled`. Legacy values are read as `accepted`→`pending`, `picked_up`→`served` (no data rewrite). | It already exists, sits inside the multi-stall ticket split, and the KDS reads it |
| D2 | Ticket and order statuses are **derived** from their items by one service (`FulfillmentService`); `order_items.status` is mirrored for consistency, never read as truth | One writer, no duplicate truth |
| D3 | Display: **Cooking** = pending/preparing, **Ready**, **Served** | Owner's vocabulary |
| D4 | Transitions only move forward. Ready: owner, or kitchen staff / stall manager **of that stall**. Served: owner, cashier, waiter; may skip Ready (the food reached the table). Same status again = no-op success. Backward / cancelled item / cancelled order = 422 | Forward-only matches the existing KDS rule; skipping to Served is what "Serve All Remaining" means |
| D5 | Optimistic concurrency: each item has a `version`; a client sending a stale `expected_version` gets **409** with the current item | No lost updates between counter and kitchen |
| D6 | Serve All Remaining: one DB transaction, order row locked, only non-served non-cancelled items, idempotency key remembered 24 h; repeats return the first result | Duplicate taps / retries do nothing twice |
| D7 | Audit every item change (`ticket_item_status`: old, new, actor) and each bulk serve (`order_serve_remaining`: item ids) | Owner requirement: who served what, when |
| D8 | New columns (additive migration): `stall_ticket_items.ready_at`, `served_at`, `served_by_user_id`, `version`; `orders.guest_count` (nullable; shown when present) | Timestamps for history/timers; guests requested on the card |
| D9 | **Card colour precedence** (documented call): all items served → **green**; else any item Ready → **amber**; else → **red** (kitchen still working). Partly-served-rest-cooking stays red with the `2/4` pill showing progress | Never green unless everything is served |
| D10 | Delay warning when an order has unserved items and its age ≥ `order_tracking.delay_minutes` (setting, default **15**, owner editable 1–120); age from the server's `created_at`, corrected by server time | Spec default 12–15 min |
| D11 | One shared clock for every timer (one interval for the whole app); the board polls every 5 s and pauses while the window is hidden; pulse uses `motion-safe:` only | Performance, reduced motion |
| D12 | KDS fix: a ticket-level change moves only items that are behind it (never backwards; `accepted` leaves items pending). Waiter `markTicketServed` goes through the same service | Keeps KDS and board consistent while the Waiter Station still exists (removed in phase 4) |
| D13 | Board at route `/tracking`, labelled "Orders & Table Tracking", visible to owner, cashier, waiter. Navigation restructure is phase 4 | No duplicate of an existing page: nothing today shows item-level fulfilment |

## Rev. 2 notes (owner review, 2026-11-03)

* D6 refined, not changed: Serve All Remaining sends the item ids the cashier confirmed; only those that are still unserved and not
  cancelled are served. Idempotency is stored in the database (`fulfillment_operations`, unique per order + key); the same key with a
  different item list is refused (409). Reason: an item added after the confirmation must not be served silently.
* D13 detail: the board is paginated (100 per page, oldest first) and shows every order with unserved items regardless of age.
* Order cancellation now also cancels the ticket items (previously left `pending`: found in the status inventory).
* Controller ruling (final review, 2026-11-03): the board is now **newest first** (created_at desc, id desc), replacing "oldest first" above, so leftover unserved orders from earlier days cannot push today's tables off page 1; every poll re-fetches all loaded pages.

## Non-goals (this phase)

Served history page (phase 3), POS guest-count entry (phase 5), realtime sockets (desktop build polls), navigation restructure (phase 4).
