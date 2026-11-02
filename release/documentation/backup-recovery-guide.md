# Multi-Stall Food Court Management System - Backup & Disaster Recovery Guide

## 1. Overview
PostgreSQL is the single source of truth for all food court operational data. Regular database backups guarantee business continuity in the event of hardware failure.

---

## 2. Automated PostgreSQL Daily Backup

### Linux Cron Setup
Create a script at `/opt/backup_foodcourt.sh`:
```bash
#!/usr/bin/env bash
set -e
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="/var/backups/foodcourt"
mkdir -p "$BACKUP_DIR"

export PGPASSWORD="<DB_PASSWORD>"
pg_dump -U foodcourt_user -h 127.0.0.1 -F c -b -v -f "$BACKUP_DIR/foodcourt_db_$TIMESTAMP.dump" foodcourt_db

# Retain backups for 30 days
find "$BACKUP_DIR" -type f -name "*.dump" -mtime +30 -exec rm {} +
```

Make executable and add to crontab:
```bash
chmod +x /opt/backup_foodcourt.sh
crontab -e
# Add: Run daily at 02:00 AM
0 2 * * * /opt/backup_foodcourt.sh
```

---

## 3. Verified Restoration Procedure

In the event of database corruption or server migration:

1. Stop application web server / background workers:
   ```bash
   sudo systemctl stop nginx
   sudo systemctl stop supervisor
   ```
2. Re-create the database:
   ```bash
   dropdb -U postgres -h 127.0.0.1 foodcourt_db
   createdb -U postgres -h 127.0.0.1 foodcourt_db
   ```
3. Restore the dump file:
   ```bash
   pg_restore -U foodcourt_user -h 127.0.0.1 -d foodcourt_db -v "/var/backups/foodcourt/foodcourt_db_<TIMESTAMP>.dump"
   ```
4. Clear Laravel application cache and restart services:
   ```bash
   cd /var/www/foodcourt/backend
   php artisan optimize:clear
   sudo systemctl start supervisor
   sudo systemctl start nginx
   ```
5. Test connectivity by opening the desktop client and logging in.

