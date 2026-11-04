# Dynamic GST configuration - implementation report

Date: 2026-11-04 · Scope: Laravel backend, Electron desktop client, customer QR menu · Nothing committed, pushed or packaged (no installer built).

## Verdict

GST is now fully controlled from **Food Court Settings -> Tax & GST Settings**. Changing the rate (for example 5% -> 12%) changes every new bill, its payment amount, UPI QR amount and receipt; bills that already exist keep the rate and mode they were created with.
All requested test cases pass (section 8). No fixed GST rate remains in application code (section 2).

---

## 1. Settings added (Tax & GST Settings)

| Field | Behaviour |
|---|---|
| Enable GST | On/off. Off = no GST is added to any bill. |
| GST Rate (%) | Numeric, 0 to 40, at most 2 decimals. Validated in the form **and** on the backend (negative, text, empty, scientific notation, 3 decimals, > 40 are refused with 422). |
| GST Calculation Type | **Exclusive** (added on top of item prices) or **Inclusive** (already inside item prices). |
| Apply GST To | **All Items** only. "Individual Items" is shown disabled: menu items have no tax setting of their own, so item-level GST is not supported (requirement: only if existing item-level tax configuration supports it). |

Stored in the existing `settings` table (key `tax`: `enabled`, `rate_percent`, `mode`, `apply_to`); owner-only write (cashier 403); every change is recorded by the existing `settings_updated` audit entry with old and new values. A live example under the form shows the effect on a Rs 100 item total.

Installations that never opened the setting keep exactly the behaviour they had (GST on, 5%, exclusive); that default is the only place a rate value is stored in code.

## 2. Audit of hardcoded GST (before the change)

| Where | What was hardcoded | Now |
|---|---|---|
| `backend/.../OrderController.php` `persistOrder` | `bcmul($subtotal, '0.05', 2)` - the only calculation in the backend | `TaxService::calculate()` from saved settings |
| `backend/.../SettingsController.php` | read-only `tax` block: `'5.00'`, "Fixed 5% GST" note, `editable:false` | editable `tax` setting (above) + public read-only `GET /public/tax` for the QR menu |
| `frontend-desktop/.../PosPage.tsx` | `Number(settings.tax.rate_percent)/100`, label "GST (5%, est.)" | `calculateTax()` + `taxLines()` from the same settings |
| `frontend-desktop/.../Receipt.tsx` | generic "Tax" row | `receiptTaxLines(order)` from the bill's own snapshot |
| `frontend-desktop/.../OrdersPage.tsx` | "Subtotal / Tax" rows | same `taxLines(order)` |
| `frontend-desktop/.../SettlementsPage.tsx` | "Includes 5% GST" text | "Includes GST Rs X as billed" (summed from bills) |
| `frontend-desktop/.../FoodCourtSettingsPage.tsx` | read-only Tax card "5.00% ... not editable" | editable Tax & GST card |
| `frontend-desktop/.../WaiterPage.tsx` | label "Items (before tax)" (wrong for inclusive) | "Items total"; the server prices the bill |
| `frontend-customer/.../QrMenuPage.tsx` | `subtotal * 0.05`, label "GST (5%)" | fetches `/public/tax`, same rules |
| `frontend-customer/.../OrderTrackPage.tsx` | label "GST (5%)" | `taxLines(order)` from the order |

Everything else only *reads stored order amounts* (payments, receipts, history, daily closing, reports), so it needed no calculation change. The mobile app has no tax code.
A final search of `backend/app`, `backend/routes`, `backend/config`, `frontend-desktop/src`, `frontend-customer/src` finds no rate other than the settings default above. The migration also writes `5.00` once to label historical bills (section 4).

## 3. One calculation service

`backend/app/Services/TaxService.php` is the only code that multiplies by a rate.

- **Exclusive:** `GST = items x rate / 100`; `total = items + GST`; stored `subtotal` = items.
- **Inclusive:** `GST = items x rate / (100 + rate)`; `total = items` (GST is never added again); stored `subtotal` = items - GST (the taxable value).
- **Disabled:** no GST, `total = items`.
- Integer paise arithmetic, **round half up once on the whole bill**, so there is no floating point or bcmath-scale drift. `subtotal + tax_amount = total_amount` in every mode. (The old code truncated with `bcmul`; half-up is the normal GST rounding rule and gives identical results for typical prices.)

The desktop and QR-menu estimate (`src/lib/tax.ts`) implements the same rules. It is not trusted for money: the server prices every real bill and refuses a payment whose amount differs from the stored total (tested: a client still using the old 5% amount is refused with 422). Both implementations are tested against the **same 20 vectors** (`qa/tax-vectors.json`, generated independently with Python `Decimal`), and the customer app's copy of `tax.ts` is asserted byte-identical to the desktop's, so they cannot drift.

## 4. Database and historical snapshot

Migration `2026_11_04_120000_add_tax_snapshot_to_orders`: adds `orders.tax_rate_percent` (decimal 5,2) and `orders.tax_mode` (`exclusive | inclusive | none`).
- Every new order stores the rate and mode it was priced with, together with `subtotal`, `tax_amount`, `total_amount`.
- Bills that existed before the migration were all priced with the old fixed 5% exclusive rule, so those that carry tax are back-filled with `5.00 / exclusive` (a record of what happened to them), and those without tax with `none`. Verified on a throwaway SQLite database: a pre-migration bill with GST became `5 / exclusive`, one without became `0 / none`.
- Receipts, Orders detail, payment history, daily closing and reports read these stored values, never the current setting - changing the configuration cannot alter an existing bill or report (tested, section 8).

## 5. Where the same configuration is used

| Screen / flow | How |
|---|---|
| Cashier POS, New Order, Order Summary | cart lines from `calculateTax` + `taxLines` (same labels as the bill: "GST (12%)", "Subtotal (including GST)", "GST Included (5%)") |
| Payment modal, Cash, Card POS, Split | modal total = stored order total; `/billing/pay` requires `amount` to equal it |
| UPI QR amount | QR `am` and the panel amount come from the stored GST-inclusive total (tested at 18%) |
| Receipt / reprint (80 mm and 58 mm) | lines from the bill's snapshot; never a fixed 5% |
| Orders & Receipts, Payment History | same stored values |
| Daily Closing | gross sales = taxable subtotal, net sales = total, new **GST collected as billed** = sum of stored taxes |
| Reports / Sales summary | per-day `paid_subtotal`, `paid_tax`, `paid_total` from stored values (column renamed "GST") |
| Customer QR menu | fetches `/public/tax`; the order tracking page shows the order's own rate |
| Kitchen billing | kitchen tickets carry no money; nothing to change |

## 6. Receipt output

Exclusive (screenshot `qa/desktop/results/gst/receipt-80mm-12pct-exclusive.png`, 58 mm variant alongside):
```
Subtotal 100.00 · GST (12%) 12.00 · TOTAL 112.00
```
Inclusive (`receipt-80mm-5pct-inclusive.png`):
```
Subtotal (including GST) 105.00 · GST Included (5%) 5.00 · TOTAL 105.00
```
GST disabled: only Subtotal and TOTAL, no percentage (`receipt-80mm-gst-disabled.png`).

## 7. Modified and added files

Backend - modified: `app/Http/Controllers/Api/{OrderController,SettingsController,SettlementController}.php`, `app/Models/Order.php`, `routes/api.php`; added: `app/Services/TaxService.php`, `database/migrations/2026_11_04_120000_add_tax_snapshot_to_orders.php`, `tests/Feature/GstConfigurationTest.php`; updated: `tests/Feature/MasterModulesTest.php` (tax is now owner-editable).

Desktop - modified: `src/context/SettingsContext.tsx`, `src/components/Receipt.tsx`, `src/lib/receiptModel.ts`, `src/pages/{PosPage,FoodCourtSettingsPage,OrdersPage,SettlementsPage,ReportsPage,WaiterPage}.tsx`; added: `src/lib/tax.ts`, `tests/tax.test.ts`, `e2e/gst-config.e2e.mjs`.

Customer QR menu - modified: `src/pages/{QrMenuPage,OrderTrackPage}.tsx`; added: `src/lib/tax.ts` (identical copy), `tests/tax.test.ts`.

Shared: `qa/tax-vectors.json`. Evidence: `qa/desktop/results/gst/*`, `qa/desktop/results/gst-config-results.json`.

## 8. Test evidence

Required cases and where they are proven:

| # | Case | Proof |
|---|---|---|
| 1 | GST disabled | vectors (2), `GstConfigurationTest` "GST disabled", E2E G-17/G-18 |
| 2-4 | 5% / 12% / 18% | vectors, order scenarios, E2E G-06 (12%), G-11 (18%) |
| 5 | Exclusive | vectors, order scenarios, E2E G-06..G-10 |
| 6 | Inclusive | vectors, order scenarios (incl. rounding 100 @5% -> 4.76), E2E G-15/G-16 |
| 7 | Rate changed after earlier bills | `test_changing_the_rate_affects_only_new_bills...`, E2E G-19, G-23 |
| 8 | Cash, UPI, Card POS, Split | `test_every_payment_method_settles...` (4 methods + stale-5% refusal), E2E: cash G-08, UPI G-12..G-14, card G-15/16, split G-17/18 |
| 9 | Receipts 80 mm and 58 mm | E2E G-09/G-10 (printed 72 mm / 48 mm wide, no overflow), G-16 |
| 10 | Daily closing, reports | `test_daily_summary_reports_the_gst_collected...`, E2E G-20..G-22 (GST 35.00 = 12 + 18 + 5 + 0, net 435.00, taxable 400.00) |

Commands and results:
```
php artisan test --filter=GstConfigurationTest   -> 30 passed (293 assertions)
php artisan test                                  -> 210 passed, 0 failed (3040 assertions)
node --test tests/**/*.test.ts  (desktop)         -> 186 passed, 0 failed
node --test tests/**/*.test.ts  (customer)        -> 15 tests: 13 passed, 0 failed, 2 skipped (live staging tests need STAGING_API)
npx tsc --noEmit (desktop, customer)              -> no errors
pnpm prepare:server && pnpm build                 -> ok (no installer)
node e2e/gst-config.e2e.mjs                       -> 26 PASS, 0 FAIL
node e2e/upi-qr.e2e.mjs                         -> 32 PASS, 0 FAIL   (regression)
node e2e/order-tracking.e2e.mjs                  -> 20 PASS, 0 FAIL   (regression)
node e2e/theme.e2e.mjs                           -> 176 PASS, 0 FAIL  (regression)
node e2e/ui-first-run.e2e.mjs                    -> 27 PASS, 0 FAIL   (regression)
```
Written test-first: the backend tests failed on the missing `TaxService`/`tax` setting and the desktop and customer tests on the missing `tax.ts` before any implementation.

## 9. Limitations and notes

- **Item-level GST is not available:** menu items have no tax field. Adding one (and per-line tax on bills) is a separate change; the setting is fixed to "All Items" and the UI says why.
- **Stall-wise sales in inclusive mode:** per-stall figures (daily closing stall breakdown, stall sales) are sums of line prices as sold. In inclusive mode that line price already contains GST. The order-level figures (gross = taxable, GST collected, net) are correct; deciding how stall settlements treat GST is the still-unresolved owner decision already noted in the settlement code, and no settlement rule was changed.
- **Rounding:** now half-up on the whole bill (previously truncation). Existing stored bills are not recalculated.
- **Rate limit:** the backend accepts 0-40% (highest GST slab incl. cess). Raise `TaxService::MAX_RATE_PERCENT` if ever needed.
- **QR menu estimate** shows no GST until `/public/tax` answers; the order the server creates is always correct.
- `e2e/electron-workflow.e2e.mjs` needs a packaged `.exe`, so it was not run (no installer was built).
- `e2e/theme.e2e.mjs`: its "settle total" check looked for the exact label `Total Bill Amount:`; the colon had been removed from `PosPage.tsx` by an edit outside this task, so the selector now accepts the label with or without the colon (test-only change).
