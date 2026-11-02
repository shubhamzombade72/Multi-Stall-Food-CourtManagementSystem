# Multi-Stall Food Court Management System - Release Notes

**Release Version:** 1.0.0  
**Release Date:** 2026-11-02  
**Target Platform:** Windows 10 / Windows 11 (64-bit)  
**Package File:** `Multi-Stall-Food-Court-Setup-x64.exe` (120.7 MB)

---

## 1. What's Included

- **Native Windows Desktop Experience:** Built on Electron 44.9.0 with hardware acceleration and secure local storage.
- **Centralized POS:** Multi-stall order bundling into a single parent invoice with automatic stall ticket splitting.
- **Dedicated Kitchen Display System (KDS):** Audio chimes, elapsed prep timers, forward-only status updates, and strict stall data isolation.
- **Desktop Waiter Station:** Live dining table floor plan, direct order dispatching, and served dish confirmations.
- **Inventory & Purchasing:** Vendor profiles, PO creation, goods receipts with inventory ledger audit, consumption & waste stock-out deductions.
- **Comprehensive Closing & Auditing:** Cashier drawer reconciliation with variance tracking, food court daily closing, and 14 distinct exportable analytical report tabs.

---

## 2. Technical Specifications & Verified Baselines

- **Frontend:** React 18.3.1 + TypeScript 5.9.3 + Vite 5.4.21
- **Backend:** Laravel 12 on PHP 8.3
- **Database:** PostgreSQL 17
- **IPC Security:** Context isolation enabled, node integration disabled, sandbox enforced.
- **Backend Test Status:** 65 passed, 1,287 assertions.
- **Desktop E2E Workflows:** 26 passed, 0 failed, 2 skipped (idempotent daily closing protection).

---

## 3. Known Limitations & Scope Boundaries

1. **Physical Thermal Printer Hardware:** Thermal printing integration is verified through the standard Windows printing system (supporting ESC/POS drivers). Real hardware testing on specific ESC/POS thermal printers (80mm/58mm) remains to be performed at the physical installation site.
2. **Code Signing Certificate:** The executable installer is not digitally signed with an Extended Validation (EV) certificate. Windows SmartScreen may present a warning during first-time manual installation.
3. **Owner Business Approvals Pending:** GST rate is standardized at 5%; stall settlement disbursements are manually finalized by the owner; automatic recipe/BOM depletion is deferred pending client recipe data.

