# Production Readiness Checklist & Phase 3 Verdict

**Date:** 2026-11-02

## Phase 4 Definition of Done (2026-11-02)

| Criterion | Status | Evidence |
|---|---|---|
| Repository changes stabilized | **Met** | Antigravity closed; no external writes since 19:28; reverted fixes re-applied; 42 change markers audited |
| QR duplicate-order regression fixed | **Met** | `checkoutSession.ts` + 12 tests (2 live); UI triple-tap → 1 order |
| Expo SDK 57 and Expo Go verified | **Partially met** | Config, deps, assets, types, doctor and bundle all pass; Metro serves SDK 57. **Not loaded on a device.** |
| Waiter workflow passes physical-device UAT | **Not met** | Not performed (API level passes) |
| Kitchen workflow passes UAT | **Met at API/Reverb level**, device UI not run | D-* checks |
| Multi-stall customer-to-cashier workflow passes | **Met** | `ORD-20261102-KND5F` E-01…E-13 |
| Offline queue behaviour verified and documented | **Met (logic)**, device not run | Phase 3 OFF-*, RST-1; `offline-test-report.md` |
| Security checks pass | **Met** | F-01…F-12; `security-verification-report.md` |
| Backend tests pass | **Met** | 38 passed / 766 assertions |
| Desktop and customer builds pass | **Met** | exit 0 |
| Mobile typecheck and Expo config pass | **Met** | exit 0 |
| Documentation reflects actual results | **Met** | this file, status doc, report |
| No unapproved commits / pushes / deployments | **Met** | HEAD still `2a050c6`; nothing pushed or deployed |

**Phase 4 status: PARTIAL**, blocked only on physical-device UAT, which needs the phone in hand.
**Release verdict unchanged: READY FOR INTERNAL TESTING.** The pilot blockers below still stand.

---

## 1. Phase 3 Definition of Done

| Criterion | Status | Evidence / gap |
|---|---|---|
| All four applications deployed or run in staging | **Met with caveat** | API + Reverb + staging DB running. Desktop and QR production builds served and used in a browser. Android: see `android-release-build.md`. |
| Actual Android release build verified | See `android-release-build.md` | |
| All critical business workflows pass | **Mostly met** | Workflows A–E pass at API level (91/91). A and C pass end-to-end in the real UI. **EOD does not lock the day (OPEN-01).** |
| Realtime private channel authorization verified | **Met** | 3 PHPUnit tests + 12 live-Reverb checks, including forged signatures |
| Offline sync passes interruption and retry scenarios | **Met (logic), partial (device)** | OFF-1…OFF-10 and RST-1 run the shipped `syncEngine.ts` against the live API. Physical Wi-Fi toggling on a device was not done. |
| No duplicate orders or payments | **Met** | OFF-6/7/9, PERF-01/02/05 |
| Database backup and restore verified | **Met** | Restore into a separate DB, counts and money totals identical, overwrite guards |
| Security tests pass | **Met for tested scope** | 37 PHPUnit tests (18 new security/integrity tests), RT-* checks. No external penetration test. |
| UAT scenarios documented and executed | **Partially** | 44 cases; 36 pass, 2 partial, 5 not run, 1 blocked. **No human UAT with food court staff.** |
| All critical and high severity defects resolved | **Not met** | 25 defects fixed (P3-01…P3-25). Open High items below. |

## 2. Verdict

### **READY FOR INTERNAL TESTING**

**Why not "Ready for food court pilot":**
1. **OPEN-01:** end-of-day closing does not lock the day. Late payments are taken but excluded from the stall settlement records the owner pays from. This is money, and the correct rule is the owner's decision.
2. **OPEN-02:** staff accounts cannot be created, deactivated or have passwords changed from any app. Every seeded account uses the same demo password.
3. **OPEN-03:** the PHP runtime has not been set up for production (no OPcache, single-threaded dev server). Measured 0.37 s per request with no load and p95 6.4 s for 40 concurrent orders.
4. Human UAT with the owner, cashier, waiters and kitchen staff has not taken place. The core business rules (settlement formula, QR payment timing, serving model) are still **unconfirmed by the owner**: the recording analysis could not be completed (see the business discovery status).

**Why not "Not ready":** every critical defect found has been fixed and verified on a live stack. The order → kitchen → serve → bill → close path works across all three ordering channels with no duplicate orders or payments under interruption and concurrency.

## 3. Open items

| ID | Severity | Item | Owner of decision / work | Blocks pilot? |
|---|---|---|---|---|
| OPEN-01 | High | EOD closing does not lock the day. The confirmation dialog falsely says it does. Need a rule: block payments for closed dates, roll them into the next day, or allow a re-close/adjustment record. | **Food court owner** decides; then engineering | Yes |
| OPEN-02 | High | No user/staff management (create, deactivate, reset password). Seeded `password123` accounts. | Engineering | Yes |
| OPEN-03 | High | Production PHP runtime: OPcache, php-fpm/nginx or Octane, `config:cache`/`route:cache`; services supervised | Engineering / ops | Yes |
| OPEN-04 | Medium | No client consumes Reverb; all UIs poll every 4–10 s | Engineering | No (polling works) |
| OPEN-05 | Medium | 5% GST hard-coded on every item (rate not confirmed for this business; no per-item tax) | Owner + accountant | Before go-live billing |
| OPEN-06 | Medium | App connects to PostgreSQL as superuser; test password in `phpunit.xml`; no DB-level append-only protection for payments/audit | Engineering | Recommended before pilot |
| OPEN-07 | Medium | App timezone UTC; business-day boundary for EOD not defined | Owner decides cut-off time | Recommended |
| OPEN-08 | Medium | No QR code printing screen for tables (tokens available via API only) | Engineering | Workaround: print from API list |
| OPEN-09 | Medium | Mobile storage is AsyncStorage (not SQLite as specified); token and queue unencrypted on device | Engineering | No |
| OPEN-10 | Medium | No discounts, refunds, split or partial payments (`split` is accepted but treated as one payment) | Owner decides rules | No (avoid in pilot) |
| OPEN-11 | Medium | Stall manager / store staff have no mobile screens (desktop only); managers get the KDS on mobile | Engineering | No |
| OPEN-12 | Low | Recipes/BOM and automatic stock consumption not implemented (stock moves only by purchase and manual adjustment) | Owner confirms whether needed | No |
| OPEN-13 | Medium | Release APK/AAB not built (deferred by decision). When built, the template signs with the debug keystore | Engineering | Before distribution |
| OPEN-17 | High | Physical-device UAT (Expo Go) for waiter, kitchen and offline flows not performed | Owner / tester with the phone | Yes |
| OPEN-18 | Low | No dependency vulnerability scan (`composer audit`, `pnpm audit`) run | Engineering | Recommended |
| OPEN-14 | High | Business discovery from the owner recording not completed (transcription tooling insufficient). Settlement formula, QR pay timing and serving model unconfirmed. | Owner + engineering | Yes |
| OPEN-15 | Low | Cloud sync / remote owner access not implemented (edge-only) | Product | No |
| OPEN-16 | Low | Reverb `allowed_origins: *`; no TLS on LAN | Ops | No |

## 4. Production deployment gate (must all be true)
- [ ] OPEN-01, OPEN-02, OPEN-03, OPEN-14 closed
- [ ] Human UAT signed by owner (uat-test-plan.md, all HUMAN rows)
- [ ] Pilot dry run: one full service day on the real LAN with real devices, including a WAN-unplug test and an edge-server restart
- [ ] Production keystore; APK distributed to staff devices
- [ ] Least-privilege DB role, fresh secrets, backups scheduled with off-box copy, restore drill on the pilot server
- [ ] Owner's explicit approval to deploy
