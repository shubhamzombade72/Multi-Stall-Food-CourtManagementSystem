# Multi-Stall Food Court Management System - Client Installation & Deployment Guide

**Application:** Multi-Stall Food Court Management System (FoodCourt Desktop)  
**Version:** 1.1.0  
**Target Environment:** Windows 10 / Windows 11 (64-bit)  
**Distribution File:** `Multi-Stall-Food-Court-Setup-1.1.0.exe`  
**Checksum (SHA-256):** `E059AC2D614EA13C4733E86F34E9E0281A39C68113D68BF63D5CF510821ADA01`

---

## 1. System Requirements

### Minimum Hardware Requirements
- **Operating System:** Windows 10 (1809+) or Windows 11 (64-bit x64).
- **Processor:** Dual-Core 2.0 GHz (Intel Core i3 / AMD Ryzen 3 or higher).
- **Memory (RAM):** 4 GB RAM (8 GB recommended for Host PC with high volume).
- **Storage:** 1 GB free SSD disk space.
- **Display Resolution:** Minimum 1366 × 768 pixels (1920 × 1080 Full HD recommended). Supports touchscreens.
- **Network (Multi-PC):** Standard LAN connection (Gigabit Ethernet or 5GHz Wi-Fi).

### Supported Peripherals
- **Thermal Receipt Printers:** 80mm or 58mm ESC/POS thermal printers connected via USB, Ethernet, or Windows spooler.
- **Cash Drawers:** Standard 12V / 24V RJ11/RJ12 drawer connected directly to the receipt printer kick-out port.
- **Barcode / QR Scanners:** Standard USB HID plug-and-play scanners.

---

## 2. Installation Instructions

### Step 1: Run the Installer
1. Copy or download `Multi-Stall-Food-Court-Setup-1.1.0.exe` onto the target Windows PC.
2. Double-click the `.exe` installer.

### Step 2: Handle Windows SmartScreen Warning
Because this internal client release is packaged without a commercial EV code-signing certificate, Windows Defender SmartScreen may display:
> *"Windows protected your PC - Microsoft Defender SmartScreen prevented an unrecognized app from starting."*

1. Click **More info**.
2. Click the **Run anyway** button.

### Step 3: Complete Installation
- The NSIS installer installs the software into `%LOCALAPPDATA%\Programs\Multi-Stall-Food-Court`.
- A desktop shortcut titled **"Multi-Stall Food Court Management System"** with the golden **मंगलमूर्ती** icon is created.
- The application launches automatically upon completion.

---

## 3. Initial Configuration

The software supports two deployment roles:
- **Option A: Central Main Computer (Standalone / Host)**
- **Option B: Additional Kitchen / Waiter / Counter Terminals (Slave)**

---

### Option A: Main Counter / Central Computer (Standalone Server)

When launched on the main computer, the application automatically boots its embedded database and local server engine.

1. **First-Run Setup Wizard:**
   - On the initial launch, the system automatically opens the **First-Run Setup** screen.
   - Enter your **Business Name** (e.g. *मंगलमूर्ती Food Court*).
   - Enter your **Owner Admin Name**, **Email Address**, and choose a secure **Password**.
   - Click **Create Food Court**.

2. **Save Your Emergency Recovery Key:**
   - The screen will display a 32-character **Emergency Recovery Key**.
   - **Crucial:** Write down or print this key and store it safely in your office. It is used to reset credentials if the owner password is lost.

3. **Configure Initial Food Stalls:**
   - In the Setup Wizard or Dashboard, create your active stalls:
     - *Stall 1: Pizza & Italian*
     - *Stall 2: Burger & Snacks*
     - *Stall 3: South Indian / Dosa*
     - *Stall 4: Juice & Beverages*
   - Each stall receives its own independent menu, inventory, and Kitchen Display System (KDS).

---

### Option B: Additional Terminals (Kitchen Display / Waiter Station / Extra Cashier)

If you have additional PCs on the same Wi-Fi or LAN:

1. Install `Multi-Stall-Food-Court-Setup-1.1.0.exe` on the secondary computer.
2. Launch the application. On the login screen, click **Server Settings** (bottom right).
3. Select **"Connect to Food Court Host (Client Mode)"**.
4. Enter the **Host PC IP Address** (e.g., `192.168.1.50`) and the **Pairing Code** generated from the Host PC (found under *Owner Dashboard -> Settings -> Multi-PC Terminals*).
5. Click **Connect & Save**. The terminal is now linked to the main food court system in real time.

---

## 4. User Accounts & Staff Roles

The software implements strict Role-Based Access Control (RBAC):

| Role | Access Scope |
| :--- | :--- |
| **👑 Owner / Admin** | Complete access: revenue reports, business settings, menu pricing, stall creation, user accounts, audit logs, and backups. |
| **💳 Central Cashier** | Customer ordering, split stall billing, payment processing (Cash, UPI, Card), and receipt printing. Blocked from kitchen tickets and closing logs. |
| **🍕 Stall Manager / Kitchen** | Kitchen Display System (KDS) for their assigned stall only. Updates order status (`Cooking` -> `Ready` -> `Served`). Cannot view other stalls or modify customer bills. |
| **🧑‍🍳 Waiter Staff** | Table ordering, order status tracking, and dispatch notifications. |

### Development / Demo Testing Accounts (If demo mode active):
- **Owner:** `owner@foodcourt.com` | Password: `password123`
- **Cashier:** `cashier@foodcourt.com` | Password: `password123`
- **Pizza Stall Manager:** `manager.pizza@foodcourt.com` | Password: `password123`
- **Waiter:** `waiter1@foodcourt.com` | Password: `password123`

---

## 5. Daily Operations & Printing

### POS & Order Flow
1. Central cashier selects items across multiple stalls in one single customer ticket.
2. System calculates combined total, GST, and discounts.
3. Upon payment settlement, customer receipt prints at the counter, and separate KOTs (Kitchen Order Tickets) automatically appear on each respective stall's KDS screen.
4. As kitchen marks items `Ready`, the central Smart Order Tracking Board alerts staff.
5. Items can be marked `Served` individually or via `Serve All Remaining`.

### Thermal Receipt Printing
- Go to **Settings -> Hardware & Printing**.
- Select the connected printer from the printer list.
- Choose paper width: **80mm** (standard) or **58mm** (compact).
- Toggle **"Open Cash Drawer on Cash Sale"** to send the RJ11 kick pulse upon completing cash transactions.

---

## 6. Backup & Disaster Recovery

- **Automated Daily Backups:** The system creates automatic backups of the SQLite database once every 24 hours into:
  `%APPDATA%\com.foodcourt.desktop\backups`
- **Manual Backups:** Can be triggered at any time via **Owner Dashboard -> Settings -> Database Backup -> Backup Now**.
- **Restore:** To restore from a previous snapshot, select the backup file in the Settings menu and click **Restore**. The system creates a safety copy of the current state before applying the restore.

---

## 7. Troubleshooting & Support

- **Application Logs:** In case of any technical inquiry, logs are stored safely without passwords or tokens at:
  `%APPDATA%\com.foodcourt.desktop\logs\desktop.log`
- **Service Restart:** If the embedded server ever disconnects, close the application completely from the taskbar and restart it.

