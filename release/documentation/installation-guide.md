# Multi-Stall Food Court Management System - Installation Guide

## 1. System Requirements

- **Operating System:** Windows 10 (64-bit) or Windows 11 (64-bit)
- **Processor:** Intel Core i3 / AMD Ryzen 3 or higher
- **RAM:** 4 GB minimum (8 GB recommended)
- **Disk Space:** 500 MB free space
- **Network:** Connected to Food Court Local Area Network (Wi-Fi or Ethernet)

---

## 2. Standard Installation

1. Copy or download `Multi-Stall-Food-Court-Setup-x64.exe` to your computer.
2. Double-click the installer `Multi-Stall-Food-Court-Setup-x64.exe`.
3. If Windows SmartScreen displays *"Windows protected your PC"*, click **More info** followed by **Run anyway** (as the internal release package is not signed with a public commercial CA).
4. Follow the setup wizard instructions:
   - Choose whether to install for the current user or specify an install path.
   - Choose whether to create a Desktop Shortcut and Start Menu entry.
5. Click **Install**.
6. Once completed, check **Launch Multi-Stall Food Court Management System** and click **Finish**.

---

## 3. Silent Installation (IT / Unattended Deployment)

For automated or remote multi-terminal deployments across multiple POS counters:

```cmd
Multi-Stall-Food-Court-Setup-x64.exe /S
```

The application installs silently into:
`%LOCALAPPDATA%\Programs\Multi-Stall Food Court Management System\`

---

## 4. Uninstallation

To remove the software:
1. Open Windows **Settings** > **Apps** > **Installed apps**.
2. Locate **Multi-Stall Food Court Management System**.
3. Click **Uninstall** and confirm.
Alternatively, run the uninstaller directly:
`%LOCALAPPDATA%\Programs\Multi-Stall Food Court Management System\Uninstall Multi-Stall Food Court Management System.exe`

