# Internal Acceptance Test Report: Multi-Stall Food Court System

**Project:** Multi-Stall Food Court Management System  
**Date:** 2026-11-03  
**Evaluator:** Antigravity Senior Engineering Team  
**Final Acceptance Verdict:** **READY FOR INTERNAL ACCEPTANCE**  
**Authoritative Environment:** Windows 11, Node v24.20, Electron 44.9.0, PHP 8.3.36, PostgreSQL 17.11 (port 5432)  

---

## 1. Resolution of Critical Contract Discrepancies

The fulfillment API implementation, TypeScript types, and test assertions were rigorously inspected and reconciled against the approved business specifications (`docs/superpowers/specs/2026-11-03-order-tracking-design.md`, decisions D4, D5, D6, D12):

| Contract Requirement | Business Rule | Backend Implementation (`FulfillmentService.php`) | Status Code | Verified Behavior |
|---|---|---|:---:|---|
| **Stale expected_version** | Optimistic locking violation when an item was modified by another operator | `FulfillmentException::versionConflict($item)` throws exception with errorCode `version_conflict` and latest item attached | **HTTP 409 Conflict** | **PASS:** Returns 409; frontend UI captures 409 and informs operator `"Someone else updated this item; showing the latest."` |
| **Same-status repeat** | Idempotent no-op when an item is already in requested state | Target matches current state (`$current === $to`); returns `['changed' => false, 'item' => $item]` | **HTTP 200 OK** | **PASS:** Returns 200 without throwing, even if client passes a stale version |
| **Invalid / Backward transition** | Attempt to move item backward (e.g., `ready` -> `preparing`) or transition cancelled item | Rank check (`RANK[$to] < RANK[$current]`); throws `FulfillmentException::invalid(...)` with `invalid_transition` | **HTTP 422 Unprocessable** | **PASS:** Rejects with 422, preserving forward-only state machine |
| **Idempotency Key Conflict** | Same `idempotency_key` reused for a different set of items | Checks `fulfillment_operations` table; if requested payload hashes differ, throws `FulfillmentException::idempotencyKeyReused()` | **HTTP 409 Conflict** | **PASS:** Rejects with 409, preventing accidental multi-item execution |

*Note on previous report:* The mention of "HTTP 422 Version Mismatch" in the previous session's Markdown prose was an editorial summarization slip; the actual source code, database constraints, and test suites have consistently enforced HTTP 409 Conflict for version mismatches.

---

## 2. Multi-Stall Acceptance Scenarios & Results

All acceptance scenarios were executed against an isolated PostgreSQL database (`foodcourt_acceptance_db` and `foodcourt_desktop_e2e_db`) through live PHP server workers and HTTP API calls.

### Scenario A: Multi-Stall Order Placement & Kitchen Ticket Splitting
- **Test ID:** `SCN-A01` .. `SCN-A03`
- **Actions:** Cashier placed an order containing 2 Pizza stall items and 1 Burger stall item.
- **Verification:**
  - One consolidated parent order created (`ORD-20261103-JSVLQ`).
  - Exactly two distinct kitchen tickets created in `stall_kitchen_tickets` (one assigned to Pizza stall ID, one to Burger stall ID).
  - Pizza KDS API (`GET /kitchen/tickets` with Pizza staff token) returned only Pizza tickets; Burger KDS returned only Burger tickets.
  - Cross-stall modification attempt (Pizza chef sending `PUT /kitchen/tickets/{burgerTicketId}/status`) was strictly rejected with **HTTP 403 Forbidden**.
- **Classification:** **PASS**

### Scenario B: Item-Level Fulfillment & Status Reconciliation
- **Test ID:** `SCN-B01` .. `SCN-B03`
- **Actions:** Created 4-item multi-stall order (2 Pizza, 2 Burger).
- **Verification:**
  - Advanced 1 item to `ready` -> Parent order status transitioned to `partially_ready`.
  - Cashier marked the 1 ready item as `served` -> Remaining 3 items retained their unserved state.
  - Cashier executed `POST /orders/{id}/serve-remaining` with unique idempotency key.
  - All 4 ticket items transitioned to `served`.
  - Both kitchen tickets automatically transitioned to `picked_up` and vacated the active KDS column.
  - Parent order status reconciled to `served`.
- **Classification:** **PASS**

### Scenario C: Concurrency & Audit Integrity
- **Test ID:** `SCN-C01`, `SCN-C02`
- **Actions:** Raced individual item serving requests (`PATCH /ticket-items/{id}/status`) concurrently against "Serve All Remaining" (`POST /orders/{id}/serve-remaining`) using `Promise.all`.
- **Verification:**
  - Zero HTTP 500 server errors or database deadlocks.
  - For every item, the database row version incremented exactly to the number of audited status transitions (`version == count(audit_logs)`).
  - No lost updates or double-increments detected.
- **Classification:** **PASS**

### Scenario D: Persistence Across Process Restart
- **Test ID:** `SCN-D01`, `SCN-D02`
- **Actions:** Placed order, recorded payment, served item, terminated PHP server process, and spawned a new server instance on a fresh port.
- **Verification:**
  - All order attributes, payment status (`paid`), items fulfillment states, and audit log entries were queried through the new process and verified 100% intact from PostgreSQL storage.
- **Classification:** **PASS**

### Scenario E: Role Authorization & Stall Isolation
- **Test ID:** `SCN-E01` .. `SCN-E03`
- **Actions:** Evaluated access boundaries for Owner, Cashier, Kitchen Staff, and Stall Manager.
- **Verification:**
  - Kitchen staff attempting `POST /billing/pay` -> **HTTP 403 Forbidden**.
  - Kitchen staff attempting `PUT /settings/food_court_name` -> **HTTP 403 Forbidden**.
  - Cashier attempting `PUT /kitchen/tickets/{id}/status` -> **HTTP 403 Forbidden**.
  - Stall Manager accessing inventory -> strictly scoped to their assigned stall.
- **Classification:** **PASS**

---

## 3. Business Workflow Regression Results

Executed via `qa/acceptance/run-desktop-e2e.mjs` against `foodcourt_desktop_e2e_db` (27 workflow checks):

| Module | Verification Steps | Exit Code | Result | Evidence |
|---|---|:---:|:---:|---|
| **Stalls & Staff** | Owner creates stall, assigns cashier, kitchen staff, and manager | 0 | **PASS** | `O-01`, `O-02`: Created stall `STALL-DOSA-*`, staff created |
| **Menu & Images** | Categories, menu items, photo upload served back via HTTP | 0 | **PASS** | `O-04`, `O-05`: 1x1 test PNG uploaded and fetched via `/api/public/menu-images/*` |
| **POS Billing** | Multi-stall items, subtotal calculation, 5% tax rule | 0 | **PASS** | `C-01`..`C-03`: Subtotal and ₹513.45 total verified |
| **Payment Collection** | Cash tendered ₹1000, change returned ₹486.55, double-pay blocked | 0 | **PASS** | `B-01`..`B-02`: Double submit produced `[200, 422]`; exactly 1 payment row |
| **Receipt & History** | Receipt breakdown grouped by stall, payment listed in history | 0 | **PASS** | `B-03`..`B-05`: Both stalls grouped, table released to `available` |
| **Purchasing & Stock** | Supplier, Purchase Order, Goods Receipt, Stock-out, Ledger audit | 0 | **PASS** | `I-01`..`I-03`: Stock calculated (5 + 10 - 2.5 = 12.5 kg), ledger matched |
| **Staff Deactivation** | Immediate session invalidation upon deactivation by owner | 0 | **PASS** | `S-01`: Subsequent kitchen API call returned HTTP 401 |
| **Daily Closing** | Gross sales calculation per stall, settlement payout, payout history | 0 | **PASS** | `R-01`..`R-02`: Stall gross sales ₹240.00; payout recorded |
| **Reports & Analytics** | Stall sales report, menu performance, cashier activity, dashboard | 0 | **PASS** | `R-03`..`R-06`: Masala Dosa x2 listed; cashier activity tracked |
| **Audit Trail** | System-wide audit log verification | 0 | **PASS** | `R-07`: `staff_created`, `order_created`, `daily_closing_created` verified |
| **Function Hall** | Hall booking, banquet scheduling, hall billing | N/A | **NOT TESTED** | **Not implemented in repository** (see Section 6) |

---

## 4. Scalability & Data Integrity Benchmarks

Executed via `qa/acceptance/internal-acceptance.mjs` against PostgreSQL:

- **160 Active Orders Generation:** 160 active multi-stall orders generated in bursts of 20. Total active unserved orders verified >= 160.
- **Board Cursor Pagination (`SCN-S01`, `SCN-S02`):**
  - Page 1 (`GET /orders/board?limit=100`): Returned exactly 100 orders with a valid base64 cursor (`Y-m-d H:i:s|id`).
  - Page 2 (`GET /orders/board?limit=100&cursor=...`): Returned remaining 65 orders.
  - Zero duplicate orders between page 1 and page 2 (`SCN-S03`).
- **Board Retention for Paid / Completed Orders (`SCN-S04`):**
  - Paid an active order with unserved items at cashier counter.
  - Re-queried `/orders/board`: The paid order **remained visible on the tracking board** until all items reached `served`. No unserved orders silently disappear.
- **Cancelled Orders & Items Edge Cases (`SCN-S05`):**
  - Cancelled an active order via `POST /orders/{id}/cancel`.
  - Re-queried `/orders/board`: The cancelled order was cleanly excluded from active unserved board.
  - Progress calculations exclude cancelled items; all-cancelled orders display "Cancelled" rather than "0/0 Served".

---

## 5. Physical POS Hardware Readiness Inspection

Desktop architecture analysis for physical deployment on Windows POS terminals:

| Hardware Component | Current Desktop Implementation | Physical Test Status | Verification Required on Target Hardware |
|---|---|:---:|---|
| **Thermal Receipt Printer** | Chromium `webContents.print({ deviceName })` through `preload.cjs` allowlist (`desktop:print`, `desktop:list-printers`). Print CSS `@media print` formatted for 80mm/58mm rolls. | **PENDING PHYSICAL TEST** | Test on physical ESC/POS USB and Network printers (Epson TM-T82, Star TSP100, TVS RP-3200) to verify physical paper feed, margins, and auto-cutter. |
| **Cash Drawer** | Handled through Windows printer driver ("Open cash drawer before/after print"). No direct serial/RJ11 raw ESC/POS pulse driver built into Electron. | **PENDING PHYSICAL TEST** | Verify cash drawer kicks open reliably via printer RJ11 port upon payment settlement print. |
| **Receipt Reprint** | Endpoint `GET /billing/receipt/{order_id}` and UI modal `ReceiptModal.tsx` allow unlimited reprints. | **VERIFIED (Software)** | Verify reprint output on physical paper roll. |
| **Touch Display & Resolution** | Window constrained to `minWidth: 1100, minHeight: 700`, default `1440x900`. Tailwind UI uses responsive flex and compact table paddings. | **PENDING PHYSICAL TEST** | Verify touch target sizes (minimum 44x44px for buttons) and Windows 125%/150% DPI scaling on 15" touch POS terminals. |
| **Barcode Scanner** | Inputs support standard keyboard events. Scanners configured as HID keyboard wedges type into active input and trigger Enter. | **PENDING PHYSICAL TEST** | Verify handheld USB scanner input speed without losing characters in search inputs. |
| **Multi-PC LAN Operations** | Verified in software: Central PC hosts PostgreSQL and API, client PCs pair with one-time code and communicate over LAN with encrypted tokens. | **VERIFIED (Software)** | Validate network latency and IP address changes on physical food court LAN router. |

---

## 6. Business Decisions & Architectural Boundaries

1. **Function Hall Workflows:**
   - *Status:* **NOT IMPLEMENTED / OUT OF SCOPE.**
   - *Finding:* No database tables, models, API endpoints, or UI screens exist in the repository for Function Hall, banquet reservations, hall rental billing, or hall calendar scheduling.
   - *Recommendation:* If the business requires Function Hall management, an independent PRD and schema design must be drafted and approved.
2. **Offline Waiter Mobile App:**
   - *Status:* Desktop is independent and 100% operational. As noted in earlier audits, the mobile waiter app (`mobile-app/`) omits `order_channel` in its order payload, which fails with 422 if used. Does not impact desktop operations.
3. **Window Resize Flash in Light Mode:**
   - *Status:* Native Win32 window background color `#0f172a` is visible momentarily during rapid mouse window resizing in light mode before the Chromium renderer paints canvas `#fafafa`. Documented as non-blocking cosmetic behavior.

---

## 7. Test Summary Matrix

| Test Suite / Scope | Command | Total Checks | Pass | Fail | Skip | Exit Code |
|---|---|:---:|:---:|:---:|:---:|:---:|
| **Internal Acceptance Scenarios (A, B, C, D, E, Scalability)** | `node --test qa/acceptance/internal-acceptance.mjs` | 7 | 7 | 0 | 0 | 0 |
| **Business Workflow Regression (POS, KDS, Stock, Closing)** | `node qa/acceptance/run-desktop-e2e.mjs` | 27 | 27 | 0 | 0 | 0 |
| **Fulfillment Concurrency (PostgreSQL)** | `node --test qa/fulfillment/concurrency.e2e.mjs` | 6 | 6 | 0 | 0 | 0 |
| **Desktop Unit Tests** | `pnpm --filter frontend-desktop test` | 152 | 152 | 0 | 0 | 0 |
| **Theme & Two-Theme Accessibility E2E** | `node e2e/theme.e2e.mjs` | 176 | 176 | 0 | 0 | 0 |
| **Order Tracking Electron E2E** | `node e2e/order-tracking.e2e.mjs` | 16 | 16 | 0 | 0 | 0 |
| **UI First-Run & Backup E2E** | `node e2e/ui-first-run.e2e.mjs` | 27 | 27 | 0 | 0 | 0 |
| **Desktop Lifecycle Integration E2E** | `node --test ../qa/desktop/lifecycle.e2e.mjs` | 14 | 14 | 0 | 0 | 0 |
| **Multi-PC Terminal Isolation E2E** | `node --test qa/multi-pc/multipc.e2e.mjs` | 7 | 7 | 0 | 0 | 0 |
| **Backend Unit & Feature (PostgreSQL)** | `php artisan test --no-coverage` | 150 | 150 | 0 | 0 | 0 |
| **Backend Compatibility (SQLite)** | `php artisan test --no-coverage` (SQLite DB) | 150 | 150 | 0 | 0 | 0 |
| **Total Test Checks** | | **732** | **732** | **0** | **0** | **0** |

---

## 8. Final Verdict

### **READY FOR INTERNAL ACCEPTANCE**
The implementation satisfies all functional, architectural, concurrency, security, and scalability criteria for desktop operations. The software is ready for internal user acceptance testing on target staging environments.
