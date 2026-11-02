# Offline & Synchronisation Test Report

**Date:** 2026-11-02
**Environment:** Staging API (`foodcourt_staging_db`, 4 `artisan serve` workers on :8100–:8103), Reverb :8180
**Code under test:** `mobile-app/src/offline/syncEngine.ts`: the **same file** the Android app ships, executed by Node 24 against the live staging API
**Harness:** `qa/staging/staging-validation.mjs` (section "Offline queue & synchronisation") and `qa/staging/restart-recovery.mjs`
**Raw results:** `qa/staging/results/latest.json` (git-ignored; regenerate by running the harness)

## 1. What "offline" means in this system (exact capabilities)

| Capability | Status | Notes |
|---|---|---|
| Food court keeps trading when the **external internet** is down | **Supported by design** | All clients talk only to the on-premise edge server over the LAN. Nothing in the order → kitchen → billing path calls the internet. |
| Waiter app keeps taking orders when **the edge server is unreachable** (Wi-Fi dead spot, server restarting) | **Supported (verified)** | Orders are queued on the device and sent automatically every 20 s (per-order exponential backoff 1 s → 5 min), or immediately via *Sync Now*. |
| Waiter app catalog while unreachable | Supported | Tables / menu / stalls cached at login (`refreshCatalog`). Prices are re-computed by the server on sync; the cached price is display-only. |
| Kitchen KDS while the server is unreachable | **Not supported** | The KDS polls the server every 4 s. With no server there are no tickets to show. |
| Cashier desktop while the server is unreachable | **Not supported** | No offline mode on the desktop. The cashier PC must reach the edge server (often it *is* the edge server). |
| Customer QR ordering without internet | **Only on food court Wi-Fi** | The customer's phone must be on the food court Wi-Fi and the QR code must encode the **LAN address** of the edge server. A phone on mobile data alone cannot reach a LAN server. |
| Cloud synchronisation (edge ↔ cloud) | **Not implemented** | There is no cloud component and no sync daemon. Remote owner access is not available. Do not claim it. |
| Edge-server failover | **Not implemented** | A single edge server is a single point of failure. Mitigation: UPS, daily backup (`ops/backup`), documented restore. |

### Network requirements
- One edge server (Laravel API + PostgreSQL 17 + Reverb) on a fixed LAN IP, wired to the router.
- Staff Android devices and the cashier PC on the same LAN/Wi-Fi.
- The Android app's *Edge Server IP* setting set to `http://<edge-LAN-IP>:<port>/api`.
- The customer QR web app built with `VITE_API_BASE_URL=http://<edge-LAN-IP>:<port>/api`, with QR codes pointing at the edge server's LAN address on a guest Wi-Fi that can reach it.
- Internet is needed only for future cloud backup or remote access, not for trading.

## 2. Test results

| ID | Scenario (from Phase 3 brief) | How it was produced | Result | Evidence |
|---|---|---|---|---|
| OFF-1 | 1. Normal connection | Queue 1 multi-stall order, sync against live API | **PASS** | synced=1, 1 order, removed from queue |
| OFF-2 | 2. Wi-Fi disconnected / server unreachable | Sync to an address with no listener (connection refused, no HTTP response) | **PASS** | Order kept, `failed`, 0 orders on server |
| OFF-3 | (backoff) | Automatic sync again inside the backoff window | **PASS** | skipped=1, nothing sent |
| OFF-4 | 4. App closed and reopened with queued orders | A new store instance reads the persisted queue file (same as AsyncStorage after an app restart), then syncs | **PASS** | synced=1, exactly 1 order, 1 ticket |
| OFF-5 | 5. Network interrupted during submission | Request aborted before the server answered, then retried | **PASS** | failed → synced, exactly 1 order |
| OFF-6 | 6. Server processes order but response is lost | Real POST is committed, device throws "socket hang up", then retries | **PASS** | 1 order after loss, still 1 order + 2 tickets after retry (HTTP 200 replay) |
| OFF-7 | 7. Repeated synchronisation | 5 concurrent sync calls + 3 more sequential | **PASS** | 1 order, 1 ticket |
| OFF-8 | 8. Two devices submit separate orders simultaneously | Two waiters on different API workers at the same instant | **PASS** | both 201, each exactly once |
| OFF-9 | (retry storm) | Same idempotency key sent to 4 API workers simultaneously | **PASS** | statuses 200,200,200,201: 1 order, 1 ticket (unique-index race path) |
| OFF-10 | (business rejection) | Order with an invalid item | **PASS** | marked `rejected`, kept for review, not auto-retried |
| RST-1 | Backend restart with an order queued | API on :8100 stopped → order queued (`failed`) → API restarted → resume sync twice | **PASS** | 1st resume synced=1, 2nd nothing to send, DB count 1. The device token was still valid after the restart |
| PAY-DUP | No duplicate payments | Same bill paid from 4 counters simultaneously | **PASS** | statuses 200,422,422,422; 1 payment row |

**Duplicate checks (all scenarios):** no duplicate parent orders, no duplicate kitchen tickets, no duplicate payments, no lost queued orders.

## 3. Not tested (honest gaps)

| Scenario | Why not | What is needed |
|---|---|---|
| Physically turning Wi-Fi off on an Android device | No physical device attached. The emulator's network toggling was not exercised. Connection-refused and aborted-request cases exercise the same code path (`syncEngine` sees "no response"). | 30-minute hands-on test on the pilot devices before go-live (UAT-W-07). |
| "Internet down, LAN up" on real hardware | Needs the real router. The design has no internet dependency in the trading path (verified by code review: no external hosts are called). | Unplug the WAN cable during the pilot dry run (UAT-O-02). |
| Long offline periods (hours) with large queues | Not run. | Backoff caps at 5 min; consider a dry run with 50+ queued orders. |
| AsyncStorage corruption / device storage full | Not run. | Queue is plain JSON in AsyncStorage (not SQLite as originally specified). |

## 4. Residual risks
- Prices shown on a queued order are the cached menu prices. If the stall changes a price before the order syncs, the server bills the new price. The waiter should treat queued totals as estimates.
- A queued order can be rejected later (for example the item became unavailable). The waiter sees it as `REJECTED` in the Sync screen and must tell the customer. No push notification is sent.
- Device tokens and the queue are stored unencrypted in AsyncStorage.
