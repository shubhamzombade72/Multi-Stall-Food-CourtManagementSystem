# FoodCourt Desktop (Windows)

The Windows desktop app is now the primary product: Owner/Admin, Cashier POS, Kitchen Display (KDS), Menu,
Purchasing & Inventory, Daily Closing & Reports, Staff & Permissions. It is the existing React app
(`frontend-desktop/`) wrapped in Electron 44.9.0 and packaged with electron-builder 26.17.0 (NSIS, x64).

The Android app and the customer QR app are **frozen (P2)**: code kept, not developed further in this phase.

## 1. Install

1. Run `Multi-Stall-Food-Court-Setup-1.1.0.exe` (built to `frontend-desktop/installers/1.1.0/`, ~130 MB). Nothing else to install:
   the program carries everything it needs. It installs over 1.0.x and keeps the data (`release-notes-1.1.0.md`).
2. The installer is per-user (no admin rights), lets you choose the folder, and creates a desktop shortcut.
3. **The installer is not code-signed.** Windows SmartScreen will warn "Windows protected your PC" → *More info* →
   *Run anyway*. PCs with **Smart App Control** or an application-control policy can block it outright; a code-signing
   certificate (covering the app **and** the bundled `php.exe`) is required before distributing beyond internal testing.
4. Earlier installers (1.0.0, 1.0.1) must not be given to clients: see `release-notes-1.0.2.md`. 1.0.2 is superseded by 1.1.0.

Silent install (IT / scripted): `Multi-Stall-Food-Court-Setup-1.1.0.exe /S /D=C:\Path\To\Folder`
Uninstall: *Settings → Apps → Multi-Stall Food Court*. Uninstalling does **not** delete the data folder (see §2).

## 2. How it works

**One PC (default):** open the app. It starts its own database by itself (the start-up screen shows *Starting application →
Preparing database → Connecting to food court services → ready*), then shows the **Welcome** screen on the very first run, or the
sign-in screen afterwards. **There is no server address to enter and no screen to enter one on.**

- **First launch:** Welcome asks for the owner's name, email and a password (8+ characters, letters and numbers), then shows a
  **one-time recovery key** to print or write down. There are no demo accounts and no default passwords.
- **Data** is stored on this PC only, in `%APPDATA%\FoodCourt Desktop\server\`. It is never in the install folder, survives upgrades
  and reinstalls, and uninstalling does **not** delete it. Automatic daily verified backups: `backup-and-recovery.md`.
- **Closing the app stops its server.** If the server ever stops by itself it is restarted; if it cannot be, the screen says
  "Service unavailable. Contact your administrator." with *Try again*, *Restore a backup…* and *Copy support information*.
- **Several PCs:** one host keeps the shared database; the other PCs join it with a one-time connection code:
  `multi-pc-deployment.md`. Why it is built this way: `architecture-decision.md`.
- Owner-only tools in **Device Settings**: Backup & recovery, owner recovery key, Connected computers (host), Support information.
- Support: `login-failure-root-cause.md` (how to find out why someone cannot sign in), `client-handover.md`.

## 3. Build from source

```powershell
cd frontend-desktop
pnpm install            # .npmrc sets node-linker=hoisted (required by electron-builder)
pnpm test               # desktop unit tests (KDS state machine, CSV safety, API URL validation)
pnpm build              # tsc + vite build -> dist/
pnpm electron:start     # build and run in Electron (unpackaged, DevTools allowed)
pnpm dist:win           # build + assemble built-in server (needs PHP 8.3 on PATH) + NSIS installer -> installers/<version>/
```

Optional realtime for the KDS: build with `VITE_REVERB_APP_KEY`, `VITE_REVERB_HOST`, `VITE_REVERB_PORT`,
`VITE_REVERB_SCHEME`. Without them the KDS polls every 4 s (the verified mode).

If `electron-builder` fails with `EBUSY … app.asar`, a scanner or file watcher is holding files in `release/`;
build to another folder: `pnpm exec electron-builder --win --x64 -c.directories.output=<folder>`.
The installer folder is `installers/<version>/` (git-ignored); bump `version` in `package.json` for every release so a new
installer can never be confused with one already delivered.

## 4. Security model

| Control | Implementation |
|---|---|
| Renderer isolation | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true` |
| Bridge | `preload.cjs` exposes exactly eight functions on `window.desktop`: `getConfig`, `setApiBaseUrl`, `useBuiltInServer`, `testConnection`, `getAppInfo`, `log`, `listPrinters`, `print` |
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

- **No data sharing between PCs in the default (single-PC) mode.** Each computer has its own database. Several PCs that must see the same orders need one shared server (`production-deployment.md`).
- No auto-update. Install new versions over the old one (settings and config are kept).
- No expense management, discounts, refunds, split payments, recipe/BOM depletion. See `docs/staging/known-limitations.md`.
