# Architecture decision: how the Windows app gets its server and database (v1.1.0)

Status: **decided and implemented in v1.1.0** (2026-11-03). Nothing has been committed or deployed.

## The question

A food court may run on **one PC**, or on **several** (owner PC, cashiers, kitchen screens, waiters). The client must
never type a server address, and every PC that belongs to the same food court must see **the same** data.

## What exists (kept)

| Layer | Choice | Why it stays |
|---|---|---|
| Backend | Laravel 11 API, Sanctum tokens, role + stall authorization | All business rules (stall isolation, payments, closing, audit) live here and are covered by 110 backend tests |
| Shared database | **PostgreSQL** | The existing production target. Not replaced |
| Single-PC database | **SQLite** inside the app's own data folder | Added in 1.0.2 so one PC needs no database server. The same migrations and code run on both (verified: full backend suite passes on PostgreSQL **and** SQLite) |
| Desktop shell | Electron, React renderer talking to the API | Unchanged |

## The decision: two clearly separated modes, no synchronisation

### Mode A: Single PC (default, zero configuration)

The app starts its own PHP + Laravel on `127.0.0.1` with its own SQLite file. Nobody sees an address, port or
database. Data lives in `%APPDATA%\FoodCourt Desktop\server\` and survives upgrades, reinstalls and uninstall.

### Mode B: Several PCs (one host, many terminals)

* **One host** runs the Laravel API on **PostgreSQL** (the existing server guide: `production-deployment.md`).
* Every other PC is a **terminal**: it contains no database and no server. It talks only to the host's API.
* A terminal is joined by **pairing**: the owner (or, for the very first PC, the administrator on the host) creates a
  one-time code; the terminal pastes it once. The code carries the host address, so nobody types or sees an address.
  The host records the terminal and gives it a device token; the owner can disconnect any terminal from Device Settings.
* PostgreSQL is never reachable by terminals: they only speak to the API.

### Why not make the single-PC app the host for the others?

| Option | Verdict | Reason |
|---|---|---|
| Embedded server listens on the LAN for other PCs | **Rejected** | The built-in server is PHP's single-process development server on SQLite: one request at a time, one writer. A counter, three kitchen screens and waiters would queue behind each other and time out at peak. It is also unencrypted and started per user session, not as a service |
| Each PC keeps its own database and they "sync" | **Rejected (explicitly forbidden)** | Divergent copies of orders and payments are a money-accounting risk. No merge strategy is safe |
| Replace PostgreSQL with another database | **Rejected** | No migration/compatibility case exists; PostgreSQL already works |
| **Central host on PostgreSQL + paired terminals** | **Chosen** | One source of truth; unchanged business rules; PostgreSQL stays private; works with the existing API |

A food court that starts on one PC and later adds PCs moves to Mode B deliberately: install the host, then connect
terminals. Data entered in Mode A stays on that PC's own database and is **not** merged into the host (no automatic
migration is attempted; a one-off import would need its own design and sign-off).

## Mode selection (what the app does on launch)

1. Single-instance lock (a second launch just focuses the running window).
2. If this PC was paired with a host (or an IT-preconfigured address exists) → **terminal**: check that the host answers,
   otherwise tell the user in plain words ("Cannot reach the food court…", Try again).
3. Otherwise → **single PC**: start the built-in server (below), then open the login screen or the first-run Welcome screen.

## Startup lifecycle (single PC)

`electron/embedded-server.cjs`. Every step reports a plain-language status to the startup screen.

| Step | What happens | If it fails |
|---|---|---|
| Prepare | Data folders, app key, safety copy of the database before the first start of a new version | "data folder could not be used" |
| Reclaim | A PHP left behind by a crashed run is stopped **only** if it is this app's own server for this data folder (checked by its command line); anything else is left alone | – |
| Migrate | `migrate --force` (additive; existing data is never reset) | "database could not be opened" (unreadable file) or "could not be brought up to date" |
| Start | PHP on a free loopback port; if the port is taken, the next free one (3 attempts) | "services did not start in time" |
| Ready check | `/up` (PHP alive) **and** `/api/system/ready` (database reachable, migrations current) | "started but not healthy" |
| Owner state | `/api/system/ready` reports `needed` / `complete` / `recovery_required` | Welcome / login / recovery screen |
| Watch | Every 10 s; three misses → the server is restarted (same address); more than 5 restarts a minute → stop and say so | "Service unavailable. Contact your administrator." |
| Quit | Only the app's own PHP is stopped; no unrelated process is touched | – |

Raw errors go to the support log only (`logs\desktop.log`, one JSON object per line, never passwords or tokens).

## Owner provisioning

* **Single PC:** the Welcome screen creates the owner once (`POST /api/setup/owner`, embedded server only). A signed marker
  (`settings.system_setup`) records completion, so the screen can **never** come back, even if every account is later
  deleted. The owner receives a **one-time recovery key** (hashed with the Laravel hasher; only the hash is stored).
* **Forgotten password / deleted owner:** the recovery key resets the owner password (or restores the owner) and issues a
  new key (`/api/setup/recover`, 5 tries per minute). Existing 1.0.2 installs have no key yet: the owner creates one in
  Device Settings.
* **Shared host:** `php artisan foodcourt:create-owner <email> "<name>"` (hidden password prompt; refuses if any account exists).
* No default password and no demo account exists in any installer. The seeder refuses to run in production.

## Security boundaries (verified by `SMOKE_RESULT` on the packaged app)

`contextIsolation` on · `nodeIntegration` off · `sandbox` on · DevTools cannot be opened in an installed app · strict
Content-Security-Policy · renderer has no `require`/`process` · the preload exposes 14 named functions and **none** can
set or read a server address · every IPC call is checked to come from the app's own page · the device token is stored
encrypted by Windows (`safeStorage`) and added to host requests in the main process, so the renderer never sees it · the
restore and folder-choose actions use native dialogs and validated names, never a path from the renderer.

## Known limits (honest list)

1. Terminals and the host were tested **on one physical PC** (separate processes, LAN address). Two real machines and a real
   firewall were not.
2. One active session per account (existing behaviour: a new sign-in revokes the older token). Two counters must use two
   cashier accounts.
3. The pairing token protects *which computers* may sign in; it does not replace user logins, and the Android / QR customer
   apps do not carry one (customer QR ordering stays open by design). Turning `FOODCOURT_REQUIRE_PAIRING` on blocks the
   frozen Android app.
4. Single-PC mode uses PHP's built-in web server: fine for one counter, not for several PCs (hence Mode B).
5. Installer and bundled `php.exe` are **not code-signed**: Windows SmartScreen / Smart App Control can warn or block.
