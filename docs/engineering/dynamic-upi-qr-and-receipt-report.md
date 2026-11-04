# Dynamic UPI QR payment and business-branded receipts - implementation report

Date: 2026-11-04 · Scope: Laravel backend + Electron/React desktop client · Nothing committed, pushed or packaged (no installer was built).

## Final verdict: IMPLEMENTED WITH PAYMENT VERIFICATION PENDING

Everything requested is implemented and passes its tests. The verdict is not "IMPLEMENTED AND VERIFIED" because the
system has **no payment gateway / bank integration**, so a UPI payment cannot be confirmed automatically. The QR is a
payment *request*; the bill stays unpaid until a cashier verifies the credit in the merchant UPI app / bank statement
and records the bank reference (UTR). See [section 7](#7-payment-verification-limitations).

Also not verified: scanning the QR with a real Google Pay / PhonePe / Paytm / BHIM app and printing on a physical
58 mm / 80 mm thermal printer (no phone or printer was available). The QR was decoded with an independent decoder instead
(section 9).

---

## 1. Files inspected

Backend: `routes/api.php`, `app/Http/Controllers/Api/{SettingsController,BillingController,OrderController}.php`,
`app/Models/{Setting,Payment,Order}.php`, `app/Observers/PaymentObserver.php`, `app/Services/AuditService.php`,
`app/Support/Sql.php`, `database/migrations/*` (payments, settings, audit), `phpunit.xml`, `tests/Feature/{BillingPaymentTest,ItemFulfillmentTest,SecurityAuditTest}.php`.

Desktop: `src/components/Receipt.tsx`, `src/context/SettingsContext.tsx`, `src/pages/{FoodCourtSettingsPage,PosPage,OrdersPage,PaymentsPage,SettingsPage}.tsx`,
`src/desktop/bridge.ts`, `src/index.css` (print rules), `electron/main.cjs` (`desktop:print` IPC), `tests/theme-guard.test.ts`,
`e2e/{order-tracking,theme}.e2e.mjs`, `scripts/prepare-embedded-server.mjs`, `package.json`, `tsconfig.json`.

Findings that shaped the design:
- The Business Profile name was already printed on the receipt (`profile.name || 'Food Court'`); it is now produced by one tested function and also feeds the new preview.
- `upi_qr` already existed as a payment method but was a plain button: no UPI ID, no QR, no verification.
- There is **no payment gateway**: `/billing/pay` records whatever the cashier submits. Nothing receives callbacks from a bank/PSP.
- Receipts were 80 mm only (`@page 80mm`); there was no 58 mm layout and no on-screen receipt preview.
- Settings live in the `settings` key/value table (JSON), owner-only writes, audited as `settings_updated`.

## 2. Exact files modified / added

Modified:
- `backend/app/Http/Controllers/Api/SettingsController.php` - new `upi` setting (defaults, read, owner-only validated write)
- `backend/app/Http/Controllers/Api/BillingController.php` - UPI request endpoint, verified UPI payment, receipt `upi` data
- `backend/app/Http/Controllers/Api/OrderController.php` - cancelling an order cancels its pending UPI requests
- `backend/routes/api.php` - `POST /billing/orders/{orderId}/upi-request`
- `frontend-desktop/src/components/Receipt.tsx` - header from Business Profile, UPI section, 58/80 mm, preview, shared data loader
- `frontend-desktop/src/context/SettingsContext.tsx` - `upi` settings type/fallback
- `frontend-desktop/src/desktop/bridge.ts` - per-PC receipt paper width (58/80)
- `frontend-desktop/src/index.css` - 58 mm print rules, QR never split/clipped
- `frontend-desktop/src/pages/FoodCourtSettingsPage.tsx` - "UPI QR payments" card
- `frontend-desktop/src/pages/PosPage.tsx` - UPI QR panel, verification workflow, Preview button
- `frontend-desktop/src/pages/OrdersPage.tsx`, `PaymentsPage.tsx` - Preview button next to print/reprint
- `frontend-desktop/src/pages/SettingsPage.tsx` - "Receipt paper width on this computer"

Added:
- `backend/app/Services/UpiPaymentService.php`, `backend/app/Models/UpiPaymentRequest.php`
- `backend/database/migrations/2026_11_04_090000_create_upi_payment_requests_table.php`
- `backend/tests/Feature/UpiQrPaymentTest.php`
- `frontend-desktop/src/lib/qr.ts` (dependency-free QR encoder), `src/lib/receiptModel.ts`, `src/components/UpiQr.tsx`
- `frontend-desktop/tests/qr.test.ts`, `tests/receiptModel.test.ts`, `e2e/upi-qr.e2e.mjs`
- `qa/desktop/upi-qr-decode.mjs`, evidence in `qa/desktop/results/upi/` and `qa/desktop/results/upi-qr-*.json`

`frontend-desktop/src/components/ui.tsx` and `RecoverOwnerPage.tsx` were already modified before this task and were not touched.

## 3. Database migration

`2026_11_04_090000_create_upi_payment_requests_table` (works on PostgreSQL and the desktop's SQLite; verified on both):
- Table `upi_payment_requests`: `order_id`, unique `reference`, `vpa`, `payee_name`, `amount`, `upi_uri`, `status` (`pending | paid | superseded | cancelled`), unique nullable `payment_id`, `created_by_user_id`. It snapshots the UPI ID/amount/reference that went into each QR.
- Partial unique index `payments_upi_reference_unique` on `payments(transaction_reference)` for `payment_method='upi_qr'`: one bank reference can settle only one payment, even under concurrent requests.

The PHPUnit database (`foodcourt_test_db`, persistent) had to be migrated once: `php artisan migrate` with the testing DB env.

## 4. Business Profile integration

`receiptHeader()` (`src/lib/receiptModel.ts`) builds the header from the saved profile fetched with the receipt:
business name (upper-cased, trimmed; blank/missing -> `FOOD COURT`), then address, `Tel:`, `GSTIN:` and the owner's header line,
each **only if configured** (GSTIN additionally requires the existing "Print GSTIN on receipts" switch). Used by print, preview, history reprint and both paper widths.
Nothing is hard-coded: the name is read at print time, so a renamed business prints the new name on the next receipt.

Note: reprints use the *current* profile for the header (transaction data - items, totals, payment, UPI ID/reference - always comes from the stored order/request). Historical receipt records are not rewritten.

## 5. UPI settings implementation

- Setting key `upi` = `{enabled, vpa}`, stored in the existing `settings` table; read by any signed-in user (the QR needs it; a UPI ID is printed on every bill), **written by the owner only** (403 for cashier/kitchen/others).
- Backend validation (not only React): `vpa` must match `name@handle` with a safe alphabet (no `&`, `?`, `=`, `#`, spaces, scheme, second `@`; <=256 chars); stored lower-case/trimmed; `enabled` without a UPI ID is refused; `enabled` while the "UPI / QR" payment method is off is refused with a clear message. Provider-neutral (no fixed list of handles).
- Change is audited via the existing `settings_updated` audit entry (old and new values).
- UI (Food Court Settings -> "UPI QR payments"): UPI ID input, enable toggle, Save, live format/missing messages, success/error banners.
- Disabled or missing UPI ID: the server refuses to create a QR with a clear message, the POS shows "UPI QR is not set up", the receipt omits the QR section.

## 6. Dynamic QR generation method

Server (`UpiPaymentService::buildUri`): `upi://pay?pa={VPA}&pn={NAME}&am={AMOUNT}&cu=INR&tn={REFERENCE}`
- `pa` = configured UPI ID (the only `@` left literal); `pn` = Business Profile name (control characters stripped, 50 chars); `am` = the order's stored `total_amount` to 2 decimals - the already-computed final payable amount after tax/discount, **never taken from the client and the billing maths is untouched**; `cu` = INR; `tn` = unique reference.
- Every value is percent-encoded (RFC 3986); injection attempts (`&pa=...`, `#`, newlines) cannot add or override parameters (tested).
- Reference = the order number (`ORD-20261104-ABCDE`), unique per order; `-2`, `-3`... if a new QR is needed after the UPI ID changes. Repeat requests for the same bill/UPI ID/amount return the same request (idempotent).
- `POST /billing/orders/{id}/upi-request` creates/returns the request (owner/cashier only; refuses cancelled, paid or non-positive bills).
- A UPI ID change supersedes pending requests; they can no longer confirm a payment. Cancelling an order cancels its pending requests.

Client: `src/lib/qr.ts` is a small, dependency-free QR encoder (byte mode, ECC level M, versions 1-14). No new package was added. It renders as vector SVG (black on white, 4-module quiet zone, square, `crispEdges`, module = whole printer dots on 203 dpi). The receipt rebuilds the payload from the stored request (UPI ID, name, amount, reference) so it always equals what the server recorded.

Receipt section (when UPI is on, or the bill was paid by UPI): `SCAN TO PAY USING UPI` + QR + `UPI ID:` + `Amount: ₹200.00` + `Ref:`.
A **paid** UPI bill reprints its original request labelled `PAID VIA UPI - PAYMENT RECORD` (original UPI ID/amount/reference, even if the UPI ID was changed or UPI was switched off later; and never another order's data).

## 7. Payment verification limitations

A generated QR is a payment request, not proof of payment. Implemented behaviour (no gateway exists):
1. Generating, showing, printing or scanning a QR never changes an order's status; it stays `unpaid` (tested).
2. With UPI QR configured, `/billing/pay` with `upi_qr` requires **all** of: the QR's `upi_reference` (a pending request of *that* order, same amount, same current UPI ID), the bank `transaction_reference` (UTR, 6-40 letters/digits, unique across UPI payments) and `payment_verified=true`. The POS shows "Payment is still PENDING" and keeps Confirm disabled until the cashier enters the UTR and ticks "I have verified that ₹X was received".
3. The order row is locked, the amount must equal the server total, the order must not be paid/cancelled, the request is closed (`paid`, linked to the payment) in the same transaction, and `upi_payment_confirmed` is written to the audit log (reference, UPI ID, amount, UTR, verifying user).
4. Replays/duplicates: a second confirmation hits "already paid"; the same UTR on another order is refused (code check + DB unique index); superseded/cancelled/other-order references are refused.

What this cannot do: nothing checks the bank. The cashier's attestation and UTR are trusted, exactly as the existing cash/card flows trust the cashier. **Automatic confirmation requires a real integration**: a UPI-capable payment gateway/PSP (e.g. a merchant account with dynamic-QR/collect APIs and signed webhooks) that returns the transaction status per `tn`/order reference. Its webhook handler would call the same confirmation step (validate signature, merchant, order reference and amount; idempotent on the gateway transaction id) instead of the manual attestation. No unofficial bank APIs or app scraping are used.

Where UPI QR is *not* configured/enabled, `upi_qr` keeps its previous manual behaviour so existing installations are not broken (cash, card and split are unchanged).

## 8. Receipt preview and print screenshots

All in `qa/desktop/results/upi/` (captured from the real Electron app):
- `settings-upi-before-save.png`, `settings-upi-saved.png` - Food Court Settings
- `preview-80mm-unpaid.png`, `preview-58mm-unpaid.png` - on-screen preview with the scan-to-pay QR
- `pos-upi-panel-pending.png` - POS QR panel, payment pending
- `print-80mm-paid.png`, `print-58mm-paid.png` (+ `.pdf`) - print output, paid UPI bill
- `print-80mm-unpaid-new-upi-id.png` - unpaid bill after the UPI ID changed
- `reprint-from-history.png`, `reprint-after-upi-change.png` - history reprint (original data)
- `preview-80mm-upi-disabled.png`, `pos-upi-disabled.png` - UPI disabled: no QR

## 9. 58 mm / 80 mm results

| Check | 80 mm | 58 mm |
|---|---|---|
| Printable receipt width (print media) | 72.0 mm | 48.0 mm |
| QR size (incl. quiet zone) | 42.9 mm | 30.6 mm |
| QR module size (needs >= 0.5 mm) | 0.875 mm | 0.625 mm |
| QR square / inside printable width / no overflow | yes | yes |
| Pages in the printed PDF | 1 | 1 |
| Independent decode of the printed QR (jsQR) | exact payload | exact payload |

Plus an offline decode of 5 payloads x both rolls (`qa/desktop/upi-qr-decode.mjs`, 10/10 decoded). The decoder (jsQR 1.4.0) is a verification tool installed outside the project, not an app dependency.

## 10. Commands and results

Backend (PostgreSQL test DB):
```
php artisan test --filter=UpiQrPaymentTest      -> 29 passed (151 assertions)
php artisan test                                -> 179 passed, 0 failed (2650 assertions)   [full suite incl. the 29 new]
```
Desktop:
```
npx tsc --noEmit                                -> no errors
node --test "tests/**/*.test.ts"                -> 171 passed, 0 failed   (includes qr.test.ts 7, receiptModel.test.ts 12, theme guards)
node qa/desktop/upi-qr-decode.mjs <jsqr dir>    -> ALL 10 DECODED
pnpm prepare:server && pnpm build               -> ok (no installer built)
JSQR_DIR=<jsqr dir> node e2e/upi-qr.e2e.mjs     -> 32 PASS, 0 FAIL
node e2e/order-tracking.e2e.mjs                 -> 16 PASS, 0 FAIL   (existing suite, regression)
node e2e/theme.e2e.mjs                          -> 176 PASS, 0 FAIL  (existing suite, regression; incl. print-media checks)
node e2e/ui-first-run.e2e.mjs                   -> 27 PASS, 0 FAIL   (existing suite, regression)
```
Not run: `e2e/electron-workflow.e2e.mjs` - it needs a packaged `.exe` (i.e. an installer build), which was explicitly out of scope until this work is accepted.
TDD: the backend and desktop tests were written first and watched failing (404s / missing modules) before the code was written.

Mapping to the required cases:
1-2 amounts `200.00`/`500.00` (backend test; E2E for 200.00) · 3 distinct references · 4 configured UPI ID in every QR · 5 UPI ID change affects new QRs (and supersedes old) · 6 receipts keep original reference/UPI ID (backend + E2E U-20/21) · 7 duplicate confirmation / reused UTR cannot double-pay · 8 wrong amount / other order's reference / superseded merchant QR cannot mark paid · 9 cancelled order + stale QR refused · 10 cash/card/legacy flows unchanged (backend + E2E U-29) · 11 disabled shows no QR (preview, print, POS) · 12 missing config gives clear messages.

## 11. Remaining limitations

- No automatic payment confirmation (needs a gateway/PSP, section 7). Cashier attestation + UTR is manual and unverified by any bank.
- Not scanned with real UPI apps and not printed on real thermal hardware. 58 mm/80 mm results are layout measurements (print-media geometry, PDF) plus an independent QR decoder.
- The sheet size is the printer driver's roll width: Electron's `print()` does not apply the CSS `@page` size (the PDF test sheet is Letter), so the app controls the content width (72 mm / 48 mm), not the paper size. Choose the roll under Settings -> Printers -> "Receipt paper width".
- A QR generated before a UPI ID change can no longer confirm a payment; if a customer already paid that old UPI ID, the owner must reconcile it outside the app (the cashier generates a new QR for the bill).
- Reprints show the current business name/address in the header (transaction data is original).
- A paid UPI receipt still prints the original QR (labelled PAID) because the requirement asks for the original transaction's QR data on reprints; staff should not treat it as a pay-again code.
- The QR encoder supports payloads up to 365 bytes (versions 1-14); longer payloads are rejected with an error rather than printed incorrectly. A 50-character business name is the realistic maximum.
- Code Review Graph and Laravel Boost were not used (the graph was not needed for this scoped change; `backend/CLAUDE.md` asks to install Laravel Boost, which was out of scope and skipped).
