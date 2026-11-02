# Phase 0: Environment & Infrastructure Audit Report

**Date:** 2026-11-02  
**System Role:** Principal Architect & Infrastructure Engineer  
**Status:** Complete  

---

## 1. Executive Summary

A comprehensive environment audit of the host machine was performed on November 2, 2026. The workstation is a Windows 11 64-bit environment equipped with substantial compute resources (24 GB RAM, 183 GB free secondary storage, 132 GB free primary storage).

The core runtime components for the required technology stack are largely present but require minor configuration adjustments:
1. **PHP 8.3.36** is installed with active PostgreSQL drivers (`pdo_pgsql`, `pgsql`), but critical extensions (`zip`, `gd`, `intl`, `sodium`) are commented out in `php.ini`.
2. **PostgreSQL 17.11** is installed and actively running as a Windows service on port 5432 with `scram-sha-256` authentication, but its `bin` directory is not in the system `PATH`.
3. **Node.js v24.20.0**, **npm 11.19.0**, and **pnpm 12.15.0** are installed and functional.
4. **OpenJDK 17.0.20.1** and the complete **Android SDK** (API build tools, emulator, platform tools with ADB 1.0.41) are installed, but Android environment variables (`ANDROID_HOME`) are not set in the active environment.
5. **Redis** and **Docker** are not natively installed. We evaluate database queues vs. local Redis alternatives below.

---

## 2. Host Operating System & Hardware

| Parameter | Detected Value | Compatibility Assessment |
|---|---|---|
| **OS Name / Version** | Microsoft Windows 11 Pro (NT 10.0.26300.0, 64-bit) | Fully Compatible |
| **Shell Environment** | PowerShell 5.1 (Build 10.0.26100.9711) | Compatible for local administration |
| **Physical RAM** | 23.64 GB Total (~10.93 GB Free) | **Excellent** — sufficient for running Laravel, PostgreSQL, Vite, and mobile emulators concurrently |
| **Primary Storage (C:)** | 168.5 GB Used / 132.3 GB Free | Adequate for system tools & caches |
| **Workspace Storage (D:)** | 26.2 GB Used / 183.5 GB Free | **Excellent** — ample space for workspace and build artifacts |

---

## 3. Backend Runtime: PHP & Composer

### 3.1 PHP Details
- **PHP Version:** `8.3.36 (cli) (built: Oct 20 2026 04:21:11) (ZTS Visual C++ 2019 x64)`
- **Binary Path:** `C:\Users\shubh\AppData\Local\Microsoft\WinGet\Packages\PHP.PHP.8.3_Microsoft.Winget.Source_8wekyb3d8bbwe\php.exe`
- **Loaded Configuration:** `C:\Users\shubh\AppData\Local\Microsoft\WinGet\Packages\PHP.PHP.8.3_Microsoft.Winget.Source_8wekyb3d8bbwe\php.ini`
- **Laravel Compatibility:** PHP 8.3 is 100% compatible with Laravel 11 and Laravel 12.

### 3.2 Loaded Extensions
The following relevant extensions are active in the CLI:
`bcmath`, `curl`, `dom`, `fileinfo`, `filter`, `json`, `mbstring`, `openssl`, `PDO`, `pdo_pgsql`, `pdo_sqlite`, `pgsql`, `SimpleXML`, `tokenizer`, `xml`, `zlib`.

### 3.3 Available but Disabled Extensions (in `php.ini`)
The following compiled extension DLLs exist in the PHP `ext/` directory but are commented out in `php.ini`:
- `php_zip.dll`: **CRITICAL** for Composer archive extraction, Excel exports, and package downloads.
- `php_gd.dll`: **CRITICAL** for server-side QR code generation, image resizing, and bill printing graphics.
- `php_intl.dll`: Highly recommended for multi-currency, formatting, and number localization.
- `php_sodium.dll`: Recommended for modern cryptography.

> **Required Remediation:** Enable `extension=zip`, `extension=gd`, `extension=intl`, and `extension=sodium` in `php.ini` before running application scaffolding.

### 3.4 Composer
- **Composer Version:** `2.10.3 (2026-08-27)`
- **Status:** Installed, up to date, and functional.

---

## 4. Database Engine: PostgreSQL

### 4.1 Service & Version
- **PostgreSQL Version:** `17.11 x64`
- **Installation Path:** `C:\Program Files\PostgreSQL\17`
- **Binary Path:** `C:\Program Files\PostgreSQL\17\bin\psql.exe`
- **Windows Service:** `postgresql-x64-17`
- **Service State:** **Running**
- **Listening Network Port:** `5432` (`0.0.0.0:5432` and `[::]:5432`)

### 4.2 Authentication & Security
- **Config File:** `C:\Program Files\PostgreSQL\17\data\pg_hba.conf`
- **Authentication Method:** `scram-sha-256` for local and TCP host connections.
- **Connection Test:** Attempting connection with empty/default password returned `fe_sendauth: no password supplied` and `FATAL: password authentication failed for user "postgres"`.
- **Finding:** A designated database and dedicated user credentials (or the `postgres` superuser password) must be provided in the backend `.env` configuration file prior to executing migrations in Phase 3.

---

## 5. Frontend & JavaScript Toolchain

| Tool | Version | Status | Notes |
|---|---|---|---|
| **Node.js** | `v24.20.0` | Installed | Modern Node runtime, excellent performance |
| **npm** | `11.19.0` | Installed | Core package manager |
| **pnpm** | `12.15.0` | Installed | High-efficiency package manager; recommended for monorepos |
| **yarn** | Not installed | N/A | Not required; pnpm is superior in disk efficiency and speed |
| **Vite** | Compatible | Ready | Supported under Node v24 |

---

## 6. Mobile & Android Toolchain

### 6.1 Java Development Kit (JDK)
- **Version:** `OpenJDK 17.0.20.1+1 (Temurin)`
- **Architecture:** 64-Bit Server VM
- **Status:** **Ready** — JDK 17 is the recommended standard LTS for React Native and Android Gradle builds.

### 6.2 Android SDK
- **Location:** `C:\Users\shubh\AppData\Local\Android\Sdk`
- **Installed Components:**
  - `platform-tools` (ADB version 1.0.41, version 37.0.1)
  - `build-tools`
  - `platforms`
  - `emulator`
  - `system-images`
  - `ndk`
  - `cmake`
- **Global CLIs:** `eas-cli@27.1.0` is installed globally.
- **Remediation:** Add `ANDROID_HOME=C:\Users\shubh\AppData\Local\Android\Sdk` and add `%ANDROID_HOME%\platform-tools` to the system path.

---

## 7. Caching, Queues & Auxiliary Services

### 7.1 Redis / Valkey
- Native Redis server is not currently running as a Windows service.
- **Evaluation:**
  - In local development, Laravel provides high-reliability drivers: `database` queue driver and `database` / `file` cache drivers.
  - In a production Linux deployment, Redis/Valkey will be mandatory for high-throughput WebSocket broadcast queuing and pub/sub.
  - For local Windows development, using the PostgreSQL database queue driver avoids introducing brittle Windows Redis ports while providing full transactional integrity.

### 7.2 Docker & Containerization
- Neither Docker Desktop nor WSL is installed.
- Development will proceed natively on the Windows host using PHP 8.3, PostgreSQL 17, and Node 24.
- Containerization (Dockerfiles, docker-compose) will be drafted as standard production artifacts for Linux staging and production deployment without blocking local execution.

---

## 8. Summary Checklist of Required Environment Actions

| Component | Action Required | Priority |
|---|---|---|
| `php.ini` | Uncomment `extension=zip`, `extension=gd`, `extension=intl`, `extension=sodium` | **Immediate** |
| `PostgreSQL` | Add `C:\Program Files\PostgreSQL\17\bin` to PATH | Medium |
| `PostgreSQL` | Confirm database name (`food_court_db`), username, and password for `.env` | High (before migrations) |
| `Android SDK` | Configure `ANDROID_HOME` environment variable | Low (prior to Android build) |

