# Realtime Security Report (Laravel Reverb)

**Date:** 2026-11-02
**Scope:** every broadcast event, every channel, channel authorization, payload contents, unauthorized subscription attempts against a live Reverb server.

## 1. Findings before Phase 3

1. **Nothing was ever broadcast.** All four events called `->load('diningTable')` / `order.diningTable`, but the relation on `Order` is `table()`. The constructor threw, and the controllers' `try/catch` hid the failure. "Runtime verified" in `realtime-implementation.md` was not true.
2. **All channels were public** (`orders`, `waiters`, `stalls.{id}`, `orders.track.{token}`). Anyone with the public Reverb app key could have subscribed to any stall's kitchen feed.
3. **No channel authorization.** `routes/channels.php` had only the default user channel, and the broadcast auth route used the `web` (session) guard, which token-based clients cannot use.
4. **No client subscribes.** Desktop, customer QR and Android apps poll over HTTP. This is still true (OPEN-04).

## 2. Channel design after Phase 3

| Channel | Type | Who may subscribe (enforced in `routes/channels.php`) | Events |
|---|---|---|---|
| `private-stall.{stallId}` | Private | Owner; kitchen staff or stall manager **of that stall** | OrderCreated, TicketStatusUpdated, TicketReady |
| `private-waiters` | Private | Waiter, owner | TicketReady |
| `private-cashier` | Private | Cashier, owner | OrderCreated, TicketStatusUpdated, TicketReady, PaymentCompleted |
| `orders.track.{trackingToken}` | Public, capability-named | Anyone who knows the order's 36-char random tracking token (the customer's own link) | OrderCreated, TicketStatusUpdated, TicketReady, PaymentCompleted |
| `App.Models.User.{id}` | Private | That user | (none yet) |

- Auth endpoint: `POST /api/broadcasting/auth` behind `auth:sanctum` and `active` (deactivated users are refused).
- **Payload minimisation:** staff payloads carry ids, numbers, status, stall name and table number. **No customer name or phone, no bill totals, no QR token.** `OrderCreated` deliberately omits `total_amount` because stall kitchens receive it.
- The tracking channel is public by necessity (customers are not logged in). Its name contains the unguessable tracking token, and payloads hold only status, ids and table number. `PaymentCompleted` includes the amount and method, which is the customer's own bill.

## 3. Tests

### Automated (PHPUnit, `tests/Feature/StagingHardeningTest.php`)
- `test_private_stall_channel_authorization`: kitchen A → own stall 200, stall B 403, cashier 403, waiters 403; waiter → waiters 200, stall 403; cashier → cashier 200; owner → any stall 200. Uses the real Pusher-protocol broadcaster (not the null driver, which authorizes everything).
- `test_unauthenticated_broadcast_auth_is_rejected`: 401.
- `test_events_broadcast_on_private_channels_only`: every channel of every event is `private-*` or `orders.track.trk_*`.

### Live Reverb (`qa/staging/staging-validation.mjs`)
| ID | Test | Result |
|---|---|---|
| B-03 | Waiter subscribes `private-waiters`, pizza KDS subscribes `private-stall.1` with server-signed auth | PASS |
| B-05 | Waiter receives `TicketReady` when kitchens mark ready | PASS (≈2.3–2.6 s including 4 sequential API calls on the dev server) |
| B-06 | Pizza KDS receives `TicketStatusUpdated` | PASS |
| B-07 | Pizza KDS socket received **no** events for other stalls | PASS |
| B-14 | Cashier receives `OrderCreated` on `private-cashier` | PASS |
| RT-01 | Pizza kitchen requests auth for burger channel | PASS: 403 |
| RT-02 | Unauthenticated auth request | PASS: 401 |
| RT-03 | Subscribe to `private-cashier` with a forged signature | PASS: Reverb `pusher:error 4009 Connection is unauthorized` |
| RT-04 | Subscribe to `private-waiters` with no signature | PASS: refused |
| RT-05 | Subscribe to the old public channels (`orders`, `waiters`, `stalls.1`) and create an order | PASS: no business event delivered |
| RT-06 / RT-07 | Kitchen → cashier channel; waiter → stall channel | PASS: 403 |
| RT-08 | Scan all received staff payloads for `customer_phone`, `customer_name`, `total_amount`, `qr_token` | PASS: none |

### HTTP polling fallback
Unchanged and still the primary mechanism: POS pending bills 8 s, owner dashboard 10 s, customer tracking 4 s, KDS 4 s, waiter ready dishes 5 s. All polled endpoints now enforce the same role and stall rules as the channels.

## 4. Remaining work
- **OPEN-04:** add `laravel-echo` + `pusher-js` subscriptions to the desktop POS, the KDS and the waiter app so polling becomes the fallback rather than the only path.
- Reverb `allowed_origins` is `['*']`. Restrict it to the desktop / QR origins in production.
- Reverb runs without TLS (`ws://`) on the LAN. Use `wss://` if the server is ever exposed beyond the LAN.
