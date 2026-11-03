# Release notes: Windows desktop v1.1.0 (2026-11-03)

## Status

**Built and tested on the development PC. NOT installed on a clean Windows PC. NOT code-signed. NOT committed or deployed.**
See `release/reports/v1.1.0-clean-install-test-report.md` before handing it to anyone.

## The installer

| | |
|---|---|
| File | `frontend-desktop/installers/1.1.0/Multi-Stall-Food-Court-Setup-1.1.0.exe` (git-ignored build output) |
| Size | 135,692,090 bytes |
| SHA-256 | `6449673ba00b3cf4dc4cae3d2afc4c8c0e14543fb01f9438d1519f7493b8db98` |
| Signed | No (app, installer and bundled `php.exe`) |
| Replaces | 1.0.2 (its installer is untouched: SHA-256 still `23c0302a…11fd9a`) |
| Payload check | Installer extracted with 7-Zip: `app.asar` byte-identical to the tested build; 6,985 files; no `.env`, seeders, factories or tests |

## What changes for the client

* **No server screen at all.** Opening the app shows *Starting application → Preparing database → Connecting to food court services*,
  then Welcome (first run) or Sign in. The *Server connection* screen, API address field, Save & test, Test connection, localhost
  address and health-check URL are gone from the application.
* **Sign-in works however the email is capitalised** (root cause of the reproduced login failure: `login-failure-root-cause.md`).
* **Clear messages:** "not set up yet" → Welcome; "no accounts any more" → recovery; wrong password stays "Invalid email or password."
* **Recovery key** at setup, **Forgot password?** on sign-in; existing owners create a key in Device Settings.
* **Automatic, verified daily backups**, Back up now, choose a backup folder, restore (from Device Settings, from the failure screen, or
  from the Welcome screen when moving to a new PC). Owner warning banner if backups fail or stop.
* **Several PCs:** one host (PostgreSQL) + terminals joined with a one-time connection code (`multi-pc-deployment.md`).
* **Self-healing:** a stopped built-in server is restarted; a leftover one from a crash is cleaned up; a busy port is skipped.
* **Plain-language failure screen** ("Service unavailable. Contact your administrator.") with Try again, Restore a backup, Copy support information.

## Upgrading from 1.0.x

Install over it. Data stays where it is (`%APPDATA%\FoodCourt Desktop\server\`), a copy is made before 1.1.0 first opens it, one additive
table (`paired_devices`) is added. Existing owners keep their password and are never sent to the Welcome screen again. Tested against a
database created by the **delivered 1.0.2 build** (`qa/desktop/lifecycle.e2e.mjs`). An address typed by hand in 1.0.x that pointed at
"this computer" (`127.0.0.1`/`localhost`, e.g. the 1.0.0 default `:8000`) is ignored, so such a PC opens on its own database instead of a
"cannot reach" screen (verified with a profile carrying `http://127.0.0.1:8000/api`). A saved LAN/internet server address is still used.

## Changed files (no commit made)

Backend: `AuthController` (case-insensitive lookup, `setup_required`/`owner_missing`), `SetupController` (marker, recovery key, recover),
`StaffController` (case-insensitive uniqueness), `User` (normalised emails), `AppServiceProvider` (named limiters), `routes/api.php`,
`bootstrap/app.php`, `config/foodcourt.php`; new `SystemController`, `PairingController`, `RequirePairedDevice`, `PairedDevice`,
`SetupState`, `SystemHealth`, `SqliteBackup`, `PairingCodes`, commands `foodcourt:backup|pairing-code|create-owner|diagnose-login`,
migration `2026_11_03_090000_create_paired_devices_table` (additive); tests `DesktopLifecycleTest`, `DevicePairingTest`,
`SqliteBackupTest`, `DiagnoseLoginCommandTest`, `EmbeddedSetupTest` (helper updated).
Desktop: `electron/{main,embedded-server,preload,config}.cjs`, new `electron/{backup,pairing}.cjs`; renderer `main.tsx`, `App.tsx`,
`StartupScreen`, `RecoveryKeyPanel`, `BackupNotice`, `RecoverOwnerPage`, `ConnectHostPage`, `FirstRunPage`, `LoginPage`, `SettingsPage`
(rewritten), `ConnectionBanner`, `Sidebar`, `bridge.ts`, `client.ts`, `apiErrors.ts`; `ServerStartFailedPage` removed; `package.json` 1.1.0,
uninstall keeps data. Tests: `tests/lifecycle.test.ts`, `e2e/ui-first-run.e2e.mjs`, `qa/desktop/lifecycle.e2e.mjs`, `qa/multi-pc/multipc.e2e.mjs`.

## Known issues

| # | Issue | Action |
|---|---|---|
| 1 | Not code-signed. On this development PC Smart App Control **blocked the final 1.1.0 EXE** (an earlier 1.1.0 build ran) | Sign the installer, app and `php.exe`/DLLs, or have IT allow-list. Expect the same on client PCs with Smart App Control on |
| 2 | Not installed on a clean Windows PC; NSIS wizard / uninstall not run here | Technician checklist in the clean-install report |
| 3 | Multi-PC verified with separate processes on one PC, not two machines | One on-site check (`multi-pc-deployment.md` §7) |
| 4 | Restore and folder pickers use native dialogs: their logic is tested, the dialogs themselves were not clicked by automation | Covered by manual checklist |
| 5 | One active session per account (existing rule) | Each person needs their own account on multi-PC sites |
| 6 | Business-day cut-off is UTC; no auto-update; thermal printer unverified | Unchanged from 1.0.2 |
