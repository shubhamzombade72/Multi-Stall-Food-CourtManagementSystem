# Phase 2 — Compact RMS-inspired design system and Light/Dark theme

Owner priority #2 (2026-11-03). Owner's words: compact, dense but readable, high contrast, fast scanning, minimal whitespace;
Inter / Roboto / Segoe UI; bold order numbers and totals; semantic statuses used everywhere; one-click Light/Dark toggle in the top
navigation, remembered, no flash, keyboard-operable, accessible contrast; semantic CSS variables; no duplicate components per theme.
RMS (`RMS/DESIGN_SYSTEM.md`, AGPL) is the **visual** reference only — no RMS code is copied.

## Findings (current state)

* Tailwind 3.4, one custom colour (`brand` = orange). No CSS variables, no dark mode, no theme switch.
* ~1,350 hard-coded colour classes in 35 files (`bg-white`, `text-slate-*`, `border-slate-*`, `bg-rose-50` …); PosPage alone 202.
* Status colours are ad hoc per page; `ui.tsx statusTone()` maps raw statuses to 6 badge tones; the tracking board uses its own red/amber/green.
* Spacing is generous (`rounded-2xl`, `p-6/p-8`, `py-2.5` inputs, 256 px sidebar).
* CSP is `script-src 'self'` (no inline scripts); fonts `'self' data:` only; the app runs offline.

## Decisions

| # | Decision | Why |
|---|---|---|
| P2-D1 | **Semantic tokens as CSS variables** (RGB channels, so Tailwind opacity works) on `:root` (light) and `:root[data-theme="dark"]`; Tailwind colour names map to them: `canvas`, `surface`, `surface-2`, `sidebar`, `fg`, `muted`, `subtle`, `line`, `primary`, `primary-fg`, `success`, `warning`, `danger`, `info`, `focus` | One component set, two themes; owner asked for semantic variables |
| P2-D2 | **Palette from RMS**: light canvas `#FAFAFA`, surface `#FFFFFF`, sidebar `#FCFCFC`, fg `#111827`, muted `#6B7280`, line `#E5E7EB`, success `#22C55E`, warning `#F59E0B`, danger `#EF4444`, **primary wine `#9F1239`**; dark canvas `#0B0B0D`, surface `#151517`, sidebar `#111113`, fg `#F4F4F5`, muted `#9CA3AF`, line `#26262A`, success `#34D399`, warning `#FBBF24`, danger `#F87171`, primary `#FB7185` (primary-fg `#1F0A0F`). Tokens used for **text** must reach WCAG AA (4.5:1) on their background; where an RMS swatch fails as text (e.g. light `success` on white) a darker text variant is defined | RMS is the owner's reference; AA is mandatory |
| P2-D3 | **Status tokens** `st-pending`, `st-running`, `st-cooking`, `st-ready`, `st-served`, `st-settled`, `st-kitchen`, `st-void`, `st-cancelled`, each with a solid colour and a soft background, light and dark. One function `statusKind(raw)` maps every existing raw status (order, ticket, item, payment, table, closing) to a kind; `Badge` and the tracking board use it. Board colours stay D9-consistent: cooking = red, ready = amber, served = green | Owner: same colours on table cards, boards, POS, KDS, settlement, history |
| P2-D4 | **Font**: Segoe UI (bundled with Windows) → Inter/Roboto if installed → system-ui; **no font download** (offline + CSP). `tabular-nums` for money and times | Owner allowed Segoe UI; no new dependency |
| P2-D5 | **Compact scale**: base 14 px body, 12 px metadata; card padding 12 px, radius 10 px (`rounded-lg`), inputs/buttons 32–36 px high, table rows ~32 px, sidebar 208 px; **KDS keeps larger type** (read at distance) and POS keeps ≥ 40 px touch targets for item tiles | Owner: dense; RMS exception for KDS/POS |
| P2-D6 | **Theme**: preference `light`/`dark` stored in `localStorage['fc_theme']`; nothing stored → follow Windows (`prefers-color-scheme`). One button in the top bar toggles; `aria-label` says the target theme; keyboard via native button | Owner: one-click, persisted |
| P2-D7 | **No flash**: a classic script `public/theme-init.js` loaded in `<head>` before CSS sets `data-theme` and `color-scheme` on `<html>` (allowed by `script-src 'self'`); the Electron window already stays hidden until `ready-to-show` | Theme correct on first paint |
| P2-D8 | **Conversion**: a deterministic codemod (`scripts/codemod-theme-tokens.mjs`) rewrites neutral classes to tokens; accents/status classes are converted by hand; a unit test fails if raw neutral colour classes reappear in `src/` (receipt/print CSS excepted) | 1,350 sites: mechanical work must be mechanical and checkable |
| P2-D9 | Print output (receipts, A4 reports) stays black on white regardless of theme | Paper |

## Non-goals (phase 2)

Navigation restructure and module removal (phase 4), new POS workflow features (phase 5), command palette, drag-and-drop KDS columns,
new chart library.
