# RMS reference analysis (Phase 2 design system)

The owner named the `RMS/` folder as the visual reference for the desktop app. This note records what that
folder contains, what was actually looked at, and how the Phase 2 design system compares.

## Licensing

`RMS/LICENSE` is the **GNU Affero General Public License v3**. RMS is used as a **visual reference only**:
colours, density and layout ideas are described and compared here. No RMS source, CSS, component, image or
text was copied into `frontend-desktop/`. The Phase 2 palette uses the same published swatch values that
`RMS/DESIGN_SYSTEM.md` lists (colour values are facts, not code). Token names, the status system, the
components and all CSS were written for this project.

## What the RMS folder contains

| Item | What it is | Looked at? |
|---|---|---|
| `DESIGN_SYSTEM.md` | Light and dark colour tokens (wine primary `#9F1239`, dark rose `#FB7185`), typography table (Geist/Inter, 32/24/18/15–16/13 px), layout (top bar, collapsible sidebar, bento dashboard), component and motion notes, WCAG AA, POS and KDS exceptions | Read in full |
| `README.md`, `FEATURE-CHECKLIST.md` | Product overview and a ~450-line feature checklist (POS, tables, menu, KDS, kiosk, QR ordering, inventory, recipes, purchasing, delivery, CRM, discounts, payments, staff, cash drawer, reports, multi-outlet, hardware, offline, sync, security, reservations, marketing, accounting, India GST, AI) | Section headings only (feature scope is later phases, not visual) |
| `MangalMurti_POS_Feature_Guide_Marathi.html` / `.pdf` | Marathi marketing/feature guide: dashboard, POS billing, tables & QR ordering, KDS, menu & pricing, stock & recipes, GST reports. The HTML has 11 `<img>` tags | HTML section headings read; the images and the PDF were **not** opened |
| `docs/screenshots/` | ~60 PNGs: `dashboard/inventory/kds` in light and dark, `pos/tables/menu/customers/reservations/purchase-orders` light, `login`, `dashboard-mobile`, and ~45 `or-*` flow shots (checkout, POS cart/modifiers/gift card, KOT/KDS, tables floor/QR/waitlist, inventory, procurement, reservations, settings/staff/roles/audit) plus `tutorial/` (56 more, mostly accounting/HR) | 8 viewed (list below) |
| `docs/*.md`, `orderrestro-manual.html`, `orderrestro-user-manual.pdf` | Kiosk/KDS, permissions/printing, integrations docs and a user manual | Not opened (functional, not visual) |
| `apps/web` | Next.js UI source (also has `public/screenshots/{dashboard,kds,pos,tables}-light.png`) | Not read: AGPL source, and the screenshots answer the visual questions |
| `casaos/screenshot-1..3.png` | Store listing screenshots | Not opened |

### RMS screens actually seen (images opened)

1. `docs/screenshots/pos-light.png`: POS, empty cart
2. `docs/screenshots/or-pos-cart.png`: POS with 2 cart lines
3. `docs/screenshots/or-checkout-billing.png`: billing / payment panel
4. `docs/screenshots/kds-dark.png`: KDS, dark theme
5. `docs/screenshots/or-kot-kds-accepted.png`: KDS, light theme, with the accepted column
6. `docs/screenshots/tables-light.png`: floor plan with mixed table states
7. `docs/screenshots/or-tables-floor.png`: floor plan, all tables available
8. `docs/screenshots/dashboard-dark.png`: dashboard, dark theme

Every statement below about an RMS screen comes from these images or `DESIGN_SYSTEM.md`. RMS has **no order
tracking board equivalent** in the screens viewed. Where a row says "not found in the reference", it means
it was not in what was viewed.

### What the RMS screens show

* **Shell**: 256 px light sidebar (`#FCFCFC`) with brand, branch switcher, icon+label links. The active link is
  a pale wine-tinted pill with wine text. The top bar holds only the bell, theme toggle (sun/moon icon) and an
  avatar with the user's name. There is no page title in the top bar; pages open with a 32 px semibold H1 and a
  muted subtitle.
* **POS**: 2 large rounded panels (radius about 24 px). On the left: search, segmented category tabs (selected
  = white pill on a grey track) and a 4-column grid of item cards (green/red availability dot, name, bold price;
  no image, no stall label). On the right: a Dine-in/Takeaway segmented control, table select, customer field,
  cart lines with −/qty/+ and delete, the subtotal, and one full-width wine primary button ("Send to kitchen";
  shown faded when the cart is empty).
* **Billing panel**: replaces the cart in the same right panel. Back link, outlined "Cancel order", order line,
  large bold total, an info note, customer chip, discount % / tip inputs, gift card, payment method select,
  split-between-guests, "Total due", and a full-width wine "Complete payment" button.
* **KDS**: 4 columns (New / Accepted / Preparing / Ready) with counts. Each ticket card shows a bold
  `#order-number`, "Table · station", a timer pill ("1m"), item lines `2× name` plus modifier text, one primary
  action per state (Accept / Start preparing / Mark ready), and star (priority) and print icon buttons. Priority
  tickets get an amber outline. Dark KDS uses the same layout with rose primary buttons. KDS type is **not**
  larger than on other screens in these shots.
* **Tables**: a floor canvas with rounded table tiles tinted by state (green = available, wine/rose =
  occupied, amber = reserved, grey = cleaning), a legend under the canvas and a waitlist card.
* **Dashboard (dark)**: 4 KPI tiles (label, tinted icon chip, large number), then three cards (Tables counts
  by state with coloured dots, Kitchen queue by state, Recent transactions).
* **Density**: generous. Card padding is about 24 px, radius 16–24 px, 15–16 px body text and lots of empty
  space. `DESIGN_SYSTEM.md` makes POS the one "density over spaciousness" exception.

## Comparison matrix

"Existing" = desktop app before Phase 2. "Required" = owner brief / spec P2-D1…D9. "Phase 2" = what is now in
the code. "Later" = deferred phase (see the spec's non-goals: navigation restructure phase 4, POS workflow
phase 5).

| RMS reference element | Existing implementation (before Phase 2) | Required | Done in Phase 2 | Later phase |
|---|---|---|---|---|
| **Colour tokens** (`DESIGN_SYSTEM.md`: wine primary, neutral canvas/card/sidebar, dark set) | One custom colour (`brand` orange); ~1,350 hard-coded `bg-white`/`slate-*` classes; no CSS variables | Semantic CSS variables, light + dark, RMS palette, AA text (P2-D1/D2) | Yes: 15 core tokens + `-fg` text variants in `src/index.css`; RMS swatches kept; `muted` darkened to `#646B79` and AA `-fg` variants added where an RMS swatch fails as text; guard test blocks raw palette classes | n/a |
| **Theme toggle** (sun/moon icon in the top bar) | None | One-click toggle in the top bar, persisted, no flash, keyboard-operable (P2-D6/D7) | Yes: `ThemeToggle` in `Navbar`, `fc_theme` in localStorage, OS preference when unset, `theme-init.js` before CSS; E2E K-01..K-04, R-01..R-03 | Live OS-theme listener (deferred minor) |
| **Navigation** (256 px sidebar, icon+label, tinted active pill, branch switcher, no title bar) | 256 px sidebar, grouped sections, orange active state, tall navbar | Compact (208 px), token colours | Partly: 208 px (`w-52`) grouped sidebar, `bg-sidebar`, active = solid primary pill (stronger than RMS's tinted pill, chosen for scanning); 48 px top bar | Restructure / module removal, collapsible drawer (phase 4) |
| **POS layout** (2 panels: item grid + cart/billing on the right; segmented filters; bold prices; one primary CTA) | Same 2-panel idea, orange, rounded-2xl, large padding | Dense, ≥ 40 px touch targets on item tiles, token colours, bold totals (P2-D5) | Yes (visual only): token surfaces, stall filter pills (selected = primary; the "All" pill was fixed in Task 4), bold `tabular-nums` prices and Grand Total, Send to Kitchen / Send & Pay | Category tabs, modifiers, gift card (phase 5) |
| **Billing panel** (in the cart panel: big total, discount/tip, payment method, split, full-width "Complete payment") | Billing modal / pending-bills flow | Same colours and status meaning as everywhere | Colours and typography only; flow unchanged (behaviour change is out of scope) | RMS-style inline billing, split bill, tip (phase 5) |
| **Table cards** (state-tinted tiles + legend) | Ad hoc green/red/amber classes | Same status colours everywhere (P2-D3) | Yes: `statusKind()` maps available → served (green), occupied → running (blue), reserved → kitchen (violet). Colours differ from RMS (occupied wine, reserved amber) on purpose: wine is our primary/action colour and amber means "ready" on the board | Floor-plan canvas, waitlist (later) |
| **Order tracking** (not found in the reference) | D9 board: red/amber/green cards | Keep D9 meaning: cooking red, ready amber, served green | Yes: board uses `st-cooking/st-ready/st-served`; expanded card checked in light and dark | n/a |
| **KDS** (4 columns, bold ticket number, timer pill, one action per state, priority outline) | 4 columns, orange accents | Larger type for distance reading, status colours (P2-D5) | Yes: token colours, status stripe per kind, LATE badge for late tickets (Preparing is now red), larger ticket type kept | Drag between columns, priority star, per-station avg time (later) |
| **Status colours** (green/amber/red/grey dots; wine for occupied) | 6 badge tones in `ui.tsx` plus per-page colours | One mapping, 9 kinds, light + dark, AA (P2-D3) | Yes: `src/lib/status.ts` (9 kinds, every raw status mapped), `Badge`, board, KDS, page chips; contrast tested | Owner to choose an attention colour for `unpaid` (currently neutral `pending`) |
| **Typography** (Geist/Inter; 32/24/18/15–16/13 px; bold tabular KPI numbers) | Tailwind default stack, mixed sizes | Segoe UI → Inter/Roboto → system-ui, no download; 14 px body, 12 px meta; bold order numbers/totals, `tabular-nums` (P2-D4/D5) | Yes: font stack in `tailwind.config.js`; page titles 18 px (`text-lg`) not 32 px, to fit the dense brief; money and times `tabular-nums` | n/a |
| **Density** (spacious: 24 px card padding, 16–24 px radius; POS exception) | Generous (`rounded-2xl`, `p-6/p-8`) | Compact: 12 px card padding, 10 px radius, 32–36 px controls (P2-D5); denser than RMS on purpose | Yes: `rounded-lg`, `p-3`, `py-1.5` controls, `text-sm` body | n/a |
| **Dashboard** (KPI tiles with tinted icon chips; state count cards) | KPI cards, orange | Token colours, bold numbers | Yes: KPI tiles with soft status-tinted icon chips, bold numbers, cards on `surface` | Bento layout, charts (later; no new chart library) |
| **Login** (`login.png`, not opened) | Card on canvas | Themed | Themed card; screenshots light/dark | n/a |
| **Print** (not found in the reference) | Receipt print CSS | Paper always black on white (P2-D9) | Yes: `@media print` resets `html/body` and `#print-root *`; E2E P-01..P-03 with a real receipt in dark mode | n/a |
| **Motion** (fade/slide/spring) | Tailwind `transition` on hovers | Not required | Unchanged | Later, if wanted |
| **Command palette / search in top bar** | None | Non-goal (spec) | n/a | Later |

## Where Phase 2 deliberately differs from RMS

* **Denser.** The owner asked for "compact, dense but readable, minimal whitespace". RMS is spacious (24 px
  padding, 16–24 px radius, 32 px titles). Phase 2 uses 12 px padding, 10 px radius and 18 px titles.
* **Muted text is darker in light mode** (`#646B79`, not RMS `#6B7280`). This lifts muted text on `surface-2`
  to AA (4.92:1).
* **Status hues are set by our D9 board meaning**, not RMS: occupied is blue (running) and reserved is violet
  (kitchen). This keeps wine for actions and amber for "ready".
* **Active navigation is a solid primary pill**, where RMS uses a tinted pill. This makes the current screen
  easier to spot at a glance.
* **Font**: Segoe UI first (it ships with Windows; the app is offline with CSP `font-src 'self' data:`). RMS uses
  Geist.
