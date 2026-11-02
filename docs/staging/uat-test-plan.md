# User Acceptance Test Plan

**Environment:** staging (`foodcourt_staging_db`), API `http://<edge-ip>:8100/api`, desktop `:4102`, customer QR `:4101/table/<qr_token>`, Android release APK `com.foodcourt.multistall` 1.0.0 (versionCode 1)
**Accounts:** seeded staging accounts (`owner@`, `cashier@`, `waiter1@`, `waiter2@`, `manager.pizza@`, `kitchen.pizza@`, `kitchen.burger@`, `kitchen.bev@` `foodcourt.com`). Staging only.
**How to record:** fill *Actual result*, *PASS/FAIL* and *Evidence* in `uat-results.md` (screenshot path, order number or harness check id).

Execution levels:
- **API**: executed by `qa/staging/staging-validation.mjs` against the live staging API (check id in the Evidence column).
- **UI**: performed in the real built application (browser, or the Android device/emulator).
- **HUMAN**: must be performed by food court staff during the pilot dry run.

## Owner

| Test ID | Preconditions | Steps | Expected result | Level |
|---|---|---|---|---|
| UAT-OW-01 | Seeded staging | Log in on desktop as owner | Lands on Dashboard; sidebar shows Dashboard, Orders, Stalls, Menu, Inventory, Purchases, EOD, Reports | UI |
| UAT-OW-02 | Paid orders today | Open EOD & Settlements | Gross, net, cash and digital figures; stall-wise breakdown matches the payments ledger | UI + API (E-01, E-03) |
| UAT-OW-03 | Day not closed | Execute End-of-Day Closing | One settlement record per active stall; **no payable amount pre-filled** | UI + API (E-04, E-05) |
| UAT-OW-04 | Day closed | Close the same day again | Rejected "already executed" | API (E-06) |
| UAT-OW-05 | Settlement record pending | Record Payout with an amount, representative name and method | Saved; row shows "Paid to …" with the entered amount; cannot be recorded again | UI + API (E-07) |
| UAT-OW-06 | — | Read table QR tokens (`GET /api/tables`) | Owner sees tokens; cashier and public do not | API (PRE-04/05/06) |
| UAT-OW-07 | — | Reports → Audit log | Order, payment, PO, stock and closing events listed | UI + API (D-09, E-08) |
| UAT-OW-08 | — | Deactivate a stall (Stalls page / API) | Its items can no longer be ordered | API (unit test) |

## Cashier

| Test ID | Preconditions | Steps | Expected result | Level |
|---|---|---|---|---|
| UAT-CA-01 | — | Log in on desktop as cashier | Lands on POS; no Dashboard / EOD / Reports in the sidebar | UI |
| UAT-CA-02 | QR order placed | Open Pending Table Bills | QR, waiter and counter orders listed with stall-wise lines and total | UI + API (A-15) |
| UAT-CA-03 | Pending bill | Settle with cash, tendered > total | Change shown correctly; receipt modal; bill leaves pending list | UI + API (A-17) |
| UAT-CA-04 | Pending bill | Attempt to pay less than the total | Rejected | API (A-16) |
| UAT-CA-05 | Paid bill | Pay it again, from two counters at once | Second attempt rejected; exactly one payment | API (C-04, PERF-02) |
| UAT-CA-06 | — | Create a counter (takeaway) order across 2 stalls and pay by card | Order created, 2 kitchen tickets, paid | API (C-01…C-03) |
| UAT-CA-07 | Paid order | Cancel it | Rejected (refund process not implemented) | API (C-05) |

## Waiter (Android)

| Test ID | Preconditions | Steps | Expected result | Level |
|---|---|---|---|---|
| UAT-W-01 | APK installed, edge IP configured | Log in as waiter1 | Waiter terminal with table list | UI (Android) |
| UAT-W-02 | — | Select table → add items from 2+ stalls → submit | "Order Dispatched", one ticket per stall | UI (Android) + API (B-02) |
| UAT-W-03 | Kitchen marked ready | Open Ready Dishes | Ready tickets listed per stall with table number | UI + API (B-08) |
| UAT-W-04 | Ready ticket | Mark Served; tap again | Served once; repeat is harmless | API (B-10) |
| UAT-W-05 | Ticket not ready | Try to serve | Rejected | API (B-04) |
| UAT-W-06 | — | Try to take payment | Not possible (403) | API (B-12) |
| UAT-W-07 | — | **Turn Wi-Fi off**, place an order, turn Wi-Fi on | Order queued ("Saved Offline"), then auto-synced within ~20 s, created once | HUMAN (logic: OFF-2…OFF-6) |
| UAT-W-08 | Queued order | Force-close and reopen the app | Queue still there, syncs once | HUMAN (logic: OFF-4) |

## Kitchen staff (Android KDS)

| Test ID | Preconditions | Steps | Expected result | Level |
|---|---|---|---|---|
| UAT-K-01 | APK | Log in as kitchen.pizza | KDS for the Pizza stall only | UI (Android) |
| UAT-K-02 | Multi-stall order | View tickets | Only pizza items visible | API (A-08, A-09) |
| UAT-K-03 | Pending ticket | Start Preparation → All Items Ready | Status advances; waiter gets a ready notification (polling) | API (A-11, B-05) |
| UAT-K-04 | Ready ticket | Try to move it back to preparing | Rejected | API (A-12) |
| UAT-K-05 | — | Try another stall's ticket, the dashboard, orders, stock adjust, cashier channel | All 403 | API (A-10, E-02, D-08, RT-06) |

## Stall manager (desktop)

| Test ID | Preconditions | Steps | Expected result | Level |
|---|---|---|---|---|
| UAT-SM-01 | — | Log in as manager.pizza | Menu, Inventory, Purchases visible | UI |
| UAT-SM-02 | — | Add supplier, create PO (12.5 kg @ ₹64.50), receive | PO total ₹806.25; stock +12.5; ledger entry `purchase_inward` | API (D-01…D-05) |
| UAT-SM-03 | Received PO | Receive again / from 4 devices simultaneously | Stock added once | API (D-06, PERF-05) |
| UAT-SM-04 | — | PO with another stall's item or supplier | Rejected | API (D-07) |
| UAT-SM-05 | — | Change stall name; try to deactivate stall | Name OK; deactivate rejected (owner only) | API (unit test) |

## Customer (QR, phone browser)

| Test ID | Preconditions | Steps | Expected result | Level |
|---|---|---|---|---|
| UAT-CU-01 | Phone on food court Wi-Fi | Scan table QR | Menu of all open stalls, table number shown | UI (browser, mobile viewport) |
| UAT-CU-02 | — | Add items from 3 stalls → Confirm | Tracking page with one ticket per stall and correct GST/total | UI |
| UAT-CU-03 | — | Edit URL to another table / random token | "Invalid QR" or order rejected | API (A-02, A-06) |
| UAT-CU-04 | Order placed | Watch tracking page while kitchens work and cashier settles | Shows ready, then paid | API (A-13, A-19) |
| UAT-CU-05 | — | Double-tap Confirm on a slow network | One order only | API (OFF-9) + code |
| UAT-CU-06 | — | Phone on mobile data only (no food court Wi-Fi) | Cannot reach the LAN server. **Expected limitation**, signage required | HUMAN |

## Cross-cutting / operations

| Test ID | Steps | Expected result | Level |
|---|---|---|---|
| UAT-O-01 | 40 simultaneous QR orders | All created once, 2 tickets each | API (PERF-01) |
| UAT-O-02 | Unplug the router's WAN (internet) during service | Ordering, KDS and billing continue on the LAN | HUMAN |
| UAT-O-03 | Restart the edge server mid-service | Queued waiter orders sync once after restart | API (RST-1) |
| UAT-O-04 | Backup, then restore into a new DB | Row counts and money totals identical | Ops (backup-recovery-report) |
| UAT-O-05 | Pay a bill **after** EOD closing | Owner decides expected behaviour | **Blocked: OPEN-01** |
