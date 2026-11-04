# Indian demo dataset: test login credentials

**Demo / test databases only.** These accounts exist only after `php artisan foodcourt:seed-indian-demo` has been run against a database whose name contains `demo` or `test` (for example `foodcourt_demo_db`). They are fictional, the email domain is the reserved `example.test`, and the passwords are shared demo values; never use them or this pattern on a real installation. The seeder refuses to run when `APP_ENV=production`.

Passwords are stored as bcrypt hashes (never plain text) and are not printed by any seeder or command.

| Role | Count | Email pattern | Password |
|---|---:|---|---|
| Owner (also acts as the administrator; the app has no separate admin role) | 1 | `owner@demo.example.test` | `DemoOwner#2026` |
| Cashier | 8 | `cashier01@demo.example.test` … `cashier08@demo.example.test` | `DemoStaff#2026` |
| Waiter | 12 | `waiter01@demo.example.test` … `waiter12@demo.example.test` | `DemoStaff#2026` |
| Stall manager (one per stall) | 50 | `manager.dm001@demo.example.test` … `manager.dm050@demo.example.test` | `DemoStaff#2026` |
| Kitchen staff (stalls DM-001..DM-025 have two) | 75 | `kitchen.dm001a@demo.example.test` (and `…b` for DM-001..DM-025) … `kitchen.dm050a@demo.example.test` | `DemoStaff#2026` |
| Store staff (stalls DM-001..DM-004) | 4 | `store.dm001@demo.example.test` … `store.dm004@demo.example.test` | `DemoStaff#2026` |

Examples: stall DM-014 is "Hyderabad Dum Biryani": `manager.dm014@demo.example.test` / `kitchen.dm014a@demo.example.test`. Stall DM-035 is "Pune Misal House".

Every stall-bound account (manager, kitchen, store) can only read and change its own stall's inventory, purchases, suppliers, stock movements and kitchen tickets; this is the application's existing rule and is covered by `tests/Feature/IndianDemoDatasetTest.php`.

Customers (1,000) use phone numbers in the unallocated `+915…` range and `…@example.test` emails; they are directory records, not login accounts.
