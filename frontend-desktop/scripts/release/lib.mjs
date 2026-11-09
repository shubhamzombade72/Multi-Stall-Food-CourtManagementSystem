/**
 * Release builder internals: what is collected, what is forbidden, how migrations are judged. Pure enough to test;
 * the command-line wrappers are build-release.mjs, keygen.mjs, baseline.mjs and publish-release.mjs.
 */
import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

// ------------------------------------------------------------------ exclusions
/** Dropped silently: dev-only or temporary files that are not needed at runtime and not dangerous. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.github', '.vite', 'coverage', 'tests', 'test', '__tests__']);
const SKIP_FILE = [/\.map$/i, /\.log$/i, /\.tmp$/i, /\.bak$/i, /(^|\/)\.DS_Store$/, /(^|\/)Thumbs\.db$/i, /\.tsbuildinfo$/i, /(^|\/)\.phpunit\.result\.cache$/];

/**
 * Stops the build. These must never leave the developer's PC, so the build fails rather than quietly leaving one out:
 * a stray database or key in the tree means something is wrong and a person should look.
 */
const FORBIDDEN_NAME = [
  { re: /\.(sqlite3?|db|db3)(-journal|-wal|-shm)?$/i, why: 'database file' },
  { re: /(^|\/)\.env(\.(?!example$)[^/]+)?$/i, why: 'environment file' },
  { re: /\.(p12|pfx|jks|keystore|ppk)$/i, why: 'private key store' },
  { re: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i, why: 'SSH private key' },
  { re: /(^|\/)(update-signing|signing)[^/]*\.(pem|key)$/i, why: 'signing key' },
  { re: /(^|\/)(auth|credentials|secrets?)\.json$/i, why: 'credentials file' },
  { re: /(^|\/)app\.key$/i, why: 'application key' },
  { re: /(^|\/)(backups?|recovery)\//i, why: 'backup folder' },
  { re: /(^|\/)storage\/(logs|app|framework\/sessions)\/.+/i, why: 'runtime storage' },
];

const FORBIDDEN_CONTENT = [
  { re: /-----BEGIN (RSA |EC |OPENSSH |ENCRYPTED |DSA )?PRIVATE KEY-----/, why: 'private key' },
  { re: /^\s*APP_KEY=base64:[A-Za-z0-9+/=]{40,}/m, why: 'application key' },
  { re: /^\s*DB_PASSWORD=\S+/m, why: 'database password' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, why: 'AWS key' },
];
const CONTENT_SCAN_LIMIT = 8 * 1024 * 1024;
const BINARY_EXT = /\.(dll|exe|node|png|jpe?g|gif|webp|wav|mp3|ico|woff2?|ttf|eot|pdf|gz|zip)$/i;

export function classifyPath(relPath) {
  const parts = relPath.split('/');
  if (parts.slice(0, -1).some((d) => SKIP_DIRS.has(d))) return { action: 'skip' };
  if (SKIP_FILE.some((re) => re.test(relPath))) return { action: 'skip' };
  const hit = FORBIDDEN_NAME.find((f) => f.re.test(relPath));
  if (hit) return { action: 'forbid', why: hit.why };
  return { action: 'keep' };
}

export function scanContent(relPath, buffer) {
  if (BINARY_EXT.test(relPath) || buffer.length > CONTENT_SCAN_LIMIT) return null;
  const text = buffer.toString('latin1');
  const hit = FORBIDDEN_CONTENT.find((f) => f.re.test(text));
  return hit ? hit.why : null;
}

// ------------------------------------------------------------------ collecting a tree
export const sha256 = (b) => createHash('sha256').update(b).digest('hex');

function walk(dir, visit, base = dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit, base);
    else if (entry.isFile()) visit(full, relative(base, full).split(sep).join('/'));
  }
}

/**
 * `roots` maps a release prefix to a source: { 'app/dist': '<dir>', 'app/package.json': '<file>', ... }.
 * Returns { files: [{ path, source, sha256, size }], skipped: [], forbidden: [{ path, why }] }.
 */
export function collectTree(roots) {
  const files = [];
  const skipped = [];
  const forbidden = [];
  const consider = (full, rel) => {
    const verdict = classifyPath(rel);
    if (verdict.action === 'skip') return skipped.push(rel);
    if (verdict.action === 'forbid') return forbidden.push({ path: rel, why: verdict.why });
    const data = readFileSync(full);
    const secret = scanContent(rel, data);
    if (secret) return forbidden.push({ path: rel, why: `contains a ${secret}` });
    files.push({ path: rel, source: full, sha256: sha256(data), size: data.length });
    return undefined;
  };
  for (const [prefix, source] of Object.entries(roots)) {
    if (!existsSync(source)) throw new Error(`Build input is missing: ${source}. Run the build first.`);
    if (statSync(source).isDirectory()) walk(source, (full, rel) => consider(full, `${prefix}/${rel}`));
    else consider(source, prefix);
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { files, skipped, forbidden };
}

// ------------------------------------------------------------------ change detection
export function diffTrees(baseline, current) {
  const base = new Map(baseline.map((f) => [f.path, f]));
  const cur = new Map(current.map((f) => [f.path, f]));
  const added = current.filter((f) => !base.has(f.path)).map((f) => f.path);
  const modified = current.filter((f) => base.has(f.path) && base.get(f.path).sha256 !== f.sha256).map((f) => f.path);
  const deleted = baseline.filter((f) => !cur.has(f.path)).map((f) => f.path);
  return { added, modified, deleted };
}

export function categorize(paths) {
  const has = (re) => paths.some((p) => re.test(p));
  return {
    frontend: has(/^app\/dist\//),
    desktop: has(/^app\/electron\/(?!app-config\.json$)/),
    backend: has(/^server\/backend\/(app|routes|bootstrap|public|resources|config)\//),
    configuration: has(/^server\/backend\/config\/|^app\/electron\/app-config\.json$|^app\/package\.json$/),
    migrations: has(/^server\/backend\/database\/migrations\//),
    backend_dependencies: has(/^server\/backend\/(vendor\/|composer\.(json|lock)$)/),
    php_runtime: has(/^server\/php\//),
    resources: has(/^app\/dist\/(sounds|assets)\/.*\.(wav|mp3|png|jpe?g|svg|ico|woff2?)$/i) || has(/^server\/backend\/resources\//),
  };
}

export function composerPackages(lockText) {
  const out = {};
  try {
    for (const p of JSON.parse(lockText).packages || []) out[p.name] = p.version;
  } catch {
    // no lock file: no dependency detail
  }
  return out;
}

export function npmPackages(packageJsonText) {
  try {
    return JSON.parse(packageJsonText).dependencies || {};
  } catch {
    return {};
  }
}

export function dependencyChanges(before = {}, after = {}) {
  const changes = [];
  for (const [name, version] of Object.entries(after)) {
    if (before[name] === undefined) changes.push({ name, change: 'added', to: version });
    else if (before[name] !== version) changes.push({ name, change: 'changed', from: before[name], to: version });
  }
  for (const [name, version] of Object.entries(before)) if (after[name] === undefined) changes.push({ name, change: 'removed', from: version });
  return changes;
}

// ------------------------------------------------------------------ migrations
const DESTRUCTIVE = [
  /->\s*dropColumn\s*\(/, /->\s*renameColumn\s*\(/, /->\s*dropForeign\s*\(/, /Schema::\s*(drop|dropIfExists|dropColumns|rename)\s*\(/, /->\s*truncate\s*\(/, /->\s*delete\s*\(/, /->\s*forceDelete\s*\(/,
  /\bDROP\s+(TABLE|COLUMN|INDEX|VIEW|TRIGGER)\b/i, /\bDELETE\s+FROM\b/i, /\bTRUNCATE\b/i, /\bALTER\s+TABLE\b[^;]*\b(RENAME|DROP)\b/i,
];

/** The body of `function up()`, so a normal `down()` that drops things does not count against the migration. */
export function upMethodBody(source) {
  const start = source.search(/function\s+up\s*\(/);
  if (start < 0) return source;
  const open = source.indexOf('{', start);
  if (open < 0) return source;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)(\/\/|#(?!\[)).*$/gm, '$1');

export function analyzeMigration(source) {
  const body = stripComments(upMethodBody(source));
  const destructive = DESTRUCTIVE.filter((re) => re.test(body)).map((re) => re.source);
  const tag = (name) => {
    const m = new RegExp(`@update-${name}:\\s*(.+)`).exec(source);
    return m ? m[1].replace(/\*\/\s*$/, '').trim() : null;
  };
  const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
  return {
    destructive,
    recovery_strategy: tag('recovery'),
    depends_on: list(tag('depends')),
    seeds_tables: list(tag('seeds-table')),
  };
}

export const normalizedChecksum = (buffer) => sha256(Buffer.from(buffer.toString('utf8').replace(/\r\n/g, '\n'), 'utf8'));

/**
 * Judges every migration against the baseline. Returns { migrations, new_migrations, problems, expected_new_rows,
 * backward_compatible }. Any problem stops the build: an edited old migration would be skipped on clients that already ran
 * it and run differently elsewhere, and a destructive one needs a stated recovery strategy.
 */
export function evaluateMigrations(treeFiles, baselineMigrations = null) {
  const migrations = [];
  const problems = [];
  const expectedNewRows = [];
  let backwardCompatible = true;
  const known = new Map((baselineMigrations || []).map((m) => [m.id, m]));
  const files = treeFiles.filter((f) => /^server\/backend\/database\/migrations\/[^/]+\.php$/.test(f.path)).sort((a, b) => (a.path < b.path ? -1 : 1));
  const ids = new Set(files.map((f) => basename(f.path, '.php')));
  const newIds = [];

  for (const file of files) {
    const id = basename(file.path, '.php');
    const raw = readFileSync(file.source);
    const checksum = normalizedChecksum(raw);
    const analysis = analyzeMigration(raw.toString('utf8'));
    const entry = { id, sha256: checksum, depends_on: analysis.depends_on, destructive: false };
    const isNew = !known.has(id);

    if (!isNew && known.get(id).sha256 !== checksum) problems.push(`Migration ${id} was edited after it shipped. Add a new migration instead.`);
    if (isNew && baselineMigrations) {
      newIds.push(id);
      if (analysis.destructive.length) {
        if (!analysis.recovery_strategy) {
          problems.push(`Migration ${id} removes or renames data (${analysis.destructive.length} pattern(s)) and declares no @update-recovery strategy. Use Expand-Migrate-Contract.`);
        } else {
          entry.destructive = true;
          entry.recovery_strategy = analysis.recovery_strategy;
          backwardCompatible = false;
        }
      }
      expectedNewRows.push(...analysis.seeds_tables);
    }
    for (const dep of analysis.depends_on) if (!ids.has(dep)) problems.push(`Migration ${id} depends on ${dep}, which does not exist.`);
    migrations.push(entry);
  }
  for (const id of known.keys()) if (!ids.has(id)) problems.push(`Migration ${id} was removed after it shipped. Clients have already applied it.`);
  return { migrations, new_migrations: newIds, problems, expected_new_rows: expectedNewRows, backward_compatible: backwardCompatible };
}

// ------------------------------------------------------------------ asar (read only)
/** Lists an electron asar's files so a baseline can record exactly what an installer shipped. */
export function readAsar(asarPath) {
  const fd = openSync(asarPath, 'r');
  try {
    const sizeBuf = Buffer.alloc(8);
    readSync(fd, sizeBuf, 0, 8, 0);
    const headerPickleSize = sizeBuf.readUInt32LE(4);
    const headerBuf = Buffer.alloc(headerPickleSize);
    readSync(fd, headerBuf, 0, headerPickleSize, 8);
    const jsonLength = headerBuf.readUInt32LE(4);
    const header = JSON.parse(headerBuf.toString('utf8', 8, 8 + jsonLength));
    const dataStart = 8 + headerPickleSize;
    const out = [];
    const visit = (node, prefix) => {
      for (const [name, child] of Object.entries(node.files || {})) {
        const rel = prefix ? `${prefix}/${name}` : name;
        if (child.files) visit(child, rel);
        else if (!child.unpacked && !child.link) {
          const buf = Buffer.alloc(child.size);
          if (child.size) readSync(fd, buf, 0, child.size, dataStart + Number(child.offset));
          out.push({ path: rel, buffer: buf });
        }
      }
    };
    visit(header, '');
    return out;
  } finally {
    closeSync(fd);
  }
}

// ------------------------------------------------------------------ safety of the key
export function keyInsideRepo(keyPath, repoRoot) {
  const k = resolve(keyPath).toLowerCase();
  const r = resolve(repoRoot).toLowerCase();
  return k === r || k.startsWith(r + sep);
}

export const repoRootFrom = (here) => resolve(here, '..', '..', '..');
export { dirname };
