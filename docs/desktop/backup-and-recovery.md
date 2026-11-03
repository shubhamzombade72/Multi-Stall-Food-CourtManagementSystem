# Backup and recovery (single-PC install, v1.1.0)

A shared host uses `ops/backup/backup-db.ps1` / `restore-db.ps1` (PostgreSQL, see `production-deployment.md`).
This page is for a PC that runs its own database.

## What is backed up, where

| | |
|---|---|
| Database | `%APPDATA%\FoodCourt Desktop\server\foodcourt.sqlite` (everything: orders, payments, stock, staff, settings) |
| Backups | default `%APPDATA%\FoodCourt Desktop\server\backups\`; the owner can choose another folder (USB drive, cloud-synced folder) in **Device Settings → Backup & recovery** |
| Logs | `%APPDATA%\FoodCourt Desktop\logs\desktop.log` (JSON lines, no passwords) and `server\logs\` |
| Not in the install folder | Nothing mutable lives in `Program Files`/the install folder: upgrades and reinstalls cannot overwrite data |

## Automatic and manual backups

* **Daily, automatic**, while the app is open (first check two minutes after start, then hourly; a backup is made when none succeeded in the last 24 h). The newest 14 automatic backups are kept.
* **Back up now** (owner): a manual backup, never deleted by the app.
* **Before every upgrade** the program copies the database aside (`foodcourt-before-<version>-…`; newest 5 kept).
* **Before every restore** the current data is copied aside (`foodcourt-before-restore-…`, never deleted).
* Files are named `foodcourt-<auto|manual|before-restore>-<UTC time>.sqlite` and are never overwritten.

## A backup only counts when it is checked

After writing a backup the program opens **the copy as its own database** and checks it: SQLite integrity check, foreign-key
check, the core tables exist, every migration of this version is recorded, and the accounts can be read. A copy that fails is
deleted and reported as a failure. "The copy command finished" is never reported as success.

**Failure notification:** a failed or missing backup shows an amber banner to the **owner** across the app ("The last backup
failed…" / "No backup has been made for more than two days") with a link to Device Settings, and is written to the log.

## Restore

**From the app (owner):** Device Settings → Backup & recovery → **Restore** next to a backup, or **Restore from a file…**. The
program (1) checks the file, (2) asks for confirmation, (3) stops its server, (4) keeps the current data as
`foodcourt-before-restore-…`, (5) puts the backup in place, (6) starts again. If the restored data will not start, the previous
data is put back automatically. Everyone is signed out afterwards.

**If the app will not start** (damaged database): the start-up screen offers **Restore a backup…**.

**By hand (support):** close the app, copy a backup over `foodcourt.sqlite` (keep the old file first), delete `foodcourt.sqlite-wal`
and `-shm` if present, open the app.

**Restore test:** `qa/desktop/lifecycle.e2e.mjs` creates a backup, then restores it into a **new, empty data folder** that never
saw the original, starts the program on it and signs in; data written after the backup is absent, data before it is present.

## Moving to another PC

Copy a backup file to the new PC, install the app, open it, and on the Welcome screen choose
**Restore from a backup (moving from another computer)**. Pick the file; the accounts and data of the old PC come across and
you sign in with the old owner password. Do not create a new owner first.

## Uninstalling and removing data

Uninstalling **does not delete business data** (`deleteAppDataOnUninstall` is off). To remove everything on purpose, close the app
and delete the folder `%APPDATA%\FoodCourt Desktop`. That is permanent. Back up first.

## Recovery quick reference

| Situation | Do |
|---|---|
| Owner forgot the password | Sign-in screen → **Forgot password?** → recovery key |
| Lost the recovery key, still signed in | Device Settings → Owner recovery key → create a new one |
| Lost both | Support: `--diagnose-login` to read the state; a supervised reset is a support task (data can be kept) |
| "Service unavailable" at start-up | Try again → Restore a backup → Copy support information to support |
| PC died | New PC, install, restore the latest backup from the USB/cloud folder |
