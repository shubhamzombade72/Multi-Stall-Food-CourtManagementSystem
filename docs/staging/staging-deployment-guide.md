# Staging Deployment Guide

**Status:** Staging was deployed and exercised on the development workstation (Windows 11) on 2026-11-02, against a **separate staging database** (`foodcourt_staging_db`). Nothing was pushed to GitHub, no DNS was changed, no hosting was bought, and nothing was deployed to production.

## 1. Topology (food court edge server)

```
            Food court LAN / Wi-Fi (no internet needed for trading)
 ┌──────────────────────────────────────────────────────────────────────┐
 │  Edge server (fixed IP, e.g. 192.168.1.50)                           │
 │   ├─ PostgreSQL 17           :5432  (localhost only in production)    │
 │   ├─ Laravel API             :8000  (/api, /api/broadcasting/auth)    │
 │   ├─ Laravel Reverb          :8080  (ws, private channels)            │
 │   ├─ Queue worker            (database driver)                        │
 │   └─ Static web: desktop app + customer QR app (built dist/)          │
 │                                                                       │
 │  Cashier PC ─ browser → desktop app      Android devices → waiter/KDS │
 │  Customer phones on guest Wi-Fi → QR app → http://192.168.1.50/...    │
 └──────────────────────────────────────────────────────────────────────┘
```

## 2. Prerequisites (verified on this workstation)

| Component | Version found | Notes |
|---|---|---|
| PHP | 8.3 CLI | **OPcache is not loaded.** Required for production (see §6) |
| Composer | 2.x | |
| PostgreSQL | 17 | `C:\Program Files\PostgreSQL\17\bin` (not on PATH) |
| Node.js | 24.x | runs the staging harness (TypeScript type-stripping) |
| pnpm | global **10.22** | `mobile-app` was reinstalled with pnpm 10.22 during the SDK 57 upgrade (`node-linker=hoisted`). The web apps' `node_modules` came from pnpm 12.15; reinstall them with the same pnpm before adding packages. |
| JDK / Android SDK | 17 / platforms 36, 37; build-tools 35, 36 | |

## 3. Staging environment configuration

`backend/.env.staging` (git-ignored, generated with its own `APP_KEY` and Reverb keys):

| Key | Staging value | Why |
|---|---|---|
| `APP_ENV` | `staging` | Loads `.env.staging` via `--env=staging` |
| `APP_DEBUG` | `false` | No stack traces to clients |
| `DB_DATABASE` | `foodcourt_staging_db` | **Separate** from `foodcourt_db` and `foodcourt_test_db` |
| `BROADCAST_CONNECTION` | `reverb` | |
| `REVERB_HOST` / `REVERB_PORT` | `127.0.0.1` / `8180` | API → Reverb publishing |
| `QUEUE_CONNECTION`, `CACHE_STORE` | `database` | No Redis needed on the edge |
| `LOG_STACK` / `LOG_LEVEL` | `daily` / `info` | Rotating logs in `backend/storage/logs` |

Generate one on a new machine:
```powershell
cd backend
Copy-Item .env.example .env.staging
# edit APP_ENV=staging, APP_DEBUG=false, DB_*, REVERB_* (random key/secret)
php artisan key:generate --env=staging
```

## 4. Exact commands used for this staging run

```powershell
# 1. Database (once)
$env:PGPASSWORD = '<postgres password>'   # typed, never committed
& 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -U postgres -c "CREATE DATABASE foodcourt_staging_db"

# 2. Schema + seed data (staging only; seeds demo accounts with password123)
cd backend
php artisan migrate --env=staging --force
php artisan db:seed --env=staging --force

# 3. Services (each in its own terminal / background)
php artisan serve        --env=staging --host=0.0.0.0 --port=8100
php artisan reverb:start --env=staging --host=0.0.0.0 --port=8180
# extra API workers used only for the concurrency tests:
php artisan serve --env=staging --host=127.0.0.1 --port=8101   # (also 8102, 8103)

# 4. Web apps built against the staging API, served as production builds
cd ..\frontend-customer;  $env:VITE_API_BASE_URL='http://<edge-ip>:8100/api'; pnpm build; pnpm exec vite preview --host 0.0.0.0 --port 4101
cd ..\frontend-desktop;   $env:VITE_API_BASE_URL='http://<edge-ip>:8100/api'; pnpm build; pnpm exec vite preview --host 0.0.0.0 --port 4102

# 5. Validation
node qa/staging/staging-validation.mjs        # 91 checks, writes qa/staging/results/latest.json
cd backend; php artisan test                   # 37 tests (uses foodcourt_test_db)
```

Customer QR URL format: `http://<edge-ip>:4101/table/<qr_token>`. The owner can read the tokens via `GET /api/tables`. There is no QR printing screen yet (OPEN-08).

## 4b. Port map in use (verified 2026-11-02, LAN IP 10.16.20.53)

| Service | Port | Bound |
|---|---|---|
| Staging API (`artisan serve --env=staging`) | 8100 | 0.0.0.0 |
| Extra API workers (concurrency tests only) | 8101–8103 | 127.0.0.1 |
| Reverb | 8180 | 0.0.0.0 |
| **Customer QR** production build (`vite preview`) | **4101** | 0.0.0.0 |
| **Desktop** production build (`vite preview`) | **4102** | 0.0.0.0 |
| Expo Metro (Expo Go, LAN) | 8081 | all |

Metro for Expo Go with the staging API baked in as the app default:
```powershell
cd mobile-app
$env:EXPO_PUBLIC_API_URL = 'http://<edge-ip>:8100/api'
npx expo start --go --lan --port 8081 --clear
```

## 5. Startup order and health checks

1. PostgreSQL service running: `Get-Service postgresql-x64-17`.
2. API: `GET http://<edge-ip>:8100/up` → 200.
3. Reverb: `php artisan reverb:start` prints "Starting server on 0.0.0.0:8180".
4. Queue worker (production): `php artisan queue:work --env=<env> --tries=3`. Broadcasts are currently `ShouldBroadcastNow`, so no worker is needed for realtime.
5. Desktop: log in as cashier, and the pending bills drawer loads.

## 6. Moving from staging to a pilot edge server (not yet done)

| Item | Requirement | Status |
|---|---|---|
| PHP runtime | **OPcache on**, production server (Linux: nginx + php-fpm, or Laravel Octane/FrankenPHP; Windows: IIS + FastCGI or Laragon nginx). `artisan serve` handles **one request at a time** on Windows. | **Required**. Measured 370 ms per request without OPcache; SQL only 0.12 ms |
| Laravel caches | `php artisan config:cache route:cache event:cache` after every deploy. **Never** run `config:cache` on a developer machine that also runs the test suite (the cached config would point tests at the wrong database). | Required |
| Process supervision | API, Reverb and the queue worker as services (NSSM / Windows services, or systemd) with auto-restart | Required |
| HTTPS | Only if anything is exposed beyond the LAN. On a closed LAN, HTTP is used and the Android app allows cleartext. | Decide per site |
| DB role | Dedicated least-privilege role instead of `postgres` | Required (OPEN-06) |
| Secrets | Fresh `APP_KEY`, Reverb key/secret, DB password per environment | Required |
| Accounts | Replace seeded demo accounts; real passwords (no user-management UI yet: OPEN-02) | **Blocker** |
| Backups | `ops/backup/backup-db.ps1` scheduled, plus off-box copy | Required |
| Monitoring | `storage/logs/laravel-*.log` (daily). `/up` polled by a simple scheduled task. No external error tracker configured. | Minimal |
| Time zone | `config/app.php` timezone is **UTC**. Business-day boundaries for EOD use UTC dates. Confirm the business day with the owner before changing (changing it after data exists shifts reports). | Decision needed (OPEN-07) |
