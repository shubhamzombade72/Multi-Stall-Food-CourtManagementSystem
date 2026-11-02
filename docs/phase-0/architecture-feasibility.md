# Phase 0: Architecture Feasibility & Strategy Evaluation

**Date:** 2026-11-02  
**System Role:** Principal Architect  
**Status:** Complete  

---

## 1. Architectural Mission & Principles

A Multi-Stall Food Court Management System presents unique architectural challenges distinct from standard single-restaurant POS systems:
1. **Multi-Stall Decoupling:** One food court contains multiple independent culinary stalls (Pizza, Burger, Chinese, Momos, Beverages), each with independent kitchens, staff, recipes, raw material consumption, purchases, and expenses.
2. **Centralized Financial Aggregation:** All customer payments pass through a single unified cash counter or centralized digital gateway. A customer can order items from three stalls in a single transaction, requiring automated atomic ticket splitting (1 Parent Order -> N Stall Tickets) while producing one consolidated bill.
3. **Zero-Latency In-Court Operations:** Kitchens cannot wait for slow cloud APIs during peak lunch/dinner rushes. If the external internet ISP fails, orders must continue being created, prepared, delivered, and billed locally.

---

## 2. Evaluation of Backend Architecture (Laravel Modular Monolith)

### 2.1 Why Modular Monolith Over Microservices?
- **Anti-Pattern Warning:** Splitting this system into independent microservices (e.g., Order Service, Billing Service, Inventory Service, Kitchen Service) would introduce distributed transaction hell (2-Phase Commit / Sagas), distributed tracing overhead, network serialization latency, and high deployment complexity for a single food court owner.
- **The Correct Pattern:** A **Modular Monolith** built on Laravel 11/12. All domains (`App\Domain\Orders`, `App\Domain\Kitchen`, `App\Domain\Inventory`, `App\Domain\Billing`, `App\Domain\Settlements`) reside in a single codebase with clean logical boundaries, explicit service contracts, and strict database foreign key relationships.

### 2.2 Advantages
- Single database transactions (`DB::transaction`) ensure that a parent order and its associated stall tickets, stock allocations, and bill line items succeed or fail atomically.
- Zero network serialization overhead between modules.
- Simplified operational deployment and backup procedures.
- Direct Eloquent relationships with eager loading prevent N+1 query bottlenecks.

### 2.3 Trade-offs & Mitigations
- *Risk:* Modules could become tightly coupled if developers bypass domain boundaries.
- *Mitigation:* Enforce Domain-Driven module boundaries, DTOs (Data Transfer Objects), and dedicated Action classes for cross-domain operations.

---

## 3. Evaluation of Database Engine (PostgreSQL 17)

### 3.1 Relational Integrity & Data Types
PostgreSQL 17 is the gold standard for financial and transactional operations.
- **Monetary Precision:** Under no circumstances will floating-point numbers (`FLOAT`, `DOUBLE`) be used for prices, taxes, discounts, or settlements. All financial values will use `DECIMAL(12, 2)` or `BIGINT` (cents/paisa).
- **Strict Constraints:** Foreign keys (`ON DELETE RESTRICT` for financial and inventory history), `CHECK` constraints (e.g., `quantity > 0`, `price >= 0`), and unique constraints (e.g., `table_number`, `sku` per stall).
- **JSONB Justification:** JSONB will only be permitted for non-relational, variable metadata such as raw webhook payloads, audit snapshot deltas, and client printer device configurations. Core business entities will be strictly normalized.
- **Concurrency Control:** Inventory stock decrement and table occupancy will utilize PostgreSQL row-level locks (`SELECT ... FOR UPDATE`) inside atomic database transactions to prevent race conditions during concurrent high-volume ordering.

---

## 4. Evaluation of Frontend & Mobile Architectures

### 4.1 Desktop POS & Admin (React + Vite + TypeScript + Tailwind)
- **Role:** High-speed cash counter, stall management, central analytics.
- **Design:** Keyboard shortcuts for rapid checkout, real-time ticket sound alerts, responsive grid layouts, and automatic print spooling for receipt printers (ESC/POS).
- **State Management:** TanStack Query for server state cache with Redux Toolkit for active cart mutations and offline pending queues.

### 4.2 Customer QR Mobile Web (Zero-Install Browser App)
- **Role:** Dine-in table ordering without app download friction.
- **Design:** Mobile-first, sub-1.5 second initial load, high-contrast touch menus, allergy/variant selectors, real-time order status tracking.
- **Security:** Table tokens cryptographically signed to prevent URL tampering and cross-table ordering griefing.

### 4.3 Unified Android Mobile Application (React Native + Expo)
- **Role:** Single universal app with dynamic Role-Based Access Control (RBAC):
  - *Waiter:* Table management, taking manual table orders, food pickup and delivery confirmation.
  - *Kitchen (KDS):* Large touch-friendly order cards, status transitions (Accept -> Preparing -> Ready), preparation countdown timers.
  - *Stall Manager:* Menu toggle (in-stock/86-out), daily consumption review, purchase requests.
  - *Store Staff:* Stock receiving, stock transfer, physical count verification.
  - *Owner:* Real-time live food court dashboard, high-level financial health, approval workflows.
- **Advantage:** Single codebase to maintain, test, and distribute across Android devices. Dynamic permission trees determine the user's active UI shell.

---

## 5. Offline-First Operational Capabilities: Comparative Analysis

The prompt mandates robust offline operational capabilities. Below is an engineering evaluation of the three architectural options.

### 5.1 Architecture Options Comparison

| Dimension | Option A: Pure Cloud Only | Option B: Local Food Court Server + Cloud Sync (Recommended) | Option C: Fully Peer-to-Peer Mobile Sync |
|---|---|---|---|
| **Topology** | Clients talk directly to remote cloud server. | An on-premise local server (mini-PC or POS master terminal) runs the PostgreSQL database, Laravel API, and Reverb WebSocket on the local LAN. It continuously synchronizes with the remote cloud. | Mobile devices and POS terminals sync directly with each other without any local server. |
| **Internet Dependency** | 100% dependent. If internet drops, all ordering, kitchen displays, and billing STOP immediately. | **Zero dependency during outage.** LAN handles all orders, KDS, waiter delivery, and billing without interruption. | Zero dependency during outage. |
| **Conflict Complexity** | None. Single cloud DB. | Low to Moderate. Local server is the definitive source of truth for the physical premises. Synced to cloud in append-only / idempotent batches. | **Extreme.** Complex CRDTs / multi-master peer-to-peer conflict resolution across dozens of mobile devices. High failure risk. |
| **Customer QR Ordering Offline** | Fails completely. | Works if customer connects to Food Court Guest Wi-Fi (routed to local server IP/mDNS). Fails if customer relies on cellular data without internet. | Fails completely. |
| **Hardware Cost** | \$0 local server hardware. | Low (\$150–\$300 for a dedicated local mini-PC or running the server on the Cashier's main POS machine). | \$0 extra hardware. |
| **Commercial Feasibility** | Unacceptable for high-volume food courts where internet outages mean lost revenue. | **Industry Standard.** Used by Tier-1 commercial food court and restaurant POS platforms worldwide. | Fragile, error-prone, academic complexity with minimal real-world stability. |

### 5.2 Architectural Recommendation: Option B (Local Edge-First with Cloud Synchronization)
1. **Physical Food Court Runtime:**
   - The primary cashier terminal (or an in-stall compact mini-PC) acts as the **Local Food Court Node**, running PostgreSQL 17, Laravel 11/12, and Laravel Reverb on the local Wi-Fi router.
   - All Waiter Android tablets, Kitchen Display Android tablets, and Cashier terminals communicate over high-speed local LAN (Wi-Fi 6 / Ethernet).
   - Latency for kitchen ticket updates is < 20 ms.
2. **Cloud Synchronization:**
   - A background sync daemon synchronizes completed transactions, audit logs, and analytics up to the Cloud Owner Portal whenever internet connectivity is active.
   - The owner can monitor the food court remotely from anywhere in the world.
3. **Handling the QR Ordering Offline Limitation:**
   - If the main ISP internet connection goes down, cellular data users cannot load external websites.
   - *Documented Limitation & Solution:* The system displays a clear sign on tables: *"During internet outages, please connect to FoodCourt-WiFi to access the digital menu, or call your waiter."* When connected to local Wi-Fi, the QR code resolves to the local gateway IP.

---

## 6. Realtime Event Delivery: Reverb vs. Node.js

As justified in the Dependency Audit, **Laravel Reverb** is selected as the real-time event broker.
- Sub-millisecond WebSocket delivery on local LAN.
- Native integration with Laravel Private & Presence Channels:
  - `private-stall.{stall_id}.kitchen` (receives stall-specific child tickets only).
  - `private-table.{table_id}` (receives table status and bill updates).
  - `private-counter.billing` (receives parent orders and payment status).
  - `private-waiter.{waiter_id}` (receives food ready pickup alerts).
- Complete isolation between stalls: Kitchen staff at the Pizza stall never receive events or data belonging to the Burger or Chinese stalls.

