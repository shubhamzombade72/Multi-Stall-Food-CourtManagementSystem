# Indian demo dataset: report

Date: 2026-11-04 · Database: PostgreSQL `foodcourt_demo_db` (isolated, created for this task) · Nothing committed or pushed.

## Verdict

**INDIAN DEMO DATASET CREATED AND VERIFIED**

All required counts were created in the isolated demo database through the application's own tables, the desktop app was opened against it and every listed screen was checked, 41 read-only integrity checks pass, the seeders are idempotent, the real development database was not touched, and the existing test suites pass. Schema gaps are listed in [Schema limitations](#schema-limitations); none of them blocked the task.

## 1. Record counts (exact, from the database)

Run `php artisan foodcourt:seed-indian-demo --counts` (or `--verify`) to reproduce.

| Entity | Required | Created | Notes |
|---|---:|---:|---|
| Food court | 1 | **1** | The schema has no food-court table; it is the `business_profile` setting ("Urban Food Court (Demo)") |
| Stalls | 50 | **50** | `DM-001` … `DM-050`, one per cuisine, all active |
| Tables | 500 | **500** | `T-001` … `T-500` |
| Menu categories | 50-80 | **75** | 25 stalls have 1 category, 25 have 2 (categories belong to a stall, so at least 50 are unavoidable) |
| Dishes / menu items | 1,500 | **1,500** | exactly 30 per stall |
| Suppliers | 100 | **100** | 2 per stall (a supplier belongs to one stall in this schema) |
| Customers | 1,000 | **1,000** | 14 cities |
| Staff users | 150 | **150** | see [credentials](indian-demo-credentials.md) |
| Orders | 2,000 | **2,000** | |
| Order items | derived | **6,933** | avg 3.5 per order |
| Kitchen tickets | derived | **2,808** | one per stall per order; 641 multi-stall orders |
| Payments | derived | **1,820** | one per paid order, equal to the bill total |
| Purchase orders | 200 | **200** | 787 line items |
| Inventory items | stall-based | **600** | 12 per stall |
| Stock ledger rows | derived | **4,208** | 600 opening + 550 purchase inward + 2,676 consumption + 382 waste |

Distributions: orders 1,820 completed (paid) · 126 cancelled · 19 partially ready · 12 ready · 12 served (awaiting payment) · 11 confirmed; 1,149 dine-in / 851 takeaway; channels cashier POS 1,087, waiter app 699, QR 214; payments cash 600, UPI 818, card 402; order dates 2026-09-05 … 2026-11-04. Tables: 441 available, 30 occupied (exactly the 30 live dine-in orders), 29 reserved; capacities 100×2, 225×4, 125×6, 50×8 seats; 8 sections. Dishes: 1,240 veg, 205 non-veg, 55 egg; 75 sold out; prices ₹15-₹1,090 (average ₹132; only family/feast/platter packs exceed ₹800). Purchase orders: 140 received, 30 ordered, 20 draft, 10 cancelled; 58 inventory items sit at or below their alert level.

## 2. Files

New (all under `backend/` unless noted):

| File | Purpose |
|---|---|
| `database/seeders/Demo/IndianDemoSeeder.php` | Orchestrator (not called from `DatabaseSeeder`); `counts()` |
| `database/seeders/Demo/DemoGuard.php` | Safety gate used by every seeder |
| `database/seeders/Demo/DemoSeederBase.php` | Guard + one transaction + created-count per seeder |
| `database/seeders/Demo/{FoodCourt,Stall,Table,MenuCategory,MenuItem,Supplier,Customer,Staff,Inventory,PurchaseOrder,Order}Seeder.php` | The eleven requested seeders |
| `database/seeders/Demo/Data/DemoCatalog.php`, `DishPools.php` | Stalls, names, cities, suppliers, ingredients, ~1,100 dish lines |
| `database/seeders/Demo/DemoIntegrity.php` | 41 read-only integrity checks (PostgreSQL SQL) |
| `app/Console/Commands/SeedIndianDemoCommand.php` | `foodcourt:seed-indian-demo [--counts] [--verify]` |
| `tests/Feature/IndianDemoDatasetTest.php` | 3 PHPUnit tests (guard, counts/idempotency/integrity, stall isolation) |
| `frontend-desktop/e2e/indian-demo-ui.e2e.mjs` | Electron UI verification + timings |
| `docs/engineering/indian-demo-credentials.md`, `indian-demo-perf-probe.php`, this report | Docs / probe |

No existing file was modified, no migration was added, no authorization rule was touched.

## 3. Execution

```bash
# one-off: create the isolated database and its schema (the default database is refused by the seeder)
cd backend
DB_DATABASE=foodcourt_demo_db php artisan migrate --force
DB_DATABASE=foodcourt_demo_db php artisan foodcourt:seed-indian-demo            # seed (idempotent)
DB_DATABASE=foodcourt_demo_db php artisan foodcourt:seed-indian-demo --verify   # 41 integrity checks
DB_DATABASE=foodcourt_demo_db php artisan foodcourt:seed-indian-demo --counts
# equivalent: php artisan db:seed --class="Database\Seeders\Demo\IndianDemoSeeder"

# UI check (demo DB only)
DB_DATABASE=foodcourt_demo_db php artisan serve --port=8099
cd ../frontend-desktop && npm run build && DEMO_API_URL=http://127.0.0.1:8099/api node e2e/indian-demo-ui.e2e.mjs
```

| Measurement | Value |
|---|---|
| Seeding, fresh database (second, clean run) | **17.5 s** total; the first run on a fresh database took 9.9 s (orders 7.9-15.6 s, everything else < 1 s) |
| Seeding, repeated | **0.6 s**, every seeder reports `+0 new` |
| Database size before seeding (after migrations) | 10,008,243 bytes (9.5 MB) |
| Database size after seeding | 18,568,883 bytes (17.7 MB), +8.6 MB |
| PHPUnit demo tests | 3 tests, 61 assertions, ~65-80 s (they seed twice inside rolled-back transactions) |

## 4. Design and safety

- **Isolated database.** The default `.env` database `foodcourt_db` is refused; the seeder only runs when the database name contains `demo` or `test`. `foodcourt_demo_db` was created for this and can be dropped and rebuilt at any time (it was rebuilt once during this work after a data fix).
- **Guard (`DemoGuard`)** runs before every seeder and before the command does anything: aborts if `APP_ENV=production`, aborts unless the connection's database name matches `demo|test`, verifies the connection, and prints driver and database name. Verified: default DB → *"Refusing to run: database 'foodcourt_db' … is not a demo/test database"*; `APP_ENV=production DB_DATABASE=foodcourt_demo_db` → *"Refusing to run: APP_ENV is production"* (also unit-tested).
- **Idempotent, non-destructive.** Natural keys: stall code `DM-nnn`, table number, category (stall, name), dish uuid derived from its SKU, supplier (stall, name), customer phone, staff email, `demo-order-NNNN`, `PO-yyyymmdd-Dnnnn`. Existing rows are skipped, never updated or deleted; nothing is truncated. Each seeder runs in one transaction. The purchase-order seeder refuses to continue on a partial set so the stock ledger can never be built twice.
- **Deterministic.** All content comes from fixed lists and per-key hashes (no `rand()`); a rebuilt database gets the same stalls, dishes, prices, order contents and statuses. Only timestamps are relative to the run time (orders span the 60 days before the run, live orders the last 3 hours).
- **No secrets in logs.** Passwords are bcrypt hashes; the two demo passwords appear only in `DemoSeederBase` and in the credentials document, never in command output.
- **Business rules preserved.** Prices come from the menu; GST comes from `TaxService::calculate()` (current setting, default 5% exclusive); `subtotal + tax = total`; a payment equals the bill total, cash records tendered and change; a paid bill is `completed`; a cancelled bill is unpaid with cancelled tickets and items; tickets split per stall; item, ticket and order statuses follow the same ladder as `FulfillmentService` (partly-prepared orders carry `partially_ready`, as the service derives it). Stock only changes through ledger rows (`previous_stock ± quantity = new_stock`, chain unbroken, `current_stock` = last row, never negative).

## 5. Verification evidence

### Integrity (`--verify`, 41 checks, all PASS on the demo database)

No duplicate stall codes / names / dish names inside a stall / SKUs / table numbers / customer phones; every dish's category belongs to its own stall; every stall has exactly 30 dishes, a manager, and prices within ₹15-₹800 (family packs ≤ ₹1,200); staff with stall roles have a stall; all demo passwords are bcrypt; order `subtotal + tax = total` and line items sum to the subtotal; every paid order has exactly one payment equal to its total; unpaid/cancelled orders have none; cash change is right; every order item has a ticket item for the right stall; no table has two live orders; occupied tables are exactly the live dine-in tables; timestamps are spread; ledger chain, stock = last row, no negative stock; received purchase orders have inward movements and others have none; PO totals equal their lines; PO supplier and items belong to the PO's stall.

### Exact counts and no duplicates
Counts above come from `--counts`. Re-running the seeder left every count unchanged and printed `+0 new` for all eleven seeders; `--verify` still passed (PHPUnit also asserts this).

### No production data modified
The default development database `foodcourt_db` was inspected before and after: 53 stalls, 1,015 menu items, 0 orders, 10 users, 10 tables and 0 `DM-` stalls, identical to before this task. It also has only 17 of the 23 migrations applied (no `customers` table), so it could not have received the dataset even without the guard. It was not migrated.

### No cross-stall data leakage (PHPUnit `test_stall_staff_cannot_see_or_change_another_stalls_data`)
As the manager or kitchen user of one stall, asking for another stall via `?stall_id=` on inventory, stock movements, purchases, suppliers and kitchen tickets returns only the own stall's rows. Direct access to another stall is refused: `GET/PUT /stalls/{id}` 403, `PUT /menu/{id}` 403, `POST /menu` 403, inventory adjust and stock-out 403, receiving another stall's purchase order 403, another stall's supplier 403, another stall's kitchen ticket status 403, `GET /orders` 403; the other stall's data was not changed. One observation, not a defect of the dataset: the **dish catalogue** (names, prices) is readable by every signed-in role (`GET /api/menu`), and public `GET /api/stalls` already serves every stall's menu, so the manager's Menu Catalog screen lists other stalls' dishes read-only; edits to them are refused.

### Existing automated tests
- `php artisan test` (backend): **228 passed, 0 failed** (8,631 assertions); 225 before this task's tests were added.
- `npm test` (frontend-desktop): **197 passed, 0 failed**; `npx tsc --noEmit -p .`: clean. (No frontend source was changed.)
- Desktop e2e `indian-demo-ui.e2e.mjs`: **14 PASS, 0 FAIL** (details below). The earlier `bulk-delete.e2e.mjs` was not re-run for this report.

### Screens checked in the real Electron app (against the demo DB)

Screenshots are in `qa/desktop/results/demo-dataset/` (raw results: `qa/desktop/results/demo-dataset-ui.json`).

| Screen | Result | Screenshot |
|---|---|---|
| Dashboard | revenue, 60 orders today, 54 in flight, 54 pending bills, table occupancy 30/500, low-stock alerts, staff by role, per-stall sales | `dashboard.png` |
| Stall Directory | 50 records, 12 cards per page, 5 pages; search "Biryani" → 1 stall | `stalls.png` |
| Floor & Tables | 500 tables with sections and statuses | `tables.png` |
| Menu Catalog | 1,500 dishes, 25 rows per page; search "Biryani" → 52 records in 46 ms | `menu.png`, `menu-search-biryani.png` |
| Cashier POS | all orderable dishes, search "Misal" and stall filter "Pune Misal House" work | `pos.png`, `pos-search-misal.png`, `pos-stall-pune-misal.png` |
| Orders & Table Tracking (order board) | live demo orders by status | `order-board.png` |
| Kitchen Display | per-stall board (Delhi Darbar Rasoi: a ready ticket, late flag) | `kitchen.png` |
| Orders & Receipts, Payment History, Reports, Customers, Staff | render with data | `orders.png`, `payments.png`, `reports.png`, `customers.png`, `staff.png` |
| Stall Inventory, Purchases & Suppliers | render with data; manager sees only own stall's stock | `inventory.png`, `purchases.png`, `manager-inventory.png`, `manager-menu.png` |

## 6. Performance (demo DB, in-process API probe + Electron timings)

API (`docs/engineering/indian-demo-perf-probe.php`, median of 5 runs, includes auth; raw: `qa/desktop/results/demo-dataset-api-perf.json`):

| Endpoint | Queries | DB time | Total | Payload |
|---|---:|---:|---:|---:|
| Stall listing (owner, 50 stalls with categories and dishes) | 6 | 4.6 ms | 160 ms | 620 KB |
| Menu listing (1,500 dishes) | 5 | 7.1 ms | 205 ms | 773 KB |
| Menu for POS (available only) | 6 | 18.1 ms | 245 ms | 735 KB |
| Menu, one stall | 5 | 2.5 ms | 22 ms | 16 KB |
| Table listing (500) | 3 | 5.6 ms | 180 ms | 112 KB |
| Order board (live orders) | 10 | 24.3 ms | 138 ms | 56 KB |
| Orders list (20 of 2,000) | 12 | 10.5 ms | 132 ms | 111 KB |
| Kitchen tickets (one stall) | 7 | 6.4 ms | 18 ms | 3 KB |
| Dashboard stats | 21 | 20.8 ms | 73 ms | 25 KB |
| Sales summary / stall sales / menu performance | 4 / 3 / 3 | 5-7 ms | 10 / 13 / 54 ms | 1 / 7 / 68 KB |
| Inventory (600 items) / purchases / suppliers / customers | 4 / 9 / 4 / 4 | 6-12 ms | 297 / 103 / 61 / 24 ms | 166 / 51 / 42 / 10 KB |

**N+1 queries: none.** No statement is repeated 10 or more times on any endpoint; query counts are constant (3-21) regardless of data size.

UI (Electron, time from navigation until the screen showed its data; DOM node count):

| Screen | Time | DOM nodes | Note |
|---|---:|---:|---|
| Menu Catalog | 2.9 s | 914 | paginated, good |
| Stall Directory | 1.4 s | 635 | paginated, good |
| Orders, Customers | 0.9 s / 0.8 s | 792 / 500 | paginated, good |
| Order board | 1.0 s | 3,326 | live orders only |
| Dashboard / Reports | 2.7 s / 0.7 s | 809 / 336 | |
| Floor & Tables | 2.3 s | **8,290** | all 500 tables rendered at once |
| Cashier POS | 3.8 s | **19,700** | all ~1,425 orderable dishes rendered at once; after typing "Misal" it drops to 1,708 nodes in 255 ms |
| Stall Inventory (owner) | 2.3 s | 7,965 | 630 rows, not paginated |
| Staff & Permissions | 1.8 s | 2,785 | 150 rows |

### Findings (evidence only; no unrelated module was changed)
1. **POS renders every orderable dish at once** (19.7 k DOM nodes, 3.8 s to populate with 1,425 dishes). The screen has no pagination or virtualization today, so I left it alone. It works, and search/stall filters make it fast to use; a windowed grid or per-stall lazy rendering would be the fix if the catalogue grows.
2. **Floor & Tables (8.3 k nodes) and Stall Inventory (630 rows)** are also unpaginated; acceptable at this size.
3. The menu endpoints return the whole catalogue (770 KB) with no server-side pagination; the desktop pages paginate client-side.
4. The development database `foodcourt_db` is 6 migrations behind the code (no `customers` table). Not caused by this work and left untouched.

## 7. Schema limitations

No schema was changed. How each requested attribute was handled:

| Requested | Reality in this schema | What I did |
|---|---|---|
| Food Court entity | none (single-tenant app) | `business_profile` setting |
| Admin role | roles are owner, cashier, waiter, kitchen_staff, stall_manager, store_staff | the owner is the administrator; waiter (12) and store staff (4) added because the app uses them |
| Stall cuisine, owner, hours, location, email, UPI | stalls have only name, code, description, phone, is_active | written into the description (marker `[DEMO DATA]`); UPI values are clearly dummy (`demo.dm001@testbank`) |
| Dish SKU, food type, tax configuration | no such columns; GST is global (Food Court Settings) | SKU `DM001-D01` in the description; food type = menu category; no per-item tax (the app does not support it) |
| Egg classification | only `is_veg` | non-veg flag plus "Egg dish" in the description |
| Inventory linked to dishes | no recipe / ingredient table | ingredients chosen per stall by cuisine group; no dish-level linkage |
| Table status "Cleaning" | the API accepts available / occupied / reserved only | not used |
| Table zones per stall | tables are not tied to stalls | 8 sections for the whole court |
| Suppliers independent of stalls | `suppliers.stall_id` is required | 2 suppliers per stall |
| Menu categories 50-80 | categories belong to a stall (min 50) | 75 |
| Settlement / daily closing, audit log | produced by owner actions | not seeded; the owner can run Daily Closing from the UI against the seeded orders |

Other limits: the seeders use only portable query-builder calls but were run on PostgreSQL only; `DemoIntegrity` uses PostgreSQL SQL. Phone numbers use the unallocated `+915…` range and emails `@example.test`, so no real person or address is involved.

## 8. Re-running or removing

- Re-run any time: it only adds what is missing.
- To rebuild the demo database from scratch: drop `foodcourt_demo_db`, create it, run the three commands in section 3. Nothing in the application deletes demo data; the bulk-delete feature added earlier will refuse stalls and dishes that have orders.
