# Stall settlement: payout recording, payout ledger and payment status tracking

Date: 2026-11-04 · Build: desktop 1.2.0 (demo-data installer) · Nothing committed or pushed.

## Final verdict

| Capability | Status | Evidence |
|---|---|---|
| **Settlement calculation implemented** | **Yes, on a stated assumption.** Net payable = the stall's recorded sales for the day (sum of its paid order lines) plus signed, audited adjustments. No commission or deduction rate is applied because none has been approved. | §3, tests 01-04, 14 |
| **Payout recording implemented** | **Yes.** Every confirmed payout is a permanent ledger row; failed attempts and reversals are rows too. Overpayment, duplicates and concurrent requests are blocked by the server. | §2, §6, §8, tests 01-03, 10-13 |
| **Payout history implemented** | **Yes.** Filters (date, range, stall, owner, method, status, search), per-payout detail with full audit history, per-stall ledger drawer, receipts. | §5, e2e P-16..P-18 |
| **Owner-wise consolidated payout implemented** | **Yes.** Owner totals across all stalls, per-stall breakdown, methods, dates and references. One consolidated payment is split into allocations that add up exactly, and is counted once. | §7, tests 05, 06, e2e P-19..P-22 |
| **Day closing integration implemented** | **Yes.** Closing records what is owed and marks nothing paid. The screen shows sales, payable, payout made and outstanding as four separate numbers. Closing history does not change when payouts happen later. | §4, tests 04, 14, 16, e2e P-02..P-04 |

**What this does not do.** A payout record means an authorised user confirmed that a cash, UPI or bank payment was made, and it stores the details they entered. The app does not send money and does not verify any transfer with a bank or UPI provider; that would need a supported payment-provider integration. The receipt says so on its face.

Limits you should know about are in §11 (settlement formula still needs the owner's sign-off, the day is still not locked after closing, the installer is unsigned).

---

## 1. What was found and fixed along the way

1. **Closing dates were stored wrongly on the desktop (SQLite) database.** `daily_closings.closing_date` was saved as `2026-11-02 00:00:00`, so every lookup by the plain date `2026-11-02` missed it. On the desktop app the day never showed as closed after closing, and the payout screen could not be reached (the existing theme test had a NOTE about exactly this). Fixed: the model now stores `Y-m-d`, and the migration normalises rows written by earlier versions. The same trap was caught in the new ledger (a reversal row stored its date with a time part); fixed and asserted in test 13.
2. **The old "pay a settlement" action accepted any amount, even more than was owed.** It is now a normal ledger payout with every guard. `POST /settlements/{id}/pay` still exists for older clients but can no longer overpay. The old test `test_settlement_record_cannot_be_paid_twice` encoded the "any amount" behaviour and was updated to the new rule (an amount above the payable is refused).

## 2. Payout database schema

Migration: `backend/database/migrations/2026_11_04_150000_create_settlement_payout_ledger.php` (works on SQLite and PostgreSQL: no enums, no triggers).

**`stall_owners`**: `id, name, phone, upi_id, is_active, timestamps`. `stalls.stall_owner_id` (nullable FK) says who a stall's money is owed to; one owner can hold many stalls.

**`stall_settlement_records`** (existing; added columns): `payable_at_close` (snapshot, never changes), `adjustment_amount` (signed, audited), `net_payable` (= `stall_gross_sales + adjustment_amount`), `paid_amount`, `remaining_amount`, `payout_status`, `last_payout_at`. `paid_amount`, `remaining_amount` and `payout_status` are a cache, always recomputed from the ledger under a row lock. The old `settlement_amount` / `settlement_status` columns are kept in step for older screens.

**`settlement_payouts`** (the ledger; one row per transaction):

| Column | Meaning |
|---|---|
| `id`, `payout_number` (unique) | Unique payout ID, `PAY-000125` |
| `entry_type` | `payment` or `reversal` |
| `status` | `completed`, `failed`, or `reversed` (set on an original when it is reversed) |
| `settlement_id` | The stall settlement (FK, restrict) |
| `consolidated_payout_id` | Set when the row is one allocation of an owner payment |
| `business_date`, `stall_id`, `stall_owner_id` | Date, stall, owner at the time |
| `payable_at_time` | Net payable of the settlement when the row was written |
| `amount` | Always positive; `entry_type` gives the direction |
| `balance_after` | Outstanding balance of the settlement after this row |
| `payment_method` | `cash`, `upi`, `bank_transfer`, `other` |
| `transaction_reference` | Required for UPI and bank transfer |
| `paid_at`, `paid_by_user_id`, `received_by`, `notes` | Exact timestamp, who confirmed it, who received it |
| `failure_reason`, `reverses_payout_id`, `reversal_reason`, `reversed_at` | Failure and reversal links |
| `idempotency_key` (unique) | Duplicate-prevention reference |

**`consolidated_payouts`**: `consolidated_number` (`CPAY-000001`), `stall_owner_id`, `total_amount`, method, reference, `paid_at`, `paid_by_user_id`, `received_by`, `notes`, `status`, `idempotency_key` (unique). The allocation to each stall is the set of child `settlement_payouts` rows, so the sum of allocations is checkable against `total_amount`.

**`settlement_payout_audits`**: append-only history (`settlement_id`, `payout_id`, `consolidated_payout_id`, `action`, `user_id`, `details` JSON, `created_at`), written in the same transaction as the change it describes.

**Protection of history.** Payout rows and audit rows cannot be edited or deleted through the application: model guards throw on any change other than the reversal flag, there is no update or delete route, and foreign keys are `restrict` so a closing, stall or user that has payouts cannot be removed. Test 13c proves it. These are application-level guards; a database superuser could still alter rows (see §11).

Files: `app/Services/PayoutService.php` (all rules), `app/Http/Controllers/Api/PayoutController.php`, `StallOwnerController.php`, `app/Models/{SettlementPayout,ConsolidatedPayout,SettlementPayoutAudit,StallOwner}.php`.

## 3. Settlement calculation and status rules

```
Net Payable      = stall sales for the business day + adjustments        (adjustments default 0)
Total Paid       = sum of payment rows that are completed and not reversed
Remaining        = Net Payable - Total Paid
Status           = Pending         no completed payout
                   Partially Paid  0 < Paid < Net Payable
                   Paid            Paid = Net Payable (ledger sum equals payable exactly)
                   Nothing Due     Net Payable = 0           (no payout can be recorded)
                   Negative Balance Net Payable < 0 (adjustments exceed sales; no payout can be recorded)
```

Money is handled as decimal strings with `bcmath` (never floats) on the server, and in whole paise in the UI.

Worked examples (from the tests and the demo data):

| Stall | Net payable | Payouts | Paid | Remaining | Status |
|---|---:|---|---:|---:|---|
| Pizza Corner | 5,000.00 | cash 5,000 | 5,000.00 | 0.00 | Paid |
| Misal House | 8,000.00 | UPI 3,000 | 3,000.00 | 5,000.00 | Partially Paid |
| Biryani Point | 6,000.00 | none | 0.00 | 6,000.00 | Pending |
| Any stall | 5,000.00 | cash 2,000, UPI 2,000, bank 1,000 | 2,000 → 4,000 → 5,000 | 3,000 → 1,000 → 0 | Partially → Partially → Paid |
| Adjusted stall | 5,000 − 500 = 4,500.00 | cash 3,000 | 3,000.00 | 1,500.00 | Partially Paid (closing snapshot stays 5,000.00) |
| Zero day | 0.00 | none allowed | 0.00 | 0.00 | Nothing Due |
| Penalty day | 100 − 150 = −50.00 | none allowed | 0.00 | −50.00 | Negative Balance |

An adjustment can never take the payable below what has already been paid (reverse a payout first).

## 4. Day closing integration

Closing runs the existing code and now records, per stall, `payable_at_close = net_payable = stall sales`, `paid = 0`, status Pending (or Nothing Due for a zero day). It never marks anything paid and never creates a payout; payout confirmation is a separate action.

The Daily Closing screen (`frontend-desktop/src/pages/SettlementsPage.tsx`) shows, after closing, four separate figures: **Sales calculated**, **Settlement payable** (with the amount at closing), **Payout actually made**, **Outstanding balance**. Each stall row shows Total Sales, Net Payable, Paid, Remaining, a status badge (Pending / Partially Paid / Paid), **View Payout History** and **Record Payout**. A business-date picker opens any past day.

The closing record is unchanged by later payouts: `payable_at_close`, `stall_gross_sales` and the day totals never move; only the paid / remaining / status cache moves, and an adjustment shows as "adjusted from ₹X" (test 16, e2e P-26).

Screenshots (real Electron app, built-in SQLite server, fresh profile): `qa/desktop/results/payouts/`
- `01-before-closing.png`: sales visible, "Not closed yet", no payout action
- `02-day-closed-all-pending.png`: closed, every stall Pending, four separate numbers
- `03-record-payout-modal.png`: settlement breakdown, amount, method, reference
- `04-payout-receipt.png`: payout receipt
- `05-paid-partial-pending.png`: one Paid, one Partially Paid, others Pending

## 5. Payout history

Inside Daily Closing → **Payout History**: filters for business date, date range (from / to), stall, stall owner, payment method, payout status (Completed / Reversed / Failed / Reversal entries) and a search on payout number or reference. Columns: Payout ID, Business Date, Stall, Owner, Net Payable, Amount, Method, Reference, Paid At, Paid By, Status. The total shown is completed payments only, so reversals and failures never inflate it. **Open** shows every field, the consolidated payment the row belongs to, any reversal, a receipt, and the complete audit history. There is no edit or delete control for a recorded payout.

Screenshots: `06-stall-payout-history.png`, `07-reversal-ledger.png`, `08-payout-history-filtered.png`, `09-payout-detail-audit.png`.

## 6. Safety rules and where they are enforced

| Rule | How |
|---|---|
| Payout never exceeds the outstanding balance | Recomputed from the ledger inside the transaction under `SELECT … FOR UPDATE` on the settlement row; refusal text states the balance |
| Duplicate request creates no second payout | `idempotency_key` is mandatory (the form keeps one key for its lifetime); same key + same request returns the first payout with `duplicate: true`; same key + different amount is a 409 |
| Concurrent requests | Database transaction + row locks, lock order owner → settlements (ascending id) → payout rows, so no deadlock; proven with real parallel processes (§9, tests 12a-c) |
| Failed payouts do not reduce the balance | A `failed` row is recorded for the audit trail but is not summed |
| Reversals are audited records | Original stays and is flagged `reversed`; a `reversal` row mirrors it; audit entries added; balance restored; cannot be reversed twice; a reversal cannot itself be reversed |
| Never delete history | Model guards, no routes, restrict foreign keys |
| Corrections preserve the original | Reversal + new payout, or an audited adjustment |
| Reconcile payouts with settlement balances | `GET /settlements/reconciliation` and the Reconciliation tab (§10) |
| Only an authorised user records a payout | Owner role only (cashiers get 403 on every payout, history, owner and reconciliation endpoint; test `only_the_owner_can_see_or_change_payouts`) |
| UPI / bank transfer must carry a reference | Server and form both refuse without one |

## 7. Owner-wise consolidated payout

`Daily Closing → Owner-wise Payouts` shows, per owner: total payable, total paid, total outstanding, the per-stall breakdown, payment methods used, and every payout with its date and reference. Totals come from the settlement registers, so a consolidated payment is counted once.

**Record consolidated payout** takes one total and splits it into allocations (by hand, or "Allocate oldest first"). The server requires: every allocation > 0 and within that stall's balance, every settlement belongs to that owner, no settlement twice, and **allocations add up exactly to the payment**. Each allocation becomes its own ledger row linked to the `CPAY-` record, so no stall is credited with the whole payment. A consolidated payment is reversed as a whole (all allocations at once); reversing one stall's share on its own is refused.

Evidence (`SettlementPayoutTest::test_06*`, and the real app run, e2e P-19..P-22):
- Five stalls of one owner (sales 1,000 / 1,200 / 1,400 / 1,600 / 1,800): payable ₹7,000.00 with a per-stall breakdown.
- One ₹3,500 bank transfer allocated Dosa 1,000 + Chaat 1,200 + Kebab 1,300 = 3,500. Owner paid = ₹3,500.00 (not 5 × 3,500); the grand total of all owners counts it once.
- Allocations of ₹1,000 against a ₹3,500 payment were refused with "must match exactly".
- Screenshots: `10-owner-wise-before.png`, `11-consolidated-allocation.png`, `12-owner-wise-after-consolidated.png`.

Example consolidated record from the demo data: `CPAY-000001`, bank transfer `NEFT-ANAND-2026110201`, total 10,300.00 = 5 allocations (2,200 + 1,700 + 3,000 + 1,400 + 2,000).

## 8. Example payout transaction records

From the demo database (`foodcourt:seed-payout-demo`, run through the real closing and payout code):

| Payout ID | Type | Status | Business date | Stall | Payable then | Amount | Balance after | Method | Reference | Notes |
|---|---|---|---|---|---:|---:|---:|---|---|---|
| PAY-000001 | payment | completed | 2026-11-02 | Pizza Corner | 4,800.00 | 4,800.00 | 0.00 | cash | | full payment |
| PAY-000002 | payment | completed | 2026-11-02 | Misal House | 6,500.00 | 2,500.00 | 4,000.00 | cash | | 1st of 3 |
| PAY-000003 | payment | completed | 2026-11-02 | Misal House | 6,500.00 | 2,000.00 | 2,000.00 | upi | UPI4455667788 | 2nd of 3 |
| PAY-000004 | payment | completed | 2026-11-02 | Misal House | 6,500.00 | 2,000.00 | 0.00 | bank_transfer | NEFT-SBIN-2026110201 | 3rd, now Paid |
| PAY-000005 | payment | **reversed** | 2026-11-02 | Biryani Point | 5,100.00 | 5,100.00 | 0.00 | upi | UPI-WRONG-ACCT-01 | wrong UPI ID |
| PAY-000006 | **reversal** | completed | 2026-11-02 | Biryani Point | 5,100.00 | 5,100.00 | 5,100.00 | upi | UPI-WRONG-ACCT-01 | reverses PAY-000005 |
| PAY-000007 | payment | completed | 2026-11-02 | Biryani Point | 5,100.00 | 5,100.00 | 0.00 | bank_transfer | IMPS-HDFC-9988776655 | re-paid correctly |
| PAY-000009…13 | payment | completed | 2026-11-02 | five stalls of one owner | 2,200 / 1,700 / 3,000 / 1,400 / 2,000 | same | 0.00 | bank_transfer | NEFT-ANAND-2026110201 | allocations of `CPAY-000001` |

The demo data also contains a failed attempt (UPI timed out, no money moved) and a part payment to an owner allocated oldest-first.

## 9. Tests: exact commands and actual results

Every payout test builds its own stalls, owners and far-future business dates; the in-process tests roll back, the process tests commit and delete what they created.

```bash
cd backend
php vendor/bin/phpunit tests/Feature/SettlementPayoutTest.php tests/Feature/SettlementPayoutProcessTest.php
```
Result: **27 tests, 335 assertions, 0 failures** (PostgreSQL `foodcourt_test_db`).

```bash
# same payout tests against the desktop database engine (SQLite, migrated + demo-seeded copy)
DB_CONNECTION=sqlite DB_DATABASE=<copy of demo.sqlite> DB_FOREIGN_KEYS=true php vendor/bin/phpunit tests/Feature/SettlementPayoutTest.php
```
Result: **23 tests, 249 assertions, 0 failures.** (The 4 process tests spawn parallel PHP processes against PostgreSQL row locks and are not run on SQLite, which the desktop runs as a single PHP process.)

```bash
cd backend && php vendor/bin/phpunit            # whole backend suite
```
Result: **255 tests, 9,027 assertions, 0 failures.**

```bash
cd frontend-desktop
npx tsc --noEmit                                 # exit 0
node --test "tests/**/*.test.ts"                 # 206 tests, 0 failures (includes tests/payout.test.ts: 8)
node e2e/settlement-payout.e2e.mjs               # real Electron app + built-in SQLite server: 33/33 checks
node e2e/demo-installer.e2e.mjs                  # the packaged demo build: 9/9 checks
node e2e/gst-config.e2e.mjs                      # 27 PASS, 0 FAIL (closing GST card unchanged)
node e2e/theme.e2e.mjs                           # 181 PASS, 0 FAIL (the payout modal is now reachable and checked in both themes)
```

### The 16 mandatory scenarios

| # | Scenario | Test(s) | Result |
|---|---|---|---|
| 1 | ₹5,000 payable, ₹5,000 paid in cash | `test_01_full_cash_payout…`; e2e P-06, P-07 | PASS |
| 2 | ₹5,000 payable, ₹3,000 paid, ₹2,000 pending | `test_02_partial_payout…`; e2e P-09 | PASS |
| 3 | ₹5,000 paid in three transactions | `test_03_three_separate_transactions…`; e2e P-12 | PASS |
| 4 | One stall paid, another unpaid | `test_04_one_stall_paid…` (Paid / Partially Paid / Pending, four-number summary); e2e P-10 | PASS |
| 5 | Five stalls of one owner | `test_05_five_stalls_of_one_owner…`; e2e P-19 | PASS |
| 6 | Consolidated owner payout allocated across stalls | `test_06`, `06b` (auto, oldest first), `06c` (reversal); e2e P-20..P-22 | PASS |
| 7 | Cash payout | `test_01`, `test_08_09` (cash/other need no reference) | PASS |
| 8 | UPI with transaction reference | `test_03`, `test_08_09`; e2e P-08 | PASS |
| 9 | Bank transfer with transaction reference | `test_03`, `test_08_09`; e2e P-12a | PASS |
| 10 | Duplicate submission | `test_10`, `test_10b`, `test_12c`; e2e P-13 | PASS |
| 11 | Overpayment attempt | `test_11`; e2e P-11 (form and server) | PASS |
| 12 | Concurrent payout requests | `SettlementPayoutProcessTest::test_12a/12b/12c` (below) | PASS |
| 13 | Reversed payout | `test_13`, `13b` (failed attempt), `13c` (immutability); e2e P-14, P-15 | PASS |
| 14 | Day closing done, payout not made | `test_14_day_closing_records_what_is_owed…`; e2e P-03, P-04 | PASS |
| 15 | Application restart, then history check | `test_15` (cold PHP process); e2e P-24, P-25 (Electron closed and relaunched on the same profile); `demo-installer` D-08 | PASS |
| 16 | Historical dates and payout records stay accurate | `test_16_historical_dates…`; e2e P-26 | PASS |

Concurrency detail (separate PHP processes, separate DB connections, one barrier): 6 workers each paying ₹3,000 against ₹5,000 → exactly **1** succeeded, 5 refused, paid = ₹3,000.00. 11 workers each paying ₹500 against ₹5,000 → exactly **10** succeeded, 1 refused, settlement Paid at exactly ₹5,000.00 with 10 distinct payout numbers. 6 workers sending the **same** key → 6 successes, 1 payout row.

## 10. Reconciliation: payable = paid + outstanding

`PayoutService::reconcile()` (API `GET /settlements/reconciliation`, UI tab "Reconciliation") checks, per settlement: `net_payable = sales + adjustments`; cached `paid_amount` = ledger sum; `remaining = payable − paid`; status equals the derived status; no overpayment; **a PAID settlement's ledger sum equals its payable exactly**; the closing snapshot equals the recorded sales. It also checks that every reversal row mirrors exactly one reversed original, that every consolidated payment's allocations sum to its total, and the grand identity **payable = paid + outstanding**. A test edits the cache directly in the database and reconciliation flags it.

| Run | Settlements | Payable | Paid | Outstanding | Discrepancies |
|---|---:|---:|---:|---:|---:|
| Test: two stalls (5,000 paid; 8,000 with 3,000 paid) | 2 | 13,000.00 | 8,000.00 | 5,000.00 | 0 |
| Electron run after all scenarios (incl. a reversal, duplicates, a consolidated payout) | 8 | 26,000.00 | 17,500.00 | 8,500.00 | 0 |
| Demo database as shipped | 27 | 94,600.00 | 52,000.00 | 42,600.00 | 0 |

Screenshot: `13-reconciliation.png`.

## 11. Limits and open items (not hidden)

1. **Settlement formula.** The earlier documents list the settlement formula as an unconfirmed owner decision (OPEN-14 / L-07). This build uses "payable = the stall's sales for the day", which matches the requirement's examples, and provides audited adjustments for any deduction. Whether commission, GST or bill-level discounts should reduce what a stall is owed still needs the owner's decision; if so, the rule changes in one place (day closing) and adjustments cover the interim.
2. **The day is not locked after closing (OPEN-01, unchanged).** A bill paid after closing is not in that day's settlement. Out of scope here.
3. **Ledger immutability is enforced by the application,** not by the database. A database superuser can still change rows (same gap as OPEN-06 for payments and audit logs). Revoking UPDATE/DELETE for the application role would close it.
4. **Authorised user = the Owner role.** There is no separate "accountant" role.
5. **`paid_at` can be backdated** by the confirming user (never into the future); the audit trail records when the entry was actually made.
6. **No electronic verification** of any payout (see the verdict).
7. **The installer is unsigned** (SmartScreen will warn). The NSIS installer itself was built but not run on this PC (it would replace the registered desktop app); the packaged `win-unpacked` executable was launched and verified instead.

## 12. Dummy-data installer

`frontend-desktop/installers/1.2.0/Multi-Stall-Food-Court-DEMO-Setup-1.2.0.exe` (copy in `release/windows/`), 135,822,967 bytes, SHA-256 `bd54b7fed56295815d1e8bba72e05d78bf8b2a777155e4cae0064d18eee3c11c`.

It is the normal desktop app plus a ready-made database, installed once on the first start when the PC has no database (never over an existing one):
- Food court "Mangalmurti Food Court (DEMO DATA)", 9 stalls, 4 owners (one holds five stalls), menus, ~4 days of paid sales.
- Day closings for the last three days (run through the real closing code); a fourth day (three days ago) is left **unclosed** so closing can be tried live.
- Today's date shows the requirement's scenario exactly: Pizza Corner ₹5,000 Paid, Misal House ₹8,000 Partially Paid (₹3,000), Biryani Point ₹6,000 Pending.
- Payout history with multi-transaction stalls, UPI and bank references, a reversed payout, a failed attempt, and consolidated owner payouts.
- Sign in: `owner@foodcourt.com` / `password123` (demo accounts only; a cashier `cashier@foodcourt.com` / `password123` also exists). Never use this build for a real business; the clean installer is unchanged and ships no demo file.

Rebuild: `FOODCOURT_DEMO_DATA=1 node scripts/prepare-embedded-server.mjs` then `npx electron-builder --win --x64 "--config.win.artifactName=Multi-Stall-Food-Court-DEMO-Setup-${version}.${ext}"` (or `pnpm dist:win:demo`). Without `FOODCOURT_DEMO_DATA=1` the same scripts build the clean installer.

Verification of the packaged build (`node e2e/demo-installer.e2e.mjs`, launches the packaged `win-unpacked` executable on a brand-new profile): **9/9 checks** passed: the demo database is shipped, first start goes straight to Login (no Welcome), the demo owner signs in, today's scenario is exact, the ledger holds every demo case, owner-wise view shows the five-stall owner, reconciliation has 0 discrepancies, the unclosed day offers closing, and after making a real payout and restarting, the payout is still there (the demo database is not re-installed). Screenshots: `qa/desktop/results/demo/`. Machine-readable results: `qa/desktop/results/settlement-payout-results.json`, `qa/desktop/results/demo-installer-results.json`.
