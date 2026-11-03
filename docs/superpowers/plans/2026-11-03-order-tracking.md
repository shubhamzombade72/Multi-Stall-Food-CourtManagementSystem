# Smart Order Tracking Implementation Plan (rev. 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Item-level Cooking → Ready → Served tracking with a compact order board, one-tap item actions and a durable, duplicate-safe Serve All Remaining.

**Architecture:** `stall_ticket_items.status` is the source of truth; `App\Services\FulfillmentService` is the only production writer of item status and derives ticket/order status in the same transaction under a fixed lock order. A cursor-paginated board feed drives a polling React board whose colours, progress and delay come from pure, unit-tested functions and one shared clock.

**Tech Stack (verified 2026-11-03):** PHP 8.3.36, **Laravel 13.39.0**, Sanctum 4.3.3, PHPUnit 12.5.43; **PostgreSQL 17.11** (authoritative) and SQLite 3.53.4 (compatibility); React 18.3, TypeScript 5.6, Vite 5.4, Tailwind 3.4, axios 1.7, react-router 6.27; Electron 44.9.0, Playwright-core 1.64.1; Node 24.20. Frontend unit tests: `node --test "tests/**/*.test.ts"` (no React testing library is installed; none will be added). E2E: Playwright `_electron` against the built-in server (`frontend-desktop/e2e/*.e2e.mjs`). Backend tests: feature tests over HTTP, seeded shared DB, `DatabaseTransactions` for destructive cases. **No dependency upgrades.**

**Spec:** `docs/superpowers/specs/2026-11-03-order-tracking-design.md` (D1–D13, rev. 2 notes).

## Global Constraints

- **No git commits, branches, resets or pushes.** Every task ends "leave uncommitted".
- Backend suite passes on PostgreSQL (`php artisan test`) **and** SQLite. **Concurrency is verified on PostgreSQL only** (SQLite has no row locks).
- Never remove authentication, stall isolation, audit logging. Additive migrations only; no historical rows deleted or rewritten.
- Item statuses: `pending`, `preparing`, `ready`, `served`, `cancelled`. Display: `Cooking`, `Ready`, `Served`.
- Card pattern: `T-04 · 4 Guests · 11m · 2/4 Served` (guests omitted when null; takeaway shows order number).
- Delay default **15** min, `order_tracking.delay_minutes`, 1–120. Poll 5 s, paused when hidden. Animation only under `motion-safe:`.
- All times shown come from server timestamps; the client applies `server_time` offset.

## Status read/write inventory (correction 2)

Found by `grep` over `backend/app`, `backend/database`, `backend/routes`, `backend/tests`, `frontend-*` and Code Review Graph (`get_minimal_context`, `query_graph tests_for`). No jobs, listeners or scheduled commands exist. Graph limit: Laravel feature tests call URLs, so `tests_for` returns 0 for controllers; coverage below is from the test files.

| Column | Writers today | After this plan |
|---|---|---|
| `stall_ticket_items.status` | `OrderController::createOrder` (insert `pending`), `KitchenController::updateTicketStatus` (bulk copy of ticket status, incl. invalid `accepted`/`picked_up`), `WaiterController::markTicketServed` (bulk `served`); **not** written by `cancelOrder` (bug) | Insert stays in `createOrder`; **every update** via `FulfillmentService` (`transitionItem`, `serveRemaining`, `applyTicketStatus`, `cancelOrderItems`) |
| `order_items.status` | insert `pending`; `cancelOrder` → `cancelled` | Mirrored by `FulfillmentService` only (same transaction) |
| `stall_kitchen_tickets.status` | insert; `KitchenController` (forward state machine); `WaiterController` (`picked_up`); `cancelOrder` (`cancelled`) | KDS keeps its state machine but persists through `FulfillmentService::applyTicketStatus`; board-driven changes via `reconcileTicket`; cancel via `cancelOrderItems` |
| `orders.status` | insert `confirmed`; `KitchenController`/`WaiterController` (derived); `BillingController` (`completed`); `cancelOrder` (`cancelled`) | Fulfilment-derived values only via `reconcileOrder`; payment and cancel keep owning `completed`/`cancelled`; `reconcileOrder` never overwrites them |

Readers kept as-is (verified): `KitchenController::getTickets`, `WaiterController::getActiveTables/getReadyTickets`, `OrderController::publicOrderView` (customer QR: now accurate because `order_items` is mirrored), `BillingController`, `ReportController`, `NotificationController`, `CustomerController`, `OrderObserver` (audits order status changes), events; frontend `KitchenPage`, `OrdersPage`, `PosPage`, `WaiterPage`, customer `OrderTrackPage`, `lib/kds.ts`, `ui.tsx statusTone`. Test fixtures that drive statuses through HTTP: `EndToEndFoodCourtWorkflowTest`, `StagingHardeningTest`, `KitchenKdsTest`, `OrderSplittingTest`, `MasterModulesTest` (read).

## Transaction and locking rules (correction 3)

Every fulfilment write, in one `DB::transaction` (retry ×3 on deadlock/serialization failure), locks in this **fixed order**: (1) the `orders` row `FOR UPDATE`, (2) the involved `stall_kitchen_tickets` rows `FOR UPDATE` ordered by id, (3) the involved `stall_ticket_items` rows `FOR UPDATE` ordered by id. Because every path (single item, Serve All, KDS ticket change, waiter serve, cancel) takes the order lock first, operations on one order serialise and cannot deadlock each other. Inside the transaction: validate `expected_version` against the locked row; apply the forward-only rule; `UPDATE … SET status=?, version=version+1, … WHERE id=? AND version=?` (0 rows → 409); mirror `order_items.status`; `reconcileTicket`; `reconcileOrder`; write audit rows. **Events are published only after commit**, each in try/catch: a broadcast failure is logged and never rolls back.

## Durable idempotency (correction 1)

New table `fulfillment_operations`: `id`, `order_id` (FK cascade), `idempotency_key` varchar(64), `operation` varchar(32), `request_hash` char(64), `actor_user_id` (FK nullOnDelete), `result` json, `created_at`; **unique (`order_id`, `idempotency_key`)**. `serveRemaining` request: `{idempotency_key, item_ids: int[]}` — the items the cashier confirmed. `request_hash = sha256("serve_remaining|" . sorted item_ids)`. Flow inside the transaction, after the order lock: existing row with same hash → return stored `result` (no updates, no audit); existing row with a different hash → **409 `idempotency_key_reused`**; none → serve the listed items that are still unserved and not cancelled (ids not in this order → 422), insert the operation row with the result, commit. A unique-constraint violation (race without the lock, e.g. SQLite) is caught and the stored result returned. Survives restarts because it lives in the database.

*Refinement of D6, not a contradiction:* D6 serves "only non-served non-cancelled items"; binding the request to the confirmed `item_ids` keeps that rule while preventing an item added after the confirmation from being served silently, and gives the payload a meaning for the "same key, different payload" rule.

## Board bounds (correction 4)

`GET /api/orders/board?cursor=` returns, oldest first (most urgent first): every non-cancelled order that has at least one unserved, non-cancelled item (**no age limit**: these are genuinely active, including `completed`/paid orders), plus orders whose last item was served in the last 10 minutes (so green is visible). Page size **100**, keyset cursor on (`created_at`, `id`); response carries `total_active` and `next_cursor`. When more than 100 are active the UI shows "Showing 100 of N active orders" with **Load more**; nothing is hidden silently. All-cancelled orders are excluded. Fixed number of queries (no N+1).

## Review Focus

1. Kitchen changes a ticket after the counter served one item → served item stays served (Task 2).
2. Two people act on one order at the same moment → no lost update, no deadlock (Task 4, PostgreSQL).
3. Serve All retried after a timeout or restart → served once, same response, one audit (Task 3).
4. More than 100 active orders → none hidden silently (Task 3).
5. API fails after an optimistic tap → UI shows the latest server state (Task 6/7).

---

### Task 1: Schema, models, settings

**Files:** Create `backend/database/migrations/2026_11_03_100000_add_item_fulfillment_columns.php` (columns `stall_ticket_items.ready_at`, `served_at` + index, `served_by_user_id` FK nullOnDelete, `version` unsigned int default 0; `orders.guest_count` unsigned smallint null; table `fulfillment_operations` as above). Create `backend/app/Models/FulfillmentOperation.php`. Modify `StallTicketItem`, `Order` (fillable/casts), `SettingsController` (`order_tracking` default `['delay_minutes' => 15]`, rule `required|integer|min:1|max:120`, owner-only update, included in index). Test: `backend/tests/Feature/ItemFulfillmentTest.php`.

- [ ] Failing tests: `test_settings_expose_order_tracking_delay_default_15`; `test_owner_can_change_delay_within_range` (20→200, 0→422, 121→422, cashier→403); `test_fulfillment_operation_key_is_unique_per_order` (second insert same order+key throws `UniqueConstraintViolationException`; same key other order OK).
- [ ] Run → FAIL. Implement. Migrate PostgreSQL test DB and SQLite test file. Run → PASS. Leave uncommitted.

### Task 2: FulfillmentService, item endpoint, all writers routed

**Files:** Create `backend/app/Services/FulfillmentService.php`, `backend/app/Exceptions/FulfillmentException.php` (`httpStatus`, `errorCode`, `?item`), `backend/app/Http/Controllers/Api/FulfillmentController.php`. Modify `routes/api.php` (`PATCH /ticket-items/{id}/status` in the auth group), `KitchenController::updateTicketStatus`, `WaiterController::markTicketServed`, `OrderController::cancelOrder`.

**Interfaces:** `normalize(string): string`; `transitionItem(int $itemId, string $to, User $actor, ?int $expectedVersion): array{changed: bool, item: StallTicketItem, events: array}`; `applyTicketStatus(int $ticketId, string $ticketStatus, User $actor): StallKitchenTicket` (keeps KDS forward state machine + its 422 message; accepted→items unchanged, preparing→preparing, ready→ready, picked_up→served; never backwards); `serveTicket(int $ticketId, User $actor): array` (waiter path, idempotent); `cancelOrderItems(Order $order, User $actor): void`; private `reconcileTicket`, `reconcileOrder` (all tickets `picked_up` → `served`; all `ready|picked_up` → `ready`; any `accepted|preparing|ready|picked_up` → `partially_ready`; never overwrite `completed|cancelled`). Authorization in the service (also enforced by tests): Ready = owner or kitchen_staff/stall_manager of the item's stall; Served = owner, cashier, waiter; others 403.

- [ ] Failing tests: `test_cashier_marks_one_item_served_and_only_that_item_changes` (served_at/served_by/version+1, order_items mirrored, one audit); `test_kitchen_marks_own_stall_item_ready_but_not_other_stall`; `test_cashier_cannot_mark_ready`; `test_kitchen_staff_cannot_mark_served`; `test_store_staff_and_unauthenticated_are_refused` (403/401); `test_backward_transition_is_rejected`; `test_same_status_is_a_no_op_without_audit`; `test_stale_version_is_rejected_with_409_and_current_item`; `test_cancelled_item_cannot_change`; `test_ticket_picked_up_and_order_served_when_last_item_served`; `test_completed_order_keeps_completed_status_when_items_served`; `test_kds_ticket_update_never_moves_items_backwards`; `test_kds_accept_keeps_items_pending_and_writes_no_invalid_item_status`; `test_waiter_serve_ticket_goes_through_service_and_is_idempotent`; `test_cancel_order_cancels_ticket_items`; `test_broadcast_failure_does_not_roll_back` (bind a throwing event dispatcher → 200, change persisted).
- [ ] Run → FAIL. Implement. Run `ItemFulfillmentTest`, `KitchenKdsTest`, `OrderSplittingTest`, `EndToEndFoodCourtWorkflowTest`, `StagingHardeningTest`, `MasterModulesTest` → PASS. Leave uncommitted.

### Task 3: Serve All Remaining (durable) and paginated board

**Files:** Modify `FulfillmentService` (`serveRemaining(int $orderId, User $actor, string $key, array $itemIds): array{replayed: bool, served_item_ids: int[], order_id: int}`), `FulfillmentController` (`board`, `serveRemaining`), routes `GET /orders/board`, `POST /orders/{id}/serve-remaining` (body `{idempotency_key: string 8–64, item_ids: int[1..200]}`).

Board payload: `{server_time, delay_minutes, total_active, next_cursor: string|null, orders: BoardOrder[]}`; `BoardOrder = {id, order_number, order_type, table:{id,table_number}|null, guest_count, created_at, status, payment_status, items: BoardItem[]}`; `BoardItem = {id, order_item_id, ticket_id, name, quantity, notes, stall:{id,name,code}, status, version, ready_at, served_at}`. Roles: owner, cashier, waiter.

- [ ] Failing tests: `test_serve_remaining_serves_listed_unserved_items_once` (already-served keeps original served_at; one `order_serve_remaining` audit + one per changed item); `test_serve_remaining_replay_returns_stored_result_without_new_audit`; `test_serve_remaining_replay_survives_cache_flush` (`Cache::flush()` between calls); `test_same_key_different_items_is_409`; `test_item_not_in_order_is_422`; `test_board_lists_active_orders_oldest_first_with_shape`; `test_board_keeps_completed_and_paid_orders_with_unserved_items`; `test_board_excludes_all_cancelled_and_long_finished_orders`; `test_board_shows_recently_fully_served_order`; `test_board_paginates_beyond_100_without_hiding` (105 active → 100 + cursor → 5, `total_active` 105); `test_board_query_count_is_constant` (≤ 8 queries for 1 and for 20 orders); `test_board_roles` (kitchen 403).
- [ ] Run → FAIL. Implement. Run full backend suite on PostgreSQL and SQLite → PASS. Leave uncommitted.

### Task 4: PostgreSQL concurrency verification

**Files:** Create `qa/fulfillment/concurrency.e2e.mjs` (own DB `foodcourt_concurrency_e2e`, created/dropped by the script; API via `php -S` with 4 worker processes `PHP_CLI_SERVER_WORKERS=4`).

- [ ] Script asserts: (a) 20 parallel PATCH served on the same item with the same `expected_version` → exactly 1 `changed:true`, others 200 no-op or 409, version +1 exactly, one audit; (b) 10 parallel Serve All with the same key → identical results, items served once, one operation row, one bulk audit; (c) Serve All in parallel with single-item actions and a KDS ticket update on the same order → final state consistent (every item served, ticket picked_up, order served/completed), no 500s, no deadlock errors in the log; (d) 30 orders × 4 items updated concurrently across orders → every item ends served, no lost update (sum of versions = number of changes).
- [ ] Run → PASS. Leave uncommitted.

### Task 5: Pure fulfilment logic and shared clock (frontend)

**Files:** Create `frontend-desktop/src/lib/fulfillment.ts`, `frontend-desktop/src/hooks/useNow.ts`, `frontend-desktop/src/api/fulfillment.ts`. Test `frontend-desktop/tests/fulfillment.test.ts`.

**Interfaces:** types `ItemStatus`, `DisplayStatus`, `BoardItem`, `BoardOrder`, `BoardPage`; `displayStatus`; `progress(items) → {served,total}` (cancelled excluded); `cardState(items) → 'green'|'amber'|'red'|'empty'` (all-cancelled → `empty`, never green, label "Cancelled"); `isDelayed(order, nowMs, delayMinutes)`; `elapsedMinutes(createdAt, nowMs)`; `nextItemAction(status, canMarkReady)`; `applyOptimistic(order, itemId, to)`; `cardLabel(order, nowMs)`; `serverOffset(serverTimeIso, clientNowMs)`; `createClock(intervalMs, now?, timers?)`; `useNow(offsetMs)`; api `fetchBoard(cursor?)`, `setItemStatus(id, to, expectedVersion)`, `serveRemaining(orderId, key, itemIds)`.

- [ ] Failing tests: colour matrix incl. 2 served + 2 cooking → red `2/4`; all cancelled → `empty` and label not "0/0 Served"; delay boundary 14:59/15:00; green never delayed; exact card labels; `applyOptimistic` immutability; server offset applied; one timer for many subscribers and cleared after last.
- [ ] Run → FAIL. Implement. `pnpm test` → PASS. Leave uncommitted.

### Task 6: Orders & Table Tracking page

**Files:** Create `src/pages/OrderTrackingPage.tsx`, `src/components/tracking/OrderCard.tsx`, `src/components/tracking/ItemRow.tsx`. Modify `src/App.tsx` (route `/tracking`), `src/components/Sidebar.tsx` (link for owner/cashier/waiter).

Behaviour: grid of compact cards (border by `cardState`, `motion-safe:animate-pulse` ring when delayed, thin progress bar); click expands items with status chip + icon and the `nextItemAction` button; "Serve All Remaining" confirms when > 1 item, sends `item_ids` shown and a `crypto.randomUUID()` key kept until success (reused on retry); optimistic apply → on **any** failure refetch the board and show the message (409 → refetch); poll 5 s paused when hidden; "Showing X of N" + Load more; test ids `order-card-{id}`, `card-state-{state}`, `item-row-{id}`, `item-action-{id}`, `serve-all-{orderId}`, `progress-{orderId}`, `board-load-more`.

- [ ] `pnpm exec tsc --noEmit`, `pnpm build` → 0 errors. Leave uncommitted.

### Task 7: Electron E2E, regression, graph review, reports

**Files:** Create `frontend-desktop/e2e/order-tracking.e2e.mjs`; `docs/engineering/code-review-graph-report.md`, `docs/engineering/superpowers-usage-report.md`.

- [ ] E2E (fresh profile, built-in server): Scenario 1 (4 items/2 stalls → red 0/4 → kitchen ready → amber → 2 served → 2/4 → Serve All → 4/4 green; KDS API shows items served; audit rows exact); Scenario 3 (PATCH aborted by `page.route` → card back to server state + message; retry → exactly one served audit).
- [ ] Regression: backend PostgreSQL + SQLite, desktop unit, lifecycle e2e, multi-PC e2e, business workflow e2e, UI first-run e2e, tsc, build.
- [ ] `code-review-graph update` + `detect-changes --brief`; record commands/results. Leave uncommitted.
