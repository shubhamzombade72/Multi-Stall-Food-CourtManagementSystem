# Phase 0: Business Assumption Register & Unresolved Rules

**Date:** 2026-11-02  
**System Role:** Principal Business Analyst & Solution Architect  
**Status:** Under Review (Pending Owner Confirmation)  

---

## 1. Executive Purpose

A frequent root cause of failed commercial software engineering is developers silently turning unverified assumptions into hardcoded business logic. 

This register catalogues every critical business rule, establishes its current status, evaluates its risk profile, and defines what architectural flexibility must be built into the system to prevent costly rework.

---

## 2. Business Assumption Register

| ID | Requirement Area | Current Engineering Understanding | Validation Status | Risk Level | Architectural & Code Impact |
|---|---|---|---|---|---|
| **BAR-01** | **Ownership Model** | Single food court owner owns all stalls, real estate, and billing infrastructure. No independent external franchise royalties in v1. | **Confirmed** | Low | Central database schema with single tenant context and multi-stall hierarchy. |
| **BAR-02** | **Multi-Stall Autonomy** | Stalls operate independently for menu, recipe, kitchen staff, raw materials, purchases, and expenses. | **Confirmed** | Low | Relational scoping by `stall_id` on menus, inventory, KDS tickets, and expenses. |
| **BAR-03** | **Centralized Billing** | One central billing counter collects all payments. Customers receive one consolidated bill even when ordering from multiple stalls. | **Confirmed** | Low | Parent Order -> Child Stall Tickets entity relationship. Consolidated invoice entity. |
| **BAR-04** | **Stall Purchases** | Each stall orders and receives raw materials independently from suppliers, with optional owner approval workflows. | **Confirmed** | Low | Purchase Orders, Inward Goods Receipts, and Accounts Payable scoped per `stall_id`. |
| **BAR-05** | **Customer QR Ordering** | Customers scan table QR to order via mobile web without app installation. Orders can combine items from multiple stalls in 1 cart. | **Confirmed** | Medium | Mobile-first responsive web client, signed table tokens, parent order generation. |
| **BAR-06** | **Offline LAN Operation** | In-court operations (waiters, KDS, billing) must function uninterrupted during external internet outages over local Wi-Fi. | **Confirmed** | High | Local Edge node with PostgreSQL + Laravel + Reverb on LAN; background cloud sync engine. |
| **BAR-07** | **End-of-Day Stall Settlement** | Owner reviews stall-wise daily calculations and records settlement payments to stall managers/representatives. | **Unresolved** | **CRITICAL** | **DO NOT HARDCODE FORMULAS.** Formula depends on commercial arrangement (commission vs. wages vs. operational expense vs. net profit payout). |
| **BAR-08** | **Payment Collection Flow** | Are cash payments collected strictly at the central cashier counter, or can waiters collect cash at the table? | **Pending Clarification** | Medium | Waiter app cash collection permission flag; cashier drawer reconciliation workflow. |
| **BAR-09** | **QR Order Payment Timing** | Do QR orders require immediate digital payment (Pay-first) or can customers order and pay at the counter/table later (Pay-after)? | **Pending Clarification** | High | Order lifecycle must support both `unpaid -> pending_kitchen_approval` and `paid -> auto_dispatched`. |
| **BAR-10** | **Food Serving & Dispatch** | Is food delivered to tables by food court waiters, or do customers collect their food from individual stall counters when notified? | **Pending Clarification** | Medium | System must support: (a) Waiter table delivery, (b) Centralized token calling board, or (c) Hybrid model. |
| **BAR-11** | **Kitchen Hardware Setup** | Will kitchens use interactive touch tablets (KDS), thermal Kitchen Order Ticket (KOT) printers, or both? | **Pending Clarification** | Medium | System must provide Android KDS app AND ESC/POS thermal network printer drivers. |
| **BAR-12** | **Discount & Tax Allocation** | When a consolidated bill receives a discount (e.g., 10% off), how is the loss absorbed across multiple stalls? | **Pending Clarification** | Medium | Configurable discount allocation: Pro-rata across stall item subtotals vs. Owner absorbs centrally. |
| **BAR-13** | **Inventory Consumption Timing** | Does stock decrement automatically upon order acceptance via recipe BOM (Bill of Materials), or upon shift-end tally? | **Pending Clarification** | Medium | Real-time automated recipe deduction with manual physical audit adjustment module. |

---

## 3. Deep Dive into Unresolved Business Rules

### 3.1 The End-of-Day Stall Settlement Problem (BAR-07)
The prompt explicitly warns:
> *"The exact meaning of payment to a stall representative is not yet confirmed. Do not assume that daily sales should be paid directly to stall staff. Design a configurable settlement model and document the unresolved business rules before implementation."*

#### Potential Commercial Models:
1. **Model A: Vendor Revenue Share / Commission Model:**
   - The food court owner keeps a platform commission (e.g., 15% of gross sales).
   - The stall operator receives: `Gross Sales - Commission - Stall Specific Expenses Paid by Owner = Net Settlement Payable`.
2. **Model B: Salaried Staff with Performance Bonus Model:**
   - The stall staff are direct employees of the owner receiving monthly salaries.
   - Daily "settlement" is simply petty cash reimbursement for local daily purchases and shift closure reconciliation.
3. **Model C: Operational Margin Settlement Model:**
   - The stall manager is paid the net margin: `Stall Sales - Raw Material Costs - Stall Labor = Manager Payout`.

#### Architectural Decision:
We will **NOT** hardcode a single formula. The settlement engine will be built with a **Strategy Pattern** featuring configurable settlement calculation formulas in the database (`settlement_rules` table), enabling the owner to choose the formula that reflects their actual legal contract.

---

### 3.2 Payment Timing for QR Orders (BAR-09)
If customers at a table can submit food orders without pre-paying:
- **Risk:** Malicious or prank orders sent to kitchens, wasting food.
- **Alternative:** Require online payment (UPI / Card) before orders reach the kitchen.
- **Dilemma:** Customers wishing to pay cash cannot use the QR system if pre-payment is mandatory.

#### Configurable Solution:
The system will provide an Owner Setting:
1. `Strict Pre-Payment Mode`: QR cart redirects to UPI/Payment Gateway; kitchen tickets are only dispatched upon successful payment confirmation.
2. `Counter Verification Mode`: QR cart submits an `UNCONFIRMED` order; the cashier or waiter must accept the order (or verify cash payment) before kitchen tickets are dispatched.
3. `Post-Dine Billing Mode`: QR cart dispatches directly to kitchen; table accumulates a running balance; customer settles bill with cashier before exiting.

---

### 3.3 Food Serving Model (BAR-10)
Food courts typically operate in one of two modes:
1. **Token / Self-Service:** Customer receives a Token Number on their bill/phone. When the Chinese stall marks items "Ready", the customer's token appears on an overhead display screen or vibrates on their phone. Customer picks up from the Chinese stall.
2. **Waiter Service:** Waiter sees "Ready at Chinese Stall", picks up the dish, and delivers it to Table 12.

#### Architectural Solution:
The system will build modular interfaces for both:
- Android Waiter App with pickup & delivery confirmation.
- Public Token Calling Screen (Web view) for self-service pickup counters.
The owner can toggle between Waiter Service and Self-Service per stall or food-court-wide.

