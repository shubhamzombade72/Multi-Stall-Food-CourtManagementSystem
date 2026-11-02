<#
.SYNOPSIS
  Restore a backup into a NEW, separate database and verify it. Never restores over the live database.

.DESCRIPTION
  - Verifies the backup's SHA-256 checksum first.
  - Refuses to target the database named in the live env file (backend/.env) or any database that
    already exists, so a restore drill can never overwrite production data.
  - After restoring, compares per-table row counts and financial totals with the source database
    (when -CompareWith is given) and prints a verification table.

  To recover production for real after an incident, restore into a new database with this script,
  verify it, then point DB_DATABASE at it (see docs/staging/backup-recovery-report.md).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File ops\backup\restore-db.ps1 `
     -BackupFile backend\storage\backups\foodcourt_staging_db_20261102-190000.dump `
     -TargetDatabase foodcourt_restore_verify -EnvFile backend\.env.staging -CompareWith foodcourt_staging_db
#>
param(
    [Parameter(Mandatory)] [string]$BackupFile,
    [Parameter(Mandatory)] [string]$TargetDatabase,
    [string]$EnvFile = '',
    [string]$LiveEnvFile = '',
    [string]$CompareWith = '',
    [string]$PgBin = 'C:\Program Files\PostgreSQL\17\bin'
)
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 does not expand $PSScriptRoot in defaults when mandatory parameters exist
$defaultEnv = Join-Path $PSScriptRoot '..\..\backend\.env'
if (-not $EnvFile) { $EnvFile = $defaultEnv }
if (-not $LiveEnvFile) { $LiveEnvFile = $defaultEnv }

function Read-DbConfig([string]$path) {
    $cfg = @{}
    Get-Content $path | ForEach-Object {
        if ($_ -match '^(DB_[A-Z]+)=(.*)$') { $cfg[$matches[1]] = $matches[2].Trim().Trim('"') }
    }
    return $cfg
}

if ($TargetDatabase -notmatch '^[a-z0-9_]+$') { throw 'TargetDatabase may contain only lowercase letters, digits and _' }
$cfg = Read-DbConfig $EnvFile
$live = if (Test-Path $LiveEnvFile) { Read-DbConfig $LiveEnvFile } else { @{} }
if ($TargetDatabase -eq $live.DB_DATABASE -or $TargetDatabase -eq $cfg.DB_DATABASE) {
    throw "Refusing to restore over an application database ($TargetDatabase). Choose a new database name."
}

$expected = ((Get-Content "$BackupFile.sha256") -split '\s+')[0]
$actual = (Get-FileHash -Algorithm SHA256 $BackupFile).Hash
if ($expected -ne $actual) { throw "Checksum mismatch for $BackupFile" }

$psql = Join-Path $PgBin 'psql.exe'
$env:PGPASSWORD = $cfg.DB_PASSWORD
function Sql([string]$db, [string]$query) {
    $out = & $psql -h $cfg.DB_HOST -p $cfg.DB_PORT -U $cfg.DB_USERNAME -d $db -tAc $query
    if ($LASTEXITCODE -ne 0) { throw "psql failed: $query" }
    return ($out | Out-String).Trim()
}

try {
    if (Sql 'postgres' "SELECT 1 FROM pg_database WHERE datname='$TargetDatabase'") {
        throw "Database $TargetDatabase already exists. Drop it yourself or choose another name."
    }
    Sql 'postgres' "CREATE DATABASE $TargetDatabase" | Out-Null

    & (Join-Path $PgBin 'pg_restore.exe') -h $cfg.DB_HOST -p $cfg.DB_PORT -U $cfg.DB_USERNAME `
        --no-owner --no-privileges --exit-on-error -d $TargetDatabase $BackupFile
    if ($LASTEXITCODE -ne 0) { throw "pg_restore failed with exit code $LASTEXITCODE" }

    $tables = 'orders', 'order_items', 'stall_kitchen_tickets', 'stall_ticket_items', 'payments',
              'purchase_orders', 'stock_movements', 'inventory_items', 'daily_closings',
              'stall_settlement_records', 'audit_logs', 'users', 'stalls', 'menu_items', 'migrations'
    $checks = foreach ($t in $tables) {
        $restored = Sql $TargetDatabase "SELECT COUNT(*) FROM $t"
        $source = if ($CompareWith) { Sql $CompareWith "SELECT COUNT(*) FROM $t" } else { '-' }
        [pscustomobject]@{ Check = "rows:$t"; Source = $source; Restored = $restored; Match = ($source -eq '-' -or $source -eq $restored) }
    }
    $money = @{
        'sum:payments.amount'               = 'SELECT COALESCE(SUM(amount),0) FROM payments'
        'sum:orders.total_amount(paid)'     = "SELECT COALESCE(SUM(total_amount),0) FROM orders WHERE payment_status='paid'"
        'sum:inventory_items.current_stock' = 'SELECT COALESCE(SUM(current_stock),0) FROM inventory_items'
        'max:audit_logs.id'                 = 'SELECT COALESCE(MAX(id),0) FROM audit_logs'
    }
    $checks += foreach ($k in $money.Keys) {
        $restored = Sql $TargetDatabase $money[$k]
        $source = if ($CompareWith) { Sql $CompareWith $money[$k] } else { '-' }
        [pscustomobject]@{ Check = $k; Source = $source; Restored = $restored; Match = ($source -eq '-' -or $source -eq $restored) }
    }
    $checks | Format-Table -AutoSize | Out-String -Width 200
    if ($checks | Where-Object { -not $_.Match }) { throw 'Restore verification FAILED: restored data differs from source' }
    "Restore verification PASSED into $TargetDatabase"
}
finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
