# Desktop-First Transformation: Report

**Date:** 2026-11-02
**Scope:** PRD "Desktop-First Transformation of Multi-Stall Food Court Management System" (P0 workstreams)
**Final status: READY FOR INTERNAL TESTING.** Not ready for a pilot or production (see §6 and §7).

Nothing has been committed, pushed or deployed. Mobile (Android) and customer QR code is untouched apart from
earlier-phase work and is frozen (P2).

## 1. Gap matrix (inspection before → state now)

| Workstream | Before | Now | Verified by |
|---|---|---|---|
| Electron shell | None (browser-only React app) | Electron 44.9.0, secure defaults, IPC allowlist, config file, logging, NSIS installer | Packaged smoke test, installed app (§4) |
| Server configuration | Build-time `VITE_API_BASE_URL` only | Runtime API URL in Settings / login "Server settings", validated, stored per user | Unit test `normalizeApiUrl`; UI |
| Connectivity status | Sidebar showed a hard-coded "PostgreSQL 17 Online" | Real `/up` health poll, offline banner | Browser UI ("Server online"); packaged app probe |
| Owner dashboard | Sales cards only | + pending bills, completed orders, payments by method, low stock, purchases, closing, staff by role, recent activity (real data) | PHPUnit dashboard structure; E2E R-06; UI |
| Stall management | Create only; no edit/activate in UI | Edit, activate/deactivate (owner), inactive stalls listed for owner, manager sees own stall | PHPUnit; E2E O-01; UI |
| Staff & permissions | **None** (accounts managed in DB, L-09/OPEN-02) | Owner creates, edits, deactivates (tokens revoked), resets password; stall roles require a stall; owner cannot lock self out; audited | PHPUnit (5 tests); E2E O-02/O-03/S-01; UI |
| Cashier POS | Order + payment | + receipt print (80 mm), reprint, payment history with filters; duplicate payment blocked | E2E C-01…B-05; payment history + Reprint in UI |
| Desktop KDS | **None** (mobile only) | Stall-isolated board (New / Preparing / Ready / Served), timers, urgency, chime, fullscreen, 4 s polling + optional Reverb | Unit (state machine); E2E K-01…K-03; UI click-through (§5) |
| Menu | Items only; any category could be assigned | + create/rename category; category must belong to the item's stall (422); product image upload (type/size checked, random file name) | PHPUnit; E2E O-04/O-05 (UI not clicked through) |
| Purchasing & inventory | PO + goods receipt + adjustment | + stock out (consumption / waste-loss, cannot go below zero), ledger view, low-stock filter | PHPUnit; E2E I-01…I-03; UI |
| Daily closing & reports | Closing; stall sales | + closing history, menu performance, cashier activity, CSV export (formula-injection safe), A4 print | Unit (CSV); E2E R-01…R-07; UI |
| Reliability | 401 → full page reload, errors swallowed | Hash routing (works from `file://`), 20 s timeout, errors logged to file, global error handlers | Packaged smoke; logs |

## 2. Backend changes (no schema changes)

New controller `StaffController`. Additions to `MenuController`, `InventoryController`, `BillingController`,
`SettlementController`, `ReportController`, `StallController`; routes in `routes/api.php`; `/up` added to CORS paths
(the desktop health check); `DatabaseSeeder` refuses to run in `production`.

New endpoints: `GET/POST /staff`, `PUT /staff/{id}`, `POST /staff/{id}/reset-password`, `POST /menu-categories`,
`PUT /menu-categories/{id}`, `POST /menu/{id}/image`, `GET /public/menu-images/{file}`, `GET /billing/payments`,
`POST /inventory/{id}/stock-out`, `GET /settlements/closings`, `GET /reports/cashier-activity`,
`GET /reports/menu-performance`. Every new endpoint checks role and stall ownership on the server.

No financial rules were added: totals, the existing 5% GST, payment and settlement logic are unchanged. Stock-out
records quantities only (no recipe/BOM depletion).

## 3. Test results (2026-11-02)

| Where | Command | Result |
|---|---|---|
| `backend` | `php artisan test` | **49 passed** (38 existing + 11 new in `DesktopFirstTest`), 944 assertions |
| `frontend-desktop` | `pnpm test` | **5/5 pass** (KDS state machine, columns, urgency/timers, CSV safety, API URL validation) |
| `frontend-desktop` | `pnpm build` | exit 0 (`tsc` clean) |
| `frontend-customer` | `pnpm test` / `pnpm build` | 10 pass, 2 skipped (live tests need `STAGING_API`) / exit 0 |
| `mobile-app` | `pnpm check-types` | exit 0 |
| repo root | `node qa/desktop/desktop-e2e.mjs` (fresh E2E DB) | **27/27 PASS**, order `ORD-20261102-GW1OG` |
| repo root | same, re-run on the same DB | 26 PASS, 0 FAIL, 2 SKIP: the day was already closed, and a second closing is correctly refused (422) |

The E2E harness runs the PRD chain against an isolated database (`foodcourt_desktop_e2e_db`, refuses any other):
owner creates stall → staff → category, items, photo → cashier creates one multi-stall order (idempotent retry) →
one ticket per stall, each kitchen sees only its own → kitchens prepare to ready → cashier settles one consolidated
bill (double submit blocked) → receipt grouped by stall → payment history → purchasing, goods receipt, stock out →
staff deactivation signs the user out → daily closing and payout → stall sales, menu performance, cashier activity,
dashboard, audit log. Each step is checked against the database with `psql`.

## 4. Windows package

| Check | Result |
|---|---|
| `pnpm dist:win` | `FoodCourt-Desktop-Setup-1.0.0.exe`, 115.1 MB, NSIS x64, per-user. SHA-256 `FE1BA072F096876C2DCCF7A7AEEAC6F2B3E64ECE6935F1BE9CE03B87AF942FF4` |
| Silent install (`/S`) | exit 0; installed to `%LOCALAPPDATA%\Programs\FoodCourt Desktop`; uninstall entry "FoodCourt Desktop 1.0.0"; desktop shortcut created |
| Re-install over existing install | exit 0 (upgrade path works) |
| Installed app smoke test (`FOODCOURT_SMOKE_TEST=1`) | **PASS**, `packaged: true`: contextIsolation, sandbox, no Node integration, `require`/`process` undefined in the page, bridge exposes exactly the 6 allowlisted functions, CSP present, login screen rendered |
| Installed app → API (from `file://` origin) | `/up` 200; `GET /api/auth/me` with a bogus bearer token → 401 readable, so the CORS preflight with `Authorization` works |
| Package contents (`app.asar`) | 10 files: `dist/index.html`, one JS, one CSS bundle, `electron/{main,preload,config}.cjs`, `package.json`. No `node_modules`, `.env`, keys, SQL; no DB credentials or `APP_KEY` patterns |
| Code signing | **None.** SmartScreen warns on install |

The first build packed ~5,500 unused `node_modules` files (the renderer is already bundled by Vite); excluded via
`"!node_modules/**/*"` in the build `files`.

## 5. UI verification (browser, same production bundle, E2E API)

Signed in as owner and checked: dashboard sections with real figures, sidebar "Server online", staff list
(inactive account greyed) and staff created through the form, stalls with edit/deactivate, inventory stock-out and
ledger, payment history with Reprint, report tabs with rows. The menu category/photo screens and the cashier POS
receipt print were exercised at the API (E2E O-04, O-05, B-03) but not clicked through in this phase.

KDS click-through on ticket `KKT-20261102-LPAH` (order `ORD-20261102-W1BKJ`): **Accept → Start Preparing →
Mark Ready** via the buttons; the database showed `preparing` with `accepted_at` set, and the card moved to
"Ready for pickup".

These UI checks ran in a browser against the same `dist/` bundle that the installer ships, not inside the installed
Electron window. The Electron-specific parts (bridge, config, print IPC, CSP, routing from `file://`) are covered by
the packaged smoke test.

## 6. Not verified / known limitations

| Item | Status |
|---|---|
| Printing on a physical 80 mm thermal printer | **Not verified.** Only up to the Windows print dialog |
| KDS realtime via Reverb | Implemented, not verified; needs `VITE_REVERB_*` at build time. Polling (4 s) is the verified mode |
| Full click-through inside the installed Electron window | Not done (see §5) |
| Menu category/photo and POS screens clicked through in this phase | Not done; API-verified |
| Installation on a second, clean Windows PC | Not done (installed on the development PC) |
| Code signing, auto-update | Not implemented |
| Offline desktop | Not supported by design. The server must be reachable; no Local Edge Server (needs separate approval) |
| Human UAT with owner/cashier/kitchen staff | Not done |
| EOD day lock, settlement formula, GST rule, business rules from the owner recording | Still open (OPEN-01, OPEN-05, OPEN-14). No rules invented |

## 7. Why "READY FOR INTERNAL TESTING" and not more

Every P0 workstream is implemented and verified end-to-end at the API with database evidence, the UI was exercised
for each area, and the Windows installer installs, launches, passes its security self-check and reaches the API.
It is not pilot-ready because thermal printing, a clean-machine install and human UAT have not happened, the
installer is unsigned, and the pilot blockers OPEN-01, OPEN-03 and OPEN-14 from
`docs/staging/production-readiness-checklist.md` still stand. OPEN-02 (staff management) is now closed.

## 8. Next steps for the internal test

1. Install on the actual counter PC; set the server address in *Server settings*.
2. Print a receipt and a report on the real printers.
3. Run one service hour with real staff: owner, one cashier, two kitchen screens.
4. Replace every seeded `password123` account using *Staff & Permissions → Password*.
