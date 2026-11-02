# Backup & Recovery Report

**Date:** 2026-11-02
**Scripts:** `ops/backup/backup-db.ps1`, `ops/backup/restore-db.ps1`
**Rule followed:** restore procedures were tested **only** on the staging database, restored into a **new** database (`foodcourt_restore_verify`). No production data was touched.

## 1. Backup

```powershell
powershell -ExecutionPolicy Bypass -File ops\backup\backup-db.ps1 -EnvFile backend\.env -RetentionDays 14
```

- `pg_dump --format=custom --compress=6`: a consistent MVCC snapshot, safe while the food court trades.
- The archive is verified readable (`pg_restore --list`) and a `.sha256` checksum is written next to it.
- Credentials are read from the Laravel env file and passed via `PGPASSWORD` for the process only. They are never printed or logged.
- Retention removes only that database's own dumps older than N days.
- Output: `backend/storage/backups/<db>_<yyyyMMdd-HHmmss>.dump` (git-ignored).

**Schedule (pilot):** Windows Task Scheduler, daily at closing time plus once mid-day. Copy the dump off the edge server (USB or NAS) daily, because a backup on the same disk does not survive a disk failure. On Linux: `pg_dump -Fc` from cron with the same flags.

## 2. Restore drill (executed)

```powershell
powershell -ExecutionPolicy Bypass -File ops\backup\restore-db.ps1 `
  -BackupFile backend\storage\backups\foodcourt_staging_db_20261102-184509.dump `
  -TargetDatabase foodcourt_restore_verify -EnvFile backend\.env.staging -CompareWith foodcourt_staging_db
```

Backup size: 105.1 KB, taken after the full staging validation run (54 orders, 24 payments, a daily closing).

| Check | Source | Restored | Match |
|---|---|---|---|
| rows: orders / order_items / stall_kitchen_tickets / stall_ticket_items | 54 / 100 / 100 / 100 | same | ✔ |
| rows: payments / purchase_orders / stock_movements / inventory_items | 24 / 6 / 6 / 9 | same | ✔ |
| rows: daily_closings / stall_settlement_records / audit_logs | 1 / 3 / 165 | same | ✔ |
| rows: users / stalls / menu_items / migrations | 10 / 3 / 15 / 17 | same | ✔ |
| sum payments.amount | 10233.30 | 10233.30 | ✔ |
| sum orders.total_amount (paid) | 10233.30 | 10233.30 | ✔ |
| sum inventory_items.current_stock | 418.750 | 418.750 | ✔ |
| max audit_logs.id (audit history preserved) | 165 | 165 | ✔ |

**Result: Restore verification PASSED.**

### Safety guards (executed)
- Restoring onto `foodcourt_staging_db`: **refused** ("Refusing to restore over an application database").
- Restoring onto `foodcourt_db` (the live name in `backend/.env`): **refused**.
- Restoring into an existing database: refused. The checksum is verified before any restore.

## 3. Recovery procedures

### A. Edge server restarted (power cut, update)
Verified (`qa/staging/restart-recovery.mjs`): with the API down, the waiter's order queued on the device. After restart it synced exactly once, and the device's login token remained valid. PostgreSQL commits are durable, so orders paid before the crash are intact. Start-up order: PostgreSQL → API → Reverb → queue worker (see `staging-deployment-guide.md`).

### B. Database lost or corrupted
1. Stop the API and Reverb.
2. `restore-db.ps1 -BackupFile <latest> -TargetDatabase foodcourt_db_restored_<date>` (new database).
3. Review the verification table.
4. Point `DB_DATABASE` in `backend/.env` at the restored database. Run `php artisan migrate --force` (normally a no-op), then start the services.
5. Orders taken since the backup exist only on paper or on waiter devices. Queued device orders will sync. Re-enter counter orders from paper slips.

### C. Bad deployment / migration
- Take a backup before **every** `php artisan migrate` on the edge server.
- Rollback strategy: prefer **restore-from-backup** over `migrate:rollback`. Several migrations' `down()` methods drop columns holding financial history (for example `tracking_token`, `idempotency_key`), so rolling back loses data. Use `migrate:rollback --step=1` only for a migration that has not yet stored data.
- New migrations must be additive (add columns or tables). Never drop or rename a column holding money or audit data in the same release that stops using it.

## 4. Audit history preservation
- `audit_logs` is append-only in application code (no update or delete endpoints) and is included in every backup (verified via `max(id)`).
- Gap: nothing prevents a database superuser from deleting audit rows. For production, revoke `UPDATE`/`DELETE` on `audit_logs`, `payments` and `stall_settlement_records` from the application DB role, and do not run the app as `postgres` (OPEN-06).

## 5. Secure credential handling
- `backend/.env`, `backend/.env.staging` and `backend/storage/backups/` are git-ignored (verified).
- **Finding:** `backend/phpunit.xml` contains the local PostgreSQL superuser password used for tests, and the app connects as `postgres`. Before the pilot, create a dedicated least-privilege role (`foodcourt_app`) and a separate backup role (OPEN-06).
