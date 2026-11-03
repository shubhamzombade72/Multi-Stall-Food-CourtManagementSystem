# Design System & Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One compact, RMS-inspired token-based design system with a persisted, flash-free Light/Dark toggle across every desktop screen.

**Architecture:** CSS variables (RGB channels) per theme on `<html data-theme>`, exposed as Tailwind colour names; a pure theme module + a pre-paint init script; shared components and `statusKind()` carry the semantics; a codemod converts the 1,350 hard-coded neutral classes and a guard test keeps them out.

**Tech Stack:** React 18.3, TypeScript 5.6, Tailwind 3.4 (`darkMode: ['selector', '[data-theme="dark"]']`), Vite 5.4, Electron 44.9, node:test, Playwright-core 1.64 (Electron E2E). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-03-design-system-theme-design.md` (P2-D1 … P2-D9).

## Global Constraints

- No git commits, branches, resets, pushes. Leave everything uncommitted.
- No new dependencies; no font downloads; CSP stays `script-src 'self'`.
- Token names exactly: `canvas surface surface-2 sidebar fg muted subtle line primary primary-fg success warning danger info focus`; status kinds exactly: `pending running cooking ready served settled kitchen void cancelled`.
- Theme storage key exactly `fc_theme`, values `light` | `dark`; absent → `prefers-color-scheme`.
- Text tokens ≥ 4.5:1 contrast on their background in both themes; large/status UI ≥ 3:1.
- Print (receipt / A4) unaffected by theme.
- Do not change behaviour, routes, API calls or test ids; this phase is visual. Existing E2E suites must still pass.

## Review Focus

1. **Dark theme leaves light islands** (a raw `bg-white` survives) → guard test (Task 3) + dark screenshots (Task 4).
2. **First paint in the wrong theme** after restart → Task 1 init-script test + Task 4 E2E check at `domcontentloaded`.
3. **Low-contrast text in dark mode** (e.g. muted on surface-2) → Task 1 contrast test over every declared text pair.
4. **Status colour meaning drifts between screens** → single `statusKind()` (Task 2) used by Badge, board, KDS.
5. **Receipt prints white-on-black in dark mode** → Task 4 print-CSS check.

---

### Task 1: Tokens, Tailwind mapping, theme module, pre-paint script, toggle

**Files:** Modify `frontend-desktop/src/index.css` (token blocks, body, focus ring), `frontend-desktop/tailwind.config.js` (colours → `rgb(var(--c-…) / <alpha-value>)`, `fontFamily.sans`, `darkMode`), `frontend-desktop/index.html` (head `<script src="./theme-init.js"></script>`, neutral loading div via tokens). Create `frontend-desktop/public/theme-init.js`, `frontend-desktop/src/lib/theme.ts`, `frontend-desktop/src/components/ThemeToggle.tsx`; modify `frontend-desktop/src/components/Navbar.tsx` (place toggle). Tests `frontend-desktop/tests/theme.test.ts`.

**Interfaces:** `type Theme = 'light'|'dark'`; `readStoredTheme(storage: Pick<Storage,'getItem'>|null): Theme|null` (try/catch); `resolveTheme(stored: Theme|null, prefersDark: boolean): Theme`; `applyTheme(root: {setAttribute, style}, theme)` sets `data-theme` and `style.colorScheme`; `storeTheme(storage, theme)`; hook `useTheme(): {theme, toggle}` (in ThemeToggle or `src/hooks/useTheme.ts`). `theme-init.js` implements the same rule without imports. Export `TOKENS` parse helper for the contrast test (test may parse `index.css`).

- [ ] Failing tests: resolve matrix (stored wins; none → prefersDark); broken storage → null; `applyTheme` sets both attributes; `theme-init.js` evaluated in a `vm` sandbox with fake `localStorage`/`matchMedia`/`document` sets `data-theme` correctly (stored dark, stored light, none+dark OS, storage throws); contrast: for every text pair (`fg/canvas`, `fg/surface`, `muted/surface`, `muted/canvas`, `primary/surface`, `primary-fg/primary`, `danger/surface`, status solid text on its soft bg) in both themes ratio ≥ 4.5 (status ≥ 3 for non-text indicator pairs listed separately).
- [ ] Implement. `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build` → pass. Leave uncommitted.

### Task 2: Status kinds and shared components (compact)

**Files:** Create `frontend-desktop/src/lib/status.ts`; modify `frontend-desktop/src/components/ui.tsx` (all helpers on tokens, compact sizes per P2-D5, `Badge` gains `kind` prop, `statusTone` kept as a thin wrapper over `statusKind` for existing callers), `Navbar.tsx`, `Sidebar.tsx` (208 px, tokens, active item = primary), `StartupScreen.tsx`, `ConnectionBanner.tsx`, `BackupNotice.tsx`, `NotificationBell.tsx`, `RecoveryKeyPanel.tsx`, `SuppliersPanel.tsx`, `components/tracking/OrderCard.tsx` + `ItemRow.tsx` (borders/chips from status kinds: cooking/ready/served). Test `frontend-desktop/tests/status.test.ts`.

**Interfaces:** `type StatusKind = 'pending'|'running'|'cooking'|'ready'|'served'|'settled'|'kitchen'|'void'|'cancelled'`; `statusKind(raw: string|null|undefined): StatusKind`; `statusClasses(kind): {solid: string; soft: string; text: string; border: string}` (Tailwind class strings using `st-*` tokens).

- [ ] Failing tests: every raw status in the repo maps (order: pending, confirmed, in_preparation, partially_ready, ready, served, completed, cancelled; ticket: pending, accepted, preparing, ready, picked_up, cancelled; item: pending, preparing, ready, served, cancelled; payment: success, failed, refunded; table: available, occupied, reserved; closing: closed; settlement: pending, paid) to the documented kind; unknown → `pending`; `statusClasses` returns token classes only.
- [ ] Implement; `pnpm test`, tsc, build, `node e2e/order-tracking.e2e.mjs` (test ids unchanged) → pass. Leave uncommitted.

### Task 3: Codemod + all pages + guard test

**Files:** Create `frontend-desktop/scripts/codemod-theme-tokens.mjs` (mapping table in the file header; dry-run prints a per-file count; `--write` applies), test `frontend-desktop/tests/theme-guard.test.ts`. Modify every remaining `src/pages/*.tsx`, `src/App.tsx`.

Mapping (minimum): `bg-white`→`bg-surface`; `bg-slate-50`/`bg-gray-50`→`bg-canvas`; `bg-slate-100`→`bg-surface-2`; `bg-slate-900`/`800` (app chrome, login backdrops)→`bg-sidebar`/`bg-canvas` as appropriate (hand-checked); `text-slate-900/800/700`→`text-fg`; `text-slate-600/500`→`text-muted`; `text-slate-400/300`→`text-subtle`; `border-slate-100/200/300`→`border-line`; `divide-slate-*`→`divide-line`; `hover:bg-slate-50/100`→`hover:bg-surface-2`; `brand-*`→`primary` family; `rose/red-*` semantic danger → `danger` tokens; `emerald/green-*` → `success`; `amber/yellow-*` → `warning`; `sky/blue-*` → `info`; status chips → `statusClasses(statusKind(…))`. Compact pass: `p-8`→`p-4`, `p-6`→`p-3`/`p-4`, `rounded-2xl`→`rounded-lg`, `py-2.5`→`py-1.5` on inputs, page wrappers `space-y-6`→`space-y-4`; **KitchenPage keeps its large ticket type**; POS item tiles keep ≥ 40 px height.

- [ ] Failing guard test: scans `src/**/*.tsx` (excluding `components/Receipt.tsx` and print-only blocks) and fails on any `(bg|text|border|divide|ring)-(white|black|slate|gray|zinc|neutral|stone)(-\d+)?` class or raw hex colour in `className`; currently fails with the count.
- [ ] Run codemod dry-run, then `--write`; hand-convert the rest page by page; guard → PASS.
- [ ] `pnpm test`, tsc, build; `node e2e/ui-first-run.e2e.mjs`, `node e2e/order-tracking.e2e.mjs` → pass. Leave uncommitted.

### Task 4: Visual verification, docs

**Files:** Create `frontend-desktop/e2e/theme.e2e.mjs`; `docs/design/rms-reference-analysis.md`; `docs/design/design-system.md`. Screenshots to `qa/desktop/results/theme/`.

- [ ] E2E (fresh profile, built-in server, owner via Welcome; seed a stall/menu/table/order via API like `e2e/order-tracking.e2e.mjs`): for light and dark, visit Dashboard, POS, Kitchen, Orders & Table Tracking (expanded card), Orders, Daily Closing, Reports, Food Court Settings, Device Settings, Login, Welcome; screenshot each; assert `<html data-theme>` matches; assert no element in the main content has computed background `rgb(255, 255, 255)` in dark mode (sampled over cards/panels); toggle via keyboard (Tab to the toggle, Enter) flips the theme; restart the app → theme persisted and correct at `domcontentloaded` (before React renders); print media: `emulateMedia({media:'print'})` on a receipt keeps `#print-root` text black.
- [ ] `docs/design/rms-reference-analysis.md`: what the RMS folder contains (screens, DESIGN_SYSTEM.md, Marathi guide), the comparison matrix (POS layout, table cards, order tracking, billing panel, KDS, typography, navigation, status colours, density) — existing vs required vs done in phase 2 vs later phase; licensing note (AGPL, reference only). `docs/design/design-system.md`: token table (light/dark values, contrast ratios measured by the test), status kinds, spacing scale, theme behaviour.
- [ ] Regression: `pnpm test`, tsc, build, all desktop E2E (ui-first-run, order-tracking, theme). Leave uncommitted.
