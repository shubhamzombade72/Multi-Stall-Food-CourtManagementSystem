# Implementation Status: Multi-Stall Food Court Management System

**Last Updated:** 2026-11-02 (Desktop-First Transformation)
**Architecture:** Laravel 12 / PHP 8.3 modular monolith, PostgreSQL 17, Laravel Reverb · **Windows desktop app (Electron 44.9.0 + React 18): primary product** (Owner, Cashier POS, Kitchen Display, Menu, Inventory, Closing & Reports, Staff) · React 18 customer QR web app (frozen, P2) · React Native 0.86.3 / Expo SDK 57 Android app (frozen, P2)
**Desktop-first status:** **READY FOR INTERNAL TESTING**. All P0 workstreams implemented and verified; installer built, installed and smoke-tested. Details: `docs/desktop/desktop-first-report.md`, install guide `docs/desktop/README.md`.
**Release verdict:** **READY FOR INTERNAL TESTING**. Not ready for a food court pilot or production (`docs/staging/production-readiness-checklist.md`).

> History: Phase 2 documents claimed "100% complete, production ready". Phase 3 disproved that (25 defects fixed,
> `docs/staging/phase-2-verification-findings.md`). During Phases 3–4 a second agent (Antigravity IDE) reverted fixes
> twice; all were re-applied and verified. Run only one agent against this folder.

## 1. Phase history

| Phase | Status | Summary |
|---|---|---|
| 0 Discovery | Partial | Environment audit done. **Owner recording not transcribed**, so core business rules are unconfirmed |
| 1 Initial implementation | Done | Four applications built |
| 2 Remediation | Superseded | Several "verified" claims were false (see findings doc) |
| 3 Staging validation | Done | 25 defects fixed. Staging DB, workflows A–E, concurrency, backup/restore, realtime security |
| 4 Stabilization & device UAT | **Partial** | Repo stabilized; QR duplicate-order guard rebuilt with tests; SDK 57 verified; full multi-stall workflow and security checklist verified live; device UAT on Moto G45 (waiter order, KDS isolation, ticket prep, Mark Served `KKT-20261102-J44L` → `picked_up`); T-T-01 table defect fixed; **offline airplane-mode device test pending** |
| Desktop-first | **Ready for internal testing** | Electron shell + NSIS installer; staff management, desktop KDS, receipts and payment history, categories and photos, stock out, closing history and new reports. 49 backend tests, 27/27 desktop E2E, packaged smoke test pass. `docs/desktop/` |

## 2. Feature classification

Legend: **IV** implemented and verified · **IN** implemented, not verified · **PI** partially implemented · **NI** not implemented · **BD** blocked by an unresolved business decision

| Area | Feature | Status | Evidence / note |
|---|---|---|---|
| Auth | Sanctum token login, logout, `/auth/me` | IV | PHPUnit `AuthTest` |
| Auth | Login rate limit, deactivated-token rejection | IV | PHPUnit; Phase 3 AUTH-01/02 |
| Auth | Staff user management (create/edit/deactivate/reset, token revocation) | IV | `DesktopFirstTest`; desktop E2E O-02/O-03/S-01; desktop UI |
| Stalls | Create/update/activate (owner), manager edits own stall | IV | PHPUnit `test_stall_details_and_updates_are_restricted`; desktop UI edit/deactivate |
| Desktop | Electron shell, secure IPC, API URL config, logging | IV | Packaged smoke test PASS (`docs/desktop/desktop-first-report.md` §4) |
| Desktop | Windows installer (NSIS, per-user) | IV (dev PC only) | Silent install + upgrade exit 0; not code-signed; clean-PC install not done |
| Desktop | Kitchen Display (stall-isolated, timers, sound, fullscreen) | IV (polling) | Unit tests; E2E K-01…K-03; UI Accept → Preparing → Ready. Reverb mode IN |
| Desktop | Receipt / report printing | IN | Prints through the Windows dialog; physical thermal printer not tested |
| Desktop | Payment history, closing history, menu performance, cashier activity, CSV export | IV | E2E B-04, R-02…R-05; unit test (CSV); UI |
| Menu | Category create/rename, category-stall match, product photo upload | IV (API) | `DesktopFirstTest`; E2E O-04/O-05 |
| Inventory | Stock out (consumption / waste-loss, no negative stock) | IV | `DesktopFirstTest`; E2E I-01/I-02; UI |
| Tables | Signed table QR tokens (owner-only visibility) | IV | Phase 3 PRE-04…06; F-05 |
| Tables | QR printing UI | NI | L-16 |
| Menu | Menu CRUD, price changes restricted by role/stall | IV | F-06; `SecurityAuditTest` |
| Orders | Multi-stall parent order + one ticket per stall | IV | E-02…E-06 (`ORD-20261102-KND5F`) |
| Orders | Server-side pricing, idempotency (incl. concurrent) | IV | A-07, E-02, OFF-9 |
| Orders | 5% GST | IN (rule unconfirmed) | L-04, hard-coded |
| Customer QR | Menu, multi-stall cart, order, tracking | IV | Browser UAT (Phase 3), E-01/E-12 |
| Customer QR | Duplicate-submission guard (in-flight lock + stable key) | IV | 12/12 `pnpm test`; UI triple-tap → 1 order `ORD-20261102-JSGAK` |
| Kitchen | Stall-isolated KDS, forward-only states | IV (API + Moto G45 UAT) | D-*-1…4; Device KDS verified for Pizza (52) & Burger (10); J44L ready |
| Waiter | Tables, order, ready list, serve confirmation | IV (API + Moto G45) | C-01…C-06; device order ORD-20261102-FBWBR; T-T-01 label defect fixed; Mark Served on device: `KKT-20261102-J44L` `picked_up` 16:01:42 |
| Waiter | Offline order queue (persist, backoff, no duplicates) | IV (logic) | Phase 3 OFF-1…10, RST-1 run the shipped syncEngine.ts; device offline test pending |
| Billing | Pending bills, exact-total payment, receipt, table release | IV | E-07…E-11; browser UAT |
| Billing | Discounts, refunds, split/partial payments | NI | L-08 |
| Purchases | Supplier, PO, goods receipt, stall isolation, receive lock | IV | Phase 3 D-01…D-07, PERF-04/05 |
| Inventory | Stock ledger, manual adjustment (authorized roles) | IV | Phase 3 D-05/D-08 |
| Inventory | BOM/recipe auto-depletion | NI | L-05 |
| EOD | Daily summary, closing, settlement records | IV | Phase 3 E-01…E-07 |
| EOD | Day lock after closing | BD | L-06 / OPEN-01 |
| EOD | Settlement formula | BD | L-07 (owner records actual payout) |
| Realtime | Private channels + auth, payload minimisation | IV | F-12, D-*-5, C-01 |
| Realtime | Client subscriptions (UIs use polling) | PI | L-10 |
| Offline | Edge server packaging + cloud sync | NI | L-02 |
| Security | DB row-level security | NI | L-03 |
| Audit | Lifecycle audit rows | IV | F-11 |
| Ops | Backup + verified restore scripts | IV | Phase 3 backup-recovery-report |
| Mobile | Expo SDK 57 config, deps, assets, types | IV | §3 |
| Mobile | Runs in Expo Go on a physical phone | IV | Moto G45 (Android 15) over USB; frozen as P2 |
| Mobile | Release APK/AAB | NI (deferred) | L-01 |
| Expense management | — | Out of scope | — |

## 3. Commands and verified results

Desktop-first run (2026-11-02):

| Directory | Command | Exit | Result |
|---|---|---|---|
| `backend` | `php artisan test` | 0 | **49 passed, 944 assertions** (38 + 11 `DesktopFirstTest`) |
| `frontend-desktop` | `pnpm test` | 0 | 5/5 pass |
| `frontend-desktop` | `pnpm build` | 0 | `index-*.js` 469.59 kB |
| `frontend-desktop` | `pnpm dist:win` + silent install + `FOODCOURT_SMOKE_TEST=1` | 0 | installer 115.1 MB; smoke PASS, `packaged: true`; API reachable from the packaged app |
| `frontend-customer` | `pnpm test` / `pnpm build` | 0 | 10 pass, 2 skipped / built |
| `mobile-app` | `pnpm check-types` | 0 | no errors |
| repo root | `node qa/desktop/desktop-e2e.mjs` | 0 | **27/27 PASS** on a fresh E2E DB; re-run 26 PASS / 2 SKIP (day already closed, re-close refused 422) |

Phase 4 final run (2026-11-02):

| Directory | Command | Exit | Result |
|---|---|---|---|
| `backend` | `php artisan test` | 0 | **38 passed, 766 assertions** (assertion count grows run to run: older tests loop over accumulated rows) |
| `frontend-desktop` | `pnpm build` (`tsc && vite build`) | 0 | 1646 modules, `index-*.js` 337.95 kB |
| `frontend-customer` | `pnpm build` (`tsc && vite build`) | 0 | 1642 modules, `index-*.js` 264.50 kB |
| `frontend-customer` | `pnpm test` | 0 | 10 pass, 2 skipped (live tests need `STAGING_API`) |
| `frontend-customer` | `STAGING_API=… STAGING_QR_TOKEN=… pnpm test` | 0 | **12/12 pass** (DB: exactly 2 orders, 2 tickets each) |
| `mobile-app` | `pnpm check-types` | 0 | no errors |
| `mobile-app` | `pnpm exec expo config --type public` | 0 | sdkVersion 57.0.0, package `com.foodcourt.multistall`, permissions INTERNET + ACCESS_NETWORK_STATE |
| `mobile-app` | `npx expo install --check` | 0 | "Dependencies are up to date" |
| `mobile-app` | `npx expo-doctor` | 0 | 21/21 checks passed |
| `mobile-app` | `npx expo export --platform android` | 0 | 612 modules; production bundle contains no demo credentials |
| repo root | `node qa/staging/phase4-workflow-e2e.mjs` | 0 | **47 PASS / 0 FAIL** |
| repo root | `node qa/staging/staging-validation.mjs` | — | Phase 3 run: 91/91 PASS. Not re-run in Phase 4: its EOD section closes "today", already closed on staging |

## 4. Expo Go status
- Metro: `exp://10.16.20.53:8081` (LAN IP re-verified 2026-11-02), Expo Go mode, serving SDK 57 (`exposdk:57.0.0`).
- Bundle built with `EXPO_PUBLIC_API_URL=http://10.16.20.53:8100/api` (verified inside the served bundle), so the app defaults to the staging API.
- Loaded and used on a Moto G45 (`ZN4223FC6T`) over USB (`adb reverse`). Waiter order, KDS isolation, ticket prep and Mark Served verified on the device. The airplane-mode offline test is still pending. The mobile app is now frozen (P2).

## 5. Known issues
`docs/staging/known-limitations.md` (L-01…L-18) and `docs/staging/production-readiness-checklist.md` §3.
