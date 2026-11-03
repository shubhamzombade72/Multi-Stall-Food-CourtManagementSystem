# Client handover: installing the Food Court app (v1.0.2)

For the person setting up the Windows app at the food court. No technical knowledge needed.

The app is **complete on one computer**: it has its own database inside it. You do not need a server, an internet
address, or a database password.

## Install

1. Run `Multi-Stall-Food-Court-Setup-1.0.2.exe`. Windows may show *"Windows protected your PC"* because the installer is
   not yet code-signed: choose **More info → Run anyway**. (If Windows says the app is *blocked* with no such option,
   see "If Windows blocks it" below.)
2. Keep the default folder (or choose one) and finish. A shortcut **Multi-Stall Food Court** appears on the desktop.
3. If an older version (1.0.0 or 1.0.1) is installed, this installs over it. Old versions could not sign in on this PC.

## First time you open it

1. Open **Multi-Stall Food Court**. After a few seconds a **Welcome** screen appears.
2. Enter **your name, your email, and a password** (at least 8 characters, with letters and numbers), twice.
3. Press **Create account and start**. You are signed in as the owner and see the dashboard.
4. Next: add your stalls, menu, staff and tables from the owner menu.

**Write the password down somewhere safe.** There is no "forgot password" button yet.

## Every day

Open the app and sign in with the owner email and password (staff use the accounts the owner creates for them).
Close the app when finished; opening it again continues with all your data.

## Your data and backups

- Everything is stored **on this computer only**, in `%APPDATA%\FoodCourt Desktop\server\` (type that into the Windows
  Explorer address bar). The file `foodcourt.sqlite` is your database.
- **Backup:** close the app, copy `foodcourt.sqlite` to a USB drive or cloud folder. Do this regularly (daily is best).
- The program also saves a copy automatically before each upgrade (folder `backups`).
- Other computers do **not** see this computer's orders. Use one computer for everything, or ask your supplier about a
  shared server if you need several.

## If something goes wrong

| You see | Do this |
|---|---|
| "The Food Court system could not start" | Press **Try again**. If it stays, restart the computer. If antivirus asks, allow the app. Then contact support |
| "Invalid email or password." | Retype carefully (caps lock?) |
| "Too many sign-in attempts" | Wait one minute |
| "The program's built-in server is not responding" | Close the app completely and open it again |
| Windows blocks the installer / app | See below |

**If Windows blocks it:** Windows "Smart App Control" (Settings → Privacy & security → Windows Security → App & browser
control) blocks unsigned programs. Your IT person can allow the app, or the supplier can provide a code-signed installer.
Do not turn security features off without advice.

Support: send the file `%APPDATA%\FoodCourt Desktop\logs\desktop.log` (contains no passwords).

## For the installer (technician)

- Verify the installer's SHA-256 against `release-notes-1.0.2.md` before handing it over.
- Silent install: `Multi-Stall-Food-Court-Setup-1.0.2.exe /S`.
- Do not hand out staging/demo accounts; none are included. The first owner account is created by the client.
- The program needs no admin rights and no extra software (the Visual C++ runtime it uses is bundled).
