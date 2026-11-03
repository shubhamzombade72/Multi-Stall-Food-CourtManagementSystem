# Desktop design system (Phase 2)

Applies to `frontend-desktop/`. Decisions are in `docs/superpowers/specs/2026-11-03-design-system-theme-design.md`
(P2-D1…D9). The RMS comparison is in `docs/design/rms-reference-analysis.md`.

## 1. Colour tokens

Tokens are CSS variables in `src/index.css`. Each one holds space-separated RGB channels (`--c-<name>: r g b`):
light values on `:root`, dark values on `:root[data-theme="dark"]`. `tailwind.config.js` maps each name to
`rgb(var(--c-<name>) / <alpha-value>)`, so `bg-surface`, `text-muted`, `border-line` and `bg-primary/10` all
work. There is one component set and both themes use it.

| Token | Use | Light | Dark |
|---|---|---|---|
| `canvas` | app background (body) | `#FAFAFA` | `#0B0B0D` |
| `surface` | cards, panels, inputs, top bar | `#FFFFFF` | `#151517` |
| `surface-2` | table headers, hover, segmented tracks, disabled inputs | `#F5F5F7` | `#1E1E22` |
| `sidebar` | navigation | `#FCFCFC` | `#111113` |
| `fg` | primary text | `#111827` | `#F4F4F5` |
| `muted` | secondary text, labels | `#646B79` | `#9CA3AF` |
| `subtle` | **decoration only**: icons, placeholders (not for essential text) | `#9CA3AF` | `#71717A` |
| `line` | borders, dividers | `#E5E7EB` | `#26262A` |
| `primary` | actions, active nav, selected tabs, links | `#9F1239` (wine) | `#FB7185` (rose) |
| `primary-fg` | text on `primary` | `#FFFFFF` | `#1F0A0F` |
| `success` / `success-fg` | fill / AA text | `#22C55E` / `#15803D` | `#34D399` / `#34D399` |
| `warning` / `warning-fg` | fill / AA text | `#F59E0B` / `#B45309` | `#FBBF24` / `#FBBF24` |
| `danger` / `danger-fg` | fill / AA text | `#EF4444` / `#B91C1C` | `#F87171` / `#F87171` |
| `info` / `info-fg` | fill / AA text | `#2563EB` / `#1D4ED8` | `#60A5FA` / `#60A5FA` |
| `focus` | focus ring / outline | `#BE123C` | `#FB7185` |

The plain `success/warning/danger/info` swatches are for fills, borders and icons. **Text uses the `-fg`
variant.** Some RMS swatches fall below 4.5:1 as text on white (for example light `success`), so each has a
darker text variant.

### Measured contrast (WCAG 2.x)

These ratios come from the `contrast report` test in `tests/theme.test.ts` (`pnpm test`, 2026-11-03). The test
fails if text is below 4.5:1, or if non-text UI is below 3:1.

| Pair (text / background) | Light | Dark |
|---|---|---|
| fg / canvas | 17.00 | 17.89 |
| fg / surface | 17.74 | 16.59 |
| fg / surface-2 | 16.29 | 15.11 |
| muted / surface | 5.36 | 7.18 |
| muted / canvas | 5.13 | 7.75 |
| muted / surface-2 | 4.92 | 6.54 |
| primary / surface | 8.02 | 6.78 |
| primary-fg / primary | 8.02 | 7.04 |
| danger-fg / surface | 6.47 | 6.59 |
| success-fg / surface | 5.02 | 9.49 |
| warning-fg / surface | 5.02 | 10.92 |
| info-fg / surface | 6.70 | 7.17 |
| focus / surface (non-text, ≥ 3) | 6.29 | 6.78 |
| danger / surface (non-text, ≥ 3) | 3.76 | 6.59 |
| info / surface (non-text, ≥ 3) | 5.17 | 7.17 |

**Semantic tints.** `bg-danger/10`-style tints may carry a text colour only when the pair is listed in
`tests/tint-pairs.ts`; `tests/theme.test.ts` blends the tint over `canvas`, `surface` and `surface-2` and requires
≥ 4.5:1, and a guard fails on any unlisted tint + text pair in `src`. Tested pairs (worst of the three backgrounds,
light · dark): `danger-fg` on `danger/10` 5.24 · 5.20, `info-fg` on `info/10` 5.38 · 5.56, `muted` on `warning/10`
4.59 · 5.29. Measured and rejected (light, over canvas): `success-fg` on `success/10` 4.43, on `success/15` 4.25,
`warning-fg` on `warning/10` 4.47. Those places (Menu Veg badge and In Stock toggle, Daily Closing "Day Closed"
banner, POS success icons and notice, Dashboard revenue icon, Inventory low-stock icon, Login and Food Court
Settings warning banners) now use the `st-served` / `st-ready` soft/fg pairs. Error banners (`ErrorBanner`,
`Modal` error) use `bg-danger/10 border-danger/30 text-danger-fg`.

`subtle` is about 2.5:1 in light mode, which is why it is limited to icons and placeholders (guard test below).
The E2E (`e2e/theme.e2e.mjs`) also audits the live screens. It checks every visible text node against its
effective (composited) background on 26 screens and states (listed in section 7), in both themes. It applies WCAG
SC 1.4.3: **4.5:1 for normal text** and 3:1 only for large text (≥ 24 px, or ≥ 18.66 px and bold). Disabled or
faded content (opacity < 0.95, `[disabled]`) is exempt, as WCAG allows for inactive controls. No violations were
found. A self-test (A-00) injects text in `subtle` (3.77:1) and checks that the audit flags it at 14 px and
accepts it at 24 px.

## 2. Status kinds

`src/lib/status.ts` exports `statusKind(raw)`, which maps **every** raw backend status to one of 9 kinds, and
`statusClasses(kind)` / `statusChip(raw)`, which give literal Tailwind classes. `Badge` (`src/components/ui.tsx`),
the Orders & Table Tracking board, the KDS and the page chips all use this mapping, so one status looks the same
on every screen. Each kind has 3 tokens: `st-<kind>` (solid: stripe, border, dot), `st-<kind>-soft` (chip
background) and `st-<kind>-fg` (text).

| Kind | Meaning | Raw statuses mapped | Solid light / dark | fg/soft light · dark | solid/surface light · dark |
|---|---|---|---|---|---|
| `pending` | waiting, nothing started (neutral) | pending, unpaid, unknown/empty | `#6B7280` / `#9CA3AF` | 9.37 · 10.09 | 4.83 · 7.18 |
| `running` | accepted / in progress / occupied | confirmed, accepted, occupied, ordered | `#2563EB` / `#60A5FA` | 7.15 · 10.34 | 5.17 · 7.17 |
| `cooking` | in the kitchen (board **red**) | in_preparation, preparing | `#DC2626` / `#F87171` | 6.80 · 11.16 | 4.83 · 6.59 |
| `ready` | ready to serve / pick up (board **amber**) | ready, partially_ready | `#D97706` / `#FBBF24` | 6.37 · 10.82 | 3.19 · 10.92 |
| `served` | done at the table / available (board **green**) | served, picked_up, available, received, active | `#16A34A` / `#4ADE80` | 6.49 · 12.30 | 3.30 · 10.47 |
| `settled` | money closed | completed, success, paid, closed | `#0D9488` / `#2DD4BF` | 6.73 · 11.48 | 3.74 · 9.80 |
| `kitchen` | reserved / held | reserved | `#7C3AED` / `#A78BFA` | 7.57 · 10.97 | 5.70 · 6.70 |
| `void` | reversed / switched off (light muted grey, **not** struck) | refunded, inactive | `#82828C` / `#71717A` | 6.20 · 6.48 | 3.80 · 3.77 |
| `cancelled` | cancelled / failed (dark neutral grey, chip text **struck through**) | cancelled, failed | `#3F3F46` / `#D4D4D8` | 8.94 · 9.50 | 10.44 · 12.34 |

`cancelled` soft/fg: light `#C8C8CE` / `#27272A`, dark `#3F3F46` / `#F4F4F5`. It used to be a rose family that
sat 1.03:1 from the red `cooking` soft background, so a cancelled item read as "still in the kitchen". Rule now
tested in `tests/theme.test.ts`: every `st-cancelled` token is neutral (CIE Lab chroma C\*ab ≤ 6), and it is far
from `cooking` in CIE76 ΔE: soft ≥ 12, solid ≥ 30 (≈ 2.3 is just noticeable). Measured: soft ΔE 15.6 light /
35.6 dark, solid ΔE 85.6 / 61.5. It must also stay ≥ 8 ΔE from the lighter `void` soft (15.7 / 15.6).

Strike-through: `isStruck(kind)` is true only for `cancelled`; `Badge`, `statusChip()` and the tracking item chip
add `line-through` for it. `void` (refunded, inactive) is muted but not struck, because those records still exist.

fg/surface ratios (status text written straight on a card) are 6.82–14.89 in light and 7.12–16.59 in dark.
Overdue work shows an explicit **LATE** label (`LateBadge` in `ui.tsx`: `bg-danger-fg text-surface`, about 6.5:1
light / 6.9:1 dark) on KDS tickets and on Orders & Table Tracking cards, because a red ring is lost inside a red
border. KDS: late = `ring-4 ring-danger` + LATE; warning (≥ 15 min) = `ring-2 ring-offset-2 ring-warning`, which stays
visible on amber Ready cards. The KDS **New** column uses the `running` blue stripe and count chip (Preparing red,
Ready amber), and the advance button takes the colour of its **target** status (Accept → running blue, Start
Preparing → cooking red, Mark Ready → ready amber). Non-status labels (the Orders channel) use `Tag`: outlined,
square-cornered, `text-muted`, never a status fill. `unpaid` stays neutral until the owner picks an attention colour.

## 3. Typography and spacing (compact scale, P2-D4/D5)

* **Font stack:** `"Segoe UI", Inter, Roboto, system-ui, -apple-system, sans-serif`. Fonts are never
  downloaded (the app is offline; CSP `font-src 'self' data:`).
* **Headings:** page title `text-xl font-bold` (20 px / 700: `PageHeader` and the hand-written page titles);
  section, card and modal headings `text-base font-semibold` (16 px / 600); column labels on boards stay
  `text-sm font-bold uppercase text-muted`. The E2E checks on the Dashboard that the title is larger and bolder
  than every section heading.
* **Sizes:** body `text-sm` (14 px); metadata `text-xs` (12 px) and `text-[11px]` for chips. KDS ticket text
  stays larger because it is read from a distance.
* **Totals:** the POS **Grand Total**, each pending bill's **Total Payable** and the settle modal's **Total Bill
  Amount** are `text-2xl font-black` (24 px / 900; checked by the E2E); the payout reference on Daily Closing is
  `text-xl font-black`.
* **Figures:** `body` sets `font-variant-numeric: tabular-nums` (`src/index.css`, unit-tested), so every money
  amount, quantity, time and timer in the app uses fixed-width digits and lines up in columns. Order-number,
  payment-number and time cells are `whitespace-nowrap`.
* **Spacing:** cards `p-3` (12 px), radius `rounded-lg` (8 px; the spec said 10 px, Tailwind `rounded-lg` is 8 px); inputs and buttons `px-2.5–3 py-1.5`
  (about 32–36 px high); table cells `py-1.5`–`py-2` and `px-2`–`px-3` (a guard forbids `py-3+`/`px-4+` on
  `<td>`/`<th>`; a row is as tall as its tallest chip or icon button plus 12 px; the E2E checks 6 px cell padding
  on Orders); grid gaps `gap-3`/`gap-4`; sidebar `w-52` (208 px); top bar
  `h-12` (48 px).
* **Touch exception:** POS item tiles keep targets of at least 40 px.
* **Shared building blocks** (`src/components/ui.tsx`): `inputClass`, `buttonClass.primary|secondary|danger`,
  `PageHeader`, `Card`, `Badge`, `Tag`, `LateBadge`, `Modal`, `Field`, `ErrorBanner`, `SuccessBanner`, `EmptyState`, `Pagination`.
  Use these rather than new one-off styles.
* **Selected state:** tabs, filter pills and segmented choices use `bg-primary text-primary-fg` when selected
  and `bg-surface-2 text-muted` (or `bg-surface border border-line`) otherwise. Do **not** use `bg-fg` as an
  "inverted" fill: it turns near-white in dark mode (guard test).
* **Modal scrim:** `bg-black/50` in both themes. It is the only allowed raw neutral class.

## 4. Theme behaviour (P2-D6/D7)

* **Preference:** `localStorage['fc_theme']` = `light` | `dark`. If nothing (or anything else) is stored, the
  app follows Windows (`prefers-color-scheme`). The rule lives in `src/lib/theme.ts` and is mirrored in
  `public/theme-init.js`.
* **No flash:** `public/theme-init.js` is a classic script in `<head>`, loaded before the CSS. It is allowed by
  `script-src 'self'`. It sets `<html data-theme>` and `style.colorScheme` before the body is parsed. The
  Electron window stays hidden until `ready-to-show`. The E2E (R-03) shows `data-theme="dark"` already set when
  `#root` is parsed, before React has mounted.
* **Toggle:** `ThemeToggle` (`data-testid="theme-toggle"`) is in the top bar of every signed-in screen. It is a
  native button, so Tab, Enter and Space all work, and it shows a focus-visible ring. Its `aria-label` names
  the theme it switches **to** ("Switch to dark theme" / "Switch to light theme"). Clicking it stores the choice
  right away. The Welcome and Login screens have no toggle, but they follow the stored choice or the OS.
* **Native controls:** `color-scheme` follows the theme, so date/time pickers and scrollbars switch too. The
  base layer gives `input/select/textarea` `surface` / `fg`.
* **Known minor (deferred):** the app does not react live to a Windows theme change while it is running. The
  new OS preference applies on the next start.

## 5. Print behaviour (P2-D9)

Receipts and A4 reports render into `#print-root`. It is hidden on screen and is the only visible element in
print. Electron prints with `printBackground: true`, so the theme must not leak onto paper. `@media print` in
`src/index.css` therefore:

* resets `html, body` to `background: #fff !important; color: #000 !important; color-scheme: light`;
* forces `#print-root *` to `color: #000 !important; background: transparent !important; border-color: #000 !important`;
* sizes receipts to 80 mm (named page `receipt`) and A4 reports to full width.

`Receipt.tsx` is excluded from the theme guard because it is print-only. The E2E prints a real bill from Orders
in dark mode and holds the print dialog open while it checks. Under print media it found `html`/`body`
`rgb(255, 255, 255)`, `#print-root` and every text element `rgb(0, 0, 0)`, and no opaque backgrounds (P-01..P-03,
screenshot `qa/desktop/results/theme/dark-print-receipt.png`).

## 6. Adding a new screen without breaking the guard

`tests/theme-guard.test.ts` runs in `pnpm test` and fails on:

1. raw neutral palette classes (`bg-white`, `text-slate-500`, `border-gray-200`, `*-zinc/neutral/stone/black-*`,
   including variants and opacity), apart from the `bg-black/50` scrim;
2. raw accent palette classes (`bg-rose-50`, `text-emerald-600`, `brand-*` …);
3. hex colours in `className` attributes and arbitrary `-[#…]` values;
4. `text-subtle` anywhere except on a lucide icon line or as `placeholder:text-subtle`;
5. `bg-fg` fills (inverted surfaces, added in Task 4);
6. a `fixed inset-0` overlay without `!m-0`. Inside a `space-y-*` parent the overlay would pick up a 16 px
   margin-top and leave the top of the window undimmed (added in Task 4);
7. a semantic tint (`bg-success|warning|danger|info/<n>`) on the same line as a text token unless that pair is
   in `tests/tint-pairs.ts` (and therefore contrast-tested) (final review);
8. roomy table cells: `py-3`+, `px-4`+ or `p-3`+ on a `<td>`/`<th>` (a `colSpan` empty-state row is exempt)
   (final review).

Checklist:

* Surfaces: `bg-canvas` (page), `bg-surface` + `border border-line` + `rounded-lg` (cards; or use `Card`),
  `bg-surface-2` (headers, hover).
* Text: `text-fg`, `text-muted` for secondary text, `text-primary` for links, `text-<x>-fg` for coloured text.
* Statuses: `<Badge kind={statusKind(raw)}>` or `statusChip(raw)`. Never pick a colour per page. If you add a
  new raw status, add it to `RAW` in `src/lib/status.ts` and to `tests/status.test.ts`.
* Actions: `buttonClass.*`. Selected tabs use `bg-primary text-primary-fg`.
* Print-only markup goes through `printContent()` into `#print-root`. Do not style it with theme tokens.
* Modals: use `Modal` from `ui.tsx`. A hand-written overlay must be `fixed inset-0 !m-0 bg-black/50 … z-50`.
* Before calling the screen done, open it in **both** themes. Add it to the `screens` list in
  `e2e/theme.e2e.mjs`, so it is screenshotted, its white surfaces are scanned in dark mode and its text contrast
  is audited. For a dialog, open it in the loop the way the Orders detail modal is opened.

## 7. Verification (2026-11-03, final review fix wave)

All commands were run from `frontend-desktop/` on Windows, unpackaged Electron, with the built-in server
(`build-server/`, unchanged in this phase).

| Command | Exit | Result |
|---|---|---|
| `pnpm test` | 0 | 152 tests, 152 pass, 0 fail (adds: cancelled-vs-cooking ΔE, tint contrast, body `tabular-nums`, strike-through rule, tint guard, compact-cell guard) |
| `pnpm exec tsc --noEmit` | 0 | no errors |
| `pnpm build` | 0 | built (only the existing >500 kB chunk-size warning) |
| `node e2e/ui-first-run.e2e.mjs` | 0 | TOTAL: 27 PASS, 0 FAIL |
| `node e2e/order-tracking.e2e.mjs` | 0 | TOTAL: 16 PASS, 0 FAIL |
| `node e2e/theme.e2e.mjs` | 0 | TOTAL: 176 PASS, 0 FAIL (2 NOTE lines, see "Not covered") |

All 6 commands were re-run after the last product-code change.

### What `e2e/theme.e2e.mjs` covers

* Fresh profile with the OS colour scheme emulated as **light**. The owner is created on Welcome. Test data is
  seeded through the API: 2 stalls, 4 menu items, 2 tables, a cashier and a kitchen user, a customer with one
  cancelled and one paid order, 2 cash payments, 2 inventory items (one below its alert level), a supplier and a
  purchase order, a close-day call, and KDS tickets for one stall in New (pending + accepted), Preparing (two) and
  Ready (one).
* **Ageing without touching the server clock:** the test rewrites `created_at` in the renderer's copy of two
  responses (`page.route`): one preparing ticket 30 min old (LATE), the ready ticket 17 min old (warning ring),
  and the table order on the tracking board 40 min old (LATE label). Server state is not changed.
* **Light and dark screenshots** go to `qa/desktop/results/theme/{light,dark}-<screen>.png` for welcome,
  dashboard, pos, pos-pending-bills, pos-settle-modal, kitchen, kitchen-history, tracking (expanded card), orders,
  orders-detail, daily-closing, reports, food-court-settings, device-settings, payments, tables, waiter,
  cashier-closing, menu, staff, stalls, inventory, purchases, customers, customers-history and login (26 per theme).
  Extra shots: `dark-print-receipt.png`, `dark-toggle-focused.png`, `dark-after-restart.png`. Raw results are in
  `theme-results.json`.
* Every screen: `<html data-theme>` equals the expected theme, and every visible text node meets WCAG AA
  against its composited background: 4.5:1 for normal text, 3:1 for large text (≥ 24 px, or ≥ 18.66 px bold).
  Text elements counted per screen: 7 (Login) to 156 (Orders detail modal). Large text elements per screen: 0–8.
  Violations: 0. A-00 is a self-test showing the audit really fails a 3.77:1 small text.
* **Dark white-surface scan** on every dark screen (27 scans including the Orders dialog-only scan). Sampled set:
  every element in `<body>` that is rendered (not `display:none`, `visibility:hidden` or `opacity:0`) and at
  least 600 px², excluding `#print-root` and img/svg/video/canvas/option. A check fails on an opaque (alpha ≥ 0.5)
  background that is exactly `rgb(255, 255, 255)` **or** near-white (all channels ≥ 235). Sampled per scan: 22 to
  313. Final run: 0 white, 0 near-white.
* **Dialogs and states opened:** Orders detail modal (scrim coverage and chip-shape checks as before), POS pending
  bills mode, POS settle/payment modal, Customer order history dialog, KDS ticket history.
* **Design-system checks (both themes):** Dashboard title larger and bolder than every section heading; Orders
  cells 6 px vertical padding, order number `nowrap`, totals `tabular-nums`; the cancelled order chip is struck
  through and its background is not the cooking colour (Orders and Customer history); the Orders channel label is
  an outlined `Tag` with a transparent background; KDS New column has 2 tickets with the `running` blue stripe,
  Preparing 2 with exactly one LATE, Ready 1 with a visible warning ring; Accept / Start Preparing / Mark Ready
  buttons have three different backgrounds; the tracking card shows LATE; POS Grand Total and the settle-modal
  total are 24 px / 900 (settle total also `tabular-nums`).
* **Keyboard, restart and print:** unchanged from Task 4 (toggle reached with Tab, Enter/Space flip it, focus ring
  visible; restart on the same profile is dark before React mounts; receipt prints black on white in dark mode).

### Not covered

* **Daily Closing payout details** (the "Record Payout" modal) is attempted in both themes but was not reachable:
  after `POST /settlements/close-day` the embedded server's daily summary still reports `is_closed=false`, so no
  settlement records are listed. Likely cause (not verified in the DB): `closing_date` has a `date` cast and is compared with a plain
  `Y-m-d` string, which on SQLite does not match a stored `Y-m-d 00:00:00` value. This is a backend issue outside
  this visual phase; the run prints a NOTE line instead of failing. The payout modal is covered only by the static
  guards.
* Other dialogs not opened by the E2E (Menu/Inventory/Purchases/Staff/Stalls edit forms, Device Settings dialogs,
  notification popover) are covered only by the static guard tests.

### Visual defects found in the screenshots and fixed (Task 4)

| Defect | Where | Fix |
|---|---|---|
| Near-white "inverted" pill/button in dark mode (`bg-fg text-surface` becomes `#F4F4F5` with dark text) | POS "All Stalls" filter (the per-stall pills already used primary), POS settled-receipt "Close", Reports tab bar selected tab, Daily Closing "Execute End-of-Day Closing", Purchases tabs (2), Waiter Station tabs and order-type switch | Changed to `bg-primary text-primary-fg` (selected tabs and actions) |
| Same inverted fill on the table label in POS pending bills | `PosPage.tsx` pending-bill card | Changed to a neutral `bg-surface-2 text-fg border border-line` label |
| Could come back | n/a | New guard test: no `bg-fg` in `src/**/*.tsx` |
| Ticket status badge in the Orders detail modal stretched to the card height and rendered as a large circle behind the text (both themes) | `OrdersPage.tsx` ticket row (`flex justify-between`; the badge was stretched by the default `align-items: stretch`) | `items-start gap-2` on the row; E2E checks the badge stays chip-shaped |
| Modal scrim started 16 px below the top of the window, leaving a bright strip above it (both themes; most visible in light) | `Modal` in `ui.tsx` renders inside a `space-y-*` page, so the overlay got `margin-top: 1rem` | `!m-0` on `Modal` and on all 12 hand-written `fixed inset-0` overlays; new guard test; E2E checks the scrim covers the window |

Seen but not changed (not theme defects, or owner decisions):

* "Serve All Remaining" on the tracking card is a light-mint fill in dark (`bg-st-served-fg`). It is readable
  and its colour is meaningful.
* Device Settings has no page header.
* The Login card shows the Marathi brand name while the top bar shows the food court name.
* `unpaid` is neutral.
