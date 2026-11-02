# Multi-Stall Food Court Management System - User Manual & Operating Guide

## 1. Role-Based Access Control

The desktop software automatically conforms navigation and capabilities to the signed-in role:

| Role | Landing Page | Key Capabilities |
|---|---|---|
| **Owner / Admin** | `/dashboard` | Complete overview, stalls, staff, tables, settings, closings, financial reports, audit logs. |
| **Cashier** | `/pos` | Counter & table orders, consolidated billing, cash change calculator, receipt printing, daily cash drawer closing. |
| **Stall Manager** | `/kitchen` | Stall-specific kitchen display, stall-specific inventory, purchases, supplier management. |
| **Kitchen Staff** | `/kitchen` | Stall-isolated kitchen tickets, status transitions (Accept → Preparing → Ready). |
| **Waiter** | `/waiter` | Dining table status, multi-stall ordering, pickup notifications, mark served. |
| **Store Staff** | `/inventory` | Inward receipt, stock out, inventory adjustments, stock movements. |

---

## 2. Cashier POS Workflow

1. **New Order:**
   - Select **Dine-In** or **Takeaway**.
   - If Dine-In, select the customer's table number.
   - Enter optional Customer Phone / Name (system automatically checks past records).
   - Click items across any stall to add them to the consolidated cart.
   - Keyboard Shortcuts:
     - `F2`: Focus menu search.
     - `F4`: Send directly to kitchens (unpaid bill).
     - `F8`: Send to kitchens & open payment settlement modal immediately.
     - `F9`: Switch between New Order and Pending Table Bills view.
     - `Esc`: Close open modals.
2. **Settling Pending Bills:**
   - Click **Pending Table Bills** tab or press `F9`.
   - Click **Settle Bill** on the table card.
   - Select payment method (`Cash`, `UPI QR`, `Card POS`).
   - If `Cash`, enter amount received: the change to return is instantly calculated.
   - Click **Confirm Payment & Settle**.
   - Print thermal receipt via Windows print dialog or thermal printer.

---

## 3. Kitchen Display System (KDS) Workflow

1. Kitchen screen auto-refreshes every 4 seconds and sounds a soft chime when a new ticket arrives.
2. Tickets appear strictly for the assigned stall.
3. Order progression:
   - Click **Start Prep** (`confirmed` → `preparing`).
   - Click **Mark Ready** (`preparing` → `ready`).
4. When ready, dishes notify Waiters immediately for pickup.

---

## 4. End-of-Day Closing (EOD)

### Cashier Closing (`/cashier-closing`)
1. At the end of a shift, cashiers navigate to **Cashier Closing**.
2. The system computes expected cash collected during the shift from paid cash transactions.
3. Enter actual cash physically counted in the drawer.
4. The system calculates any overage or shortage variance.
5. Click **Submit Cashier Closing**.

### Food Court Daily Closing (`/settlements`)
1. Owner opens **End-of-Day Closing**.
2. Reviews total daily sales, stall-wise portion, and payment method summaries.
3. Clicks **Close Day & Generate Stall Settlements**.
4. Payout records are generated for each active stall for settlement distribution.

