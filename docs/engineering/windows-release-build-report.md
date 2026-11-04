# Windows Production Release Build Report

**Project:** Multi-Stall Food Court Management System  
**Product Name:** Multi-Stall Food Court Management System (FoodCourt Desktop)  
**Release Version:** 1.1.0  
**Target Platform:** Windows 10 / 11 (64-bit, x64)  
**Build Date:** November 2026  
**Status:** RELEASE BUILD VERIFIED - READY FOR CLIENT TESTING

---

## 1. Executive Summary

The production Windows desktop installer for the **Multi-Stall Food Court Management System** has been compiled, packaged, verified, and audited. The application ships as a standalone NSIS installer that packages both the Electron desktop client and an embedded, zero-configuration local server runtime (PHP 8.3 + SQLite + Laravel 12 backend).

The software operates in two validated modes:
1. **Single-PC Standalone (Default):** Runs an embedded local server on loopback (`127.0.0.1`), initializes an isolated SQLite database in `%APPDATA%`, and guides the operator through a first-run setup wizard.
2. **Multi-PC Terminal (LAN Client):** Connects to a central Food Court Host PC over the local area network using a secure pairing token.

---

## 2. Release Artifact Specification

| Property | Value |
| :--- | :--- |
| **Installer File** | `Multi-Stall-Food-Court-Setup-1.1.0.exe` |
| **Relative Path** | `frontend-desktop/installers/1.1.0/Multi-Stall-Food-Court-Setup-1.1.0.exe` |
| **Absolute Path** | `D:\New folder\Multi-Stall-Food-CourtManagementSystem\frontend-desktop\installers\1.1.0\Multi-Stall-Food-Court-Setup-1.1.0.exe` |
| **Exact File Size** | `135,708,444 bytes` (129.42 MB) |
| **SHA-256 Checksum** | `E059AC2D614EA13C4733E86F34E9E0281A39C68113D68BF63D5CF510821ADA01` |
| **Target Architecture** | Windows x64 |
| **Packaging Engine** | `electron-builder` v26.17.0 (NSIS Installer) |
| **Signing Status** | Unsigned (Self-contained / internal release; SmartScreen prompt expected on initial launch) |

---

## 3. Bundled Application Contents

Archive inspection of the uncompressed installer payload (verified via 7-Zip archive extraction):
- **Total Files:** 6,991 files
- **Total Folders:** 1,021 folders
- **Uncompressed Footprint:** 446,499,095 bytes (~425.8 MB)

### Included Core Components:
1. **Desktop Client:**
   - `Multi-Stall Food Court Management System.exe` (Electron v44.9.0 runtime)
   - `resources/app.asar` (Compiled React 18 + Vite frontend bundle, Tailwind CSS tokens, branded assets)
   - Brand logo asset: `मंगलमूर्ती` golden Ganesha emblem integrated in navbar, login page, and desktop icon.
2. **Embedded Server Runtime (`resources/server/`):**
   - **PHP 8.3 CLI Runtime:** `php.exe`, `php_sqlite3.dll`, `php_pdo_sqlite.dll`, `php_mbstring.dll`, `php_openssl.dll`, `vcruntime140.dll`, `msvcp140.dll`.
   - **Laravel 12 Backend:** `artisan`, optimized production vendor autoloader, full migration set.
   - **Router Wrapper:** `router.php` serving static API endpoints and database migrations securely on dynamic loopback ports.

---

## 4. Electron Security Verification

The desktop runtime enforces strict isolation standards:
- **`contextIsolation`:** `true` (Enforced across all renderer windows)
- **`nodeIntegration`:** `false` (Renderer has no direct Node.js execution capabilities)
- **`sandbox`:** `true` (Renderer executes inside Chromium's OS sandbox)
- **`webSecurity`:** `true` (Same-origin policy and CORS strictly applied)
- **`devTools`:** Disabled by default in production packaging
- **IPC Surface Area:** Restricted to documented `BRIDGE_KEYS` in `preload.cjs`
- **Shell / File System Access:** Renderer cannot trigger arbitrary shell commands or open arbitrary filesystem paths.
- **Embedded Smoke Test:** Executed `Multi-Stall Food Court Management System.exe` with `FOODCOURT_SMOKE_TEST=1` in an isolated temporary profile; all 11 security assertions passed and process exited cleanly with code `0`.

---

## 5. Verification & Test Metrics

| Test Suite | Result | Metrics |
| :--- | :--- | :--- |
| **Backend PHPUnit** | **PASSED** | 150 tests, 2,468 assertions, 0 failures |
| **Desktop Unit Tests** | **PASSED** | 152 tests, 0 failures (theme, KDS, routing, contracts) |
| **TypeScript Typecheck** | **PASSED** | `tsc --noEmit` exited with code 0 (0 errors) |
| **Internal Acceptance Scenarios** | **PASSED** | 7/7 suites passed (Scenarios A through E, Contract Reconciliation) |
| **Desktop E2E Integration** | **PASSED** | 27/27 tests passed against test database |
| **Production Packaging Smoke Test**| **PASSED** | Exit code 0, clean server boot & shutdown |

---

## 6. Known Scope Boundaries

1. **Function Hall Module:** Out of scope for v1.1.0 release (reserved for future multi-facility milestone).
2. **Physical Hardware Validation:** ESC/POS 80mm/58mm thermal receipt printers, RJ11 cash drawers, and hardware barcode scanners require physical target hardware attachment on-site.
3. **Windows SmartScreen:** Because this internal release is not signed with an EV Code Signing Certificate, Windows Defender SmartScreen will display an *"Unknown Publisher"* warning. Click *"More info"* -> *"Run anyway"*.

---

## 7. Handover Verdict

**`RELEASE BUILD VERIFIED - READY FOR CLIENT TESTING`**

