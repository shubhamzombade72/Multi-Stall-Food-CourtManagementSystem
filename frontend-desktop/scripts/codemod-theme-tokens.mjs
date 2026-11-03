#!/usr/bin/env node
/**
 * codemod-theme-tokens.mjs — P2-D8: rewrite raw Tailwind palette classes in src/**\/*.tsx to the semantic theme tokens.
 *
 *   node scripts/codemod-theme-tokens.mjs            dry run: per-file replacement counts + classes left for hand conversion
 *   node scripts/codemod-theme-tokens.mjs --write    apply the rewrite
 *   --no-compact                                     colours only (skip the density pass)
 *
 * Deterministic: every rule is an exact class -> class mapping (variant prefixes such as hover:/focus:/group-hover: are
 * preserved, and a prefixed key wins over the bare one). Anything not in the table is reported and converted by hand
 * (dark app-chrome slates, text-white on non-primary fills, status chips -> statusClasses(statusKind(x))).
 * Scope: src/pages/**, src/App.tsx and other non-component files. src/components/ was converted by hand (Task 2) and
 * components/Receipt.tsx is never touched (print-only, black on white, P2-D9).
 *
 * MAPPING TABLE (colours)
 *   Neutrals
 *     bg-white                         -> bg-surface
 *     bg-slate-50 / bg-gray-50         -> bg-canvas
 *     hover:bg-slate-50(/80) / -100    -> hover:bg-surface-2
 *     bg-slate-100                     -> bg-surface-2
 *     bg-slate-200 / hover:bg-slate-200-> bg-line / hover:bg-line
 *     text-slate-950/900/800/700       -> text-fg            (gray-* likewise)
 *     text-slate-600/500               -> text-muted
 *     text-slate-400/300               -> text-subtle
 *     border-slate-100/200/300(/n)     -> border-line
 *     divide-slate-100/200             -> divide-line
 *     hover:text-slate-900 / -600      -> hover:text-fg / hover:text-muted
 *   Brand (legacy orange) -> primary (wine)
 *     bg-brand-500/600                 -> bg-primary
 *     hover:bg-brand-600/700           -> hover:bg-primary/90
 *     text-brand-400..700              -> text-primary        hover:text-brand-700 -> hover:text-primary/80
 *     bg-brand-50 / -100               -> bg-primary/10 / bg-primary/15
 *     border-brand-500                 -> border-primary      hover:border-brand-300/400/500 -> /40, /60, primary
 *     (focus:)ring-brand-500           -> ring-focus
 *     shadow-brand-500/n               -> shadow-primary/n
 *   Semantic accents
 *     rose|red   text-600/700/800 -> text-danger-fg   bg-50 -> bg-danger/10   bg-100 -> bg-danger/15   border-200/300 -> border-danger/30
 *                bg-500/600 -> bg-danger           ring-500 -> ring-danger
 *     emerald|green text-500..900 -> text-success-fg  bg-50 -> bg-success/10  bg-100 -> bg-success/15  border-200/300 -> border-success/40
 *                bg-500/600 -> bg-success-fg (solid, AA with text-surface)  hover:bg-700 -> hover:opacity-90  border-400 -> border-success
 *     amber|yellow text-600/700/800 -> text-warning-fg bg-50 -> bg-warning/10 bg-100 -> bg-warning/15  border-100..300 -> border-warning/40
 *                bg-500 -> bg-warning   border-400 -> border-warning   ring-500 -> ring-warning
 *     sky|blue   text-600/700 -> text-info-fg  bg-50 -> bg-info/10  bg-100 -> bg-info/15  border-400 -> border-info
 *     purple     text-600 -> text-st-kitchen-fg   bg-50 -> bg-st-kitchen-soft      indigo text-600 -> text-info-fg
 *   Contextual (same string literal)
 *     text-white next to bg-primary            -> text-primary-fg
 *     group-hover:text-white next to group-hover:bg-primary -> group-hover:text-primary-fg
 *     text-white next to bg-success-fg / bg-danger-fg       -> text-surface
 *
 * MAPPING TABLE (compact density, P2-D5)
 *     p-8 / p-6 -> p-4     px-8 -> px-4     space-y-6 / space-y-8 -> space-y-4     gap-6 / gap-8 -> gap-4
 *     rounded-xl / rounded-2xl / rounded-3xl -> rounded-lg     mb-8 / mb-6 -> mb-4
 *     page title "text-2xl font-bold text-slate-900 tracking-tight" -> "text-lg font-semibold text-fg tracking-tight"
 *     text-2xl -> text-xl (not in KitchenPage: the KDS keeps its large type, read from 2-3 m)
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
const WRITE = args.has('--write');
const COMPACT = !args.has('--no-compact');

const root = fileURLToPath(new URL('../', import.meta.url));
const srcDir = join(root, 'src');
const EXCLUDED = new Set(['components/Receipt.tsx']);
const KEEP_LARGE_TYPE = new Set(['pages/KitchenPage.tsx']);
const ALLOWED = new Set(['bg-black/50']);

const COLOR = {
  // neutrals
  'bg-white': 'bg-surface',
  'bg-slate-50': 'bg-canvas',
  'bg-gray-50': 'bg-canvas',
  'hover:bg-slate-50': 'hover:bg-surface-2',
  'hover:bg-slate-50/80': 'hover:bg-surface-2',
  'hover:bg-gray-50': 'hover:bg-surface-2',
  'hover:bg-slate-100': 'hover:bg-surface-2',
  'bg-slate-100': 'bg-surface-2',
  'bg-gray-100': 'bg-surface-2',
  'bg-slate-200': 'bg-line',
  'text-slate-950': 'text-fg',
  'text-slate-900': 'text-fg',
  'text-slate-800': 'text-fg',
  'text-slate-700': 'text-fg',
  'text-gray-900': 'text-fg',
  'text-gray-800': 'text-fg',
  'text-gray-700': 'text-fg',
  'text-slate-600': 'text-muted',
  'text-slate-500': 'text-muted',
  'text-gray-600': 'text-muted',
  'text-gray-500': 'text-muted',
  'text-slate-400': 'text-subtle',
  'text-slate-300': 'text-subtle',
  'text-gray-400': 'text-subtle',
  'border-slate-100': 'border-line',
  'border-slate-200': 'border-line',
  'border-slate-300': 'border-line',
  'border-slate-200/60': 'border-line',
  'border-slate-200/80': 'border-line',
  'border-slate-200/90': 'border-line',
  'border-gray-200': 'border-line',
  'divide-slate-100': 'divide-line',
  'divide-slate-200': 'divide-line',
  // brand -> primary
  'bg-brand-500': 'bg-primary',
  'bg-brand-600': 'bg-primary',
  'hover:bg-brand-600': 'hover:bg-primary/90',
  'hover:bg-brand-700': 'hover:bg-primary/90',
  'text-brand-400': 'text-primary',
  'text-brand-500': 'text-primary',
  'text-brand-600': 'text-primary',
  'text-brand-700': 'text-primary',
  'hover:text-brand-700': 'hover:text-primary/80',
  'bg-brand-50': 'bg-primary/10',
  'bg-brand-100': 'bg-primary/15',
  'border-brand-500': 'border-primary',
  'hover:border-brand-300': 'hover:border-primary/40',
  'hover:border-brand-400': 'hover:border-primary/60',
  'hover:border-brand-500': 'hover:border-primary',
  'ring-brand-500': 'ring-focus',
  'shadow-brand-500/20': 'shadow-primary/20',
  'shadow-brand-500/25': 'shadow-primary/25',
  // danger
  'text-rose-600': 'text-danger-fg',
  'text-rose-700': 'text-danger-fg',
  'text-rose-800': 'text-danger-fg',
  'text-red-600': 'text-danger-fg',
  'text-red-700': 'text-danger-fg',
  'bg-rose-50': 'bg-danger/10',
  'bg-red-50': 'bg-danger/10',
  'bg-rose-100': 'bg-danger/15',
  'border-rose-200': 'border-danger/30',
  'border-rose-300': 'border-danger/30',
  'border-red-200': 'border-danger/30',
  'bg-rose-500': 'bg-danger',
  'bg-rose-600': 'bg-danger',
  'ring-rose-500': 'ring-danger',
  // success
  'text-emerald-500': 'text-success-fg',
  'text-emerald-600': 'text-success-fg',
  'text-emerald-700': 'text-success-fg',
  'text-emerald-800': 'text-success-fg',
  'text-emerald-900': 'text-success-fg',
  'text-green-600': 'text-success-fg',
  'text-green-700': 'text-success-fg',
  'bg-emerald-50': 'bg-success/10',
  'bg-emerald-100': 'bg-success/15',
  'hover:bg-emerald-200': 'hover:bg-success/25',
  'border-emerald-200': 'border-success/40',
  'border-emerald-300': 'border-success/40',
  'border-emerald-400': 'border-success',
  'bg-emerald-500': 'bg-success-fg',
  'bg-emerald-600': 'bg-success-fg',
  'hover:bg-emerald-700': 'hover:opacity-90',
  'shadow-emerald-600/20': 'shadow-success/20',
  // warning
  'text-amber-600': 'text-warning-fg',
  'text-amber-700': 'text-warning-fg',
  'text-amber-800': 'text-warning-fg',
  'bg-amber-50': 'bg-warning/10',
  'bg-amber-100': 'bg-warning/15',
  'border-amber-100': 'border-warning/40',
  'border-amber-200': 'border-warning/40',
  'border-amber-300': 'border-warning/40',
  'border-amber-400': 'border-warning',
  'bg-amber-500': 'bg-warning',
  'hover:bg-amber-400': 'hover:opacity-90',
  'ring-amber-500': 'ring-warning',
  'shadow-amber-500/20': 'shadow-warning/20',
  // info / kitchen
  'text-blue-600': 'text-info-fg',
  'text-blue-700': 'text-info-fg',
  'text-sky-700': 'text-info-fg',
  'text-indigo-600': 'text-info-fg',
  'bg-blue-50': 'bg-info/10',
  'bg-blue-100': 'bg-info/15',
  'border-sky-400': 'border-info',
  'text-purple-600': 'text-st-kitchen-fg',
  'bg-purple-50': 'bg-st-kitchen-soft',
};

const COMPACT_MAP = {
  'p-8': 'p-4',
  'p-6': 'p-4',
  'px-8': 'px-4',
  'space-y-6': 'space-y-4',
  'space-y-8': 'space-y-4',
  'gap-6': 'gap-4',
  'gap-8': 'gap-4',
  'rounded-xl': 'rounded-lg',
  'rounded-2xl': 'rounded-lg',
  'rounded-3xl': 'rounded-lg',
  'mb-8': 'mb-4',
  'mb-6': 'mb-4',
  'text-2xl': 'text-xl',
};

const PHRASES = [['text-2xl font-bold text-slate-900 tracking-tight', 'text-lg font-semibold text-fg tracking-tight']];

const TOKEN = /(?<![\w\-/[.])((?:[a-z0-9-]+:)*)(-?[a-z][a-z0-9-]*(?:\/\d+)?)(?![\w\-/])/g;
const RAW_LEFT =
  /(?<![\w-])(?:[a-z0-9-]+:)*(?:bg|text|border(?:-[xytrbl])?|divide|ring|from|via|to|placeholder|shadow)-(?:white|black|slate|gray|zinc|neutral|stone|brand|red|rose|emerald|green|amber|yellow|sky|blue|indigo|violet|purple|orange|teal|cyan|lime|pink|fuchsia)(?:-\d{2,3})?(?:\/\d+)?(?![\w-])/g;

function lookup(map, prefix, cls) {
  if (map[prefix + cls]) return map[prefix + cls];
  // a bare rule applies under any variant prefix, unless a prefixed rule exists for the same class
  const bare = map[cls];
  return bare ? prefix + bare : null;
}

function transform(text, rel) {
  let count = 0;
  const compact = COMPACT;
  if (compact) {
    for (const [from, to] of PHRASES) {
      const parts = text.split(from);
      count += parts.length - 1;
      text = parts.join(to);
    }
  }
  text = text.replace(TOKEN, (whole, prefix, cls) => {
    let to = lookup(COLOR, prefix, cls);
    if (!to && compact && !(KEEP_LARGE_TYPE.has(rel) && cls === 'text-2xl')) to = lookup(COMPACT_MAP, prefix, cls);
    if (!to || to === whole) return whole;
    count++;
    return to;
  });
  // contextual text-white, per string literal
  text = text.replace(/(["'`])((?:(?!\1)[^\n])*)\1/g, (lit, q, body) => {
    const has = (c) => new RegExp(`(?<![\\w:-])${c.replace('/', '\\/')}(?![\\w/-])`).test(body);
    let b = body;
    if (has('group-hover:bg-primary')) b = b.replace(/group-hover:text-white(?![\w-])/g, () => (count++, 'group-hover:text-primary-fg'));
    if (has('bg-primary')) b = b.replace(/(?<![\w:-])text-white(?![\w/-])/g, () => (count++, 'text-primary-fg'));
    else if (has('bg-success-fg') || has('bg-danger-fg')) b = b.replace(/(?<![\w:-])text-white(?![\w/-])/g, () => (count++, 'text-surface'));
    return q + b + q;
  });
  return { text, count };
}

function tsxFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

let total = 0;
let totalLeft = 0;
for (const file of tsxFiles(srcDir).sort()) {
  const rel = relative(srcDir, file).split(sep).join('/');
  // components/ were converted by hand in Task 2 (and Receipt.tsx is print-only): never rewritten here
  if (EXCLUDED.has(rel) || rel.startsWith('components/')) continue;
  const before = readFileSync(file, 'utf8');
  const { text, count } = transform(before, rel);
  const leftAll = (text.match(RAW_LEFT) ?? []).filter((c) => !ALLOWED.has(c)); // the modal scrim is allowed (see tests/theme-guard.test.ts)
  const left = [...new Set(leftAll)];
  total += count;
  totalLeft += leftAll.length;
  if (count || left.length) {
    console.log(`${String(count).padStart(4)}  ${rel}${left.length ? `   [hand: ${left.join(' ')}]` : ''}`);
  }
  if (WRITE && text !== before) writeFileSync(file, text);
}
console.log(`\n${WRITE ? 'Rewrote' : 'Would rewrite'} ${total} class(es); ${totalLeft} raw palette class occurrence(s) left for hand conversion.`);
