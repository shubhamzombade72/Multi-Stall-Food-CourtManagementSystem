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
| L-09 | ~~No staff user management.~~ **Resolved 2026-11-02:** desktop *Staff & Permissions* (create, edit, deactivate, reset password). | Implemented and verified | Seeded demo passwords must still be reset |
| L-10 | Clients poll (4–10 s). The desktop KDS can subscribe to Reverb when built with `VITE_REVERB_*`, but that mode is not verified. | Partially implemented | Ready alerts arrive within one polling interval |
| L-11 | Offline: only **waiter order creation** is queued on the device. KDS, cashier, serving confirmation, payments and the customer QR app need the server reachable. | Partially implemented | See `offline-test-report.md` |
| L-12 | Mobile storage is AsyncStorage (not SQLite); token and queue unencrypted on the device. | Implemented differently from spec | — |
| L-13 | Customer phones must be on the food-court Wi-Fi to reach the LAN API. Mobile data alone cannot reach it. | By design (LAN) | Table signage needed |
| L-14 | PHP dev server (`artisan serve`) without OPcache: ~370 ms per request, single-threaded on Windows. | Staging only | A production PHP runtime is required before pilot |
| L-15 | App timezone UTC; business-day cut-off undefined. | Blocked by business decision | EOD dates may not match the trading day |
| L-16 | No QR printing screen for table codes. | Not implemented | Owner reads tokens via `GET /api/tables` |
| L-17 | Owner discovery recording not transcribed; core business rules (settlement, QR payment timing, serving model) unconfirmed. | Blocked | — |
| L-18 | Expense Management | **Out of scope** by decision | — |
| L-19 | Desktop installer is not code-signed and has no auto-update. | Not implemented | SmartScreen warning on install; updates are re-installs |
| L-20 | Desktop has no offline mode; it needs the API reachable. A Local Edge Server needs a separately approved architecture. | By decision | Counter stops if the server/LAN is down |
| L-21 | Receipt (80 mm) and report (A4) printing verified only up to the Windows print dialog. | Implemented, not verified on hardware | Test on the real printer |
| L-22 | Android and customer QR apps are frozen (P2) during desktop-first work. | By decision | No new mobile/QR features |
| L-23 | A **shared** production API (several PCs on one server) has no address and has not been deployed or verified. Not needed for the default single-PC install (v1.0.2 has a built-in server). | Open only if a shared server is wanted | See `docs/desktop/production-deployment.md` |
| L-24 | Desktop installers before v1.0.1 default to `http://127.0.0.1:8000/api` and cannot sign in on a PC that does not host the server. | Fixed in v1.0.1 | Replace any delivered 1.0.0 installer |
| L-25 | Sanctum tokens never expire (`expiration => null`); revoked only on new login or logout. | Open (decision) | A lost PC keeps a valid session until the user signs in elsewhere |
| L-26 | No `trustProxies` setting. Behind a reverse proxy/CDN the login throttle (5/min per email+IP) would treat all clients as one. | Open (needed before an HTTPS proxy is used) | See `production-deployment.md` §2 |
| L-27 | Desktop e2e `R-05` (daily closing) can pass only once per UTC day per database (`daily_closings.closing_date` is unique). | Test limitation | Re-run next day or on a fresh e2e DB |
| L-28 | v1.0.1 NSIS install/uninstall wizard was not exercised on a clean separate Windows PC; payload was verified by extraction and run on the development PC. | Open verification | See `docs/desktop/release-notes-1.0.1.md` |
| L-29 | Single-PC mode: each computer has its own database; PCs do not share orders, menus or users. | By design (v1.0.2) | Use a shared server for multi-PC trading |
| L-30 | Built-in server uses PHP's single-process built-in web server: one request at a time. Measured 15-40 ms per request with OPcache; fine for one counter, not for heavy concurrency. | Accepted for single-PC | Use a production PHP runtime for shared servers |
| L-31 | `php.exe` and its DLLs bundled in the installer are unsigned (official PHP builds). With the app code-signed, these must be signed too or Smart App Control / application-control policies may block the built-in server. | Open | Sign all shipped executables |
| L-32 | No in-app backup or restore and no owner password recovery. Backup = copy `foodcourt.sqlite` (app closed); an automatic copy is made before upgrades. A forgotten owner password cannot be reset from the app. | Open | Consider adding both before wide rollout |
| L-33 | Built-in database is SQLite; the shared-server path uses PostgreSQL. Both pass the 70-test backend suite, but SQLite is not used for shared multi-user production. | By design | See L-30 |
