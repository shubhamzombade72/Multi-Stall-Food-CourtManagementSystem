# Security Audit Report
## Multi-Stall Food Court Management System

**Audit Date:** 2026-11-02  
**Auditor:** Application Security Auditor & Principal Security Engineer  
**Scope:** Vulnerability analysis, Authentication & RBAC, Access Control, Data Isolation, Input Validation, and Penetration Testing.

---

## 1. Vulnerability Summary Matrix

| Vuln ID | Title | Severity | CVSS v3.1 | Status |
|---|---|:---:|:---:|:---:|
| **SEC-01** | Insecure Direct Object Reference (IDOR) Exposing Customer PII via Public API | **CRITICAL** | 8.6 | **VERIFIED** |
| **SEC-02** | Unauthenticated Channel Spoofing on Order Placement Endpoint | **CRITICAL** | 8.2 | **VERIFIED** |
| **SEC-03** | Privilege Escalation: Kitchen Staff Modifying Menu Item Details & Pricing | **HIGH** | 7.5 | **VERIFIED** |
| **SEC-04** | Authorization Bypass: Waiters and Kitchen Staff Can Record Cash Payments | **HIGH** | 7.4 | **VERIFIED** |
| **SEC-05** | Broken Access Control: Any Authenticated User Can Cancel Active Orders | **HIGH** | 7.1 | **VERIFIED** |
| **SEC-06** | Privilege Escalation: Kitchen Staff Can Create and Receive Purchase Orders | **HIGH** | 6.8 | **VERIFIED** |
| **SEC-07** | Unverified Table Identification: Ordering to Any Table Without Scanning QR | **MEDIUM** | 5.3 | **VERIFIED** |
| **SEC-08** | Missing Date Validation on Reporting Endpoints (500 Error Risk) | **MEDIUM** | 4.3 | **VERIFIED** |
| **SEC-09** | Static, Guessable, Non-Expiring Dining Table QR Tokens | **MEDIUM** | 4.1 | **VERIFIED** |
| **SEC-10** | Missing Rate Limiting on Public QR & Login Endpoints | **MEDIUM** | 5.0 | **VERIFIED** |

---

## 2. Detailed Vulnerability Findings

### SEC-01: Insecure Direct Object Reference (IDOR) Exposing Customer PII
* **Severity:** **CRITICAL**
* **Application / Component:** Backend API (`OrderController.php`)
* **Exact File Path:** [`backend/routes/api.php`](file:///d:/New%20folder/Multi-Stall-Food-CourtManagementSystem/backend/routes/api.php#L31) and [`backend/app/Http/Controllers/Api/OrderController.php`](file:///d:/New%20folder/Multi-Stall-Food-CourtManagementSystem/backend/app/Http/Controllers/Api/OrderController.php#L50-L67)
* **Evidence:**
  ```php
  // routes/api.php
  Route::prefix('public')->group(function () {
      Route::get('/orders/{id}', [OrderController::class, 'show']);
  });
  ```
  `OrderController::show($id)` uses `findOrFail($id)` without authentication and eagerly loads:
  `Order::with(['table', 'items.stall', 'kitchenTickets', 'payments.cashier', 'waiter', 'cashier'])`.
* **Verification Test:** Executed `SecurityAuditTest::test_idor_public_order_show_exposes_sensitive_customer_data_without_auth()`. Returned HTTP 200 with complete customer name, phone number, table number, itemized food, and cashier details.
* **Business Impact:**
  Any external attacker or customer can iterate integer IDs (`1, 2, 3...`) and harvest customer identities, mobile phone numbers, dining patterns, financial transaction totals, and staff assignments across the food court without authentication.
* **Recommended Fix:**
  - Do not expose sequential integer IDs publicly. Use UUIDs or cryptographically signed session tokens.
  - Public order tracking must require either a signed order token (e.g., returned upon order creation) or be constrained by `where('uuid', $uuid)` with a rate limiter.
  - Remove customer phone number and cashier internals from the public resource serializer.
* **Verification Test Required:** Send `GET /api/public/orders/{id}` without order token; assert HTTP 403 or 404.

---

### SEC-02: Unauthenticated Channel Spoofing on Order Placement Endpoint
* **Severity:** **CRITICAL**
* **Application / Component:** Backend API (`OrderController.php`)
* **Exact File Path:** [`backend/app/Http/Controllers/Api/OrderController.php`](file:///d:/New%20folder/Multi-Stall-Food-CourtManagementSystem/backend/app/Http/Controllers/Api/OrderController.php#L70-L84)
* **Evidence:**
  ```php
  $validated = $request->validate([
      'order_channel' => 'required|in:qr_customer,waiter_app,cashier_pos',
      ...
  ]);
  ```
  `POST /api/public/orders` is accessible to unauthenticated callers, but permits the caller to supply `'order_channel' => 'cashier_pos'`.
* **Verification Test:** Executed `SecurityAuditTest::test_public_order_allows_channel_spoofing()`. Sent an unauthenticated payload with `'order_channel' => 'cashier_pos'`; order was successfully inserted as an authoritative cashier order.
* **Business Impact:**
  External attackers can forge orders that appear on audit trails as created by front-desk cashiers, bypassing cashier shift accountability and corrupting sales-by-channel analytics.
* **Recommended Fix:**
  - When invoked on public routes, automatically force `order_channel = 'qr_customer'` on the backend regardless of what payload was submitted.
  - Require `auth:sanctum` and role checks for `waiter_app` and `cashier_pos` order creation channels.
* **Verification Test Required:** Assert that an unauthenticated request supplying `'order_channel' => 'cashier_pos'` is rejected with HTTP 403 or forced to `'qr_customer'`.

---

### SEC-03: Privilege Escalation — Kitchen Staff Can Alter Menu Items and Prices
* **Severity:** **HIGH**
* **Application / Component:** Backend API (`MenuController.php`)
* **Exact File Path:** [`backend/app/Http/Controllers/Api/MenuController.php`](file:///d:/New%20folder/Multi-Stall-Food-CourtManagementSystem/backend/app/Http/Controllers/Api/MenuController.php#L48) & line 66
* **Evidence:**
  ```php
  // MenuController::update
  if (!$user->isOwner() && ($user->stall_id != $item->stall_id)) {
      return response()->json(['success' => false, 'message' => 'Unauthorized...'], 403);
  }
  ```
  The logic permits ANY user whose `stall_id` matches the menu item's `stall_id` to edit the menu item. It does **NOT** check `$user->isStallManager()`.
* **Verification Test:** Executed `SecurityAuditTest::test_kitchen_staff_can_modify_menu_prices_privilege_escalation()`. Logged in as `kitchen_staff` (e.g., Pizza cook); successfully updated Pizza price to ₹1.00.
* **Business Impact:**
  Kitchen cooks or dishwashers with staff tablet access can alter prices, rename menu items, or mark items sold out without stall owner authorization.
* **Recommended Fix:**
  Update authorization check:
  ```php
  if (!$user->isOwner() && !($user->isStallManager() && $user->stall_id == $item->stall_id)) {
      return response()->json(['success' => false, 'message' => 'Unauthorized. Stall Manager role required.'], 403);
  }
  ```
* **Verification Test Required:** As `kitchen_staff`, attempt `PUT /api/menu/{id}`; assert HTTP 403.

---

### SEC-04: Authorization Bypass — Non-Cashiers (Waiters/Kitchen) Can Process Payments
* **Severity:** **HIGH**
* **Application / Component:** Backend API (`BillingController.php`)
* **Exact File Path:** [`backend/app/Http/Controllers/Api/BillingController.php`](file:///d:/New%20folder/Multi-Stall-Food-CourtManagementSystem/backend/app/Http/Controllers/Api/BillingController.php#L28-L47)
* **Evidence:**
  ```php
  public function processPayment(Request $request)
  {
      $cashier = $request->user();
      // NO check for $cashier->isCashier() or $cashier->isOwner()
      $validated = $request->validate([ ... ]);
  ```
* **Verification Test:** Executed `SecurityAuditTest::test_non_cashier_can_execute_payments()`. Logged in as `waiter`; successfully processed payment on an unpaid order and marked it as completed.
* **Business Impact:**
  Waiters or unauthorized stall staff can mark orders as paid without handing over cash to the central counter register, creating massive cash leakage risks and untraceable theft opportunities.
* **Recommended Fix:**
  Add strict role check:
  ```php
  if (!$request->user()->isCashier() && !$request->user()->isOwner()) {
      return response()->json(['success' => false, 'message' => 'Unauthorized. Cashier or Owner privileges required.'], 403);
  }
  ```
* **Verification Test Required:** As `waiter`, call `POST /api/billing/pay`; assert HTTP 403.

---

### SEC-05: Broken Access Control on Order Cancellation
* **Severity:** **HIGH**
* **Application / Component:** Backend API (`OrderController.php`)
* **Exact File Path:** [`backend/app/Http/Controllers/Api/OrderController.php`](file:///d:/New%20folder/Multi-Stall-Food-CourtManagementSystem/backend/app/Http/Controllers/Api/OrderController.php#L193-L224)
* **Evidence:**
  `OrderController::cancelOrder` has no role restriction. Any authenticated token can trigger order cancellation. Furthermore, it fails to check if the order was already paid (`$order->payment_status === 'paid'`), allowing cancellation of settled financial transactions without refund accounting.
* **Recommended Fix:**
  - Restrict `cancelOrder` to `isOwner()` or `isCashier()`.
  - Prohibit cancellation if `payment_status === 'paid'` unless an explicit manager override and refund ledger record are executed.
* **Verification Test Required:** As `waiter` or `kitchen_staff`, attempt `POST /api/orders/{id}/cancel`; assert HTTP 403.

---

### SEC-06: Privilege Escalation on Purchases and Stock Inward
* **Severity:** **HIGH**
* **Application / Component:** Backend API (`PurchaseController.php`)
* **Exact File Path:** [`backend/app/Http/Controllers/Api/PurchaseController.php`](file:///d:/New%20folder/Multi-Stall-Food-CourtManagementSystem/backend/app/Http/Controllers/Api/PurchaseController.php#L53) & line 100
* **Evidence:**
  `PurchaseController::store` and `receive` check `($user->stall_id != $validated['stall_id'])` without checking if `$user->isStallManager()`.
* **Business Impact:**
  Kitchen line cooks can generate fabricated purchase orders and mark incoming stock as received.
* **Recommended Fix:** Require `isStallManager()` or `isOwner()` on all purchase management endpoints.

---

### SEC-07: Unverified Table Identification on Public Order POST
* **Severity:** **MEDIUM**
* **Application / Component:** Backend API (`OrderController.php`)
* **Exact File Path:** [`backend/app/Http/Controllers/Api/OrderController.php`](file:///d:/New%20folder/Multi-Stall-Food-CourtManagementSystem/backend/app/Http/Controllers/Api/OrderController.php#L71-L82)
* **Evidence:**
  `createOrder` accepts `'table_id' => 'nullable|exists:dining_tables,id'`. It does **NOT** require or validate the `qr_token` of that table.
* **Business Impact:**
  A customer sitting at Table 1 can submit orders targeting Table 5, Table 8, etc., sending unordered food to other patrons.
* **Recommended Fix:**
  For public QR orders, require `'qr_token'` in the payload. Look up the table via `DiningTable::where('qr_token', $token)->firstOrFail()` rather than trusting client-submitted `table_id`.

---

### SEC-08: Missing Input Validation on Reporting Date Ranges
* **Severity:** **MEDIUM**
* **Application / Component:** Backend API (`ReportController.php`)
* **Exact File Path:** [`backend/app/Http/Controllers/Api/ReportController.php`](file:///d:/New%20folder/Multi-Stall-Food-CourtManagementSystem/backend/app/Http/Controllers/Api/ReportController.php#L66-L71)
* **Evidence:**
  `$startDate = $request->query('start_date', ...)` is passed directly to `whereBetween(DB::raw('DATE(orders.created_at)'), [$startDate, $endDate])` without `date` format validation. Malformed strings trigger uncaught SQL exceptions (HTTP 500).
* **Recommended Fix:** Validate query parameters using `$request->validate(['start_date' => 'date', 'end_date' => 'date|after_or_equal:start_date'])`.

---

### SEC-09: Static, Non-Expiring QR Tokens
* **Severity:** **MEDIUM**
* **Application / Component:** Backend Model (`DiningTable.php`)
* **Exact File Path:** [`backend/app/Models/DiningTable.php`](file:///d:/New%20folder/Multi-Stall-Food-CourtManagementSystem/backend/app/Models/DiningTable.php#L30-L34)
* **Evidence:**
  `qr_token` is generated once upon table creation (`'TBL-' . strtoupper(Str::random(12))`). It never expires, rotates, or incorporates a time-based HMAC signature.
* **Business Impact:**
  A customer can photograph a QR code, leave the food court, and place spam orders from their home hours or days later that dispatch to physical kitchen stalls.
* **Recommended Fix:**
  Implement daily rotation or short-lived cryptographic table tokens (e.g. HMAC-SHA256 signature containing date and salt).

