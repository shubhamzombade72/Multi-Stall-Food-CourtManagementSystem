/**
 * Ad-hoc semantic tints (bg-success/10 …) that pages may combine with a text token on the same element/line.
 * Every pair listed here is contrast-tested in tests/theme.test.ts (tint alpha-blended over canvas, surface and
 * surface-2, both themes, >= 4.5:1). tests/theme-guard.test.ts fails on any tint + text pair in src that is not listed.
 * Anything not passing belongs on an st-* soft/fg pair instead (e.g. bg-st-served-soft text-st-served-fg).
 * Measured and rejected (light, over canvas): success/10 + success-fg 4.43, success/15 4.25, warning/10 + warning-fg 4.47.
 */
export type Tint = 'success' | 'warning' | 'danger' | 'info';
export const TESTED_TINTS: ReadonlyArray<readonly [Tint, number, string]> = [
  ['danger', 10, 'danger-fg'],
  ['info', 10, 'info-fg'],
  ['warning', 10, 'muted'],
];
