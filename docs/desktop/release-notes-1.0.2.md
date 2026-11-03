# Release notes: Windows desktop v1.0.2 (2026-11-03)

## Status

**FIXED BUT NOT VERIFIED ON A CLIENT PC.** v1.0.2 opens and works on a single PC with nothing to configure. It was
verified on the development PC only. Run the checklist in `client-handover.md` on the client's PC before saying the
problem is solved. **Code signing is still required** (see Known issues #1).

## What changed for the client

The client no longer has to know about, type or understand a server address. **Install, open, create the owner
account, work.** The program contains its own server and database and starts them itself.

| Version | What happened on a client PC |
|---|---|
| 1.0.0 (all delivered builds) | Tried `http://127.0.0.1:8000/api`: a server that was never installed. Sign-in failed with "Verify your credentials" |
| 1.0.1 (internal only, not for clients) | Removed that default but asked the client for a server address they did not have ("Server setup required") |
| **1.0.2** | Starts its own server on this PC. First launch shows a Welcome screen to create the owner account. Nothing else to enter |

## The installer

| | |
|---|---|
| File | `Multi-Stall-Food-Court-Setup-1.0.2.exe` |
| Location | `frontend-desktop/installers/1.0.2/` (git-ignored build output) |
| Size | 135,665,960 bytes (129.4 MiB) |
| SHA-256 | `23c0302a0de2b183a650c461ba48add57e9ed524c4cbe454859d1ec13b11fd9a` |
| Signed | **No** (neither the app nor the bundled `php.exe`) |
| Pre-configured server | None needed (`electron/app-config.json` stays empty; the built-in server is the default) |

Not for clients: `1.0.0` (4 installers, listed in `release-notes-1.0.1.md`) and `1.0.1`.

## How it works

- **Built-in server.** The installer carries PHP 8.3 (minimal: SQLite, OpenSSL, mbstring, OPcache) and the Laravel API
  (production dependencies only; no tests, demo seeders or `.env`). On every launch the app starts it on a free
  `127.0.0.1` port (this PC only, not reachable from the network), applies database migrations, and stops it when the app closes.
- **Local database.** SQLite in `%APPDATA%\FoodCourt Desktop\server\foodcourt.sqlite`. Before the first start of a new program
  version the database is copied to `...\server\backups\` (last 5 kept).
- **First run.** An empty database shows **Welcome**: name, email, password (8+ chars, letters and numbers). This creates the
  owner (`POST /api/setup/owner`, which exists only inside the built-in server and only while there are no users; it answers
  404 on any other server). No demo accounts, no default passwords.
- **Shared server still possible.** Settings → *Advanced: connect to a different server* (and `app-config.json` for pre-set
  installers) point a PC at a shared server instead; *Use the built-in server* switches back.
- **Backend portability.** The API now runs on PostgreSQL (shared servers) **and** SQLite: four search endpoints used
  PostgreSQL-only `ILIKE` and now pick the right operator (`App\Support\Sql::like()`). No schema change.

### Files changed (no commit made)

Backend: `app/Support/Sql.php` (new), `app/Http/Controllers/Api/{Billing,Customer,Order,Purchase}Controller.php` (case-insensitive search
operator), `app/Http/Controllers/Api/SetupController.php` (new), `config/foodcourt.php` (new), `routes/api.php`,
`tests/Feature/EmbeddedSetupTest.php` (new).
Desktop: `electron/embedded-server.cjs` (new), `electron/main.cjs`, `electron/preload.cjs`, `scripts/prepare-embedded-server.mjs` (new),
`scripts/embedded-router.php` (new), `src/pages/FirstRunPage.tsx` (new), `src/pages/ServerStartFailedPage.tsx` (new), `src/pages/SettingsPage.tsx`,
`src/pages/LoginPage.tsx`, `src/App.tsx`, `src/api/client.ts`, `src/desktop/bridge.ts`, `index.html`, `package.json` (version 1.0.2,
`extraResources`, `prepare:server`), `tests/embedded-server.test.ts` (new), `e2e/electron-workflow.e2e.mjs`; root `.gitignore`; docs.

## Verification performed

| Check | Result |
|---|---|
| Backend suite on **PostgreSQL** (shared-server path) | 70/70 pass (incl. 5 new first-run tests) |
| Backend suite on **SQLite** (built-in path) | 70/70 pass |
| TypeScript | 0 errors |
| Desktop unit tests | 22/22 pass (runtime location, environment, app key, upgrade backup, URL/error classification) |
| Built-in server, standalone (staged PHP, empty data folder, backend on D:, data on C:) | migrate OK (31 tables); setup flow, login and 6 endpoints OK at ~15-38 ms per request; `.env` and `composer.json` return 404 |
| Fresh-profile UI journey, **17 steps**, no address configured, run twice: from `build-server/` and from the packaged copy `win-unpacked/resources/server` | 17/17 both runs: opens to Welcome in ~2-5 s, weak/mismatched password refused, owner created and signed in, dashboard shows server data, settings shows built-in status + data folder with no address field, closing the app stops the server (no orphan `php.exe`), reopening keeps the session and data, wrong password message, sign-in |
| Failure screen (bundled PHP made unusable) | 5/5: clear message, "data not changed", Try again, support log named, failure logged |
| Installer payload vs source | 10/10 app files byte-identical (sha256) to the final source build; version 1.0.2 |
| Installer contents | server bundle present (6,899 files); no `.env`, tests, seeders, factories, dev packages |

### Caveats: read before claiming anything

1. **Not run on a separate clean Windows PC.** Everything above ran on the development PC.
2. **The final packaged `.exe` was not launched here.** Windows Smart App Control is enforcing on the development PC and blocks
   newly built unsigned executables. Its setting was not changed. The same Electron code was run through the Electron runtime, the
   server bundle from the packaged `resources\server` folder was exercised, and the installer's `app.asar` was compared to source.
3. **The NSIS install/uninstall wizard was not run** (it would overwrite the `FoodCourt Desktop 1.0.0` already registered on this PC).
4. **Business workflows on SQLite are covered by the backend test suite** (order, split tickets, payment, closing, settlement, security),
   not by a new UI end-to-end run. The earlier 38-step UI e2e (v1.0.1) ran against PostgreSQL and still applies to the shared-server mode.
5. The development PC's own saved profile (`%APPDATA%\FoodCourt Desktop\config.json`) may still point at the staging server (`127.0.0.1:8100`);
   in that case this PC will use that server, not the built-in one, until Settings → *Use the built-in server* is pressed or that file is removed.

## Known issues

| # | Issue | Impact | Action |
|---|---|---|---|
| 1 | **Installer and bundled `php.exe` are unsigned.** SmartScreen warns; PCs with **Smart App Control** or an application-control policy can block the installer, the app, or the built-in server outright | Possible install/start failure on the client PC | Apply a code-signing certificate to the installer, the app **and** `php.exe`/DLLs (`signExts`), or have IT allow-list the app. Check the client's Windows policy |
| 2 | **No data sharing between PCs** | Several PCs would each have separate data | Use one PC, or a shared server (`production-deployment.md`) |
| 3 | **No owner password recovery and no in-app backup/restore** | A forgotten owner password locks the owner out; data loss if the PC fails | Add both before wide rollout; until then back up `foodcourt.sqlite` regularly |
| 4 | Built-in server is PHP's single-process web server | One request at a time; fine for one counter | Production runtime for shared servers |
| 5 | Business-day cut-off is UTC (L-15) | Day boundary at 05:30 IST | Owner decision pending |
| 6 | Receipt printing not verified on a thermal printer; no auto-update | As before | Unchanged |
