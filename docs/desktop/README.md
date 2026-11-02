# FoodCourt Desktop (Windows)

The Windows desktop app is now the primary product: Owner/Admin, Cashier POS, Kitchen Display (KDS), Menu,
Purchasing & Inventory, Daily Closing & Reports, Staff & Permissions. It is the existing React app
(`frontend-desktop/`) wrapped in Electron 44.9.0 and packaged with electron-builder 26.17.0 (NSIS, x64).

The Android app and the customer QR app are **frozen (P2)**: code kept, not developed further in this phase.

## 1. Install

1. Run `FoodCourt-Desktop-Setup-1.0.0.exe` (produced in `frontend-desktop/release/`, ~115 MB).
2. The installer is per-user (no admin rights), lets you choose the folder, and creates a desktop shortcut.
   Default folder: `%LOCALAPPDATA%\Programs\FoodCourt Desktop`.
3. **The installer is not code-signed.** Windows SmartScreen will warn "Windows protected your PC" → *More info* →
   *Run anyway*. A code-signing certificate is required before distributing beyond internal testing.

Silent install (IT / scripted): `FoodCourt-Desktop-Setup-1.0.0.exe /S /D=C:\Path\To\Folder`
Uninstall: *Settings → Apps → FoodCourt Desktop 1.0.0*, or `Uninstall FoodCourt Desktop.exe /currentuser /S`.

## 2. Point it at the server

The app holds **no database credentials**. It talks only to the Laravel API over HTTP(S) with a per-user
Sanctum token obtained at sign-in.

- First launch defaults to `http://127.0.0.1:8000/api` (the API on the same PC).
- On a counter PC, open **Server settings** on the login screen (or *Settings* after sign-in), enter the
  server address, e.g. `http://192.168.1.50:8000/api`, press **Test connection**, then **Save**.
- Accepted form: `http(s)://host[:port]/…/api` with no user/password, query or fragment. Anything else is rejected.
- Stored in `%APPDATA%\FoodCourt Desktop\config.json` (written atomically). Only `apiBaseUrl` is stored.
- The sidebar shows the live server status (polls `/up` every 15 s); a red banner appears when the server is unreachable.

## 3. Build from source

```powershell
cd frontend-desktop
pnpm install            # .npmrc sets node-linker=hoisted (required by electron-builder)
pnpm test               # desktop unit tests (KDS state machine, CSV safety, API URL validation)
pnpm build              # tsc + vite build -> dist/
pnpm electron:start     # build and run in Electron (unpackaged, DevTools allowed)
pnpm dist:win           # build + NSIS installer -> release/
```

Optional realtime for the KDS: build with `VITE_REVERB_APP_KEY`, `VITE_REVERB_HOST`, `VITE_REVERB_PORT`,
`VITE_REVERB_SCHEME`. Without them the KDS polls every 4 s (the verified mode).

If `electron-builder` fails with `EBUSY … app.asar`, a scanner or file watcher is holding files in `release/`;
build to another folder: `pnpm exec electron-builder --win --x64 -c.directories.output=<folder>`.

## 4. Security model

| Control | Implementation |
|---|---|
| Renderer isolation | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true` |
| Bridge | `preload.cjs` exposes exactly six functions on `window.desktop`: `getConfig`, `setApiBaseUrl`, `getAppInfo`, `log`, `listPrinters`, `print` |
| IPC | Each handler checks the sender frame is the app's own page; anything else is rejected and logged |
| CSP | Injected into the production `index.html`: `script-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'` |
| Navigation | `will-navigate` away from the app is blocked; `window.open` is denied (http(s) links open in the system browser) |
| Permissions | Every web permission request (camera, mic, geolocation, notifications…) is refused |
| DevTools | Disabled in the packaged app |
| Credentials | No DB credentials, `.env`, keys or SQL in the package (asar inspected: 10 files, see report) |
| Single instance | A second launch focuses the existing window |
| Authorization | Enforced by the server on every request (role + stall); the UI only hides what the role cannot use |

Self-check: launch with `FOODCOURT_SMOKE_TEST=1` and it prints one `SMOKE_RESULT {…}` JSON line and exits 0/1.

## 5. Logs

`%APPDATA%\FoodCourt Desktop\logs\desktop.log` (rotated at 2 MB). Renderer errors, failed API calls (network / 5xx),
blocked navigation and print failures are recorded. Settings → About shows the path and version.

## 6. Printing

- Receipts (POS after payment, and *Payment History → Reprint*) render an 80 mm layout; reports print on A4.
- Printing goes through the Windows print dialog (`webContents.print`, not silent), so the cashier picks the printer.
- Settings lists the printers Windows reports.
- **Not verified on a physical thermal printer.** Verified only up to the print dialog. Test on the actual
  receipt printer before go-live.
- An unpaid order prints as "UNPAID - NOT A RECEIPT".

## 7. Role landing pages

| Role | Lands on | Can open |
|---|---|---|
| Owner | Dashboard | everything |
| Cashier | POS | POS, Orders & Receipts, Payment History |
| Stall manager | Kitchen Display | KDS, own stall, menu, inventory, purchasing (own stall only) |
| Kitchen staff | Kitchen Display | KDS (own stall only) |
| Store staff | Inventory | inventory (own stall only) |

Every role also has Settings. This table is sidebar visibility; the API enforces the same rules independently.

## 8. Not supported (by decision)

- **No offline mode.** The desktop needs the API reachable. A Local Edge Server needs a separately approved architecture.
- No auto-update. Install new versions over the old one (settings and config are kept).
- No expense management, discounts, refunds, split payments, recipe/BOM depletion. See `docs/staging/known-limitations.md`.
