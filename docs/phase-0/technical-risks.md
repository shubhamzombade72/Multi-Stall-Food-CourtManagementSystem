# Phase 0: Technical Risk Register & Mitigation Architecture

**Date:** 2026-11-02  
**System Role:** Principal Security & Reliability Engineer  
**Status:** Complete  

---

## 1. Risk Evaluation Framework

Every risk is quantified across two dimensions before and after mitigation:
- **Likelihood:** Low (1), Medium (2), High (3)
- **Impact:** Minor (1), Moderate (2), Critical (3)
- **Risk Score:** Likelihood x Impact (1–9, where 6–9 represents High Severity)

---

## 2. Technical Risk Matrix

| Risk ID | Risk Domain | Description | Likelihood | Impact | Score | Technical Mitigation Strategy |
|---|---|---|---|---|---|---|
| **TR-01** | **Offline Sync / Distributed Data** | Edge node and cloud diverge due to intermittent network drops, resulting in split-brain state or duplicate order IDs. | Medium | Critical | **6 (High)** | **Idempotent UUIDs & Monotonic Sequences:** All primary keys for transactional records use UUIDv7 (time-ordered, collision-resistant). Background sync uses append-only changelogs with idempotent upsert endpoints. |
| **TR-02** | **Inventory Concurrency** | Two customers order the last portion of a limited item simultaneously, causing negative stock or unfulfillable kitchen tickets. | High | Moderate | **6 (High)** | **Pessimistic Row Locking & Stock Reservation:** Use `SELECT ... FOR UPDATE` inside PostgreSQL database transactions during order placement. In-flight items hold temporary reservations with TTL. |
| **TR-03** | **QR Tampering & Table Spoofing** | A malicious customer scans Table 05 QR, copies the URL, edits parameters to Table 01 or injects invalid prices, causing orders to bill to another customer. | High | Critical | **9 (Critical)** | **HMAC Signed Table Tokens & Server-Side Price Lookup:** QR codes encode cryptographically signed JWT/HMAC tokens verifying physical table authenticity. The client submits only `item_id` and `variant_id`; prices are strictly calculated server-side from PostgreSQL. |
| **TR-04** | **Payment Drift & Ghost Transactions** | Customer pays via UPI or card; network fails before cashier or customer screen receives gateway webhook, causing order status limbo. | High | Critical | **9 (Critical)** | **Payment Reconciliation Engine & Gateway Webhook Polling:** Webhook listeners with replay protection; fallback polling mechanism to verify transaction status directly with gateway API; manual cashier override with mandatory transaction ID entry and audit logging. |
| **TR-05** | **Multi-Stall Data Leakage** | Kitchen or manager of Stall A accesses sales reports, raw material recipes, or profit margins of Stall B. | Medium | Critical | **6 (High)** | **Strict Multi-Tenant Scoping & Laravel Global Scopes:** Use Laravel Policies and Tenant/Stall Scopes (`StallScope`) enforcing `WHERE stall_id = ?` at the Eloquent model layer. Kitchen WebSocket channels are strictly authenticated private channels. |
| **TR-06** | **In-Court Thermal Printer Latency / Failure** | Physical thermal printer runs out of paper or loses IP connection, blocking the entire kitchen or checkout queue. | High | Moderate | **6 (High)** | **Print Spooler & KDS Redundancy:** Android KDS tablets act as the primary real-time order display. Printing is asynchronous via background queue; failed print jobs generate visual warning badges on the Cashier UI with a "Reprint" button. |
| **TR-07** | **Float Point Rounding in Financials** | Using floating-point arithmetic for item prices, percentage discounts, GST/tax, and stall settlements leads to cumulative penny drift. | Low | Critical | **3 (High)** | **Strict Fixed-Point Decimal / Integer Math:** PostgreSQL columns strictly configured as `DECIMAL(12, 2)`. PHP calculations strictly handled via `bcmath` or integer cents/paisa. No floating-point types in financial models. |
| **TR-08** | **Denial of Service via QR Order Flooding** | Attacker writes an automated bot to submit hundreds of fake orders through the public QR ordering endpoint. | Medium | Critical | **6 (High)** | **Rate Limiting & Session Throttling:** Strict Laravel rate limiters on public QR submission routes (`throttle:10,1`). Device fingerprinting and optional SMS OTP or cashier verification for untrusted devices. |
| **TR-09** | **End-of-Day Settlement Discrepancy** | Unresolved business logic leads to disputes between stall managers and the owner over cash deductions, damaged stock, or returned items. | High | High | **9 (Critical)** | **Dual-Sided Settlement Audit Trail:** Every settlement generates an itemized worksheet showing Gross Sales, Void Orders, Returns, Raw Material Cost, Approved Expenses, and Owner Deductions. Requires dual digital sign-off (Owner Approval + Manager Acknowledgment). |
| **TR-10** | **Android App Memory Leaks & Background Crashes** | Long-running KDS tablets running all day in hot kitchen environments crash due to memory leaks or WebSocket disconnects. | Medium | High | **6 (High)** | **Automated Heartbeats & Exponential Reconnect:** Lightweight KDS UI with periodic garbage collection, heartbeat ping/pong on Laravel Reverb WebSockets, and automatic exponential backoff reconnection. |

---

## 3. High-Priority Risk Mitigation Architecture

```mermaid
flowchart TD
    subgraph ClientLayer ["Client Layer (Threat Surface)"]
        QR[Customer Mobile Browser]
        KDS[Kitchen Android Tablet]
        Cashier[Desktop POS Terminal]
    end

    subgraph SecurityControls ["Zero-Trust Security Controls"]
        HMAC[HMAC Table Token Validator]
        Throttle[Rate Limiter & Bot Blocker]
        Sanctum[Sanctum RBAC & Stall Policy]
    end

    subgraph CoreEngine ["Transactional Backend Engine"]
        Tx[PostgreSQL Atomic Transaction]
        Lock[Pessimistic Row Lock: FOR UPDATE]
        PriceEngine[Server-Authoritative Price Engine]
    end

    subgraph StorageLayer ["PostgreSQL 17 Relational Storage"]
        UUID[UUIDv7 Primary Keys]
        Dec[DECIMAL(12,2) Fixed Point]
        Audit[Append-Only Financial Ledger]
    end

    QR -->|Signed URL| HMAC
    QR -->|Submit Order| Throttle
    Throttle --> PriceEngine
    Cashier --> Sanctum
    KDS --> Sanctum
    Sanctum --> Tx
    PriceEngine --> Tx
    Tx --> Lock
    Lock --> UUID
    Lock --> Dec
    Dec --> Audit
```

