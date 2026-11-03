# Server configuration (Windows desktop app)

**Since v1.1.0 nobody configures a server address, and the app has no screen for it.** The old "Server connection" screen
(API address, Save & test, Test connection, health-check URL) was removed from the application.

| Your situation | What happens | Read |
|---|---|---|
| One PC | The app starts its own database by itself. Nothing to do | `README.md` §2 |
| Several PCs | One host keeps the data; other PCs join with a one-time connection code | `multi-pc-deployment.md` |
| Something is wrong | Plain-language message on screen; the owner can copy "support information" (Device Settings → Support information) | `login-failure-root-cause.md` |

## How a PC decides what to use (highest priority first)

| # | Source | Who sets it | Used for |
|---|---|---|---|
| 1 | The host this PC was **paired** with (`%APPDATA%\FoodCourt Desktop\config.json` + encrypted `pairing.json`) | Pairing code, once | Normal multi-PC use. Survives restarts and upgrades |
| 2 | `FOODCOURT_API_URL` environment variable | Developers / automated tests | Not for client installs |
| 3 | `electron/app-config.json` → `apiBaseUrl`, compiled into the installer | The release engineer, **before** `pnpm dist:win` | Pre-configuring installers for a known shared host (IT deployments); empty by default |
| 4 | **The built-in database on this PC** | Automatic | Normal single-PC use |

An installed app ignores `.env` changes; only #1 can change after installation (the owner: Device Settings → Support
information → *Disconnect from the food court* returns the PC to its own separate database).

## Pre-configuring an installer for a known shared host (optional, IT)

Only when the real host address is known and approved:

```powershell
# frontend-desktop/electron/app-config.json  ->  { "apiBaseUrl": "https://<host>/api" }   (https; no credentials; never loopback)
cd frontend-desktop ; pnpm test ; pnpm dist:win
```

Such a PC still shows the host-unreachable screen when the host is off. With `FOODCOURT_REQUIRE_PAIRING=true` on the host it must
also be paired.

## Sign-in messages (what staff see)

| Message | Cause |
|---|---|
| *Invalid email or password.* | Wrong password **or** no such email (deliberately not distinguished). Capital letters in the email do not matter |
| *This Food Court has not been set up yet…* | Fresh install: the app moves to the Welcome screen |
| *No accounts exist…* | All accounts were deleted: the app moves to the recovery screen |
| *Your account has been deactivated…* | The owner deactivated the user |
| *Too many sign-in attempts…* | 5 attempts per minute per email+device |
| *Your session has expired. Please sign in again.* | A saved login was revoked or replaced (a newer sign-in of the same account elsewhere) |
| *The food court services are not responding…* | Single PC: close and reopen. Terminal: host off or network down |
| *This computer is not connected to the food court…* | Terminal disconnected by the owner |

## Security notes

* Only the host address (paired PCs) is stored. No database credentials, `.env`, API keys or passwords are in the app or its config.
* The app keeps only the user's session token; the device token of a paired PC is encrypted by Windows.
* No demo or default accounts exist in any installer.
