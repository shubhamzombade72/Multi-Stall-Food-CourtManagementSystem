# Known Limitations (as of Phase 4, 2026-11-02)

These are deliberate scope boundaries or open items. None should be described as implemented.

| # | Limitation | Status | Impact |
|---|---|---|---|
| L-01 | **APK / AAB build intentionally deferred.** The app runs through Expo Go (SDK 57) only. | Deferred by decision | Staff devices need Expo Go plus the dev server until a release build exists |
| L-02 | **Local edge-server packaging and cloud sync are not implemented.** The backend runs on one LAN machine. There is no cloud replica, no sync daemon and no remote owner access. | Not implemented | Single point of failure (mitigated by backups); owner must be on site |
| L-03 | **Database-level RLS is not implemented.** Stall isolation is enforced in controllers and channel callbacks only. | Not implemented | A bug in application code could leak cross-stall data; there is no second line of defence |
| L-04 | **GST is hard-coded at 5% on every item** (`OrderController`; the customer app mirrors it for display). | Implemented, rule unconfirmed | Rates per category/HSN are not supported; must be confirmed by the owner/accountant |
| L-05 | **No BOM/recipe-based automatic stock depletion.** Stock changes only through purchases and manual adjustments. | Not implemented | Inventory does not follow sales automatically |
| L-06 | **End-of-day closing does not lock the day** (OPEN-01). Payments after closing are accepted but missing from that day's settlement records. | Blocked by business decision | Settlement figures can be incomplete |
| L-07 | **Settlement payout amount is entered by the owner.** No formula exists (by design until the owner confirms one). | Blocked by business decision | — |
| L-08 | No discounts, refunds, split or partial payments (`split` is accepted as a single payment). | Not implemented | Avoid in pilot |
| L-09 | No staff user management (create / deactivate / reset password). | Not implemented | Accounts managed in the DB; seeded demo password must be replaced |
| L-10 | Clients poll (4–10 s); Reverb events are broadcast and authorized but no UI subscribes. | Partially implemented | Ready alerts arrive within one polling interval |
| L-11 | Offline: only **waiter order creation** is queued on the device. KDS, cashier, serving confirmation, payments and the customer QR app need the server reachable. | Partially implemented | See `offline-test-report.md` |
| L-12 | Mobile storage is AsyncStorage (not SQLite); token and queue unencrypted on the device. | Implemented differently from spec | — |
| L-13 | Customer phones must be on the food-court Wi-Fi to reach the LAN API. Mobile data alone cannot reach it. | By design (LAN) | Table signage needed |
| L-14 | PHP dev server (`artisan serve`) without OPcache: ~370 ms per request, single-threaded on Windows. | Staging only | A production PHP runtime is required before pilot |
| L-15 | App timezone UTC; business-day cut-off undefined. | Blocked by business decision | EOD dates may not match the trading day |
| L-16 | No QR printing screen for table codes. | Not implemented | Owner reads tokens via `GET /api/tables` |
| L-17 | Owner discovery recording not transcribed; core business rules (settlement, QR payment timing, serving model) unconfirmed. | Blocked | — |
| L-18 | Expense Management | **Out of scope** by decision | — |
