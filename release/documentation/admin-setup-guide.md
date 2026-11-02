# Multi-Stall Food Court Management System - Administrator Setup Guide

## 1. Backend Server Deployment Requirements

The central backend manages data persistence, security, and multi-stall business rules.

### Server Requirements
- **OS:** Ubuntu 22.04 LTS / Debian 12 / Windows Server 2022
- **PHP:** PHP 8.3 or 8.4 CLI + FPM
  - Required PHP Extensions: `pdo_pgsql`, `pgsql`, `bcmath`, `curl`, `mbstring`, `tokenizer`, `xml`, `zip`, `ctype`, `intl`
- **Database:** PostgreSQL 17
- **Web Server:** Nginx or Apache
- **Process Manager:** Supervisor (for Laravel queue workers and Reverb daemon)

---

## 2. Server Installation & Configuration

### A. Clone & Dependencies
```bash
git clone <repository_url> foodcourt-backend
cd foodcourt-backend/backend
composer install --no-dev --optimize-autoloader
```

### B. Environment Configuration (.env)
Copy `.env.example` to `.env`:
```ini
APP_NAME="Multi-Stall Food Court"
APP_ENV=production
APP_DEBUG=false
APP_URL=https://foodcourt.local

DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=foodcourt_db
DB_USERNAME=foodcourt_user
DB_PASSWORD=<SECURE_STRONG_PASSWORD>

# Realtime WebSocket server
REVERB_APP_ID=862158
REVERB_APP_KEY=<RANDOM_KEY>
REVERB_APP_SECRET=<RANDOM_SECRET>
REVERB_HOST="0.0.0.0"
REVERB_PORT=8080
REVERB_SCHEME=http
```

### C. Database Migration & Key Generation
```bash
php artisan key:generate
php artisan migrate --force
```

---

## 3. Initial Owner Account Provisioning

To seed the initial administrative account without exposing default passwords in version control:

```bash
php artisan tinker
```
Execute in Tinker:
```php
$user = App\Models\User::create([
    'name' => 'Food Court Owner',
    'email' => 'owner@foodcourt.local',
    'password' => Hash::make('YourTemporaryStrongPassword123!'),
    'role' => 'owner',
    'is_active' => true,
]);
```

> **IMPORTANT:** On first login, immediately navigate to **Staff & Permissions** or **My Profile** and update your password.

---

## 4. Connecting Desktop Terminals to Backend

1. Launch **Multi-Stall Food Court Management System** on the POS terminal.
2. If the terminal is not connected or shows a connection banner, click **Server Settings** on the login screen (or navigate to `/connection`).
3. Enter the central API endpoint (e.g. `http://192.168.1.100:8000/api` or `https://foodcourt.lan/api`).
4. Click **Test & Save**.
5. Once a green checkmark appears confirming the server `/up` health check passed, return to the Login screen.

