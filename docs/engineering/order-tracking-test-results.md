# Smart Order Tracking: test results

Run on 2026-11-03 on the developer PC (Windows 11, PHP 8.3.36, PostgreSQL 17.11, SQLite 3.53.4, Node 24.20, Electron 44.9.0).
Every suite was run after the two product fixes described below. Nothing is committed (owner rule).

## Final fix wave (after the whole-change review, 2026-11-03)

Changes: board newest first (created_at desc, id desc) and every poll re-fetches all loaded pages; owner field
"Late-order warning after (minutes)" on Food Court Settings; same-target tap with a stale version is a no-op 200 (D4);
order status becomes `partially_ready` when an item is ready/served while its ticket is still pending; friendlier KDS
message "This ticket was already served at the counter."; progress bar moved out of the card button; memoised cards.

| Suite | Exact command (working directory) | Exit | Passed | Failed |
|---|---|---|---|---|
| Backend, PostgreSQL (authoritative) | `php artisan test` (`backend`) | 0 | 150 tests (2408 assertions) | 0 |
| Backend, SQLite compatibility | fresh scratch file: `DB_CONNECTION=sqlite DB_DATABASE=<file> php artisan migrate --seed --force && DB_CONNECTION=sqlite DB_DATABASE=<file> php artisan test` (`backend`) | 0 | 150 tests (1092 assertions) | 0 |
| Desktop unit | `pnpm test` (`frontend-desktop`) | 0 | 68 | 0 |
| TypeScript | `pnpm exec tsc --noEmit` (`frontend-desktop`) | 0 | n/a | 0 errors |
| Renderer build | `pnpm build` (`frontend-desktop`) | 0 | n/a | 0 (existing chunk-size warning only) |
| Embedded server copy | `pnpm prepare:server` (`frontend-desktop`) | 0 | n/a | n/a |
| Order tracking board, Electron E2E | `node e2e/order-tracking.e2e.mjs` (`frontend-desktop`) | 0 | 16 checks (new S4-01: owner edits the delay setting) | 0 |
| Fulfilment concurrency (PostgreSQL) | `node --test --test-timeout=300000 qa/fulfillment/concurrency.e2e.mjs` (repo root) | 0 | 6 | 0 |

Board query count stays 8 for 1 and 20 orders. The first PostgreSQL run had 1 error (149/150): a unique-key collision
on the random 4-character `stall_kitchen_tickets.ticket_number` (`StallKitchenTicket::booted`, not changed by this
feature) while a test fixture created tickets. The rerun passed 150/150. This is an existing flake, recorded as a follow-up.

## Earlier run (task 7)

| Suite | Exact command (working directory) | Exit | Passed | Failed | Skipped | Evidence |
|---|---|---|---|---|---|---|
| Order tracking board, Electron E2E (new) | `node e2e/order-tracking.e2e.mjs` (`frontend-desktop`) | 0 | 15 checks | 0 | 0 | `qa/desktop/results/order-tracking-results.json`; screenshots `tracking-red.png`, `tracking-amber.png`, `tracking-partial.png`, `tracking-green.png`, `tracking-abort-error.png` |
| Backend, PostgreSQL (authoritative) | `php artisan test` (`backend`) | 0 | 147 tests (2310 assertions) | 0 | 0 | console: `{"result":"passed","tests":147,"passed":147,"assertions":2310}`; board queries 8 for 1 and 20 orders |
| Backend, SQLite compatibility | `DB_CONNECTION=sqlite DB_DATABASE=<scratch>/fc-sqlite.sqlite php artisan migrate --seed --force && DB_CONNECTION=sqlite DB_DATABASE=<same file> php artisan test` (`backend`, fresh file) | 0 | 147 tests (1054 assertions) | 0 | 0 | console JSON summary; temporary SQLite file deleted afterwards |
| Desktop unit | `pnpm test` (`frontend-desktop`) | 0 | 61 | 0 | 0 | node --test summary (59 before this task + 2 new regression tests) |
| TypeScript | `pnpm exec tsc --noEmit` (`frontend-desktop`) | 0 | n/a | 0 errors | n/a | no output |
| Renderer build | `pnpm build` (`frontend-desktop`) | 0 | n/a | 0 | n/a | Vite built; only the existing chunk-size warning |
| Fulfilment concurrency (PostgreSQL) | `node --test --test-timeout=300000 qa/fulfillment/concurrency.e2e.mjs` (repo root) | 0 | 6 | 0 | 0 | node --test summary (cancelled 0) |
| Desktop lifecycle | `node --test --test-timeout=240000 ../qa/desktop/lifecycle.e2e.mjs` (`frontend-desktop`) | 0 | 14 | 0 | 0 | node --test summary (cancelled 0) |
| Multi-PC | `node --test --test-timeout=300000 qa/multi-pc/multipc.e2e.mjs` (repo root) | 0 | 7 | 0 | 0 | node --test summary (cancelled 0) |
| Business workflow API | `APP_ENV=desktope2e php artisan migrate:fresh --seed --force` (`backend`); `APP_ENV=desktope2e php -S 127.0.0.1:8110 -t . ../vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php` (`backend/public`); `E2E_API=http://127.0.0.1:8110/api node qa/desktop/desktop-e2e.mjs` (repo root) | 0 | 27 | 0 | 0 | `TOTAL: 27 PASS, 0 FAIL, 0 SKIP (order ORD-20261103-PSP1S)`; isolated DB `foodcourt_desktop_e2e_db` only; the 8110 server was stopped afterwards |
| UI first-run, Electron E2E | `node e2e/ui-first-run.e2e.mjs` (`frontend-desktop`) | 0 | 27 checks | 0 | 0 | `qa/desktop/results/ui-first-run-results.json` |

Before the E2E runs the embedded server copy was refreshed with `pnpm prepare:server` (exit 0), so `frontend-desktop/build-server/backend` contains the order-tracking backend.

## What the new E2E checks

Fresh Electron profile (`FOODCOURT_USER_DATA_DIR`), built-in PHP + SQLite server, owner created on the Welcome screen.
Cashier and stall-A kitchen accounts are created by the owner through the API. The owner is never logged in again through the API, because a login would revoke the window's session.

- **Scenario 1.** One dine-in order with 4 items from 2 stalls.
  - The card starts red at 0/4.
  - The kitchen sets the stall-A ticket to ready through the KDS API (`PUT /kitchen/tickets/{id}/status`), and the card turns amber on the next poll.
  - The owner taps Mark Served on the 2 ready items. The card shows 2/4 and goes back to red, because the remaining items are still cooking.
  - Serve All asks "Serve 2 items?". After Confirm the card is green at 4/4.
  - Backend checks: the order has left the active KDS list; `?status=picked_up` returns both tickets with all 4 items served; the board API shows 4 served items.
  - Audit check: the `ticket_item_status` rows are exactly {2× pending>ready via kds, 2× ready>served via item, 2× pending>served via serve_remaining}. There is exactly one `order_serve_remaining` row, and its `served_item_ids` are the 2 stall-B items.
- **Scenario 3.**
  - `page.route` aborts the item PATCH. The card shows the server state again (Ready, amber, 0/1) with the message "Could not update the order. Showing the latest state.", and the server still says ready.
  - After `unroute` the retry succeeds: the item is Served, the card is green and the error is cleared.
  - The item has exactly one "served" audit row, plus the KDS "ready" row.

## Product defects found and fixed in this task

Both defects were invisible to the unit and backend suites. Only the real Electron renderer exposed them, and each one blanked the whole board page.

1. **Board crashed on open with "Illegal invocation".**
   - Cause: `createClock` (`frontend-desktop/src/lib/clock.ts`) called `timers.setInterval(...)` as a method, so `this` was the plain `timers` object. Chromium's native `setInterval` rejects that receiver. Node does not, which is why the unit test passed.
   - Fix: the timer functions are now called without a receiver.
   - Regression test: `createClock calls the timer functions with no receiver ...` in `frontend-desktop/tests/fulfillment.test.ts`. It uses a fake timer that applies the browser's receiver rule. It failed before the fix and passes after.
2. **Board crashed after any single-item tap ("Cannot read properties of undefined (reading 'code')").**
   - Cause: `PATCH /ticket-items/{id}/status` returns `{success, message, data: {changed, item}}`, but `setItemStatus` (`frontend-desktop/src/api/fulfillment.ts`) returned `res.data.data` (the `{changed, item}` wrapper) as the item. `changed` was read from the wrong level too. The board then replaced the item with an object that had no `stall`.
   - Fix: a pure `parseItemStatusBody` in `src/lib/fulfillment.ts` reads the real body shape, and the API client uses it.
   - Regression test: `parseItemStatusBody reads PATCH /ticket-items/{id}/status ...`. It failed (missing export) before the fix and passes after.

No assertion was weakened. One E2E check was corrected while it was being written: it now reads served tickets with the KDS's own `?status=picked_up` filter, because by design the active KDS list only shows pending to ready tickets.
