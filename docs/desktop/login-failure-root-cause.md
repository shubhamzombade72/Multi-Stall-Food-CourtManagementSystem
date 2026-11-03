# Root-cause analysis: client cannot sign in (v1.0.2)

Prepared 2026-11-03. **Read the "What is proven and what is not" section first.**

## What is proven and what is not

I do **not** have the client's PC, database or logs. Everything below was reproduced on the development PC using the
**delivered 1.0.2 build itself** (`installers/1.0.2/win-unpacked/resources/server`), not a guess about it.

| Statement | Status |
|---|---|
| The client's built-in server was running ("Online", `/up` OK) and answering the login request | Given by the screenshot; consistent with the code |
| A login that reaches an **empty or different** account set returns the same text as a wrong password | **Reproduced** |
| In 1.0.2 an email typed with different capital letters than at setup is rejected as "invalid credentials" | **Reproduced on the delivered build** (below) |
| 1.0.2 has no way back in after a forgotten owner password | **Confirmed in code and release notes (known issue 3)** |
| Which of these hit the client | **Unknown until their database is read** (procedure at the end) |

## Reproduced defects, in order of likelihood

### 1. Sign-in was case-sensitive (reproduced)

`AuthController::login` looked the account up with `WHERE email = ?`, an exact match. Windows keyboards, phones and
password managers capitalise the first letter of an email. The owner who set up as `Shop.Owner@Gmail.com` and later
typed `shop.owner@gmail.com` (or the reverse) got **"Invalid email or password."** with a *correct* password.

Evidence on the delivered 1.0.2 build (`qa/desktop/lifecycle.e2e.mjs`, test "support diagnosis"):

```
POST /setup/owner   Shop.Owner@Gmail.com            -> 201
POST /auth/login    shop.owner@gmail.com + right pw -> 422  "The provided credentials do not match our records."
POST /auth/login    Shop.Owner@Gmail.com + right pw -> 200
```

The audit trail even mislabels it: the attempt is recorded as `unknown_email`, and the same 422 text is used for
"no such account", "wrong password" and "wrong capitals", so neither the client nor support could tell them apart.

**Fix (1.1.0):** lookup is case-insensitive and trims spaces (`lower(email) = ?`); new emails are stored lower-case;
staff-email uniqueness is checked case-insensitively; older rows with capitals still sign in (no data rewrite).
Wrong password and unknown email deliberately stay **indistinguishable** (no account probing).

### 2. A sign-in with nothing to sign in to gave the wrong message (reproduced)

On a fresh install (no accounts) any login returned *"The provided credentials do not match our records."*, e.g. a client
typing the demo credentials from the old credentials PDF (`owner@foodcourt.com` / `password123`; **no such account exists in an
installer**). The right message is "this Food Court has not been set up yet".

**Fix:** the server answers `422` with `code: setup_required` (fresh) or `owner_missing` (all accounts deleted); the app moves
to the Welcome / recovery screen. The text never contains SQL, paths or credentials.

### 3. No recovery after a forgotten password (confirmed)

1.0.2 had no reset path. A forgotten owner password is indistinguishable, to the client, from a login bug, and is permanent.

**Fix:** one-time recovery key at setup (+ "Forgot password?" on the sign-in screen); owners of existing installs can create
one from Device Settings; support can read the account state without opening the database (below).

### 4. Stale 1.0.0 / 1.0.1 settings can override the built-in server (code path, not reproduced on the client)

A saved shared-server address in `config.json` (from 1.0.0/1.0.1) took precedence over the built-in server. The client's
screenshot shows the built-in address, so this probably did not apply, but it was a trap.
**Fix:** addresses can no longer be typed anywhere in the app; a PC uses a shared host only through pairing or an IT-preconfigured installer.

## Things I checked that were **not** the cause

| Hypothesis | Result |
|---|---|
| API unreachable | No: the screenshot shows Online; `/up` and `/api/system/ready` answer |
| Database not migrated | No: migrations run before the server starts; a failed migration now stops start-up with a clear screen |
| Password hashing / guard | Correct: Laravel `hashed` cast + `Hash::check`; Sanctum guard; token creation works (tested with a rolled-back token) |
| Token expiry | Tokens do not expire; a revoked/deleted token returns 401 and the app returns to sign-in with a notice (tested) |
| Rate limit | 5 attempts/min per email+IP, then 429 "Too many sign-in attempts". Not a root cause, but it makes retrying worse; unchanged |
| **A new bug I introduced** | Yes, and fixed: stacked `throttle:N,M` middleware share one counter, so polling `/setup/status` would have locked out recovery. Every new route has its own named limiter; regression test `test_polling_setup_status_and_signing_up_never_lock_out_recovery` |

## Scenario results (HTTP, real bundled server, sanitised)

| Scenario | Result |
|---|---|
| Correct credentials | 200 + token |
| Same account, different capitals | 200 (was 422) |
| Incorrect password | 422 "Invalid email or password." |
| Unknown email | 422, identical text and shape to the wrong password |
| Missing owner account (fresh) | 422 `setup_required` → Welcome screen |
| All accounts deleted after setup | 422 `owner_missing` → recovery screen; first-run setup **not** offered again |
| Expired / revoked token | 401 → "Your session has expired" |
| Backend unavailable | "Cannot reach the food court services…" (no address shown) |
| Database unavailable (damaged file) | "Service unavailable. Contact your administrator." Data file left byte-identical |
| Application restart | Owner still signs in; no second setup |

## How to find out what happened on the client's PC (read-only, nothing changes)

On the client's PC, with the app **closed**, from a Command Prompt (the path is the install folder of
`Multi-Stall Food Court Management System.exe`):

```bat
set FOODCOURT_DIAG_PASSWORD=<the password the client says they use>
"Multi-Stall Food Court Management System.exe" --diagnose-login=<the email the client types> --check-password > out.txt
type out.txt
```

(Needs 1.1.0. Installing 1.1.0 over 1.0.2 does not touch the data; the diagnosis itself never migrates or writes anything. Run it before opening the app normally if you want to see the 1.0.2 state untouched.) The output is one
JSON object, no secrets, e.g. for the reproduced case:

```json
{"account_found":true,"role":"owner","is_active":true,"email_differs_only_by_case_from_stored":true,
 "failed_attempts_by_reason":{"unknown_email":1},"password_matches":true,"token_can_be_created":true}
```

| Field | Meaning |
|---|---|
| `accounts_in_system: 0` | Nobody ever created an account → the client was never at the Welcome screen / used the wrong profile |
| `account_found: false`, accounts > 0 | The email is not the one used at setup; `failed_attempts_by_reason` shows how often |
| `email_differs_only_by_case_from_stored: true` | **Defect 1** |
| `password_matches: false` | Wrong password → use the recovery key / support reset |
| `is_active: false` | Account deactivated by the owner |
| `token_can_be_created: false` | Database problem, escalate |
