# Phase 0: Project Discovery & Environment Audit — Summary Report

**Date:** 2026-11-02  
**System Role:** Principal Architect | Product Engineering | Security | QA | DevOps  
**Deliverable Status:** Completed and Submitted for Review  

---

## 1. Project Overview & Audit Scope

Acting on behalf of the engineering organization, a comprehensive, multi-disciplinary Phase 0 Discovery & Environment Audit was executed for the **Multi-Stall Food Court Management System**.

The audit inspected:
1. Host operating system, hardware limits, memory, and filesystem partitions.
2. Runtime tools: PHP CLI, loaded modules, configuration files, and Composer.
3. Database server: PostgreSQL service, network socket, authentication configuration, and client binaries.
4. JavaScript & Frontend toolchain: Node.js, npm, pnpm, and package manager availability.
5. Android mobile development toolchain: Java JDK, Android SDK components, build tools, emulator, and EAS CLI.
6. Local cache, queue, and containerization services: Redis, Docker, WSL.
7. Git repository status, history, remotes, and codebase layout.
8. Complete technology stack feasibility, architectural patterns, and offline capabilities.
9. Business assumption risk register and unresolved operational policies.

---

## 2. Audit Findings

### 2.1 What Was Inspected & Found Installed
- **Operating System:** Windows 11 Pro 64-bit (`10.0.26300.0`), PowerShell 5.1.
- **Hardware Resources:** 23.64 GB RAM (~11 GB free), 183 GB free on drive D:, 132 GB free on drive C:.
- **PHP Runtime:** PHP `8.3.36` (cli) ZTS x64 with active PostgreSQL drivers (`pdo_pgsql`, `pgsql`), `bcmath`, `fileinfo`, `mbstring`, `openssl`, `tokenizer`.
- **Composer:** Version `2.10.3`.
- **Database Engine:** PostgreSQL `17.11` actively running on port `5432` with `scram-sha-256` authentication.
- **JavaScript Toolchain:** Node.js `v24.20.0`, npm `11.19.0`, pnpm `12.15.0`.
- **Mobile Development Toolchain:** OpenJDK `17.0.20.1`, Android SDK with ADB `1.0.41`, build-tools, emulator, and `eas-cli@27.1.0`.
- **Version Control:** Git `2.55.0` initialized on `main` branch with remote origin mapped to `https://github.com/shubhamzombade72/Multi-Stall-Food-CourtManagementSystem.git`.

### 2.2 What Is Missing or Disabled
1. **PHP Extensions:** `php_zip.dll`, `php_gd.dll`, `php_intl.dll`, and `php_sodium.dll` exist in the PHP `ext/` directory but are commented out in `php.ini`.
2. **PostgreSQL Path & Credentials:** `C:\Program Files\PostgreSQL\17\bin` is not in the system `PATH`. A dedicated database and credentials must be configured.
3. **Android Environment Variables:** `ANDROID_HOME` is not set in the active environment.
4. **Redis:** Native Windows Redis service is not installed.
5. **Docker / WSL:** Not installed on the Windows host.

### 2.3 What Needs to Be Changed / Configured Before Phase 1 & 2 Scaffolding
1. **Enable PHP Extensions:** Uncomment `extension=zip`, `extension=gd`, `extension=intl`, and `extension=sodium` in `C:\Users\shubh\AppData\Local\Microsoft\WinGet\Packages\PHP.PHP.8.3_Microsoft.Winget.Source_8wekyb3d8bbwe\php.ini`.
2. **Database Credentials:** Create database `food_court_db` and record credentials for the backend `.env`.
3. **Environment Variables:** Add `ANDROID_HOME=C:\Users\shubh\AppData\Local\Android\Sdk` and add `C:\Program Files\PostgreSQL\17\bin` and `%ANDROID_HOME%\platform-tools` to PATH.

---

## 3. Technology Stack & Architectural Decisions

### 3.1 Verdict on Express.js / Node.js Backend Service
**Verdict: Express.js is REJECTED.**  
- **Reasoning:** Introducing an Express.js service alongside Laravel creates a dual-backend anti-pattern with duplicated business logic, split database connections, fragmented authentication, and doubled DevOps maintenance.
- **Solution:** **Laravel Reverb** (first-party, asynchronous WebSocket server in Laravel 11+) satisfies all real-time requirements (instant KDS updates, cashier alerts, waiter notifications) directly within Laravel's native event pipeline and Sanctum authorization, delivering sub-millisecond local latency.

### 3.2 Verdict on Offline-First Architecture
**Verdict: Recommended Architecture is Option B (Local Edge-First with Cloud Synchronization).**  
- **Reasoning:** A pure cloud architecture causes complete food court paralysis during ISP internet outages. A pure peer-to-peer mobile sync architecture introduces extreme CRDT conflict complexity and unreliability.
- **Solution:** The physical food court runs an on-premise Local Edge Node (the main POS terminal or a dedicated mini-PC running PostgreSQL 17, Laravel, and Reverb on the local Wi-Fi router). Waiters, KDS screens, and cashiers operate continuously over local LAN with zero external internet dependency. When internet is active, completed transactions synchronize to the Cloud Owner Portal.
- **Documented QR Limitation:** Customers scanning QR codes during an external ISP failure must connect to the food court's local Wi-Fi to reach the local ordering gateway, or place orders through a waiter.

---

## 4. Major Technical Risks Identified

1. **TR-03: QR Tampering & Spoofing (Critical):** Mitigated via cryptographically signed HMAC table tokens, preventing URL tampering and cross-table ordering griefing.
2. **TR-04: Payment Status Drift (Critical):** Mitigated via server-side payment verification webhooks, replay protection, and transactional reconciliation.
3. **TR-09: End-of-Day Settlement Disputes (Critical):** Mitigated by avoiding hardcoded formulas and implementing an itemized dual-sided audit worksheet with digital sign-offs.
4. **TR-02: Inventory Race Conditions (High):** Mitigated via PostgreSQL pessimistic row locking (`SELECT ... FOR UPDATE`) inside atomic database transactions.
5. **TR-05: Multi-Stall Data Leakage (High):** Mitigated via Laravel global model scopes enforcing strict `stall_id` data isolation.

---

## 5. Critical Business Decisions Requiring Owner Clarification

Before beginning implementation, the following operational questions must be reviewed:

| Decision Item | Engineering Question | Impacted Module |
|---|---|---|
| **Decision 1: Stall Settlement Model** | What is the commercial formula for paying a stall manager/representative? (e.g., Gross Sales minus Owner Commission? Salaried employee petty cash reimbursement? Net profit margin payout?) | End-of-Day Settlement Engine |
| **Decision 2: QR Payment Timing** | Must customers pre-pay digitally before their QR order reaches the kitchen, or can they pay at the counter / to a waiter after dining? | Order Lifecycle & KDS Dispatch |
| **Decision 3: Food Serving Method** | Is food served to tables by waiters, or do customers collect their food from individual stall counters using an order token buzzer/screen? | Waiter vs. Token Calling Display |
| **Decision 4: Bill Discounts Allocation** | When an owner or cashier applies a bill-level discount (e.g., 10% off the total order), how is the discount absorbed across multiple stalls? | Financial Reporting & Settlements |
| **Decision 5: Cash Collection Permissions** | Are cash payments collected strictly at the central cashier counter, or are waiters permitted to collect cash at tables? | Cash Drawer & Audit Reconciliation |

---

## 6. What Should Happen in Phase 1 (Product Requirements Document)

Upon approval of this Phase 0 report, the engineering team will transition to **Phase 1: Comprehensive Product Requirements Document (PRD)**.

Phase 1 will produce 21 detailed specifications under `docs/prd/`:
- `README.md` & `business-overview.md`
- `product-scope.md` & `user-personas.md`
- `user-roles-permissions.md` (RBAC & Stall Scopes)
- `functional-requirements.md` (Modules 1 through 17)
- `non-functional-requirements.md` (Performance, Reliability, Offline, Security)
- `business-workflows.md` (End-to-End lifecycle diagrams)
- Module specifications: `order-management.md`, `kitchen-management.md`, `qr-ordering.md`, `purchase-management.md`, `inventory-management.md`, `financial-management.md`, `settlement-management.md`, `reporting-requirements.md`, `mobile-app-requirements.md`, `offline-requirements.md`, `security-requirements.md`
- `acceptance-criteria.md` & `risks-and-assumptions.md`

Every feature will follow strict MoSCoW prioritization with positive and negative validation scenarios.

---

## 7. Sign-off Request

Phase 0 is complete. In accordance with the engineering protocol, execution is halted pending explicit review and approval from the project owner.

