# Several PCs: one host, paired terminals (v1.1.0)

For a food court with more than one computer. **One** computer or server (the **host**) keeps the shared database;
every other computer (**terminal**: cashier, kitchen, waiter, manager) only runs the app and shows the host's data.
A single-PC food court needs none of this (`architecture-decision.md`).

Nobody types an address. A terminal joins with a **one-time connection code**.

## 1. Host (administrator, once)

Prerequisites and hardening are in `production-deployment.md` (PostgreSQL, web server, `APP_ENV=production`, OPcache, backups).
The host runs the Laravel API from `backend/`. In its `.env`:

```ini
APP_ENV=production
APP_DEBUG=false
FOODCOURT_PUBLIC_API_URL=https://foodcourt-host.lan/api   # the address terminals will use, ends in /api
FOODCOURT_REQUIRE_PAIRING=true                            # only paired computers may sign in
# FOODCOURT_EMBEDDED must stay unset/false on a host
```

```powershell
php artisan migrate --force                                  # never migrate:fresh on real data
php artisan foodcourt:create-owner owner@example.com "Owner Name"   # hidden password prompt; refuses if any account exists
php artisan foodcourt:pairing-code                           # prints the code for the FIRST terminal
```

* PostgreSQL listens on **localhost of the host only**. Terminals never connect to it.
* Without a trusted TLS certificate, use the host on a private network only (see §5).

## 2. First terminal

1. Install the app (`installers\1.1.0\Multi-Stall-Food-Court-Setup-1.1.0.exe`) and open it.
2. On the Welcome screen choose **Connect to an existing food court instead**.
3. Paste the `FCPAIR1.…` line printed on the host, press **Connect this computer**. Sign in with the owner account.

## 3. More terminals (owner, no administrator needed)

Owner → **Device Settings → Connected computers → Add a computer**. A code appears (valid 15 minutes, works **once**).
On the new PC choose *Connect to an existing food court*, paste it. The new computer appears in the list with its name
and last-seen time; **Disconnect** locks it out immediately.

| Message on the terminal | Meaning |
|---|---|
| "The connection code is wrong or has expired" | Ask the owner for a new code |
| "This computer cannot reach the food court host…" | Host switched off, wrong network, or firewall (§4) |
| "This computer is not connected to the food court" | The owner disconnected it, or pairing was switched on after it joined: pair again |
| "…not using a secure (https) connection" | The host address is public but plain `http`: enable https |

## 4. Network and firewall

| Item | Setting |
|---|---|
| Open on the host | **Only** the API port (443 for https, or the port you chose). Allow it to the food court LAN/VLAN only |
| Never open | PostgreSQL (5432), the PHP built-in server, Reverb unless used |
| Host address | Give the host a fixed LAN IP or a DNS name; put that in `FOODCOURT_PUBLIC_API_URL` **before** creating codes (the code embeds it) |
| `http://` | Accepted by the app only for `localhost`, private ranges (10.x, 172.16-31.x, 192.168.x) and single-label LAN names. A public name must be `https://` |
| Windows Firewall on the host | `New-NetFirewallRule -DisplayName "FoodCourt API" -Direction Inbound -Protocol TCP -LocalPort 443 -RemoteAddress LocalSubnet -Action Allow` |

## 5. TLS

Use `https://` wherever the network is not fully private. Passwords and sales data cross the network on every request.
A certificate must be valid for the name in `FOODCOURT_PUBLIC_API_URL`; an internal CA must be installed on every terminal.
The app refuses a terminal pairing to a **public** `http://` host.

## 6. What is shared, what is per-terminal

* Shared (on the host): orders, kitchen tickets, payments, stock, closings, staff, settings.
* Per terminal: receipt printer choice, window state, the device token (encrypted by Windows for that Windows user).
* Stall isolation and roles are enforced by the host on every request. A kitchen terminal only ever receives its own stall's tickets.
* **One active session per account.** Signing in on a second computer ends the first computer's session. Give each person their own account.
* The kitchen display refreshes every 4 s by polling (real-time sockets are optional and off in the desktop build).
* If the host or network goes down, terminals show "The food court system is not responding… Reconnecting automatically" and
  resume by themselves; nothing needs re-pairing. Orders cannot be saved while the host is unreachable.

## 7. Verified (and not)

`qa/multi-pc/multipc.e2e.mjs`: real API on PostgreSQL, started with pairing required, three paired terminals using the PC's
LAN address (not localhost): unpaired login refused · code works once · wrong code refused · order placed on the counter is seen by
both kitchen terminals, each only for its own stall · a kitchen cannot touch another stall's ticket · kitchen progress and a cash
payment made on different terminals are visible on a third · a disconnected terminal is locked out at once · host stopped and
restarted: terminals recover without re-pairing and earlier data is intact · readiness output contains no database details.

**Not verified:** two physical computers, a real firewall between them, https with a real certificate, realtime sockets.
Do this once on site with the checklist above.
