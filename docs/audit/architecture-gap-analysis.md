# Architecture Gap Analysis
## Multi-Stall Food Court Management System

**Audit Date:** 2026-11-02  
**Auditor:** Principal Software Architect & Reliability Engineer  
**Scope:** Architecture evaluation of Backend, Desktop POS, Customer QR, and Android Applications.

---

## 1. Executive Summary

This architecture gap analysis evaluates the actual implemented codebase against the operational requirements of a multi-stall food court. While the core relational data model and multi-stall order splitting logic are well-structured, several major architectural discrepancies and gaps exist between the documented system design and the actual implementation.

---

## 2. In-Depth Architectural Discrepancy Investigation

### 2.1 Discrepancy 1: Realtime Order Notifications (Laravel Reverb vs. HTTP Polling)
* **Design Specification:** Realtime order notifications powered by Laravel Reverb and WebSockets for instantaneous kitchen dispatch, waiter alerts, and customer order tracking.
* **Actual Implementation:**
  - `backend/composer.json` does **NOT** contain `laravel/reverb` or `pusher/pusher-php-server`.
  - There are zero Broadcast Events (`app/Events`), zero Event Listeners, and zero channel authorization definitions in `routes/channels.php`.
  - All applications rely on brute-force HTTP polling via `setInterval`:
    - Customer QR Web (`OrderTrackPage.tsx` line 34): Polls `GET /api/public/orders/{id}` every **4 seconds**.
    - Android Waiter Terminal (`ReadyDishesScreen.tsx` line 33): Polls `GET /api/waiter/ready-items` every **5 seconds**.
    - Android Kitchen Terminal (`KdsScreen.tsx` line 28): Polls `GET /api/kitchen/tickets` every **4 seconds**.
* **Operational Impact:**
  - In an active food court with 30 dining tables, 3 stalls (each with a kitchen tablet), 4 waiters, and 2 cashier terminals, the local server is bombarded with **30–50 HTTP requests per second** continuously, even when there are no new orders.
  - Latency: Dish readiness notifications take up to 5 seconds to appear on waiter screens.
* **Architectural Remedy:** Install `laravel/reverb`, configure Pusher protocol broadcasting, and replace client-side polling with WebSocket channel subscriptions (`foodcourt-order.{orderId}`, `stall-kitchen.{stallId}`, `waiter-alerts`).

---

### 2.2 Discrepancy 2: Local Edge Server Architecture vs. Mobile Offline Queue
* **Design Specification:** Local Food Court Edge Server with offline LAN autonomy, handling power and internet outages locally, with downstream waiter app synchronization.
* **Actual Implementation:**
  - The backend is a standard monolithic Laravel application. It assumes a direct connection to a PostgreSQL database (`DB_HOST=127.0.0.1`).
  - There is no Edge Server daemon, heartbeat manager, local DNS discovery (mDNS), or local sync service.
  - What exists is solely a client-side offline storage queue in the React Native mobile app (`mobile-app/src/storage/offlineStore.ts`).
* **Operational Impact:**
  - The system functions as a local server if hosted on a LAN PC. However, there are no failover mechanisms, automatic IP discovery routines, or local server monitoring agents.

---

### 2.3 Discrepancy 3: Cloud Synchronization Architecture
* **Design Specification:** Local Edge Server + Cloud Synchronization for centralized owner reporting, multi-branch oversight, and remote dashboard access.
* **Actual Implementation:**
  - **Zero cloud synchronization exists.** There are no queued jobs, no database replication mechanisms, no API synchronization endpoints to a cloud master, and no tombstone records for tracking deleted or modified entities across nodes.
  - The entire database is strictly local.
* **Operational Impact:**
  - All data is confined to the local food court machine. If the local disk fails without manual PostgreSQL dumps, all transaction history, sales, and inventory data are lost. Multi-store management is impossible without custom cloud sync.

---

### 2.4 Discrepancy 4: Offline Order Idempotency & Duplicate Prevention
* **Design Specification:** Offline orders captured by waiters must be synchronized without creating duplicate orders or duplicate kitchen tickets on retries.
* **Actual Implementation:**
  - In `mobile-app/src/api/client.ts` line 52, the mobile client attaches `idempotency_key: item.id`.
  - In `backend/app/Http/Controllers/Api/OrderController.php`, the controller **completely ignores** `idempotency_key`. It is not validated, not stored, and not indexed.
  - The `orders` table in `database/migrations/2026_11_02_110400_create_orders_and_order_items_table.php` has **NO** `idempotency_key` column and no unique constraint.
* **Operational Impact:**
  - When an Android waiter app resends an offline queue item following a network timeout, the backend creates a brand-new parent order and a duplicate set of kitchen tickets. Kitchens will prepare duplicate meals, causing food waste and inventory discrepancies.
* **Architectural Remedy:** Add `idempotency_key` (VARCHAR 64, unique, nullable) to `orders` migration, validate it in `OrderController::createOrder`, and return the existing order if an idempotency key matches.

---

### 2.5 Discrepancy 5: Database-Level Stall Isolation
* **Design Specification:** Stall employees cannot access another stall's private data without authorization. Database-level stall isolation constraints.
* **Actual Implementation:**
  - There are **NO PostgreSQL Row-Level Security (RLS)** policies enabled on tables `stall_kitchen_tickets`, `menu_items`, `inventory_items`, or `purchase_orders`.
  - Isolation is enforced entirely via Eloquent query clauses in controllers (e.g., `where('stall_id', $user->stall_id)`).
* **Operational Impact:**
  - If a developer introduces an endpoint or query without manual `where('stall_id', ...)`, data leaks across stalls immediately. There is no defense-in-depth at the persistence layer.
* **Architectural Remedy:** Enable PostgreSQL Row-Level Security (RLS) on stall-scoped tables, or introduce Global Eloquent Scopes (`StallScope`) bound to the authenticated user's `stall_id`.

---

### 2.6 Discrepancy 6: Authoritative Backend Financial Calculations
* **Design Specification:** Authoritative backend prices, tax calculations, and payment change logic.
* **Actual Implementation:**
  - `OrderController.php` lines 98–135 fetches authoritative prices from `MenuItem::whereIn('id', ...)` and computes line totals using `bcmul` and `bcadd`. (VERIFIED)
  - `tax_amount` is hardcoded to a flat 5% GST (`bcmul($subtotal, '0.05', 2)`).
  - Cashier payment change calculation (`BillingController.php` lines 54–59) authoritatively checks `cashTendered >= amount` and calculates `changeReturned` using `bcsub`. (VERIFIED)
* **Gap Identified:**
  - Tax rates are hardcoded rather than driven by a system settings configuration or category-level GST rules (e.g., 5% vs 18% on specific packaged goods).

---

### 2.7 Discrepancy 7: Purchase Receiving & Stock Concurrency
* **Design Specification:** Transaction-safe purchase receiving and stock movements.
* **Actual Implementation:**
  - `PurchaseController::receive` (lines 108–135) uses `DB::transaction()` and pessimistic locking (`InventoryItem::where('id', ...)->lockForUpdate()`). (VERIFIED)
  - `InventoryController::adjust` uses `DB::transaction()` and logs to `StockMovement`. (VERIFIED)
* **Gap Identified:**
  - Stock is **NOT** automatically decremented when food orders are fulfilled. There is no Bill of Materials (BOM) or Recipe Ingredient mapping linking a `MenuItem` (e.g., Margherita Pizza) to `InventoryItem`s (e.g., 150g Flour, 80g Cheese). Inventory depletion remains completely manual.

---

### 2.8 Discrepancy 8: EOD Settlement Formula
* **Design Specification:** End-of-day closing must show stall-wise business and payment information without hardcoding an unconfirmed commission or revenue-sharing formula.
* **Actual Implementation:**
  - `SettlementController.php` lines 140–148 generates `StallSettlementRecord` where `settlement_amount` defaults to `stall_gross_sales`.
  - No deduction, commission, or revenue-sharing percentage is fabricated.
  - The settlement status progresses from `calculated` to `paid` when the owner executes `recordSettlementPayment()`. (VERIFIED)

---

## 3. Summary of Architectural Gaps

| ID | Design Requirement | Implemented Reality | Gap Severity |
|---|---|---|---|
| **GAP-01** | Realtime WebSockets via Laravel Reverb | 4s–5s HTTP polling across all apps; Reverb not installed | **HIGH** |
| **GAP-02** | Local Edge Server Autonomy & Cloud Sync | Local monolithic Laravel; Zero cloud sync implementation | **HIGH** |
| **GAP-03** | Offline Order Idempotency | `idempotency_key` sent by client but ignored by backend | **CRITICAL** |
| **GAP-04** | Defense-in-depth Database Stall Isolation | Pure application queries; No PostgreSQL RLS or Global Scopes | **MEDIUM** |
| **GAP-05** | Inventory Ingredient Depletion on Sales | No Recipe/BOM mapping; stock adjustments are purely manual | **MEDIUM** |
| **GAP-06** | Configurable Tax / GST Engine | Hardcoded flat 5% GST in controller code | **LOW** |

