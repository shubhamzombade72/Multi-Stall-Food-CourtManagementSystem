# Production deployment guide (backend for the Windows desktop app)

> **Not needed for the default install.** Desktop v1.1.0 carries its own database and works on one PC with nothing hosted
> anywhere (`README.md` §2). Use this guide to build the **host** for several PCs; the other PCs then join it with a connection
> code (`multi-pc-deployment.md`). Nobody types an address.

**Status (2026-11-03): no shared production backend has been identified, deployed or verified.** This repository
records no production hostname, and none was invented. Everything below is what a shared server must satisfy before
client PCs can use it. Nothing here has been executed against production infrastructure.

## 0. Decision needed from the project owner

| Question | Why it matters |
|---|---|
| **What is the production API address?** (`https://<host>/api`) | The installer cannot be pre-configured and clients cannot be given an address without it |
| Hosted server (internet, HTTPS) or edge server on the food court LAN? | Docs so far describe an **edge server** (`docs/staging/staging-deployment-guide.md` §1). The client's failure suggests they expect a server they do not host |
| Who operates it (OS, web server, backups)? | Determines §2 |

## 1. What was verified on the development machine (staging, read-only)

| Item | Result | Evidence |
|---|---|---|
| API routing | OK | `POST api/auth/login`, `POST api/auth/logout`, `GET api/auth/me` present |
| Migrations | OK | `migrate:status --env=staging`: all 18 `Ran` |
| PostgreSQL | OK | Listening on 5432; API serves data from `foodcourt_staging_db` |
| Health endpoint | OK | `GET /up` → 200 |
| Authentication | OK | valid login 200; wrong password 422; no/garbage/revoked token 401; logout 200 and token then 401 |
| CORS from the packaged app (`file://`, `Origin: null`) | OK | preflight 204 with `Allow-Headers: authorization,content-type`; `allowed_origins: *` (safe here: Bearer tokens, `supports_credentials=false`) |
| Login throttle | OK | `throttle:login` = 5/min per email+IP; triggered during testing (HTTP 429) |
| File storage | Writable | `storage/logs`, `storage/framework/cache`, `storage/app` |

## 2. NOT satisfied (blockers for a production host)

| # | Finding | Required for production |
|---|---|---|
| 1 | The API was reachable only through `php artisan serve --host=127.0.0.1 --port=8100` on the developer PC. That serves one request at a time and is not a production server | nginx/IIS + php-fpm (or Octane/FrankenPHP), supervised |
| 2 | No HTTPS anywhere; staging is plain `http://` | TLS certificate valid for the public name, auto-renewing; only 443 (and 80→443) exposed |
| 3 | No production environment file. Default `backend/.env` is `APP_ENV=local`, `APP_DEBUG=true` | `APP_ENV=production`, `APP_DEBUG=false`, new `APP_KEY`, `APP_URL=https://<host>` |
| 4 | DB role is `postgres` with a weak password | Dedicated least-privilege role, strong password, PostgreSQL listening on localhost only |
| 5 | OPcache not loaded (measured 370 ms/request without it) | Enable OPcache; run `config:cache route:cache event:cache` on deploy |
| 6 | No `trustProxies` configured (`bootstrap/app.php`) | Behind a reverse proxy/CDN set trusted proxies, otherwise every client appears as the proxy IP and **the login throttle locks everyone out together**, and `https` is not detected |
| 7 | Reverb (port 8180) and a queue worker are not running | The desktop app does not need Reverb (the KDS polls every 4 s; the desktop build has no Reverb key). Run a supervised `queue:work` only if queued jobs are introduced (`QUEUE_CONNECTION=database` today; broadcasts are `ShouldBroadcastNow`) |
| 8 | Seeded demo accounts (`password123`) | Remove/replace with real owner credentials; never ship demo data |
| 9 | Sanctum `expiration => null`: tokens never expire; they are revoked only on a new login or logout | Decide a lifetime; the desktop app already handles a rejected token (returns to sign-in with a notice) |
| 10 | Backups only via a manual script | Schedule `ops/backup/backup-db.ps1` plus an off-box copy |

Do **not** expose port 8100, the `artisan serve` process or PostgreSQL to the internet to "make the EXE work".

## 3. Verifying a production server (run from any PC, before touching a client)

```powershell
$api = 'https://<production-host>'            # supplied by the project owner
curl.exe -i "$api/up"                          # expect HTTP 200
curl.exe -i "$api/api/auth/me" -H "Accept: application/json"   # expect HTTP 401 (JSON), proves it is the Food Court API
# Sign in with a real, authorized account (typed by you, never stored in scripts or the installer):
curl.exe -s -X POST "$api/api/auth/login" -H "Accept: application/json" -H "Content-Type: application/json" `
  -d '{"email":"<owner email>","password":"<typed password>"}'   # expect HTTP 200 and a token
```

Then create the owner and the first connection code on the host (`php artisan foodcourt:create-owner …`,
`php artisan foodcourt:pairing-code --url=https://<production-host>/api`), and on a clean Windows PC: install the desktop app,
choose *Connect to an existing food court*, paste the code, sign in, open Dashboard, Stalls and POS, close and reopen.
Full procedure: `multi-pc-deployment.md`.

## 4. Server-side checklist

- [ ] Production DB created, `php artisan migrate --force` run once (never `migrate:fresh` on data)
- [ ] `APP_ENV=production`, `APP_DEBUG=false`, unique `APP_KEY`, correct `APP_URL`
- [ ] HTTPS certificate valid for the production name; HTTP redirects to HTTPS
- [ ] OPcache on; Laravel caches built; PHP-FPM / web server supervised with auto-restart
- [ ] Trusted proxies configured if behind a proxy/CDN
- [ ] DB role least-privilege; PostgreSQL not publicly reachable
- [ ] Real owner account created; demo accounts absent
- [ ] Firewall: only 80/443 public
- [ ] Backups scheduled and a restore tested
- [ ] Log monitoring on `storage/logs/laravel-*.log` and `/up`
