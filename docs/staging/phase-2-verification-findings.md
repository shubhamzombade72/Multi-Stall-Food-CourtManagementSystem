# Phase 3 — Independent Verification of Phase 2 Claims

**Date:** 2026-11-02
**Method:** Every Phase 2 claim was checked against the source code, by running the test suites and builds, and by exercising the live staging stack (`qa/staging/staging-validation.mjs`). Nothing in this file is based on the Phase 2 reports alone.

## 1. Claim-by-claim verdict

| Phase 2 claim (source) | Verified result | Verdict |
|---|---|---|
| "19 tests, 419 assertions, 100% pass" (`implementation-status.md`) | The suite ran 19 tests with **473** assertions, all passing. The assertion count in the docs was stale. The tests shared state through the seeded test database (`Order::first()` "from previous tests") and covered none of the defects below. | **Partially true** |
| Desktop build OK (338.7 kB) | Reproduced: 338.70 kB. | True |
| Customer QR build OK (262.8 kB) | Reproduced: 262.80 kB. | True |
| "Android app READY (typecheck OK)" | The typecheck passed, but **no Android build had ever been produced**, and the app called four API routes that do not exist (see §2). | **False** |
| "Realtime: 4 broadcast events, runtime verified" | **All four events threw `RelationNotFoundException`** (`diningTable` is not a relation on `Order`). Controllers swallowed the exception, so **no event was ever broadcast**. All channels were public `Channel`s with no channel authorization. No client subscribes to Reverb; every UI polls. | **False** |
| "Private channel / stall isolation for realtime" (Phase 0/2) | `routes/channels.php` contained only the default user channel. | **False** |
| "Offline queue with exponential backoff" (`offline-sync.md`) | The code shown in the doc (`queueOfflineOrder`, `OFFLINE_ORDERS_KEY`, backoff) **did not exist**. The real code had no backoff and only synced manually. Worse, it **generated a new idempotency key when queueing**, so "server committed, response lost" produced a duplicate order. | **False** |
| "Backend idempotency" | Sequential replays worked. Concurrent retries with the same key hit the unique index and returned HTTP 500. Unauthenticated replays returned the full order, including customer phone and the table QR token. | **Partially true** |
| "Signed QR tokens / table spoofing fixed" (VULN-02) | `GET /api/public/tables` (no login) returned **every table's `qr_token`**. Public orders accepted a bare `table_id` with no token. | **False** |
| "Payment integrity" (VULN-04) | Role check and row lock present, but the **amount was never compared with the bill total**: a ₹500 bill could be marked paid with ₹1. | **Partially true** |
| "Kitchen staff cannot access owner financials" | Kitchen staff could read `/orders` (customer phones), receipts, `/reports/dashboard` and `/reports/stall-sales`. They could also rename or deactivate their stall and adjust stock. | **False** |
| "Settlements without invented deduction formulas" | `closeDay` set `settlement_amount = stall gross sales`, which is itself an invented formula ("pay the stall its gross"). A paid settlement could be re-paid and silently overwritten. | **False** |
| "Purchases & inventory stall-isolated" | A stall manager could raise a PO for their stall containing **another stall's** inventory items or supplier, and receiving it changed the other stall's stock. Double-receive race (status checked outside the lock). | **Partially true** |
| "Audit logging" | Observers exist and write audit rows (order, payment, menu, PO, stock, closing). Verified on staging (165 audit rows after the run). | True |
| "Cashier pending bills" | Works (API + UI verified in browser). | True |
| "Production ready" (`final-verification-report.md`) | Contradicted by the findings above and in `production-readiness-checklist.md`. | **False** |

## 2. Defects found and fixed in Phase 3

Severity is the impact on a real food court pilot.

| ID | Severity | Defect | Fix | Evidence |
|---|---|---|---|---|
| P3-01 | Critical | Public endpoint leaked all table QR secrets | `qr_token` hidden; only owner sees it | `test_public_tables_endpoint_does_not_leak_qr_tokens`, PRE-05/06 |
| P3-02 | Critical | Public order without QR token / with forged token accepted | Public orders require a valid token; table taken from the token | `test_public_order_requires_valid_qr_token`, A-06 |
| P3-03 | Critical | Payment amount not checked against bill total | Exact-total check with `bccomp`; cancelled orders cannot be paid | `test_payment_amount_must_match_order_total`, A-16 |
| P3-04 | Critical | Every broadcast event crashed (wrong relation name) | Events load `table`; broadcast verified on live Reverb | B-05, B-06, B-14 |
| P3-05 | Critical | All realtime channels public, no channel auth | `private-stall.{id}`, `private-waiters`, `private-cashier` + `POST /api/broadcasting/auth` (Sanctum) | `test_private_stall_channel_authorization`, RT-01…RT-08 |
| P3-06 | Critical | Mobile app called non-existent routes (`/menu-items`, `/waiter/ready-items`, `/waiter/items/{id}/served`, `/kitchen/items/{id}/status`): waiter could not load menu, see ready dishes or confirm serving | Routes corrected; screens adapted to real payloads | typecheck + API workflow B |
| P3-07 | Critical | Mobile KDS crashed as soon as a ticket existed (`items` vs `ticket_items`) | `normalizeTicket` mapping | typecheck; API A-08 |
| P3-08 | Critical | Offline queue minted a new idempotency key → duplicate order when a response was lost | One key per order for its whole life; `syncEngine.ts` | OFF-6 |
| P3-09 | Critical | Web apps hard-coded `http://localhost:8000/api`: QR ordering impossible from any phone | `VITE_API_BASE_URL` (default same-origin `/api`) | Browser UAT on built app |
| P3-10 | Critical | Android release blocks cleartext HTTP; LAN edge server unreachable from a release APK | `plugins/withLanCleartext.js` | AndroidManifest after prebuild |
| P3-11 | High | Kitchen/any staff could read orders, receipts, revenue dashboards | Owner/cashier only | `test_kitchen_staff_cannot_read_financial_or_cross_stall_data`, E-02 |
| P3-12 | High | Kitchen staff could rename/deactivate stall; stall details exposed staff emails/phones | Manager of own stall only; `is_active` owner-only | `test_stall_details_and_updates_are_restricted` |
| P3-13 | High | Any stall-assigned user (kitchen, waiter) could adjust stock | Owner, stall manager, store staff only; row lock | `test_kitchen_staff_cannot_adjust_inventory`, D-08 |
| P3-14 | High | Cross-stall PO items/supplier; double receive race | Stall ownership validation; PO row lock | `test_purchase_order_cannot_reference_another_stalls_items_or_supplier`, D-06/07, PERF-05 |
| P3-15 | High | Any role could mark any ticket served, even un-cooked; serving reopened a paid order | Waiter/owner only, `ready` only, idempotent, keeps `completed` | `test_only_waiters_serve_ready_tickets_and_payment_status_is_preserved`, B-04/09/10 |
| P3-16 | High | Kitchen tickets could move backwards / change after cancel | Forward-only state machine | `test_kitchen_ticket_cannot_move_backwards`, A-12 |
| P3-17 | High | Invented settlement formula (payable = gross) and overwritable payouts | No amount derived; owner records actual amount paid; paid record immutable | `test_settlement_record_cannot_be_paid_twice`, E-05/E-07 |
| P3-18 | High | No login brute-force protection; deactivated users kept working tokens | `throttle:login` (5/min per email+IP); `active` middleware | `test_login_is_rate_limited`, `test_deactivated_user_token_is_rejected`, AUTH-01/02 |
| P3-19 | High | Idempotency race → HTTP 500; replay leaked PII | Unique-violation → replay; sanitized public view | OFF-9, `test_public_idempotent_replay_does_not_expose_customer_phone` |
| P3-20 | High | Demo quick-login buttons with seeded passwords shipped in production builds | Shown only in dev builds (`DEV` / `__DEV__`) | `password123` absent from desktop `dist/` |
| P3-21 | Medium | Public QR order throttle 30/min per IP would throttle a whole food court behind one NAT | Per-table 20/min + per-IP 300/min | `test_public_orders_are_throttled_per_table`, PERF-01 |
| P3-22 | Medium | Customer QR app had no idempotency key (double-tap duplicates) | Key per checkout, reset when cart changes | code review |
| P3-23 | Medium | Offline: business rejections (422) were retried forever as "offline"; "Clear" deleted unsent orders | `rejected` state; only rejected orders can be discarded | OFF-10 |
| P3-24 | Medium | Items from deactivated stalls could be ordered | Rejected with 422 | `test_order_rejects_items_from_inactive_stall` |
| P3-25 | Medium | Mobile routed cashier/manager/store roles to the waiter terminal | Manager → KDS; unsupported roles see "use desktop" | code review |

## 2b. Phase 4 additions (2026-11-02)

| ID | Severity | Item | Fix | Evidence |
|---|---|---|---|---|
| P4-01 | High (process) | A second agent (Antigravity IDE) rewrote its own Phase 2 snapshots of about 15 files twice (19:12:41–19:12:59 and 19:17:47–49, plus 19:26:47). This reverted P3-03, P3-08, P3-10, P3-14, P3-22 and the status doc. Files it hadn't diverged on came back byte-identical. | All fixes re-applied; Antigravity closed; 42 markers audited | `implementation-status.md` history note |
| P4-02 | High | QR checkout guard used React state only: two taps in the same tick could both submit before the button re-rendered disabled | `frontend-customer/src/lib/checkoutSession.ts`: synchronous in-flight lock, one key per checkout (cart signature), key cleared only on 200/201, typed error messages | `pnpm test` 12/12; UI triple-tap → 1 POST, 1 order |
| P4-03 | Medium | Mobile default API URL was the emulator address; every phone needed manual setup | `EXPO_PUBLIC_API_URL` default (login-screen setting still overrides) | Served bundle contains the staging URL |
| P4-04 | Medium | Demo seeder (shared `password123`) could run against production | `DatabaseSeeder` refuses `APP_ENV=production` | `test_demo_seeder_refuses_to_run_in_production` |
| P4-05 | Low | Test-script bugs (CRLF from psql on Windows, number vs string compare) caused 2 false FAILs in the first Phase 4 run | Script fixed and re-run from scratch | 47/47 |

Kept as valid work from the other agent: `backend/config/cors.php` (Laravel default), `frontend-customer/.env` and `frontend-desktop/.env` (local dev API URL, git-ignored).

## 3. Open defects (not fixed: business decision or outside this phase)

See `production-readiness-checklist.md` §3 for the full list. The most important:

- **OPEN-01 (High, business decision):** End-of-day closing does not lock the day. Payments taken after closing are accepted but are not in that day's settlement records. Found in browser UAT: the live summary showed ₹10,223 gross while the closed settlement records total ₹9,746. The desktop confirmation text says closing "will lock day transactions"; it does not.
- **OPEN-02 (High):** There are no user-management endpoints or screens. Staff accounts can only be created, deactivated or have passwords changed directly in the database. Seeded accounts all share `password123`.
- **OPEN-03 (High):** PHP runtime without OPcache on the `artisan serve` dev server takes about 370 ms per request (SQL 0.12 ms). A pilot needs a production PHP server.
- **OPEN-04 (Medium):** No client consumes Reverb. All realtime UX is HTTP polling (4–10 s). Server-side broadcasting and channel security are verified.
