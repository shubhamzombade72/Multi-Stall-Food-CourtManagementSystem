# Server configuration (Windows desktop app)

**Most installs never need this page.** Since v1.0.2 the app carries its own server and database and starts them
itself (`README.md` §2), so nobody enters an address. This page is only for the *optional* case where several PCs
must share one server that is hosted elsewhere.

> v1.0.0 (every installer delivered before 2026-11-03) defaulted to `http://127.0.0.1:8000/api`, i.e. "the API
> on this same PC", but contained no server, so it could never sign in. v1.0.1 removed that default but showed a
> "Server setup required" screen. v1.0.2 starts a built-in server, so there is nothing to set up.

## Where the address comes from (highest priority first)

| # | Source | Who sets it | Used for |
|---|---|---|---|
| 1 | **Server settings** in the app, stored in `%APPDATA%\FoodCourt Desktop\config.json` | The operator on each PC | Normal use. Survives restarts and upgrades |
| 2 | `FOODCOURT_API_URL` environment variable | Developers / automated tests | Not for client installs |
| 3 | `electron/app-config.json` → `apiBaseUrl`, compiled into the installer | The release engineer, **before** `pnpm dist:win` | Pre-configuring installers for a known shared server |
| 4 | **The built-in server on this PC** (default) | Automatic | Normal single-PC use |
| 5 | Nothing (only in a development run without the bundled server) | n/a | Server Setup screen |

Changing a `.env` file does **not** change an installed app. The installer contains a frozen copy of the code
and of `app-config.json`; only source 1 can change after installation. (The desktop app ignores
`VITE_API_BASE_URL`; that variable is for the browser build only.)

## Switching this PC to a shared server

1. *Settings* → **Server connection** → **Advanced: connect to a different server**. (To return: **Use the built-in server on this computer instead**.)
2. Type the address your administrator gave you, in the form `https://<server-name>/api`.
3. Press **Save & test**. The app saves the address, then checks it:

| Message | Meaning | What to do |
|---|---|---|
| *Food Court API found and responding.* | Connected | Continue to sign in |
| *The server name could not be found (DNS lookup failed)* | Typo in the name, or no internet/LAN DNS | Check spelling and the PC's network |
| *The server computer refused the connection* | Name resolves but nothing listens on that port | Server not running, wrong port, or firewall |
| *The server did not respond in time* | Offline or traffic dropped | Check the server and firewall |
| *The server's security certificate was rejected* | Expired, self-signed, or wrong name; or this PC's clock is wrong | Fix the certificate, or the PC date/time |
| *…not the Food Court API (404)* | A web server answered but not the API | Address must end in `/api` |
| *…internal error (HTTP 5xx)* | The API itself is failing | Check `storage/logs` on the server |
| *…redirected the request* | e.g. `http` → `https` | Use the final `https://` address |

4. Accepted format: `http(s)://host[:port]/…/api`, no user name/password, no `?query`, no `#fragment`. Anything else is rejected and not saved.
5. Warnings (the address is still saved): *points to THIS computer* for loopback addresses; *unencrypted http on a public host* for `http://` on a non-LAN name.

**Test connection** checks an address without saving it. The sidebar and the *Server connection* panel show live status (checked every 15 s); a red banner appears when the server cannot be reached.

## Sign-in errors

| Message on the sign-in screen | Cause |
|---|---|
| *Invalid email or password.* | Credentials rejected by the server (HTTP 422) |
| *Unauthorized…* | HTTP 401 on sign-in |
| *Your account has been deactivated…* | HTTP 403; ask the owner to reactivate the user |
| *Too many sign-in attempts…* | HTTP 429. The server allows 5 attempts per minute per email+IP |
| *Cannot reach the server…* / DNS / certificate / refused / timeout | Network problem; the specific reason is looked up and shown |
| *…not the Food Court API (404)* | Wrong address path |
| *…internal error (HTTP 5xx)* | Server fault |
| *Your session has expired. Please sign in again.* | A saved login was rejected by the server (expired or revoked token) |

## Pre-configuring an installer for a known production server

Only when the real production API URL is known and approved:

```powershell
# 1. Edit frontend-desktop/electron/app-config.json  ->  { "apiBaseUrl": "https://<real-production-host>/api" }
#    (https only; no credentials; never a loopback or staging address)
cd frontend-desktop
pnpm test          # fails if app-config.json holds a loopback or non-https address
pnpm dist:win      # installer in dist-electron-<version>/
```

Users can still override it in Server settings. Leave it empty to force the Server Setup screen.

## Security notes

- Only the API address is stored on the PC. No database credentials, `.env`, API keys or passwords are in the app or its config.
- The app signs in with the user's own email and password and keeps only the Sanctum token (browser storage of the app profile).
- Do not give clients staging or demo credentials (`password123` accounts exist only in seeded non-production databases).
