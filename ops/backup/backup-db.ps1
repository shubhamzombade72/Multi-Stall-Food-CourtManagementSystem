<#
.SYNOPSIS
  Consistent PostgreSQL backup of the food court database (custom format, compressed) with SHA-256 checksum.

.DESCRIPTION
  Reads connection settings from a Laravel env file (default backend/.env). Credentials are passed to
  pg_dump through PGPASSWORD for this process only and are never printed or written to the backup log.
  pg_dump takes an MVCC snapshot, so the backup is consistent while the food court keeps trading.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File ops\backup\backup-db.ps1 -EnvFile backend\.env.staging
  powershell -ExecutionPolicy Bypass -File ops\backup\backup-db.ps1 -RetentionDays 30
#>
param(
    [string]$EnvFile = (Join-Path $PSScriptRoot '..\..\backend\.env'),
    [string]$OutDir = (Join-Path $PSScriptRoot '..\..\backend\storage\backups'),
    [int]$RetentionDays = 14,
    [string]$PgBin = 'C:\Program Files\PostgreSQL\17\bin'
)
$ErrorActionPreference = 'Stop'

function Read-DbConfig([string]$path) {
    if (-not (Test-Path $path)) { throw "Env file not found: $path" }
    $cfg = @{}
    Get-Content $path | ForEach-Object {
        if ($_ -match '^(DB_[A-Z]+|APP_ENV)=(.*)$') { $cfg[$matches[1]] = $matches[2].Trim().Trim('"') }
    }
    foreach ($k in 'DB_HOST', 'DB_PORT', 'DB_DATABASE', 'DB_USERNAME') {
        if (-not $cfg[$k]) { throw "$k missing in $path" }
    }
    return $cfg
}

$cfg = Read-DbConfig $EnvFile
New-Item -ItemType Directory -Force $OutDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$file = Join-Path $OutDir ("{0}_{1}.dump" -f $cfg.DB_DATABASE, $stamp)

$env:PGPASSWORD = $cfg.DB_PASSWORD
try {
    & (Join-Path $PgBin 'pg_dump.exe') -h $cfg.DB_HOST -p $cfg.DB_PORT -U $cfg.DB_USERNAME `
        --format=custom --compress=6 --no-owner --no-privileges --file $file $cfg.DB_DATABASE
    if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE" }

    # Integrity: the archive's table of contents must be readable
    & (Join-Path $PgBin 'pg_restore.exe') --list $file | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Backup archive is unreadable: $file" }
}
finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

$hash = (Get-FileHash -Algorithm SHA256 $file).Hash
Set-Content -Path "$file.sha256" -Value "$hash  $(Split-Path $file -Leaf)" -Encoding ascii

# Retention: delete only this database's own dumps older than the window
Get-ChildItem $OutDir -Filter ("{0}_*.dump*" -f $cfg.DB_DATABASE) |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } |
    Remove-Item -Force

[pscustomobject]@{
    Database = $cfg.DB_DATABASE
    Backup   = $file
    SizeKB   = [math]::Round((Get-Item $file).Length / 1KB, 1)
    SHA256   = $hash
}
