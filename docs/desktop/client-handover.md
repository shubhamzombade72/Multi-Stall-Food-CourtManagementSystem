# Client handover: installing the Food Court app (v1.1.0)

For the person setting up the Windows app at the food court. No technical knowledge needed.

The app is **complete on one computer**: it has its own database inside it. You do not need a server, an internet
address, or a database password. If the food court has **several computers**, read "More than one computer" below.

## Install

1. Run `Multi-Stall-Food-Court-Setup-1.1.0.exe`. Windows may show *"Windows protected your PC"* because the installer is
   not yet code-signed: choose **More info → Run anyway**. (If Windows says the app is *blocked* with no such option,
   see "If Windows blocks it" below.)
2. Keep the default folder (or choose one) and finish. A shortcut **Multi-Stall Food Court** appears on the desktop.
3. **Already have 1.0.0, 1.0.1 or 1.0.2?** Install 1.1.0 over it. Your data is kept, and a copy is made automatically
   before the new version first opens it. Do not uninstall first.

## First time you open it

1. Open **Multi-Stall Food Court**. You see *Starting application… Preparing database… Connecting to food court services…* for a few
   seconds, then **Welcome**.
2. Enter **your name, your email, and a password** (at least 8 characters, with letters and numbers), twice. Press **Create account and start**.
3. **Write down the recovery key** that is shown (print it or copy it somewhere safe, away from the counter). It is shown **only once**
   and is the only way back in if the password is forgotten. Tick the box and press Continue.
4. You are signed in as the owner. Next: add your stalls, menu, staff and tables from the owner menu.

Moving from another computer? On the Welcome screen choose **Restore from a backup (moving from another computer)** instead of creating an owner.

## Every day

Open the app and sign in with the owner email and password (staff use the accounts the owner creates for them). Capital letters in
the email do not matter. Close the app when finished; opening it again continues with all your data.

## Forgot the password

On the sign-in screen press **Forgot password?**, enter the owner email, the recovery key and a new password. You are given a **new**
recovery key: save it. No recovery key? Contact support.

## Your data and backups

- Everything is stored **on this computer**, in `%APPDATA%\FoodCourt Desktop\server\` (type that into the Windows Explorer address bar).
- **Backups are automatic** (daily, while the app is open) and **checked** after they are made. The owner can back up at any time and choose a
  USB drive or cloud folder: **Device Settings → Backup & recovery**. If a backup fails, the owner sees an amber warning in the app.
- The owner can restore a backup from the same place. Details: `backup-and-recovery.md`.
- Uninstalling **does not** delete your data.

## More than one computer

Several computers can share the same orders only through **one main computer (the host)** that your supplier sets up. The other computers join it with a
one-time code (owner: **Device Settings → Connected computers → Add a computer**; on the new computer choose **Connect to an existing food court**).
Do **not** install the app on a second computer and expect it to see the first computer's orders: each computer on its own has its own separate data.
Details: `multi-pc-deployment.md`.

## If something goes wrong

| You see | Do this |
|---|---|
| *Service unavailable. Contact your administrator.* | Press **Try again**. If it stays, restart the computer. Then **Copy support information** and send it to support. Your data has not been changed |
| *Invalid email or password.* | Retype carefully (caps lock?). Forgot it? **Forgot password?** |
| *Too many sign-in attempts* | Wait one minute |
| *The food court services are not responding* | Close the app completely and open it again |
| *Cannot reach the food court* (shared setups) | The main computer is off or you are not on the food court network |
| An amber backup warning | Owner: open **Device Settings → Backup & recovery** and press **Back up now** |
| Windows blocks the installer / app | See below |

**If Windows blocks it:** Windows "Smart App Control" (Settings → Privacy & security → Windows Security → App & browser
control) blocks unsigned programs. Your IT person can allow the app, or the supplier can provide a code-signed installer.
Do not turn security features off without advice.

Support: the owner opens **Device Settings → Support information → Copy support information**. The log file is
`%APPDATA%\FoodCourt Desktop\logs\desktop.log` (no passwords). Why someone cannot sign in: `login-failure-root-cause.md`.

## For the installer (technician)

- Verify the installer's SHA-256 against `release-notes-1.1.0.md` before handing it over.
- Silent install: `Multi-Stall-Food-Court-Setup-1.1.0.exe /S`. No admin rights needed. The Visual C++ runtime is bundled.
- Do not hand out staging/demo accounts or the old credentials PDF: none of those accounts exist in an installer. The first owner is created by the client.
- Run `release/reports/v1.1.0-clean-install-test-report.md` §"Checklist for the technician" on the client PC; it has not been run on a clean PC yet.
