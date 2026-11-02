# Master PRD: Feature-Gap Matrix (audit 2026-11-02, before master implementation)

Legend: **Done** works and verified · **Partial** exists with gaps · **Missing** not present · **Decision** blocked by an owner decision

| # | Module | State at audit | Gaps found | Plan |
|---|---|---|---|---|
| 1 | Owner dashboard | Done | Real data incl. pending bills, low stock, staff, activity (desktop-first) | Keep; add notifications feed |
| 2 | Food court management | Partial | No food court profile/settings store; tables can be created and status-changed only (no edit, no activate/deactivate, no desktop screen); sections are a free-text column with no list | `settings` table + Settings screen; table edit/activate, sections, Tables screen with live occupancy |
| 3 | Stall management | Done (partial for manager assignment) | Stall page does not show assigned managers | Show managers per stall |
| 4 | Staff management | Done | No login history, no per-user activity view | Login audit + staff activity report |
| 5 | Menu management | Done | — | Keep |
| 6 | Central POS | Partial | Customer name hard-coded "Walk-in Cashier Order"; no customer lookup; no order notes; no cancellation from desktop; no keyboard shortcuts; payment methods not configurable | Customer fields + lookup, notes, cancel with reason, shortcuts, methods from settings |
| 7 | Order management | Partial | Orders page loads only the first 20 orders and filters in the browser; no date/channel filter, no server search, no pagination, no cancel; cancellation has no reason, no row lock, no audit | Server-side search/filter/pagination; cancel with reason (locked, audited) |
| 8 | Kitchen display | Done | No ticket history by date | History view |
| 9 | Waiter (desktop) | **Missing** | Waiter role lands on Settings; no tables/order/ready/served screens on desktop | Waiter desktop: tables, new order, ready dishes, mark served |
| 10 | Customer management | **Missing** | No customer records (orders only store name/phone) | `customers` table (additive), CRUD, search, order history matched by phone, POS lookup |
| 11 | Supplier management | Partial | Create/list only; no edit, no deactivate, no search, no purchase history/report | Edit, status, search, supplier detail with purchase history |
| 12 | Purchase management | Done (no partial receipt) | Schema has no received-quantity per line, so partial receipt is not supported | Document; no schema change |
| 13 | Inventory | Done | — | Inventory valuation report |
| 14 | Payment management | Partial | No refund flow (policy undecided); payment methods fixed | Method enable/disable in settings; refunds = owner decision |
| 15 | Daily closing | Partial | No cashier-wise closing / cash verification | Cashier cash closing (expected vs counted, variance), history |
| 16 | Reports | Partial | Missing: sales summary by day, order report, payment summary, purchase report, inventory valuation, supplier report, staff activity, login history; audit log has no filters | New report endpoints + tabs, filters, CSV, print |
| 17 | Notifications | **Missing** | Nothing in the desktop shows events | Role-filtered notification feed (polling) + bell |
| 18 | Audit & security | Partial | Observers audit orders, payments, menu, stock, purchases, closings, staff. **Not audited:** logins (success/failure), denied requests (403), tables, suppliers, stalls, settings, customers, order cancellation reason | Add audit for all of these |
| 19 | System settings | **Missing** | Only API URL + printers (desktop-local) | Business profile, operating hours, receipt header/footer, payment methods; tax shown read-only (owner decision) |

Architecture risks noted: cancellation and payment could race (cancel did not lock the order row); the packaged Electron
app leaves Node inspector CLI flags enabled (fuses not flipped).

Owner decisions required (not implemented, documented in the final report): GST rate and inclusive/exclusive pricing,
commission, settlement formula, payment allocation, partial payments, refunds, late payments after closing,
recipe/BOM, ingredient depletion, wastage approval policy.
