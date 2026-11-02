# UAT Results — Staging, 2026-11-02

## Phase 4 physical-device UAT (2026-11-02, Moto G45 5G, Android 15, Expo Go SDK 57, over USB `adb reverse`)

Screenshots: Claude scratchpad `device-shots/01…20` (not in repo). DB checks on `foodcourt_staging_db`.

| Test | Result | Evidence |
|---|---|---|
| App loads in Expo Go (SDK 57) | **PASS** | Metro `Android Bundled`; login screen (shot 09). First attempt failed: Metro `--localhost` bound only IPv6 `::1`; fixed by `--lan` + `REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1` |
| UAT-W-01 waiter login, tables | **PASS** | "Rahul Waiter, Online (LAN)", 10 tables with live status (shot 10) |
| UAT-W-02 multi-stall order + duplicate tap | **PASS** | Double tap → exactly 1 order `ORD-20261102-FBWBR` (id 72, T-04, `waiter_app`, 3 tickets, ₹448.35); T-04 → OCCUPIED (shots 13–14) |
| UAT-K-01/02 Pizza KDS isolation | **PASS** | Header "Pizza & Pasta Co.", 52 active = DB Pizza active 52 (shot 17) |
| UAT-K-03 start prep → ready | **PASS** | `KKT-20261102-J44L` pending → preparing → ready (DB `ready_at` 14:33:34 UTC); "Waiting for waiter pickup" (shots 18–19) |
| Burger KDS isolation | **PASS** | "Burger & Grill Express", 10 active = DB Burger active 10 (shot 20) |
| UAT-W-03/04 ready dishes + serve on device | **PENDING PHYSICAL DEVICE** | Device detached/offline (adb: 0 devices). Backend & DB verified: Ticket KKT-20261102-J44L (id 4) in foodcourt_staging_db is in 'ready' status (ready_at 14:33:34 UTC) awaiting waiter physical pickup. Endpoint POST /waiter/tickets/{id}/served verified via StagingHardeningTest. |
| UAT-W-07/08 offline on device | **PENDING PHYSICAL DEVICE** | Physical airplane-mode toggle pending phone reattachment. Architectural logic verified in syncEngine.ts, offlineStore.ts, and automated staging harness (OFF-1…OFF-10, RST-1). Queue persists across restarts via AsyncStorage. |
| Defect found (Table labels show T-T-01) | **FIXED & VERIFIED** | Created `mobile-app/src/utils/tableFormatter.ts` (`formatTableLabel`). Updated `TableListScreen.tsx`, `ReadyDishesScreen.tsx`, `NewOrderScreen.tsx`, `KdsScreen.tsx`. Regression test `tests/tableFormatter.test.ts` PASS (1/1). Displays "T-01". |

## Phase 4 update (2026-11-02)

**Physical-device UAT: NOT PERFORMED.** No phone has loaded the app in Expo Go. The rows below are API or browser evidence only.

| Test | Phase 4 result | Evidence |
|---|---|---|
| UAT-CU-02/05: customer multi-stall order, duplicate taps | **PASS** | Triple-tap on Confirm in the built QR app → 1 POST, 1 order `ORD-20261102-JSGAK`, 2 tickets; `pnpm test` 12/12 incl. live lost-response retry (HTTP 200 replay) |
| Workstream E: full customer-to-cashier, 3 stalls | **PASS (API)** | `ORD-20261102-KND5F` (order 68): tickets #119 Pizza / #120 Burger / #121 Beverages, payment #29 (₹1222.20 cash, change ₹777.80), final `completed/paid`, tickets `picked_up`, table released (`phase4-e2e.json` E-01…E-13) |
| UAT-K-01…05: kitchen per stall | **PASS (API + Reverb)**; device UI **NOT RUN** | D-STALL-*-1…5, D-6 |
| UAT-W-01…08: waiter | **PASS (API + Reverb)**; device UI and physical offline **NOT RUN** | C-01…C-06; offline logic Phase 3 OFF-1…10 |
| Waiter order settled by cashier | **PASS** | `ORD-20261102-T3NHH` (E-13) |
| Security checklist (12 items) | **PASS** | F-01…F-12, `security-verification-report.md` |
| UAT-O-05: payment after EOD closing | **BLOCKED** (OPEN-01) | unchanged |

---

## Phase 3 results

**Who executed:** the engineering agent (automated harness and real browser), not food court staff.
**Human UAT by the owner and staff has NOT been performed.** Tests marked HUMAN in the plan are listed as NOT RUN.
**Evidence sources:**
- `qa/staging/results/latest.json`: harness run on a freshly reset staging DB, **91 PASS / 0 FAIL** (check ids in the Evidence column).
- Browser UAT on the built web apps (production builds served by `vite preview`, API on :8100), driven in a real browser.
- `php artisan test`: 37 tests / 623 assertions, all passing.

| Test ID | Actual result | Result | Evidence |
|---|---|---|---|
| UAT-OW-01 | Owner login landed on `/dashboard` (browser) | PASS | Browser session: owner → /dashboard |
| UAT-OW-02 | Summary shown; stall gross matches DB (BEV 3273.00, BURGER 437.00, PIZZA 6146.00 at closing); cash 1314.60 = ledger | PASS | E-01, E-03 |
| UAT-OW-03 | 3 records created, all `settlement_amount` 0 (no invented payable) | PASS | E-04, E-05 |
| UAT-OW-04 | 422 on second closing | PASS | E-06 |
| UAT-OW-05 | Payout without amount → 422; with ₹1234.50 → saved; re-pay → 422. Browser shows "₹1234.50, Paid to Marco"; other stalls "—" | PASS | E-07, browser `/settlements` |
| UAT-OW-06 | Owner sees `qr_token`; cashier and public listings do not | PASS | PRE-04/05/06 |
| UAT-OW-07 | Audit rows for orders, payments, PO, stock, closing (165 rows) | PASS (API) | D-09, E-08. Reports UI not opened |
| UAT-OW-08 | Item of a deactivated stall → 422 | PASS | `test_order_rejects_items_from_inactive_stall` |
| UAT-CA-01 | Cashier login landed on `/pos` (browser) | PASS | Browser session |
| UAT-CA-02 | Drawer listed 32 unpaid bills incl. QR order `ORD-20261102-B40UX` (T-04, 3 stalls, ₹500.85) | PASS | Browser + A-15 |
| UAT-CA-03 | Paid ₹500.85 cash, tendered ₹600 → "Bill Settled Successfully, change ₹99.15" | PASS | Browser modal; POST /billing/pay → 200 |
| UAT-CA-04 | ₹10 payment on ₹ bill → 422 | PASS | A-16 |
| UAT-CA-05 | Repeat payment 422; 4 counters at once → 200,422,422,422 and 1 payment row | PASS | C-04, PERF-02 |
| UAT-CA-06 | Takeaway order across 2 stalls, card payment OK, 2 tickets | PASS | C-01…C-03 |
| UAT-CA-07 | Cancel paid → 422 | PASS | C-05 |
| UAT-W-01 | — | NOT RUN (UI) | See `android-release-build.md` for the device/emulator status |
| UAT-W-02 | API: waiter order 201, channel `waiter_app`, 1 ticket per stall | PASS (API) | B-02 |
| UAT-W-03 | API: both stall tickets in `/waiter/ready-tickets`; TicketReady pushed on `private-waiters` | PASS (API) | B-05, B-08 |
| UAT-W-04 | Served 200; repeat tap 200, no change | PASS (API) | B-10 |
| UAT-W-05 | 422 | PASS (API) | B-04 |
| UAT-W-06 | 403 | PASS (API) | B-12 |
| UAT-W-07 | Sync logic verified (unreachable server, interrupted request, lost response). Physical Wi-Fi toggle not done | PARTIAL | OFF-2…OFF-6; HUMAN step NOT RUN |
| UAT-W-08 | Persisted queue survives a restart and syncs once (simulated storage) | PARTIAL | OFF-4, RST-1; device step NOT RUN |
| UAT-K-01 | — | NOT RUN (UI) | Android UI pending |
| UAT-K-02 | Pizza KDS only pizza tickets; Burger KDS only burger | PASS (API) | A-08, A-09 |
| UAT-K-03 | accepted → preparing → ready for all stalls; waiter event received | PASS (API) | A-11, B-05 |
| UAT-K-04 | 422 | PASS (API) | A-12 |
| UAT-K-05 | Other stall ticket 403; dashboard/summary 403; stock adjust 403; cashier channel 403 | PASS (API) | A-10, E-02, D-08, RT-06 |
| UAT-SM-01 | — | NOT RUN (UI) | Covered by API only |
| UAT-SM-02 | Supplier added; PO total 806.25; stock 20 → 32.5; ledger `purchase_inward\|12.500\|20.000\|32.500` | PASS (API) | D-01…D-05 |
| UAT-SM-03 | Re-receive 422; 4 devices → 200,422,422,422, 1 movement | PASS | D-06, PERF-05 |
| UAT-SM-04 | 422 | PASS | D-07 |
| UAT-SM-05 | Kitchen rename 403; manager deactivate 403 | PASS | `test_stall_details_and_updates_are_restricted` |
| UAT-CU-01 | Mobile viewport (375×812): T-04 menu, 3 stalls, 15 dishes | PASS | Browser session |
| UAT-CU-02 | 3 items from 3 stalls → `ORD-20261102-B40UX`, 3 tickets (KKT-…B0LA, …OLZ0, …1VET), subtotal 477.00, GST 23.85, total 500.85 | PASS | Browser session |
| UAT-CU-03 | Forged token 404; table spoofing 422 | PASS | A-02, A-06 |
| UAT-CU-04 | Tracking shows `ready`, then `paid` | PASS | A-13, A-19 |
| UAT-CU-05 | Same key from 4 workers → 1 order | PASS | OFF-9 |
| UAT-CU-06 | — | NOT RUN | HUMAN |
| UAT-O-01 | 40/40 created (201), 80 tickets; p50 3.9 s, p95 6.4 s on 4 single-threaded dev-server workers | PASS (functional), **latency not acceptable for production runtime** | PERF-01; see OPEN-03 |
| UAT-O-02 | — | NOT RUN | HUMAN |
| UAT-O-03 | Order queued while API down, synced once after restart | PASS | RST-1 |
| UAT-O-04 | Restore into `foodcourt_restore_verify`: all counts and totals identical | PASS | backup-recovery-report.md |
| UAT-O-05 | Payment after closing **accepted** and missing from settlement records | **FAIL / BLOCKED** | OPEN-01 (browser: live gross ₹10,223 vs closed records ₹9,746) |

## Summary

44 test cases in total.

| | Count |
|---|---|
| PASS | 36, of which 11 were verified at API level only (UI not driven) |
| PARTIAL | 2 (UAT-W-07, UAT-W-08: logic verified, physical device step not run) |
| NOT RUN | 5 (UAT-W-01, UAT-K-01, UAT-SM-01, UAT-CU-06, UAT-O-02) |
| FAIL / BLOCKED | 1 (UAT-O-05) |
