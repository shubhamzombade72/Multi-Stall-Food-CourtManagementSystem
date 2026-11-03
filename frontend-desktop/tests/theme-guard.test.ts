/**
 * Theme guard (P2-D8): screens must use the semantic colour tokens, never raw neutral palette classes or hex colours,
 * otherwise the dark theme leaves light "islands". Receipt.tsx is excluded: it is print-only and printed black on white (P2-D9).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));

/** Files that are print-only and therefore not themed. */
const EXCLUDED_FILES = new Set(['components/Receipt.tsx']);

/**
 * Exact classes allowed despite matching the neutral pattern.
 * - bg-black/50: modal scrim. A dark overlay reads as "dimmed" in both themes (a canvas-tinted overlay would brighten the dark theme).
 */
const ALLOWED_CLASSES = new Set(['bg-black/50']);

const NEUTRAL =
  /(?<![\w-])(?:[a-z0-9-]+:)*(?:bg|text|border(?:-[xytrbl])?|divide|ring(?:-offset)?|from|via|to|placeholder|outline|fill|stroke|shadow|accent|caret|decoration)-(?:white|black|slate|gray|zinc|neutral|stone)(?:-\d{2,3})?(?:\/\d+)?(?![\w-])/g;
/** Arbitrary-value hex colours anywhere (bg-[#123456]) and any hex inside a className attribute. */
const ARBITRARY_HEX = /-\[#[0-9a-fA-F]{3,8}\]/g;
const CLASSNAME_ATTR = /className=(?:"[^"]*"|\{`[^`]*`\}|\{'[^']*'\}|\{"[^"]*"\})/g;
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

function violations(): string[] {
  const found: string[] = [];
  for (const file of tsxFiles(srcDir)) {
    const rel = relative(srcDir, file).split(sep).join('/');
    if (EXCLUDED_FILES.has(rel)) continue;
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const hits = [
        ...[...line.matchAll(NEUTRAL)].map((m) => m[0]).filter((c) => !ALLOWED_CLASSES.has(c.replace(/^(?:[a-z0-9-]+:)+/, ''))),
        ...[...line.matchAll(ARBITRARY_HEX)].map((m) => m[0]),
        ...[...line.matchAll(CLASSNAME_ATTR)].flatMap((m) => [...m[0].matchAll(HEX)].map((h) => h[0])),
      ];
      for (const h of hits) found.push(`${rel}:${i + 1}  ${h}`);
    });
  }
  return found;
}

test('no raw neutral palette classes or hex colours in src/**/*.tsx (use semantic tokens)', () => {
  const v = violations();
  assert.equal(v.length, 0, `${v.length} raw colour class(es) found:\n${v.slice(0, 60).join('\n')}${v.length > 60 ? '\n…' : ''}`);
});

/** Accent palette classes: colour meaning lives in the semantic tokens (success/warning/danger/info, st-*), never raw hues. */
const ACCENT =
  /(?<![\w-])(?:[a-z0-9-]+:)*(?:bg|text|border(?:-[xytrbl])?|divide|ring(?:-offset)?|from|via|to|placeholder|outline|fill|stroke|shadow|accent|caret|decoration)-(?:brand|red|rose|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink)-\d{2,3}(?:\/\d+)?(?![\w-])/g;

test('no raw accent palette classes in src/**/*.tsx (use success/warning/danger/info or status tokens)', () => {
  const found: string[] = [];
  for (const file of tsxFiles(srcDir)) {
    const rel = relative(srcDir, file).split(sep).join('/');
    if (EXCLUDED_FILES.has(rel)) continue;
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      for (const m of line.matchAll(ACCENT)) found.push(`${rel}:${i + 1}  ${m[0]}`);
    });
  }
  assert.equal(found.length, 0, `${found.length} raw accent class(es) found:\n${found.slice(0, 60).join('\n')}`);
});

test('the guard itself catches what it should and allows the modal scrim', () => {
  const sample = 'className="bg-white hover:bg-slate-50 text-gray-700 border-zinc-200/60 divide-stone-100 ring-neutral-300 bg-black/50 bg-[#fff]"';
  const neutral = [...sample.matchAll(NEUTRAL)].map((m) => m[0]).filter((c) => !ALLOWED_CLASSES.has(c));
  assert.deepEqual(neutral, ['bg-white', 'hover:bg-slate-50', 'text-gray-700', 'border-zinc-200/60', 'divide-stone-100', 'ring-neutral-300']);
  assert.equal([...sample.matchAll(ARBITRARY_HEX)].length, 1);
  assert.equal([...'className="text-fg bg-surface border-line"'.matchAll(NEUTRAL)].length, 0);
});

/**
 * text-subtle (about 2.5:1 light) is for decoration only: allowed on a line that renders a lucide icon component with a
 * className (<Search className="… text-subtle" />) or as placeholder:text-subtle. Essential text uses text-muted (≥ 4.5:1).
 */
const ICON_LINE = /<[A-Z][A-Za-z]+ [^>]*className/;
const SUBTLE = /(?<![\w:-])(?:[a-z0-9-]+:)*text-subtle(?![\w/-])/g;

test('text-subtle only on decorative icons and placeholders', () => {
  const found: string[] = [];
  for (const file of tsxFiles(srcDir)) {
    const rel = relative(srcDir, file).split(sep).join('/');
    if (EXCLUDED_FILES.has(rel)) continue;
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (ICON_LINE.test(line)) return;
      for (const m of line.matchAll(SUBTLE)) if (!m[0].startsWith('placeholder:')) found.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
    });
  }
  assert.equal(found.length, 0, `${found.length} text-subtle use(s) on non-decorative content (use text-muted):\n${found.join('\n')}`);
});

/**
 * bg-fg (an "inverted" near-black fill in light) turns into a near-white island in the dark theme. Selected tabs and
 * strong actions use bg-primary text-primary-fg; neutral labels use bg-surface-2. Found by the dark screenshots (Task 4).
 */
const INVERTED = /(?<![\w-])(?:[a-z0-9-]+:)*bg-fg(?:\/\d+)?(?![\w-])/g;

test('no inverted bg-fg fills in src/**/*.tsx (light island in dark mode)', () => {
  const found: string[] = [];
  for (const file of tsxFiles(srcDir)) {
    const rel = relative(srcDir, file).split(sep).join('/');
    if (EXCLUDED_FILES.has(rel)) continue;
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      for (const m of line.matchAll(INVERTED)) found.push(`${rel}:${i + 1}  ${m[0]}`);
    });
  }
  assert.equal(found.length, 0, `${found.length} inverted bg-fg fill(s) (use bg-primary or bg-surface-2):\n${found.join('\n')}`);
  assert.equal([...'className="hover:bg-fg bg-fg/80 bg-fg-x text-fg"'.matchAll(INVERTED)].length, 2);
});

/**
 * A full-window overlay inside a `space-y-*` parent picks up margin-top from the spacing utility, so the scrim
 * starts 16 px below the top of the window (found by the Task 4 E2E on the Orders detail modal). Every
 * `fixed inset-0` overlay carries `!m-0`.
 */
test('every fixed inset-0 overlay resets its margin (!m-0)', () => {
  const found: string[] = [];
  for (const file of tsxFiles(srcDir)) {
    const rel = relative(srcDir, file).split(sep).join('/');
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (/(?<![\w-])fixed inset-0(?![\w-])/.test(line) && !/!m-0(?![\w-])/.test(line)) found.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
    });
  }
  assert.equal(found.length, 0, `${found.length} overlay(s) without !m-0:\n${found.join('\n')}`);
});

/**
 * Semantic tints (bg-danger/10 …) are only allowed with a text colour when that exact pair is in tests/tint-pairs.ts,
 * which tests/theme.test.ts contrast-checks (>= 4.5:1 over canvas/surface/surface-2 in both themes). Found by the
 * final review: bg-success/15 + text-success-fg was 4.41:1.
 */
const TINT = /(?<![\w-])(?:[a-z0-9-]+:)*bg-(success|warning|danger|info)\/(\d+)(?![\w-])/g;
const TEXT_TOKEN = /(?<![\w-])(?:[a-z0-9-]+:)*text-(fg|muted|primary|primary-fg|success-fg|warning-fg|danger-fg|info-fg)(?![\w/-])/g;
export function tintPairs(line: string): string[] {
  const tints = [...line.matchAll(TINT)].map((m) => `${m[1]}/${m[2]}`);
  const texts = [...line.matchAll(TEXT_TOKEN)].map((m) => m[1]);
  return tints.flatMap((t) => texts.map((x) => `${t}:${x}`));
}

test('semantic tint + text pairs in src are all contrast-tested (tests/tint-pairs.ts)', async () => {
  const { TESTED_TINTS } = await import('./tint-pairs.ts');
  const allowed = new Set(TESTED_TINTS.map(([t, a, x]) => `${t}/${a}:${x}`));
  const found: string[] = [];
  for (const file of tsxFiles(srcDir)) {
    const rel = relative(srcDir, file).split(sep).join('/');
    if (EXCLUDED_FILES.has(rel)) continue;
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      for (const p of tintPairs(line)) if (!allowed.has(p)) found.push(`${rel}:${i + 1}  ${p}`);
    });
  }
  assert.equal(found.length, 0, `${found.length} untested tint/text pair(s) (use an st-* soft/fg pair or add + test it):\n${found.join('\n')}`);
  assert.deepEqual(tintPairs('className="bg-success/15 hover:bg-success/25 text-success-fg"'), ['success/15:success-fg', 'success/25:success-fg']);
});

/**
 * Compact tables (P2 design: dense list screens). Table cells use py-1.5/py-2 and px-2/px-3; roomy py-3+/px-4+ cells
 * are not allowed on <td>/<th> (a colSpan empty-state row may keep its vertical padding). Found by the final review:
 * Orders, Customers, Staff and Payments still had py-3 px-4 cells.
 */
const ROOMY_CELL = /(?<![\w-])(?:py-(?:3|4|5|6)|px-(?:4|5|6)|p-(?:3|4|5|6))(?![\w.-])/;
test('table cells are compact (no py-3+/px-4+ on <td>/<th>)', () => {
  const found: string[] = [];
  for (const file of tsxFiles(srcDir)) {
    const rel = relative(srcDir, file).split(sep).join('/');
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (!/<t[dh][\s>]/.test(line) || /colSpan/.test(line)) return;
      const cls = line.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/);
      if (cls && ROOMY_CELL.test(cls[1] ?? cls[2])) found.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
    });
  }
  assert.equal(found.length, 0, `${found.length} roomy table cell(s) (use py-1.5 px-3):\n${found.slice(0, 80).join('\n')}`);
  assert.ok(ROOMY_CELL.test('py-3 px-4') && !ROOMY_CELL.test('py-1.5 px-3') && !ROOMY_CELL.test('py-2 px-2'));
});
