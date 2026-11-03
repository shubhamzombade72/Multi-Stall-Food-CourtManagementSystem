/**
 * Theme: resolution rule, DOM application, the pre-paint init script and WCAG contrast of the declared text tokens.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { applyTheme, readStoredTheme, resolveTheme, storeTheme, THEME_KEY } from '../src/lib/theme.ts';

const here = new URL('.', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, here), 'utf8');

test('storage key is fc_theme', () => {
  assert.equal(THEME_KEY, 'fc_theme');
});

test('resolveTheme: stored wins, otherwise the OS preference', () => {
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme(null, true), 'dark');
  assert.equal(resolveTheme(null, false), 'light');
});

test('readStoredTheme accepts only light/dark and survives broken storage', () => {
  assert.equal(readStoredTheme({ getItem: () => 'dark' }), 'dark');
  assert.equal(readStoredTheme({ getItem: () => 'light' }), 'light');
  assert.equal(readStoredTheme({ getItem: () => 'purple' }), null);
  assert.equal(readStoredTheme({ getItem: () => null }), null);
  assert.equal(readStoredTheme(null), null);
  assert.equal(readStoredTheme({ getItem: () => { throw new Error('denied'); } }), null);
});

test('storeTheme writes the key and never throws', () => {
  const written: Record<string, string> = {};
  storeTheme({ setItem: (k: string, v: string) => { written[k] = v; } }, 'dark');
  assert.deepEqual(written, { fc_theme: 'dark' });
  assert.doesNotThrow(() => storeTheme({ setItem: () => { throw new Error('full'); } }, 'light'));
  assert.doesNotThrow(() => storeTheme(null, 'light'));
});

test('applyTheme sets data-theme and color-scheme', () => {
  const attrs: Record<string, string> = {};
  const root = { setAttribute: (k: string, v: string) => { attrs[k] = v; }, style: { colorScheme: '' } };
  applyTheme(root, 'dark');
  assert.equal(attrs['data-theme'], 'dark');
  assert.equal(root.style.colorScheme, 'dark');
  applyTheme(root, 'light');
  assert.equal(attrs['data-theme'], 'light');
  assert.equal(root.style.colorScheme, 'light');
});

// ---- theme-init.js (classic script, runs before first paint) ----
const initSrc = read('../public/theme-init.js');
function runInit(opts: { stored?: string | null; prefersDark?: boolean; throws?: boolean; noMatchMedia?: boolean }) {
  const attrs: Record<string, string> = {};
  const root = { setAttribute: (k: string, v: string) => { attrs[k] = v; }, style: { colorScheme: '' } };
  const sandbox: Record<string, unknown> = {
    document: { documentElement: root },
    localStorage: {
      getItem: () => {
        if (opts.throws) throw new Error('blocked');
        return opts.stored ?? null;
      },
    },
  };
  if (!opts.noMatchMedia) sandbox.matchMedia = () => ({ matches: !!opts.prefersDark });
  sandbox.window = sandbox;
  vm.runInNewContext(initSrc, sandbox);
  return { attrs, root };
}

test('theme-init.js: stored dark wins over light OS', () => {
  const r = runInit({ stored: 'dark', prefersDark: false });
  assert.equal(r.attrs['data-theme'], 'dark');
  assert.equal(r.root.style.colorScheme, 'dark');
});
test('theme-init.js: stored light wins over dark OS', () => {
  const r = runInit({ stored: 'light', prefersDark: true });
  assert.equal(r.attrs['data-theme'], 'light');
  assert.equal(r.root.style.colorScheme, 'light');
});
test('theme-init.js: nothing stored follows the OS', () => {
  assert.equal(runInit({ prefersDark: true }).attrs['data-theme'], 'dark');
  assert.equal(runInit({ prefersDark: false }).attrs['data-theme'], 'light');
});
test('theme-init.js: throwing storage falls back to the OS and never throws', () => {
  assert.equal(runInit({ throws: true, prefersDark: true }).attrs['data-theme'], 'dark');
  assert.equal(runInit({ throws: true, prefersDark: false }).attrs['data-theme'], 'light');
});
test('theme-init.js: no matchMedia and no storage still does not throw', () => {
  assert.doesNotThrow(() => runInit({ throws: true, noMatchMedia: true }));
});

// ---- tokens & contrast ----
type RGB = [number, number, number];
function parseBlock(css: string, selector: RegExp): Record<string, RGB> {
  const m = css.match(selector);
  assert.ok(m, `token block ${selector} not found in index.css`);
  const out: Record<string, RGB> = {};
  for (const t of m[1].matchAll(/--c-([a-z0-9-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) {
    out[t[1]] = [Number(t[2]), Number(t[3]), Number(t[4])];
  }
  return out;
}
const css = read('../src/index.css');
const light = parseBlock(css, /:root\s*\{([^}]*)\}/);
const dark = parseBlock(css, /:root\[data-theme="dark"\]\s*\{([^}]*)\}/);

function lum([r, g, b]: RGB) {
  const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a: RGB, b: RGB) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const REQUIRED = ['canvas', 'surface', 'surface-2', 'sidebar', 'fg', 'muted', 'subtle', 'line', 'primary', 'primary-fg',
  'success', 'warning', 'danger', 'info', 'focus', 'success-fg', 'warning-fg', 'danger-fg', 'info-fg'];
for (const [name, set] of [['light', light], ['dark', dark]] as const) {
  test(`${name} theme declares every token`, () => {
    for (const t of REQUIRED) assert.ok(set[t], `--c-${t} missing in ${name}`);
  });
}

const TEXT_PAIRS: Array<[string, string]> = [
  ['fg', 'canvas'], ['fg', 'surface'], ['fg', 'surface-2'], ['muted', 'surface'], ['muted', 'canvas'], ['muted', 'surface-2'],
  ['primary', 'surface'], ['primary-fg', 'primary'],
  ['danger-fg', 'surface'], ['success-fg', 'surface'], ['warning-fg', 'surface'], ['info-fg', 'surface'],
];
const report: string[] = [];
for (const [name, set] of [['light', light], ['dark', dark]] as const) {
  for (const [fg, bg] of TEXT_PAIRS) {
    test(`${name}: ${fg} on ${bg} >= 4.5:1`, () => {
      const r = ratio(set[fg], set[bg]);
      report.push(`${name} ${fg}/${bg} = ${r.toFixed(2)}`);
      assert.ok(r >= 4.5, `${name} ${fg}/${bg} is ${r.toFixed(2)}`);
    });
  }
  test(`${name}: focus ring and primary fill >= 3:1 against surface`, () => {
    for (const t of ['focus', 'primary', 'danger', 'info']) {
      const r = ratio(set[t], set.surface);
      report.push(`${name} ${t}/surface (non-text) = ${r.toFixed(2)}`);
      assert.ok(r >= 3, `${name} ${t}/surface is ${r.toFixed(2)}`);
    }
  });
}
// ---- status kinds ----
const KINDS = ['pending', 'running', 'cooking', 'ready', 'served', 'settled', 'kitchen', 'void', 'cancelled'];
for (const [name, set] of [['light', light], ['dark', dark]] as const) {
  test(name + ' theme declares every status token', () => {
    for (const k of KINDS) for (const suffix of ['', '-soft', '-fg']) assert.ok(set['st-' + k + suffix], '--c-st-' + k + suffix + ' missing in ' + name);
  });
  for (const k of KINDS) {
    test(name + ': status ' + k + ' contrast', () => {
      const solid = set['st-' + k], soft = set['st-' + k + '-soft'], fg = set['st-' + k + '-fg'];
      const a = ratio(fg, soft), b = ratio(fg, set.surface), c = ratio(solid, set.surface);
      report.push(name + ' st-' + k + ': fg/soft=' + a.toFixed(2) + ' fg/surface=' + b.toFixed(2) + ' solid/surface=' + c.toFixed(2));
      assert.ok(a >= 4.5, name + ' ' + k + ' fg/soft ' + a.toFixed(2));
      assert.ok(b >= 4.5, name + ' ' + k + ' fg/surface ' + b.toFixed(2));
      assert.ok(c >= 3, name + ' ' + k + ' solid/surface ' + c.toFixed(2));
    });
  }
}

// ---- print stays black on white regardless of theme (printBackground: true in electron/main.cjs) ----
function mediaPrintBlock(source: string): string {
  const start = source.indexOf('@media print');
  assert.ok(start >= 0, '@media print block missing');
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unterminated @media print block');
}
test('@media print resets html/body to white background and black text', () => {
  const block = mediaPrintBlock(css);
  const m = block.match(/html\s*,\s*body\s*\{([^}]*)\}/);
  assert.ok(m, 'no "html, body" rule inside @media print');
  assert.match(m[1], /background:\s*#fff(fff)?\s*!important/);
  assert.match(m[1], /color:\s*#000(000)?\s*!important/);
  assert.match(m[1], /color-scheme:\s*light/);
});
test('@media print forces #print-root contents to black on transparent regardless of theme', () => {
  const block = mediaPrintBlock(css);
  const m = [...block.matchAll(/#print-root\s+\*\s*\{([^}]*)\}/g)].find((x) => /border-color/.test(x[1]));
  assert.ok(m, 'no "#print-root *" colour reset rule inside @media print');
  assert.match(m[1], /color:\s*#000(000)?\s*!important/);
  assert.match(m[1], /background:\s*transparent\s*!important/);
  assert.match(m[1], /border-color:\s*#000(000)?\s*!important/);
});

// ---- cancelled must not look like cooking (final review I1) ----
// Rule: cancelled is a neutral grey family (CIE Lab chroma C*ab <= 6 for soft, solid and fg) while cooking is chromatic red,
// and the two are clearly apart in CIE76 colour difference: soft backgrounds dE >= 12, solids dE >= 30 (dE ~2.3 is a
// just-noticeable difference). Measured on the declared tokens in both themes.
function lab([r, g, b]: RGB): [number, number, number] {
  const f = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [f(r), f(g), f(b)];
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const t = (v: number) => (v > 216 / 24389 ? Math.cbrt(v) : (24389 / 27 * v + 16) / 116);
  return [116 * t(Y) - 16, 500 * (t(X) - t(Y)), 200 * (t(Y) - t(Z))];
}
const deltaE = (a: RGB, b: RGB) => { const [p, q] = [lab(a), lab(b)]; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
const chroma = (c: RGB) => { const [, a, b] = lab(c); return Math.hypot(a, b); };

for (const [name, set] of [['light', light], ['dark', dark]] as const) {
  test(name + ': cancelled is neutral grey and clearly apart from cooking (soft dE >= 12, solid dE >= 30)', () => {
    for (const s of ['', '-soft', '-fg']) assert.ok(chroma(set['st-cancelled' + s]) <= 6, `${name} st-cancelled${s} chroma ${chroma(set['st-cancelled' + s]).toFixed(1)} (must be neutral)`);
    const soft = deltaE(set['st-cancelled-soft'], set['st-cooking-soft']);
    const solid = deltaE(set['st-cancelled'], set['st-cooking']);
    report.push(`${name} cancelled vs cooking: soft dE=${soft.toFixed(1)} solid dE=${solid.toFixed(1)}`);
    assert.ok(soft >= 12, `${name} cancelled/cooking soft dE ${soft.toFixed(1)}`);
    assert.ok(solid >= 30, `${name} cancelled/cooking solid dE ${solid.toFixed(1)}`);
    // and still distinguishable from the lighter muted void grey
    assert.ok(deltaE(set['st-cancelled-soft'], set['st-void-soft']) >= 8, `${name} cancelled/void soft dE ${deltaE(set['st-cancelled-soft'], set['st-void-soft']).toFixed(1)}`);
  });
}

// ---- ad-hoc semantic tints (tests/tint-pairs.ts): tint alpha-blended over canvas/surface/surface-2, text >= 4.5:1 ----
import { TESTED_TINTS } from './tint-pairs.ts';
const blendOver = (top: RGB, alpha: number, under: RGB): RGB => [0, 1, 2].map((i) => top[i] * alpha + under[i] * (1 - alpha)) as RGB;
for (const [name, set] of [['light', light], ['dark', dark]] as const) {
  for (const [tint, alpha, text] of TESTED_TINTS) {
    test(`${name}: ${text} on bg-${tint}/${alpha} >= 4.5:1 over canvas, surface and surface-2`, () => {
      for (const under of ['canvas', 'surface', 'surface-2']) {
        const r = ratio(set[text], blendOver(set[tint], alpha / 100, set[under]));
        report.push(`${name} ${text} on ${tint}/${alpha} over ${under} = ${r.toFixed(2)}`);
        assert.ok(r >= 4.5, `${name} ${text} on ${tint}/${alpha} over ${under} is ${r.toFixed(2)}`);
      }
    });
  }
}

// ---- tabular figures app-wide (final review I2): money, quantities, times and timers line up in columns ----
test('body uses tabular-nums so every money / quantity / time figure is fixed-width', () => {
  const base = css.slice(css.indexOf('@layer base'));
  const m = base.match(/(?:^|\n)\s*body\s*\{([^}]*)\}/);
  assert.ok(m, 'no body rule in @layer base');
  assert.match(m[1], /font-variant-numeric:\s*tabular-nums/);
});

// Printed last so every ratio above (tokens, status kinds, cancelled vs cooking, tints) is in the report.
test('contrast report', () => { console.log(report.join('\n')); });
