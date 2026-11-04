# RMS sound-effects and printer-system investigation

Date: 2026-11-04 · Reference project: `RMS/` (MangalMurti POS / "Nodedr OrderRestro", NestJS + Next.js + Prisma)
Target project: Multi-Stall Food Court Management System (Laravel API + Electron/React desktop)

This document is **evidence only**. What was built from it is in
`sound-system-implementation-report.md` and `printer-system-implementation-report.md`;
results are in `sound-and-printer-test-report.md`.

Legend: **[V]** verified in source I read. **[A]** assumption or inference, stated as such.
**[X]** looked for and found absent.

---

## 1. REA availability

| Check | Result |
|---|---|
| `reverse-engineer-anything` skill in the session skill list | **Not present** |
| Skill folders under `~/.claude/skills`, `~/.agents/skills`, and the project tree | Not found (`find … -iname "*reverse-engineer*"` returned nothing) |
| REA MCP server | The only project MCP server is `code-review-graph` (`.mcp.json`). No REA tools were registered |

**Exact setup requirement (not performed, as instructed):** install the REA skill / register the REA MCP
server from <https://github.com/morluto/rea.git> in the coding agent's configuration. I did not install it or touch
global agent configuration.

**Consequence:** the brief says to use ordinary source analysis first and REA only for packaged binaries,
runtime behaviour or Electron boundaries that source cannot answer. RMS ships **complete TypeScript source**
for both sound and printing, so every conclusion below comes from reading source. No packaged-binary or runtime
question remained open that source could not answer, except physical-printer behaviour — which neither REA nor
source can establish without hardware (see §6).

## 2. License and asset decision (checked before reading further)

* `RMS/LICENSE` is the **GNU Affero General Public License v3** (header: "Nodedr OrderRestro, Copyright (C) 2026
  Nodedr Infotech Private Limited and Raktim Ranjit"). `RMS/package.json` → `"license": "AGPL-3.0-only"`.
* RMS contains **no audio asset files**: a search of `apps/` (excluding `node_modules`, `.next`) for
  `.mp3/.wav/.ogg/.m4a/.aac/.webm` found none, and every sound is synthesized in code (§3).
* **Decision:** AGPL-3.0 code cannot be copied into our proprietary application without making the combined work
  AGPL. Therefore **no RMS source, text, assets, constants tables or tests were copied.** RMS was used only to
  learn *what behaviour exists*. All code in our project was written independently. Details that are public
  standards rather than RMS expression (ESC/POS command bytes, code-page tables from the IBM/Microsoft
  specs, Web Audio API usage, UPI URI format) were re-derived from the standards.
  If the owner wants RMS code incorporated verbatim, that is a licensing decision to take with counsel first;
  I stopped short of it.

## 3. Sound effects in RMS

### 3.1 Mechanism [V]

| Item | Evidence |
|---|---|
| All sounds are **synthesized with the Web Audio API** (oscillator + gain envelope); nothing is loaded from a file | `apps/web/lib/celebrate.ts` L8-L91, `apps/web/lib/notification-feedback.ts` L27-L68 (comments: "Synthesized rather than an audio file, so there's nothing to bundle") |
| One shared `AudioContext`, created and resumed on the first `pointerdown`/`keydown`, so a kitchen screen that is loaded then left alone is not silently muted by browser autoplay policy | `apps/web/lib/audio-unlock.ts` L1-L73 (`installAudioUnlock`, `unlockAudio`, `runningAudioContext`) |
| KDS shows a "Tap to turn on new-ticket sound" button while the context is locked | `apps/web/components/kds/live-status.tsx` L25-L39 |
| **Per-device** mute in `localStorage` key `nodedr_notifications_muted`, shared by bell, KDS and Settings through a window event; no volume control, no per-event toggles | `apps/web/hooks/use-notification-mute.ts` L1-L50 |
| Vibration (`navigator.vibrate`) accompanies the staff alert | `notification-feedback.ts` L12-L17 |
| Speech: `speechSynthesis` "Payment received. ₹…" 700 ms after the payment chime | `celebrate.ts` L83-L87 |

### 3.2 Sound events actually present [V]

| # | RMS event | Trigger condition (verified) | Sound | Source |
|---|---|---|---|---|
| 1 | New kitchen ticket | Socket event `kot.created` on the KDS screen | Double square-wave beep, C6 (1046.5 Hz), 2 × 90 ms, gain 0.15 | `apps/web/hooks/use-kds-sound.ts` L38-L40 → `playNotificationFeedback()` |
| 2 | Order awaiting acceptance | Socket `order.created` with `acceptance === 'PENDING'` (online order, no ticket yet) | Same double beep | `use-kds-sound.ts` L37-L39; server emits `acceptance` at `orders.service.ts` L385-L389 |
| 3 | Any staff notification (bell) | Socket `notification.created`, **plus** a poll fallback that rings once for unread notifications not yet announced (first poll only seeds a "seen" set; `socketAnnounce.pending` prevents socket+poll double ring) | Same double beep + vibrate | `apps/web/components/notifications/notification-bell.tsx` L73-L106 |
| 3a | …which carries: new online order needing accept, new order, scheduled-order due, kitchen-accepted online order | `notifyByPermission` calls | (no distinct sound) | `orders.service.ts` L404, L412, L640, L2183 |
| 3b | …**order ready** (to the table's assigned waiter only) | `kot` status → `READY` and table has `assignedWaiterId` → `notifyUser(type 'order.ready')` | Same double beep (no distinct sound) | `orders.service.ts` L2325-L2345 |
| 3c | …"Kitchen rejected a ticket" | `order.rejected` to `orders.create` holders | Same double beep | `orders.service.ts` L2508-L2520 |
| 4 | Payment received (till) | Checkout success with `settlement.fullyPaid` | 3-note rising triangle chime G5→C6→G6 + spoken amount | `apps/web/components/pos/checkout-panel.tsx` L259-L262 |
| 5 | Payment received (customer display) | `state.kind === 'paid'` **and** the display was tapped once (`soundOn`) | Same chime + speech | `apps/web/app/customer-display/page.tsx` L18-L23 |
| 6 | Guest QR order placed | `placed` flips true on the guest's own page | 2-note sine chime A5+E6, vibrate `[15,40,15]` | `apps/web/app/order/[qrToken]/page.tsx` L108-L113, `celebrate.ts` L10-L45 |

### 3.3 Events the brief asked about that RMS does **not** have [X]

I grepped `apps/web` for `AudioContext|new Audio(|speechSynthesis|playSound|beep|\.play()` and read all three hits'
call sites. There is **no** sound for: order accepted (the accept action itself is silent; only the *kitchen-side*
`order.new` notification that follows rings), preparation-status changes, **order marked Served**, payment
**failed**, cash-drawer or printer events, generic error/warning toasts, or button/navigation clicks. "Order Ready"
has no distinct sound — it reuses the generic notification beep and only reaches the assigned waiter.

### 3.4 RMS duplicate / stale-sound behaviour [V]

* Socket + poll double-ring is suppressed by a counter (`socketAnnounce.pending`), not by an id set.
* Opening the bell does not replay history: the first poll only seeds `announced` (L88-L92).
* The KDS hook has **no** de-duplication: a reconnecting socket that re-delivers an event rings again, and it
  opens its own socket separate from the bell's, so a user with both mounted can hear two beeps for one
  `kot.created` [V: `use-kds-sound.ts` creates its own `io(...)`; bell creates another]. I treated that as a
  weakness to avoid, not behaviour to copy.
* `celebrate.ts` creates a **new** `AudioContext` for each chime and closes it after 0.5-1.2 s (several contexts
  alive during bursts). `notification-feedback.ts` prefers the shared one.

## 4. Printing in RMS

### 4.1 Architecture [V]

```
POS / KDS (browser)  ──HTTP──►  NestJS backend ──►  buildReceiptEscPos / buildKotEscPosJob (bytes)
                                                  │
                                                  ├─ NETWORK : raw TCP  host:9100        (escpos-network.ts)
                                                  └─ USB     : kernel /dev/usb/lp* then libusb (escpos-usb.ts)
Browser path (kept): hidden iframe → window.print() → OS dialog                 (web/lib/print.ts)
```

Printing is performed **by the server**, not the browser; the printer must be reachable from the server host.
Source: `docs/PERMISSIONS-STOCK-PRINTING.md` "Thermal printing" L68-L120; `printer-transport.ts` L1-L28.

### 4.2 Evidence by capability

| Capability | Finding | Evidence |
|---|---|---|
| Printer selection / configuration | **Per branch** DB fields `printerConnection` ("USB" \| "NETWORK"), `printerHost`, `printerPort` (default 9100), `printerPaperWidthMm` (80), `printerCodepage` ("CP858"), `printerColumns`. Edited in Settings → Printer | `apps/backend/prisma/schema.prisma` L138-L146; `web/components/settings/printer-diagnostics-card.tsx` |
| Discovery | [X] **None.** "there is no discovery" (comment). User types an IP | `escpos-network.ts` L2-L4 |
| USB | Linux only: kernel `usblp` char device first, `libusb` raw bulk fallback; needs USB passthrough in Docker | `escpos-usb.ts` L1-L35, L45-L330 |
| LAN | Raw ESC/POS to TCP, 4 s connect timeout, 8 s write timeout, resolves only after socket `close` | `escpos-network.ts` L10-L66 |
| Bluetooth / serial / WebUSB | [X] **None** (grep for `bluetooth|serial|webusb` in print code: no hits) | — |
| ESC/POS | Yes. Init `ESC @`, font A, bold `ESC E`, size `GS !`, align `ESC a`, code page `ESC t n`, cut `GS V 0`, drawer `ESC p`, native QR via `GS ( k` model 2 level M | `escpos/encoder.ts` L47-L68, L245-L295 |
| Widths | 58 mm → 32 columns, 80 mm → 48 (576-dot head); optional override 20-64 | `encoder.ts` L25, L28-L45 |
| Code pages | CP437, CP850, CP858 (default), CP1252 (`ESC t` 0/2/19/16) | `escpos/codepages.ts` |
| **Devanagari / Marathi** | [X] **Not supported in thermal mode.** Code pages are Latin only. Unencodable characters print as `?`, are returned as `unsupportedChars`, the UI warns, and a line on the ticket says some characters could not be printed; the docs tell users to use the **browser** path for those | `encoder.ts` L110-L135, L278-L290; `PERMISSIONS-STOCK-PRINTING.md` L108-L111. (The browser/HTML path renders any script the OS fonts support — [A], not tested.) |
| Logo | [X] No raster/logo printing in the ESC/POS builder (no image commands). The HTML receipt has no `<img>` either | `grep -i "logo|raster|image"` in `escpos*` = no hits; `receipt.html.ts` only mentions logo in comments |
| QR | Native ESC/POS QR, but **only the Spain VERI\*FACTU invoice QR** is printed, not a UPI payment QR | `escpos-receipt.ts` L61, L238-L247; `escpos-receipt.spec.ts` L294-L365 |
| Cash drawer | Yes: `ESC p 0 0x19 0xfa` appended after the cut; `POST /orders/print/drawer`; kicked for cash payments | `encoder.ts` L66-L67, L295; `use-print.ts` L65-L75 |
| Customer receipt | `buildReceiptEscPos`; `POST /v1/orders/:id/print/usb` (bill if unpaid, receipt if paid) | `escpos-receipt.ts` `buildReceiptEscPosJob` L112, `buildKotEscPosJob` L287 |
| KOT | `buildKotEscPosJob`; one ticket per **kitchen round and station**, built only from that ticket's own lines; no prices | `kot-print.service.ts` L22-L25, L110-L135; docs L87-L93 |
| Duplicate prevention | First print "claims" the ticket with a conditional `UPDATE … printedCount 0→1` **before** sending → second tap/tablet/retry gets `409 ALREADY_PRINTED`; on failure the claim is released | `kot-print.service.ts` L101-L106 (claim), L153-L160 (release on failure) |
| Reprint | `?reprint=true`, paper says `*** REPRINT #n ***`; `printedCount` incremented only on success | `kot-print.service.ts` L86, L110 (copy number), L172-L175 (`printedCount` incremented only after success) |
| Print preview | [X] No on-screen preview of the thermal output. Browser path has the OS print dialog only | — |
| Auto-print | [X] None found. Every print is a button press | grep `autoPrint|printOnPay|autoKot` = no hits |
| **Print queue / job history** | [X] **None.** No job table; the only state is `Kot.printedCount/printedAt/lastPrintError`. Printing is synchronous inside the HTTP request, so a restart loses nothing queued only because nothing is ever queued. **No history of receipt prints at all** | `schema.prisma` L1453-L1455; `kot-print.service.ts` |
| Connectivity check | `GET /orders/print/diagnostics` → network `reachable` via open/close probe; USB: lists `lp` nodes and a libusb printer | `escpos-network.ts` L68-L85; `use-print.ts` L8-L20 |
| Failure handling | `503` with reason (`ECONNREFUSED` → "is raw/9100 enabled?", `EHOSTUNREACH`, `ENOTFOUND`, timeouts); last error stored on KOT; **retry = press again** | `escpos-network.ts` L35-L50; `kot-print.service.ts` L153-L165 |
| Test print | Receipt slip with column ruler + accents; sample KOT | docs L99-L101, L114-L120 |
| Hardware verification | **RMS itself states it is not verified on real hardware**; only a local TCP listener | docs L114-L120; `FEATURE-CHECKLIST.md` L338-L339 |

### 4.3 What this means for our design

RMS gives us a behavioural checklist (width presets, code pages, once-only KOT, `REPRINT` stamp, TCP 9100,
reachability check, honest "?" warning) but its architecture does not fit our product: ours is a Windows
desktop app whose renderer cannot reach `/dev/usb`, and the brief requires a **persistent job queue, history and
controlled retry**, which RMS lacks. Gaps RMS leaves open that we must close ourselves: preview, job lifecycle,
restart safety, Marathi, UPI QR.

## 5. Our application — what exists today [V, all inspected]

| Area | Finding | File |
|---|---|---|
| Electron security | `contextIsolation`, `sandbox`, no Node integration, `webSecurity`, DevTools off when packaged, all IPC goes through an allow-listed `handle()` that rejects non-app senders; smoke test compares the preload API to `BRIDGE_KEYS` | `frontend-desktop/electron/main.cjs` L404-L425, L545-L565 |
| Existing printing | `desktop:list-printers` (`getPrintersAsync`) and `desktop:print` = `webContents.print({silent:false})` of **the current page** (print-only CSS) → the **Windows print dialog every time**. Receipt printer name and paper width kept in `localStorage` per PC | `main.cjs` L616-L632; `src/desktop/bridge.ts` L113-L168; `src/components/Receipt.tsx` |
| Receipt content | Business Profile header, GSTIN if enabled, per-stall item groups (stall name deliberately **not** printed), tax lines from the bill's own stored rate/mode, discount, TOTAL, payment lines, UPI QR block, footer, fixed credit line | `src/lib/receiptModel.ts`, `Receipt.tsx`, `tax.ts`, `qr.ts` |
| Preview | React `ReceiptContent` in a dialog (same component as print) | `Receipt.tsx` `ReceiptPreviewButton` |
| Receipt history/reprint | Payments page "Reprint" and Orders detail call `printReceipt(orderId)` which refetches `GET /billing/receipt/{id}` — paid UPI bills reprint their original request | `PaymentsPage.tsx` L91, `OrdersPage.tsx` L295 |
| KOT | **Digital only** (KDS). `GET /kitchen/tickets`, `GET /orders/{id}` (owner/cashier) returns `kitchenTickets.stall` + `ticketItems.orderItem` (name, quantity, `special_instructions`) per stall. **No paper KOT exists.** No endpoint adds items to an existing order, so "newly added items" cannot occur | `backend/app/Http/Controllers/Api/KitchenController.php`, `OrderController::show` |
| Sound | One inline `chime()` in `KitchenPage.tsx` L23-L40 (new context per beep, local `sound` state, resets on every mount); `NotificationBell` polls `/notifications` every 15 s and is silent | `KitchenPage.tsx`, `NotificationBell.tsx` |
| Notifications | Derived server-side from records, role-filtered: `new_order`, `order_cancelled`, `payment` (owner), `kitchen_ticket` (kitchen/stall manager), `ticket_ready` (owner/cashier/waiter), `low_stock`, `purchase_received`; ids are stable (`order:12`, `ticket:7`, `ready:7`, …) | `backend/app/Http/Controllers/Api/NotificationController.php` |
| CSP | Production `default-src 'self'` (media falls back to it); `connect-src` http(s)/ws(s) | `frontend-desktop/vite.config.ts` |
| Backend DB | Sound/printer settings need no server table: both are **per-PC** concerns, matching how the receipt printer is already per-PC | — |

## 6. What can and cannot be known without hardware

* Byte-level ESC/POS output, layout, queue semantics and TCP transport can be tested (and RMS did the same).
* **Physical compatibility cannot be.** No thermal printer was available to me, so nothing here is claimed to work
  on any brand/model. A manual hardware procedure is in `printer-system-implementation-report.md`.

## 7. Sound-event mapping (verified RMS events only → our equivalent)

| RMS event | Verified trigger | RMS sound | Target app equivalent |
|---|---|---|---|
| New kitchen ticket (#1) | `kot.created` socket on KDS | double beep C6 | `kitchen_ticket`: new stall ticket appears on the Kitchen board / notification `kitchen_ticket` |
| Order awaiting acceptance (#2) | `order.created` + `PENDING` | double beep | **No equivalent** — our orders have no acceptance step (tickets start `pending` and are accepted on the KDS, which is `kitchen_ticket`) |
| Bell notification — new order (#3) | `notification.created` | double beep | `new_order`: notification `new_order` (owner/cashier) |
| Bell notification — order ready (#3b) | KOT → READY, to assigned waiter | double beep | `order_ready`: notification `ticket_ready` (owner/cashier/waiter) |
| Bell notification — rejected/cancelled (#3c) | `order.rejected` | double beep | `alert`: notification `order_cancelled`, `low_stock` |
| Payment received (#4, #5) | checkout `fullyPaid`; display `paid` | 3-note chime + speech | `payment_success`: POS payment recorded; owner notification `payment` |
| Guest order placed (#6) | guest page | 2-note chime | No equivalent: the guest QR page is `frontend-customer`, out of scope for this task |

Our-own additions (**not** RMS-verified, documented as such): `payment_failed` on a rejected payment in POS, and
`alert` when a print job ends `failed` (RMS has no print-failure sound). Everything else the brief listed
(accepted, preparing, served, cash-drawer) has no RMS sound, so none was built.

## 8. Printer feature matrix

| Feature | RMS evidence | Existing app status (before) | Required implementation |
|---|---|---|---|
| Printer selection | Per-branch connection type/host/port; no OS printer list (§4.2) | Per-PC Windows printer name in `localStorage`; only used to preselect the print dialog | **Implement**: separate Receipt and Kitchen printer profiles, persisted in the main process |
| Printer discovery | [X] none | `getPrintersAsync` lists installed Windows printers | Reuse installed-printer list; LAN stays manual IP (no fabricated discovery) |
| USB | Linux usblp/libusb | Windows driver only via dialog | **Implement** via Windows spooler (driver mode and RAW mode); no libusb dependency |
| LAN | TCP 9100 | None | **Implement** TCP 9100 (built-in `net`) |
| Bluetooth | [X] | None | **Gap, documented** — works only if Windows exposes it as an installed printer |
| 58 mm receipt | 32 columns | `paperProfile(58)` HTML only | **Implement** both HTML (driver) and text (ESC/POS) layouts |
| 80 mm receipt | 48 columns | HTML | **Implement** |
| KOT printing | Per ticket+station, no prices | **None (no paper KOT)** | **Implement** stall-isolated KOT from the order's tickets and from the Kitchen board |
| Stall isolation | Ticket lines come from that ticket | n/a | **Implement + test** (one job per stall, items asserted) |
| Reprint | `reprint=true`, `*** REPRINT #n ***` | Re-fetches receipt, prints with no marker, no record | **Implement**: reprint marker, copy number, job history |
| Duplicate prevention | DB claim `printedCount 0→1` | None | **Implement** dedupe key in a persistent queue |
| Preview | [X] | HTML preview (dialog) | Keep HTML preview; **add** exact thermal-text preview for ESC/POS profiles |
| Auto-print | [X] | None | **Implement as an opt-in** per-PC setting (off by default) |
| Job queue / history | [X] | None | **Implement** persistent `queued→processing→completed/failed` |
| Failure handling | 503 + stored error; press again | `alert()` | **Implement** classified errors, history, controlled retry, failure alert |
| Printer status | LAN reachability probe | `status` int exposed but unused | **Implement** status check (spooler state / TCP probe) with honest wording |
| Disconnect | Error message | none | **Implement** (printer missing from OS list / unreachable → failed, retryable) |
| Restart safety | n/a | n/a | **Implement**: queued resume; `processing` becomes `failed (interrupted)` — never auto-reprinted |
| Encoding | CP437/850/858/1252, `?` + warning | Browser fonts (Marathi works) | **Implement** code pages + `?` warning; route Marathi to Windows-driver mode |
| Marathi / Devanagari | [X] thermal; browser only | Works via browser/driver print | Keep working via **driver mode**; in ESC/POS mode warn, do not claim support |
| Logo | [X] | [X] | **Gap, documented** (no logo field exists in Business Profile) |
| UPI QR on receipt | VERI\*FACTU QR only | HTML QR from `upiSection` | **Implement** in both layouts from the same `upiSection` payload |
| Cash drawer | `ESC p` | None | **Not implemented** (hardware-dependent, not requested in Phase 4) — noted |
| Hardware verification | Not verified by RMS either | n/a | **Pending**, procedure supplied |

## 9. Evidence index (RMS files read)

`LICENSE`, `package.json`, `FEATURE-CHECKLIST.md` (L56, L112, L130, L155, L337-L341),
`docs/PERMISSIONS-STOCK-PRINTING.md`,
`apps/web/lib/{audio-unlock,celebrate,notification-feedback,print}.ts`,
`apps/web/hooks/{use-kds-sound,use-notification-mute,use-print}.ts`,
`apps/web/components/{kds/live-status,notifications/notification-bell,pos/checkout-panel,settings/printer-diagnostics-card}.tsx`,
`apps/web/app/{customer-display,order/[qrToken]}/page.tsx`, `apps/web/app/(dashboard)/kds/page.tsx`,
`apps/backend/src/modules/orders/{printer-transport,escpos-network,escpos-usb,kot-print.service,orders.service}.ts`,
`apps/backend/src/modules/orders/escpos/{encoder,codepages}.ts`, `escpos-receipt.ts` (structure),
`apps/backend/prisma/schema.prisma` L138-L146, L1453-L1455.
Screenshots in `RMS/docs/screenshots` show UI pages only; none document sound or printing, so no conclusion
rests on them.
