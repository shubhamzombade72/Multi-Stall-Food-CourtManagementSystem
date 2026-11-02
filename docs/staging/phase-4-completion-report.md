# Phase 4 Completion Report — Stabilization, Device UAT & Release Readiness

**Date:** 2026-11-02
**Phase 4 status: PARTIAL.** Every workstream that can run on this workstation passes. **Physical Android UAT through Expo Go has not been performed**: no phone has loaded the app, and the attached phone does not accept remote commands.
**Release verdict: READY FOR INTERNAL TESTING** (not pilot, not production).

## 1. Executive summary
- The repository was stabilized. The source of the repeated reverts was identified as Antigravity IDE rewriting its Phase 2 file snapshots. It is closed, all reverted fixes are restored, and no external writes have occurred since 19:28.
- The QR duplicate-order regression is fixed with a tested submission guard. A real UI triple-tap creates one order, and a lost response followed by a retry replays the same order.
- Expo SDK 57 is verified: config, packages, assets, types, doctor, bundle and Metro. The app defaults to the staging API through `EXPO_PUBLIC_API_URL`.
- One full multi-stall customer-to-cashier scenario, kitchen and waiter role checks, and the 12-item security checklist all pass live: 47/47.
- Backend 38 tests pass. Desktop and customer builds pass. Mobile typecheck and Expo config pass.
- Not done: physical-device UAT. Pilot blockers remain: EOD lock, user management, production PHP runtime, owner-confirmed business rules.

## 2. Files changed in Phase 4

| File | Change |
|---|---|
| `frontend-customer/src/lib/checkoutSession.ts` | **New**: checkout guard (in-flight lock, stable key per cart, clear on ack, typed errors) |
| `frontend-customer/src/pages/QrMenuPage.tsx` | Uses the guard; inline error message; `aria-busy`; cart cleared after acknowledgement |
| `frontend-customer/tests/checkoutSession.test.ts` | **New**: 10 unit + 2 live tests |
| `frontend-customer/package.json` | `test` script (`node --test`) |
| `mobile-app/src/storage/offlineStore.ts` | Default API URL from `EXPO_PUBLIC_API_URL` |
| `backend/database/seeders/DatabaseSeeder.php` | Refuses to run in production |
| `backend/tests/Feature/StagingHardeningTest.php` | + seeder guard test |
| `qa/staging/phase4-workflow-e2e.mjs` | **New**: workstreams C–F live scenario |
| Re-applied after external revert | `BillingController.php`, `PurchaseController.php`, `SecurityAuditTest.php`, `mobile-app/src/api/client.ts`, `mobile-app/app.json`, `mobile-app/package.json` (SDK 57), `docs/implementation-status.md` |
| Docs | `implementation-status.md`, `staging/uat-results.md`, `staging/production-readiness-checklist.md`, `staging/phase-2-verification-findings.md`, `staging/staging-deployment-guide.md`, `staging/android-release-build.md`; **new** `staging/security-verification-report.md`, `staging/known-limitations.md`, `staging/phase-4-completion-report.md`, `proposals/post-phase-4-proposals.md` |

Nothing committed: HEAD is still `2a050c6`. Nothing pushed or deployed. No APK built.

## 3. Bugs fixed (Phase 4)
P4-01 reverted fixes (process) · P4-02 same-tick double submission · P4-03 emulator-only default API URL · P4-04 demo seeder allowed in production · P4-05 two harness false-fails. Details: `phase-2-verification-findings.md` §2b.

## 4. Tests executed — exact results

| Command (directory) | Exit | Result |
|---|---|---|
| `php artisan test` (backend) | 0 | 38 passed, 766 assertions |
| `pnpm build` (frontend-desktop) | 0 | 1646 modules, 337.95 kB JS |
| `pnpm build` (frontend-customer) | 0 | 1642 modules, 264.50 kB JS |
| `pnpm test` (frontend-customer) | 0 | 10 pass, 2 skipped (no `STAGING_API`) |
| `pnpm test` with `STAGING_API`/`STAGING_QR_TOKEN` | 0 | 12 pass; DB shows exactly 2 orders (`ORD-20261102-WPIXM`, `-WPUVH`) with 2 tickets each |
| `pnpm check-types` (mobile-app) | 0 | clean |
| `pnpm exec expo config --type public` (mobile-app) | 0 | sdkVersion 57.0.0 |
| `npx expo install --check` / `npx expo-doctor` | 0 / 0 | up to date / 21 of 21 |
| `npx expo export --platform android` | 0 | 612 modules |
| `node qa/staging/phase4-workflow-e2e.mjs` | 0 | 47 PASS / 0 FAIL (first run 45/2: script bugs, fixed) |
| Browser: built QR app, triple-tap Confirm | — | 1 POST, 1 order `ORD-20261102-JSGAK`, 2 tickets |

## 5. Physical Android UAT evidence
**None.** Metro (`exp://10.16.20.53:8081`) has served no bundle to a device: the only "Android Bundled" log line was this workstation's own verification request. `adb` sees `ZN4223FC6T`, but `adb shell` times out (likely an unaccepted USB-debugging prompt). Waiter, kitchen and offline flows are verified at API level only.

## 6. Security verification
12/12 checklist items pass live (`security-verification-report.md`). Demo credentials are absent from all production bundles. The demo seeder is now production-guarded. Flagged: `backend/phpunit.xml` tracks the local Postgres superuser password; staging accounts share `password123` and must be replaced before any real deployment.

## 7. Manual steps to finish Expo Go UAT on the phone
1. Phone on the **same Wi-Fi** as this PC (`10.16.20.53`; re-check with `ipconfig` if the network changed). On networks that isolate clients, use a phone hotspot shared with the PC.
2. Keep running: Metro (terminal tab "Expo Go Metro"), API `:8100`, Reverb `:8180`. If Metro was stopped:
   `cd mobile-app; $env:EXPO_PUBLIC_API_URL = 'http://10.16.20.53:8100/api'; npx expo start --go --lan --port 8081 --clear`
3. Open **Expo Go (SDK 57)** → scan the Metro QR, or enter `exp://10.16.20.53:8081`. Wait for the bundle to load. The Metro terminal should print `Android Bundled …` and device logs.
4. The server URL defaults to `http://10.16.20.53:8100/api`. If an older URL was saved on the device, set it under *Configure Edge Server IP / LAN*.
5. **Waiter** (`waiter1@foodcourt.com`, staging password): tables load → pick a table → add items from 2+ stalls → submit → "Order Dispatched". Note the order number. Tap submit twice quickly and confirm only one order appears in the cashier's pending bills.
6. **Kitchen** (log out, then `kitchen.pizza@foodcourt.com`): only Pizza tickets show → Start Preparation → All Items Ready. Repeat for `kitchen.burger@` and `kitchen.bev@`.
7. **Waiter again**: Ready Dishes shows the tickets within about 5 s → Mark Served.
8. **Offline**: with the menu loaded, turn Wi-Fi off → place an order → "Saved Offline" → force-close Expo Go → reopen (queue count still shown) → Wi-Fi on → wait ≤ 20 s or tap Sync Now → the queue empties. Confirm **one** order on the cashier screen (`http://10.16.20.53:4102`, cashier login).
9. Record the order numbers and screenshots in `uat-results.md` (UAT-W-01…08, UAT-K-01…05). The DB can confirm: `SELECT order_number, order_channel, idempotency_key FROM orders WHERE order_channel='waiter_app' ORDER BY id DESC LIMIT 5;`

Unsupported offline operations (by design today): KDS updates, serving confirmation, payments, customer QR ordering, and anything when the phone was never online since login.

## 8. Known limitations
`known-limitations.md` (L-01…L-18): APK deferred, edge/cloud sync not implemented, no RLS, hard-coded GST, no BOM depletion, EOD lock and settlement formula blocked by owner decisions, and more.

## 9. Failed or blocked tests
- UAT-O-05 (payment after EOD close): **BLOCKED** on the owner decision (OPEN-01).
- All physical-device UAT rows: **NOT RUN** (OPEN-17).
- Phase 3 `staging-validation.mjs` not re-run (its EOD section would close an already-closed day). Its Phase 3 run was 91/91.

## 10. Remaining production-release tasks
1. Physical-device UAT (§7) with owner sign-off.
2. Owner decisions: EOD lock, settlement formula, GST rates, business-day cut-off, QR payment timing / serving model.
3. User management + replace all demo accounts.
4. Production PHP runtime, least-privilege DB role, secrets rotation, scheduled off-box backups.
5. Release APK/AAB with a production keystore (when un-deferred).
6. Pilot dry run on the real LAN (WAN-unplug and edge-restart tests).

## 11. Phase 4 status: **PARTIAL**
