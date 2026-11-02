# Business Logic & Functional Workflow Audit Report
## Multi-Stall Food Court Management System

**Audit Date:** 2026-11-02  
**Auditor:** Principal Software Architect & QA Architect  
**Scope:** Functional correctness, operational edge cases, cross-application workflows, UI completeness, and business rule conformance.

---

## 1. Functional Findings Matrix

| Finding ID | Title | Severity | Affected Application | Status |
|---|---|:---:|:---:|:---:|
| **BIZ-01** | Cashier POS Cannot Settle Existing Table Orders from QR or Waiters | **CRITICAL** | Desktop POS (`frontend-desktop`) | **VERIFIED** |
| **BIZ-02** | Mobile App Offline Sync Permanently Fails Due to Missing `order_channel` | **CRITICAL** | Mobile App (`mobile-app`) | **VERIFIED** |
| **BIZ-03** | Customer QR Web App Defaults to Table 1 on Root Route | **HIGH** | Customer QR (`frontend-customer`) | **VERIFIED** |
| **BIZ-04** | Menu Management UI Lacks Create, Edit & Price Adjustment Forms | **HIGH** | Desktop Admin (`frontend-desktop`) | **VERIFIED** |
| **BIZ-05** | Purchase & Supplier Management Completely Missing from Desktop UI | **HIGH** | Desktop Admin (`frontend-desktop`) | **VERIFIED** |
| **BIZ-06** | Audit Log Table Exists But Is Never Written by Any Event or Controller | **MEDIUM** | Backend (`backend`) | **VERIFIED** |
| **BIZ-07** | Inventory Ingredients Not Automatically Depleted by Order Sales | **MEDIUM** | Backend & Inventory | **VERIFIED** |
| **BIZ-08** | PostgreSQL Foreign Keys Lack B-Tree Indexes (Performance Degradation) | **MEDIUM** | PostgreSQL Schema | **VERIFIED** |
| **BIZ-09** | Missing Composite Unique Constraint on Stall Settlements `(closing_id, stall_id)` | **LOW** | Database Migration | **VERIFIED** |
| **BIZ-10** | React Native Expo `app.json` References Non-Existent Icon Assets | **LOW** | Mobile App (`mobile-app`) | **VERIFIED** |

---

## 2. Detailed Business Logic & Workflow Findings

### BIZ-01: Cashier POS Cannot Settle Existing Table Orders
* **Severity:** **CRITICAL**
* **Application / Component:** Desktop Frontend (`frontend-desktop/src/pages/PosPage.tsx`)
* **Evidence:**
  - `PosPage.tsx` only supports building a fresh cart and paying for it immediately.
  - The backend provides `GET /api/billing/pending` (`BillingController::getPendingBills`) to list unpaid table and takeaway orders.
  - In `frontend-desktop`, **`GET /api/billing/pending` is never called anywhere.**
  - In `OrdersPage.tsx`, clicking the inspect modal displays an order summary with only a "Close" button. There is no "Process Payment / Settle Bill" button.
* **Business Impact:**
  In a physical food court where customers order via table QR codes or waiters take orders on Android tablets, the cashier **has no screen or button in the desktop POS to collect payment or print receipts for those orders.** The central cashier billing model is rendered operationally inoperable through the UI.
* **Recommended Fix:**
  - Add a "Pending Table Bills" tab/drawer in `PosPage.tsx` that queries `/billing/pending`.
  - When the cashier selects a pending bill, populate `activePaymentOrder`, display the item breakdown by stall, and allow payment settlement (Cash with change, UPI QR, or Card).
  - Add a "Pay Bill" quick-action button in `OrdersPage.tsx` on unpaid orders.

---

### BIZ-02: Mobile App Offline Sync Permanently Fails
* **Severity:** **CRITICAL**
* **Application / Component:** Android Mobile App (`mobile-app/src/screens/waiter/NewOrderScreen.tsx` & `mobile-app/src/api/client.ts`)
* **Evidence:**
  In `NewOrderScreen.tsx` (lines 110–117):
  ```typescript
  const payload = {
    order_type: 'dine_in' as const,
    table_id: table ? table.id : null,
    customer_name: customerName,
    notes: notes,
    items: cartList.map(...),
  }; // MISSING order_channel
  ```
  In `client.ts` (lines 42–53):
  ```typescript
  const payload = {
    order_type: item.order_type,
    table_id: item.table_id,
    customer_name: item.customer_name,
    notes: item.notes,
    items: item.items.map(...),
    idempotency_key: item.id,
  }; // MISSING order_channel
  ```
  In `OrderController.php` (line 74):
  ```php
  'order_channel' => 'required|in:qr_customer,waiter_app,cashier_pos'
  ```
* **Business Impact:**
  Every time a waiter places an order from the mobile app, Laravel returns HTTP 422 (`The order_channel field is required.`).
  The mobile app's catch block assumes the network is down and pushes the order to the local offline queue.
  When the offline sync engine retries (`syncOfflineOrders`), it sends the exact same invalid payload, gets HTTP 422 again, and permanently fails to sync! The order is never delivered to the kitchens.
* **Recommended Fix:**
  Add `'order_channel': 'waiter_app'` explicitly to both `NewOrderScreen.tsx` and `client.ts`.

---

### BIZ-03: Customer QR Web App Defaults to Table 1 on Root Route
* **Severity:** **HIGH**
* **Application / Component:** Customer QR Web (`frontend-customer/src/pages/QrMenuPage.tsx`)
* **Evidence:**
  In `QrMenuPage.tsx` (lines 58–66):
  ```typescript
  let tokenToUse = qrToken;
  if (!tokenToUse) {
    const tablesRes = await apiClient.get('/public/tables');
    if (tablesRes.data.data.length > 0) {
      tokenToUse = tablesRes.data.data[0].qr_token;
    }
  }
  ```
* **Business Impact:**
  If a customer navigates to the root URL (`http://foodcourt.local/`) or scans an invalid link without a valid `qrToken`, the application silently assigns them **Table 1**. Any food ordered is charged and delivered to Table 1, confusing guests and waitstaff.
* **Recommended Fix:**
  If `qrToken` is absent or invalid, render a prompt: `"Please scan the QR code located on your dining table to start ordering"`. Never auto-bind to Table 1.

---

### BIZ-04: Menu Management UI Lacks Create, Edit & Price Adjustment Forms
* **Severity:** **HIGH**
* **Application / Component:** Desktop Admin (`frontend-desktop/src/pages/MenuPage.tsx`)
* **Evidence:**
  `MenuPage.tsx` displays menu items and includes a `toggleAvailability` button (`In Stock` / `Sold Out`).
  However, there is **no button or modal to create a new dish, edit descriptions, adjust dish pricing, change preparation time, or assign food categories**, despite backend endpoints `POST /menu` and `PUT /menu/{id}` existing.
* **Business Impact:**
  Stall managers and food court owners cannot add new menu items or update dish prices from the desktop application.
* **Recommended Fix:**
  Add an "Add New Dish" button and an "Edit Item" modal in `MenuPage.tsx` supporting name, price, veg/non-veg flag, prep time, stall selection, and category selection.

---

### BIZ-05: Purchase & Supplier Management Missing from Desktop UI
* **Severity:** **HIGH**
* **Application / Component:** Desktop Admin (`frontend-desktop`)
* **Evidence:**
  `backend/app/Http/Controllers/Api/PurchaseController.php` implements purchase order creation and receiving into stock (`GET /purchases`, `POST /purchases`, `POST /purchases/{id}/receive`).
  However, in `frontend-desktop/src/components/Sidebar.tsx` and `App.tsx`, **there is no navigation route or page for Purchases.**
* **Business Impact:**
  Stall managers cannot create purchase orders or record goods receipts from suppliers via the desktop UI.
* **Recommended Fix:**
  Create `PurchasesPage.tsx` in `frontend-desktop` with PO creation and "Receive into Stock" actions; link it in `Sidebar.tsx`.

---

### BIZ-06: Audit Log Table Never Populated
* **Severity:** **MEDIUM**
* **Application / Component:** Backend Architecture (`AuditLog.php`)
* **Evidence:**
  - Table `audit_logs` exists (`2026_11_02_111100_create_audit_logs_table.php`).
  - Model `AuditLog.php` exists.
  - Endpoint `GET /reports/audit-logs` in `ReportController.php` queries the table.
  - In `ReportsPage.tsx`, an "Audit Trail & Activity Log" table is displayed.
  - **However, `AuditLog::create()` is NEVER invoked anywhere in the codebase.**
* **Business Impact:**
  The audit log table remains perpetually empty. The food court owner has zero audit trails for critical operations such as price changes, stock adjustments, manual order cancellations, or settlement payouts.
* **Recommended Fix:**
  Implement an `AuditLogService` or Eloquent Model Observers on `Order`, `Payment`, `MenuItem`, `StockMovement`, and `DailyClosing` to record every state change.

---

### BIZ-07: Missing Automatic Stock Depletion on Food Order Completion
* **Severity:** **MEDIUM**
* **Application / Component:** Backend Inventory Engine
* **Evidence:**
  Inventory items are tracked in `inventory_items` and updated during purchase receiving (`PurchaseController::receive`) and manual adjustments (`InventoryController::adjust`).
  However, completing an order does not automatically consume ingredients.
* **Business Impact:**
  Stock levels do not automatically decrement as food items are sold. Inventory tracking relies entirely on manual end-of-shift adjustments.
* **Recommended Fix:**
  Document the current design limitation: automatic depletion requires a recipe Bill-of-Materials (BOM) schema (mapping 1 Pizza to 100g Cheese, 1 Dough Ball).

---

### BIZ-08: PostgreSQL Foreign Keys Lack B-Tree Indexes
* **Severity:** **MEDIUM**
* **Application / Component:** PostgreSQL Migrations
* **Evidence:**
  In PostgreSQL, creating a foreign key constraint (`$table->foreignId('order_id')->constrained(...)`) does **NOT** automatically create an index on the referencing column.
  Columns frequently filtered in queries lack indexes:
  - `orders.status`, `orders.payment_status`, `orders.order_channel`, `orders.created_at`
  - `order_items.stall_id`, `order_items.status`
  - `stall_kitchen_tickets.stall_id`, `stall_kitchen_tickets.status`
  - `payments.order_id`, `payments.created_at`
* **Business Impact:**
  As order volume grows to thousands of records, daily closing calculations (`whereDate('orders.created_at')`) and KDS queries (`where('stall_id', ...)->whereIn('status', ...)`) will perform sequential table scans, severely degrading query performance.
* **Recommended Fix:**
  Add explicit `$table->index([...])` on frequently queried foreign keys and status columns in migrations.

---

### BIZ-09: Missing Composite Unique Constraint on Stall Settlements
* **Severity:** **LOW**
* **Application / Component:** Database Migration (`stall_settlement_records`)
* **Evidence:**
  Table `stall_settlement_records` has `foreignId('closing_id')` and `foreignId('stall_id')`, but lacks `$table->unique(['closing_id', 'stall_id'])`.
* **Business Impact:**
  If a daily closing is recalculated or re-triggered, duplicate settlement rows can be generated for the same stall on the same date.
* **Recommended Fix:** Add unique constraint `$table->unique(['closing_id', 'stall_id'])`.

---

### BIZ-10: React Native Expo `app.json` References Missing Icon Assets
* **Severity:** **LOW**
* **Application / Component:** Mobile App (`mobile-app/app.json`)
* **Evidence:**
  `app.json` specifies `"icon": "./assets/icon.png"` and `"favicon": "./assets/favicon.png"`. However, the directory `mobile-app/assets` does not exist.
* **Business Impact:**
  Running `expo export` or building an APK/AAB with EAS fails during asset bundling.
* **Recommended Fix:**
  Create `mobile-app/assets` with placeholder `icon.png` and `favicon.png`, or remove the asset references from `app.json`.

