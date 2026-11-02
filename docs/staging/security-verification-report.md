# Security Verification Report — Phase 4

**Date:** 2026-11-02
**Environment:** staging (`foodcourt_staging_db`), API `http://10.16.20.53:8100/api` (+ workers :8101–:8103), Reverb `ws://…:8180`
**Evidence:** `qa/staging/phase4-workflow-e2e.mjs` → `qa/staging/results/phase4-e2e.json` (47 PASS / 0 FAIL, run 2026-11-02), `php artisan test` (38 passed, 766 assertions), `pnpm test` in `frontend-customer` (12/12 incl. 2 live).

Every item below was executed against running code. Nothing is marked verified from documentation alone.

| # | Control | How verified | Result |
|---|---|---|---|
| 1 | Public order tracking uses cryptographic tokens | `trk_` + 36 random chars (F-01); invalid token → 404 (`SecurityAuditTest`) | **Verified** |
| 2 | Sequential order ids do not expose customer data | `GET /api/public/orders/{id}` → 404 (F-02); authenticated `/orders/{id}` limited to owner/cashier, kitchen → 403 (D-6); public responses carry no phone (F-03) | **Verified** |
| 3 | Public orders cannot spoof their channel | `order_channel: cashier_pos` sent publicly → stored `qr_customer` (F-04) | **Verified** |
| 4 | QR tokens validated | Forged token → 422, missing token with `table_id` → 422 (F-05); QR secrets hidden from public/staff listings, owner only (Phase 3 PRE-04…06) | **Verified** |
| 5 | Menu pricing changes need authorized roles | Kitchen staff → 403; manager of another stall → 403 (F-06) | **Verified** |
| 6 | Payment operations need authorized roles | Waiter → 403 (C-06/F-07); amount must equal bill total (E-08); concurrent double payment → one row (E-09) | **Verified** |
| 7 | Cancellation permissions | Waiter → 403; cashier on unpaid → 200 (F-08) | **Verified** |
| 8 | Paid orders cannot be cancelled | Cashier on paid → 422 (F-08) | **Verified** |
| 9 | Idempotency enforced by backend | Unique index on `orders.idempotency_key`; replay → 200 same order (E-02); 4 workers same key → 1 row (Phase 3 OFF-9); live UI triple-tap → 1 order (`ORD-20261102-JSGAK`) | **Verified** |
| 10 | Cross-stall data access denied | Kitchen sees only own tickets (D-*-1), cannot move other stall's ticket (D-*-2), stock adjust / stall details of other stall → 403 (F-10) | **Verified** |
| 11 | Audit logs persisted | Rows `order_created`, `order_status_updated`, `order_payment_status_updated` present for the UAT order (F-11) | **Verified** (no DB-level append-only protection: OPEN-06) |
| 12 | Realtime private-channel authorization | `private-stall.{id}`, `private-waiters`, `private-cashier`: cross-stall auth 403, anonymous 401, forged signature refused by Reverb with `pusher:error` (F-12); each KDS socket received 0 foreign events (D-*-5) | **Verified** |
| 13 | Public broadcast channel scope | `orders.track.{trackingToken}` **is public**. It is not treated as private: its name is the customer's unguessable token, and payloads carry status/ids/table only | **Documented, by design** |
| 14 | Login brute force | 5 attempts per email+IP per minute (PHPUnit + Phase 3 AUTH-01/02) | **Verified** |
| 15 | Deactivated accounts | Existing tokens rejected 403 (PHPUnit) | **Verified** |

## Demo accounts and credentials

| Check | Result |
|---|---|
| Desktop production build contains `password123` / demo quick-login UI | **No** (scan of `frontend-desktop/dist`) |
| Mobile production JS bundle (`expo export`, `__DEV__=false`) contains `password123` / demo buttons | **No** |
| Customer build contains credentials | **No** |
| Demo seeder can run in production | **No longer**: `DatabaseSeeder` throws when `APP_ENV=production` (new test `test_demo_seeder_refuses_to_run_in_production`) |
| Real `.env` files tracked by git | **No** (`backend/.env`, `backend/.env.staging`, `frontend-*/.env` are ignored; only `backend/.env.example`) |
| Tracked credential found | `backend/phpunit.xml` contains the **local PostgreSQL superuser password** used by tests. Not a production secret, but rotate it and move it to an untracked `.env.testing` (OPEN-06) |
| Staging accounts | All seeded staff use `password123`. They **must be replaced** before any real deployment (OPEN-02: there is no user-management UI yet) |

## Not covered
- No external penetration test or dependency vulnerability scan (`composer audit`, `pnpm audit`) was run in this phase.
- No database row-level security (RLS). Isolation is enforced in application code only.
- Reverb on `ws://` (no TLS) and `allowed_origins: *`.
