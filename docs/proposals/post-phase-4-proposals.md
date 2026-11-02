# Proposals for Unresolved Items (after Phase 4)

Each item is **out of scope for Phase 4** and needs an owner decision or a dedicated phase. None has been started.

| # | Proposal | Why | Decision needed from | Rough size |
|---|---|---|---|---|
| P-1 | **EOD day lock.** After `close-day`, reject payments dated to a closed day, or record them as next-day / adjustment entries with an audit trail; fix the misleading confirmation text | Settlement records can omit late payments (L-06) | **Owner** (which rule) | S–M |
| P-2 | **Staff user management.** Owner screens + API to create staff, assign role/stall, deactivate, reset password; force a password change on first login | Seeded shared password; accounts only via DB (L-09) | — | M |
| P-3 | **Production runtime for the edge server.** php-fpm + nginx (Linux) or Octane/FrankenPHP; OPcache; `config:cache`/`route:cache`; supervised API, Reverb and queue worker | 370 ms per request on the dev server (L-14) | Ops | M |
| P-4 | **Configurable tax.** Tax rate per menu item or category stored with the order line, replacing the hard-coded 5% | Rate unconfirmed, no per-item tax (L-04) | **Owner + accountant** | M |
| P-5 | **Settlement rule engine.** Configurable formula (e.g. gross − commission), owner approval and stall acknowledgement | No formula confirmed (L-07) | **Owner** | M–L |
| P-6 | **Recipes / BOM.** Map menu items to ingredients and deduct stock on ticket `ready` or `accepted` | Stock does not follow sales (L-05) | **Owner** (when to deduct) | L |
| P-7 | **Realtime clients.** Add Echo/Pusher subscriptions to KDS, waiter app and POS; keep polling as fallback | UIs poll only (L-10) | — | S–M |
| P-8 | **DB-level isolation.** PostgreSQL RLS policies on stall-scoped tables, least-privilege app role, append-only grants on payments/audit | Defence in depth (L-03, OPEN-06) | — | M |
| P-9 | **Edge packaging + cloud sync.** Installer/service bundle for the LAN server; optional cloud replica for remote owner reporting and off-site backup | Single point of failure, no remote access (L-02) | **Owner** (is remote access needed?) | L |
| P-10 | **Release Android build.** `expo prebuild` + Gradle or EAS Build with a production keystore; MDM/sideload plan for staff devices | APK deferred (L-01) | — | S |
| P-11 | **QR table printing.** Owner screen that renders printable table QR codes from the hidden tokens | No UI today (L-16) | — | S |
| P-12 | **Discounts / refunds / split payments.** Model and audit them | Not supported (L-08) | **Owner** (rules) | M |
