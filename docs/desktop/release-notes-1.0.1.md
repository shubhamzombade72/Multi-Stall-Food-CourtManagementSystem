> **Superseded by v1.0.2 (`release-notes-1.0.2.md`).** 1.0.1 removed the 127.0.0.1 default but still asked clients for a server
> address. Do not give 1.0.1 to clients. Kept for the record of the original diagnosis.

# Release notes: Windows desktop v1.0.1 (2026-11-03)

## Status

**FIXED BUT NOT VERIFIED ON CLIENT ENVIRONMENT.** The cause of the client's sign-in failure is fixed in the app, but
there is **no production API address** to connect it to, and the installer has not been run on a separate clean
Windows PC. Do not tell the client it is resolved until the checklist in `client-handover.md` has been completed on
their PC against their real server.

## The installer

| | |
|---|---|
| File | `Multi-Stall-Food-Court-Setup-1.0.1.exe` |
| Location | `frontend-desktop/installers/1.0.1/` (git-ignored build output) |
| Version | 1.0.1 (`package.json`) |
| Size | 121,530,989 bytes (115.9 MiB) |
| SHA-256 | `cac5a88d3cf13ba7957fdbad87e8c7e7648bba869e9f7221811819d23ddc5404` |
| Built | 2026-11-03 09:24 IST |
| Signed | **No** (no certificate configured) |
| Pre-configured server | **None** (`electron/app-config.json` → `apiBaseUrl: ""`) |

**It is a different file from the one already delivered.** The delivered installers are all version **1.0.0** and
embed `http://127.0.0.1:8000/api`:

| Old installer (do not use) | Size (bytes) |
|---|---|
| `frontend-desktop/release/FoodCourt-Desktop-Setup-1.0.0.exe` | 120,718,621 |
| `frontend-desktop/dist-electron/Multi-Stall-Food-Court-Setup-1.0.0.exe` | 120,696,346 |
| `frontend-desktop/dist-electron-v1/Multi-Stall-Food-Court-Setup-1.0.0.exe` | 121,527,267 |
| `frontend-desktop/dist-electron-v2/Multi-Stall-Food-Court-Setup-1.0.0.exe` | 121,527,472 |

(Which of these went to the client is not recorded in the repository. All four share the defect.)

## Root cause of the client's sign-in failure

Every 1.0.0 installer contained a built-in default server address of `http://127.0.0.1:8000/api` in **two** places:
the Electron main process (`DEFAULT_API_BASE_URL`) and the web bundle (compiled in from a local `.env`,
`VITE_API_BASE_URL`). `127.0.0.1` means "this computer". The client's PC has no Laravel server, so every request
failed at the network layer. The sign-in screen then showed the generic text *"Login failed. Please verify your
credentials."*, which wrongly suggested a bad password.

The `:8100` address seen on the developer PC was a **saved setting on that PC** (`%APPDATA%\FoodCourt Desktop\config.json`,
written while testing staging). It was never in the installers. Starting `artisan serve` on `:8100` there made the
developer's own app work and did nothing for the client.

## Changes

| Area | v1.0.0 | v1.0.1 |
|---|---|---|
| Default server | `http://127.0.0.1:8000/api`, silently | **None.** Fresh install shows **Server setup required** |
| Address sources | saved file → env → hard-coded default | saved file → env → `electron/app-config.json` (release setting) → none |
| Renderer default | `VITE_API_BASE_URL` baked in at build time | Ignored by the desktop app (web build only) |
| Validation | `http(s)://…/api` | same, plus warnings: loopback address; plain `http://` on a public host |
| Connection test | browser-side `GET /up`, generic text | Main-process test of `/auth/me` + `/up`; distinguishes DNS, certificate, refused, timeout, redirect, wrong path (404), server error (5xx) |
| Sign-in errors | one generic message for everything | Specific: invalid credentials, unauthorized, deactivated (403), rate limited (429), unreachable/DNS/TLS/timeout, wrong path, server error, **session expired** notice |
| First-run flow | n/a | Setup continues to sign-in only after the server answered |
| Status | banner when offline | plus current address and live Online/Offline in Server settings |
| Bridge | 6 functions | 7 (`testConnection` added) |
| Realtime | fell back to `127.0.0.1` if the address was unparseable | no loopback fallback |

Not changed: database schema, backend code, existing desktop features, security model (contextIsolation, sandbox, CSP).

### Files modified (no commit made)

`frontend-desktop/`: `electron/main.cjs`, `electron/preload.cjs`, `electron/config.cjs`, **new** `electron/app-config.json`,
`src/api/client.ts`, **new** `src/lib/apiErrors.ts`, `src/desktop/bridge.ts`, `src/pages/LoginPage.tsx`,
`src/pages/SettingsPage.tsx`, `src/App.tsx`, `src/hooks/useConnection.ts`, `src/realtime/echo.ts`, `src/vite-env.d.ts`,
`package.json` (version 1.0.1, output `installers/${version}`), `.env.example`, `.env` (local, git-ignored: loopback value removed),
`tests/desktop.test.ts`, `e2e/electron-workflow.e2e.mjs`. Also `.gitignore` (+`frontend-desktop/installers/`) and docs
(`docs/desktop/*`, `docs/staging/known-limitations.md`).

## Verification performed (and not performed)

| Check | Result |
|---|---|
| TypeScript (`tsc`) | 0 errors |
| Unit tests (`pnpm test`) | 16/16 pass (11 new: no-loopback-default guard, bundled-config validation, URL warnings, network/API error classification, sign-in error mapping) |
| Vite production build | OK; the bundle contains no API address (only a third-party library's `http://localhost` URL-parsing fallback) |
| Electron main/preload syntax | OK. Smoke test (`FOODCOURT_SMOKE_TEST=1`, Electron runtime from source, throw-away profile): all security checks pass; unconfigured → Server setup screen; configured → sign-in, and the `file://` page reaches the API incl. a CORS-preflighted `Authorization` request |
| Installer contents | asar holds 9 files, 0 secrets; `app-config.json` empty; app code **byte-identical** to the source build (9/9 sha256) |
| Desktop e2e regression (38 business-workflow steps, packaged 1.0.1 exe, isolated e2e DB) | Run 1: 38 pass, 2 fail → both were test-script issues (S-02 hard-coded the 6-function bridge; P-06 locator matched two cells). Fixed. Run 2: 39 pass, 1 fail (R-05 can only pass once per UTC day per DB, see below). **Every check passed at least once; no single run was 40/40.** These runs used an **earlier build of 1.0.1** (before the first-run confirmation fix below) |
| Auth matrix (staging API, local) | health 200; valid login 200; wrong password 422; unknown email 422 (identical message); no/forged/revoked token 401; Bearer works; logout 200 then token 401; login again 200 |
| Clean-profile checklist, 19 steps (fresh profile, nothing configured): setup screen, bad/dead/DNS addresses, save, sign-in, wrong password, owner dashboard, stalls with real data, POS with real data, token sent, close/reopen persistence, expired-token notice, re-login, logout | **19/19 pass**, run on the final 1.0.1 code in the Electron runtime (see caveat) |

### Caveats: read before claiming anything

1. **Not run on a separate clean Windows PC.** All testing was on the development PC.
2. **The final packaged `.exe` could not be launched on the development PC.** Windows **Smart App Control** is enforcing there
   and blocked the new unsigned executable ("An Application Control policy has blocked this file"). Its security setting
   was not changed. The code inside the installer was proven byte-identical to the source build and was run through the
   Electron runtime instead. The earlier packaged build of 1.0.1 did run (e2e above).
3. **The NSIS install/uninstall wizard was not executed.** Running it here would have overwritten the existing
   `FoodCourt Desktop 1.0.0` registration (same app ID GUID). The installer payload was extracted and inspected only.
4. **No production server was tested.** None is identified. Tests used the local staging API (`127.0.0.1:8100`) and the isolated e2e API (`127.0.0.1:8120`, since stopped).

## Known issues

| # | Issue | Impact | Action |
|---|---|---|---|
| 1 | **No production API address.** The installer cannot be pre-configured and clients cannot connect | **Blocker** | Project owner must supply `https://<host>/api` and a hosted/LAN server must exist (`production-deployment.md`) |
| 2 | **Installer is unsigned.** Windows SmartScreen warns; on PCs with **Smart App Control** or an application-control policy the app can be **blocked outright with no "Run anyway"** | Possible install failure on the client PC | Buy/apply a code-signing certificate, or have IT allow-list the app. Confirm the client's Windows policy |
| 3 | The backend is currently only reachable through `php artisan serve` (single-request dev server) on the developer PC | Cannot serve clients | See `production-deployment.md` §2 |
| 4 | Sanctum tokens never expire | Lost PC keeps its session | Decide a token lifetime |
| 5 | No `trustProxies`; the sign-in throttle is 5/min per email+IP | Behind a proxy all users share one limit | Configure before using a proxy/CDN |
| 6 | e2e step R-05 passes once per UTC day per DB | Re-runs the same day report a false failure | Re-run next day or on a fresh e2e DB |
| 7 | Receipt printing not verified on a physical thermal printer; no auto-update | As before | Unchanged from 1.0.0 |
