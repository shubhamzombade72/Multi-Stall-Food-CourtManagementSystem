# Cashier POS & Consolidated Billing Workflow

> **Phase 3 note (2026-11-02):** verified end-to-end in the browser against staging (UAT-CA-02/03). Since Phase 3
> the API rejects payments that do not equal the bill total, and only owner/cashier can read orders and receipts.

## Multi-Stall Food Court Management System

**Document Version**: 2.0 (Post-Remediation Verification)  
**Modules Covered**: Cashier POS (`PosPage.tsx`), Orders Page (`OrdersPage.tsx`), Backend Billing API (`BillingController.php`)

---

## 1. Cashier Role & Workflow Overview

In the multi-stall food court architecture, the Cashier operates the single centralized point of payment collection and consolidated customer checkout. Customers may order from 3 different channels:
1. **Self-Service QR Ordering** (Customer places order at table, dining, paying at counter upon exit or ordering).
2. **Waiter Assisted Ordering** (Waiter inputs customer order on Android tablet, dining at table, payment settled at cashier).
3. **Counter POS Direct Walk-in** (Customer walks straight to cashier counter, places order across multiple stalls, pays immediately, and takes buzzer/table).

---

## 2. End-to-End Cashier Settlement Architecture

```
  ┌────────────────────────────────────────────────────────┐
  │                    CASHIER POS (Desktop)               │
  └───────┬────────────────────────────────────────┬───────┘
          │                                        │
    [Mode Switcher]                          [Mode Switcher]
          │                                        │
          ▼                                        ▼
   ┌───────────────┐                       ┌───────────────┐
   │ Counter Order │                       │ Pending Bills │
   │ (New Cart)    │                       │ (Unpaid Orders)
   └───────┬───────┘                       └───────┬───────┘
           │ Multi-Stall Catalog                   │ Live Auto-Refresh (8s)
           ▼                                       ▼
     [Create Order]                       [Select Table / Order]
           │                                       │
           ▼                                       ▼
    Order Dispatched                        [Settle Bill Modal]
   (Tickets generated)                             │
           │                                       ├─ Select Payment: Cash / UPI / Card
           ▼                                       ├─ Cash Change Calculator
     [Process Payment] <───────────────────────────┤
           │
           ▼
   Backend POST /api/billing/pay (Row-locked, Idempotent)
           │
           ├─ Payment record created
           ├─ Order payment_status => 'paid'
           ├─ Table status => 'available' (freed)
           ├─ Audit log recorded
           └─ Broadcast PaymentCompletedEvent
```

---

## 3. UI/UX Features Implemented in Cashier POS (`PosPage.tsx`)

### 3.1 Mode Switcher (Counter POS vs Pending Table Bills)
- Top banner toggle allows the cashier to seamlessly switch between:
  1. **"New Counter Order"**: Interactive multi-stall menu browser, search, stall filter, customer cart, and immediate checkout.
  2. **"Pending Table Bills"**: Real-time listing of all active dining tables and unpaid orders placed by customers (via QR) or waiters (via mobile app).

### 3.2 Real-Time Pending Bills Drawer & Search
- Live polling every 8 seconds via `GET /api/billing/pending`.
- Real-time search by Table Number, Customer Name, or Order Number.
- Shows total amount, timestamp, order channel badge (`QR Customer` / `Waiter App` / `Counter POS`), and itemized multi-stall breakdown.

### 3.3 Instant Bill Settlement Modal
- Clicking **"Settle Bill"** on any pending order opens a modal with:
  - Table number and full order details.
  - Multi-stall items preview.
  - Payment method selector: **Cash**, **UPI / QR**, **Card**.
  - **Live Cash Tendered & Change Return Calculator**: When Cash is selected, cashier inputs the notes received (e.g., ₹500 for a ₹315 bill), and the modal automatically calculates the exact change return (₹185) with over/under-payment validation.
  - Submitting triggers atomic backend settlement, displays confirmation, and auto-removes the settled order from the pending list.

### 3.4 Cross-Navigation from Orders List
- In `OrdersPage.tsx`, every unpaid order displays a green **"Settle Payment at POS ➔"** quick-action button that transitions directly to the POS settlement modal.

---

## 4. Backend Billing Endpoints & Authorization

### 4.1 `GET /api/billing/pending`
- **Role Requirement**: Strictly limited to `isCashier()` or `isOwner()` (HTTP 403 on other roles).
- **Behavior**: Retrieves all orders where `payment_status = 'unpaid'` and `status != 'cancelled'`, ordered by `created_at ASC`. Includes dining table relations and items with stall metadata.

### 4.2 `POST /api/billing/pay`
- **Role Requirement**: Strictly limited to `isCashier()` or `isOwner()`.
- **Payload**:
  ```json
  {
    "order_id": 42,
    "payment_method": "cash",
    "amount": 420.00,
    "cash_tendered": 500.00,
    "notes": "Table 4 checkout"
  }
  ```
- **Atomicity & Concurrency Safeguards**:
  - `Order::where('id', $orderId)->lockForUpdate()->firstOrFail()`
  - Rejects already paid orders with HTTP 422 (`Order has already been paid in full`).
  - Creates authoritative `payments` record with auto-incremented receipt number `PAY-YYYYMMDD-XXXX`.
  - Marks `Order::payment_status = 'paid'`.
  - Automatically frees the table: `DiningTable::where('id', $order->table_id)->update(['status' => 'available'])`.
  - Dispatches `PaymentCompletedEvent` and records `AuditLog` entry.

### 4.3 `GET /api/billing/order/{id}/receipt`
- Generates itemized receipt data grouped by stall name for printing thermal slips or customer verification.

---

## 5. Verification Proof
- `BillingPaymentTest::test_cashier_can_settle_consolidated_bill_and_free_table` (PASS)
- `PendingBillsAndPurchasesTest::test_cashier_can_retrieve_pending_bills_and_receipts` (PASS)
- `SecurityAuditTest::test_waiter_blocked_from_executing_payments` (PASS)

