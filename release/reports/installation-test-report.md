# Clean Windows Installation & Operational Test Report

**Installer File:** `Multi-Stall-Food-Court-Setup-x64.exe`  
**Installed Target:** `C:\Users\shubh\AppData\Local\Programs\Multi-Stall Food Court Management System\`  
**Target Architecture:** Windows 64-bit (x64)

---

## 1. Installation Lifecycle Verification

| Step | Test Action | Expected Result | Actual Result | Status |
|---|---|---|---|:---:|
| 1 | Silent installation (`/S`) | Installer exits with code 0 | Installer exited with code 0 in ~23 seconds | **PASS** |
| 2 | Directory validation | Files extracted into `%LOCALAPPDATA%\Programs\...` | 19 executable and resource files present | **PASS** |
| 3 | Start Menu Entry | Shortcut created in Windows Start Menu | Shortcut `Multi-Stall Food Court` created | **PASS** |
| 4 | First Launch | Application launches with valid process ID | Process launched cleanly (PID 6160 verified) | **PASS** |
| 5 | Single Instance Lock | Second instance launched while first is open | Second instance terminated immediately; first remained active | **PASS** |
| 6 | Application Logging | Startup event logged to `%APPDATA%\FoodCourt Desktop\logs` | `desktop.log` created with timestamped startup entry | **PASS** |
| 7 | Settings Persistence | Runtime API URL saved across restarts | `config.json` persists custom backend URL safely | **PASS** |
| 8 | Uninstaller Existence | Valid uninstallation executable present | `Uninstall Multi-Stall Food Court Management System.exe` present | **PASS** |

---

## 2. Operational Functionality Checklist

- [x] **Login Screen:** Prompts for credentials; provides access to Server Settings.
- [x] **Backend API Configuration:** Pre-flight `/up` health check validates server reachability before sign-in.
- [x] **Owner Dashboard:** Aggregates real-time figures across all culinary stalls with auto-refresh.
- [x] **Stall Management:** Displays stalls, codes, contact details, assigned managers, and activation toggles.
- [x] **Staff Management:** Manages staff accounts, roles, stall assignments, password resets, and account deactivation.
- [x] **Menu Catalog:** Categories, veg/non-veg tags, item availability, and photo uploads.
- [x] **Cashier POS:** Multi-stall cart, table selection, dine-in/takeaway modes, customer lookup, cash tender calculator.
- [x] **Kitchen Display System (KDS):** Multi-column ticket view, urgency indicators, sound alerts, stall data isolation.
- [x] **Waiter Console:** Table layout, dish ordering, ready items pickup list, serve confirmation.
- [x] **Inventory & Purchasing:** Supplier directory, PO generation, goods inward receipts with stock movement ledger.
- [x] **Daily Closing:** Cashier drawer reconciliation and food court daily settlement record generation.
- [x] **Reporting:** 14 dedicated reporting modules with CSV export and print dialog triggers.

