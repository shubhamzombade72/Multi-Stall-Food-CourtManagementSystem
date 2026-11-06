/**
 * Developer release builder: compares the built app with a known baseline and produces signed packages.
 *
 *   pnpm build && pnpm prepare:server
 *   node scripts/release/build-release.mjs --version 1.3.0 --baseline 1.2.5 --key <outside the repo> --key-id k1 --notes notes.json
 *
 * Output: release/updates/<version>/{tree.json, full/{manifest.json,manifest.sig,payload.fcpkg}, incremental-<base>/...}
 * The full recovery package is always built. Nothing is published here: see publish-release.mjs.
 * Options: --channel stable|beta|testing, --min-supported x.y.z, --min-app-version x.y.z, --required, --store <dir>,
 * --app-root <dir> and --server-root <dir> to build from somewhere other than ./dist + ./electron + ./build-server.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { categorize, collectTree, composerPackages, dependencyChanges, diffTrees, evaluateMigrations, keyInsideRepo, npmPackages, repoRootFrom } from './lib.mjs';

const require = createRequire(import.meta.url);
const { compareVersions, isValidVersion, manifestProblems, signManifest, verifySignature, writePayload, publicKeyFromBase64 } = require('../../electron/update/format.cjs');
const { buildServerEnv, phpArgs, locateRuntime } = require('../../electron/embedded-server.cjs');
const crypto = require('node:crypto');

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = resolve(HERE, '..', '..');

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

const fail = (message) => {
  console.error(`RELEASE BUILD STOPPED: ${message}`);
  process.exit(1);
};

const opts = args(process.argv.slice(2));
const version = opts.version;
const channel = opts.channel || 'stable';
if (!isValidVersion(version)) fail('--version x.y.z is required.');
if (!['stable', 'beta', 'testing'].includes(channel)) fail('--channel must be stable, beta or testing.');
if (!opts.key || !opts['key-id']) fail('--key <private key file> and --key-id <id> are required.');
if (keyInsideRepo(opts.key, repoRootFrom(HERE))) fail('The private signing key is inside the repository. Keep it outside, on protected storage.');
if (!existsSync(opts.key)) fail('The private signing key was not found.');

const store = resolve(opts.store || join(DESKTOP, 'release', 'updates'));
const outDir = join(store, version);
if (existsSync(outDir)) fail(`Version ${version} was already built (${outDir}). A version is never rebuilt with different contents; use a new version.`);

const appRoot = resolve(opts['app-root'] || DESKTOP);
const serverRoot = resolve(opts['server-root'] || join(DESKTOP, 'build-server'));
const roots = {
  'app/dist': join(appRoot, 'dist'),
  'app/electron': join(appRoot, 'electron'),
  'app/package.json': join(appRoot, 'package.json'),
  'server/backend': join(serverRoot, 'backend'),
  'server/php': join(serverRoot, 'php'),
  'server/router.php': join(serverRoot, 'router.php'),
};

// ------------------------------------------------------------------ 1. what is in this build
console.log(`[release] collecting ${version} (${channel})`);
const { files, skipped, forbidden } = collectTree(roots);
if (forbidden.length) fail(`These must never be packaged:\n${forbidden.map((f) => `  ${f.path}: ${f.why}`).join('\n')}`);
console.log(`[release] ${files.length} files, ${skipped.length} dev-only files left out`);
const treeEntries = files.map(({ path, sha256, size }) => ({ path, sha256, size }));

// ------------------------------------------------------------------ 2. what changed against the baseline
let baseline = null;
if (opts.baseline) {
  if (!isValidVersion(opts.baseline)) fail('--baseline must be a version.');
  if (compareVersions(version, opts.baseline) <= 0) fail(`${version} is not newer than the baseline ${opts.baseline}.`);
  const file = join(store, opts.baseline, 'tree.json');
  if (!existsSync(file)) fail(`No known baseline ${opts.baseline} at ${file}. Record one with scripts/release/baseline.mjs.`);
  baseline = JSON.parse(readFileSync(file, 'utf8'));
}
const changes = baseline ? diffTrees(baseline.tree, treeEntries) : { added: treeEntries.map((f) => f.path), modified: [], deleted: [] };
const categories = categorize([...changes.added, ...changes.modified, ...changes.deleted]);

// ------------------------------------------------------------------ 3. migrations
const evaluated = evaluateMigrations(files, baseline ? baseline.migrations : null);
if (evaluated.problems.length) fail(`Migration rules:\n${evaluated.problems.map((p) => `  ${p}`).join('\n')}`);
if (!evaluated.backward_compatible && !opts['min-app-version']) fail('A destructive migration needs --min-app-version so that older program files refuse to start on the changed database.');

// ------------------------------------------------------------------ 4. schema the release must end with (real PHP, throw-away database)
const runtime = locateRuntime(serverRoot);
if (!runtime) fail(`The PHP runtime or API is missing in ${serverRoot}. Run pnpm prepare:server.`);
const scratch = mkdtempSync(join(tmpdir(), 'fc-release-schema-'));
let describe;
try {
  ['logs', 'tmp', 'cache', 'cache/opcache', 'storage/app/public', 'storage/framework/cache/data', 'storage/framework/sessions', 'storage/framework/views', 'storage/logs'].forEach((d) => mkdirSync(join(scratch, d), { recursive: true }));
  writeFileSync(join(scratch, 'foodcourt.sqlite'), '');
  const env = buildServerEnv(scratch, `base64:${crypto.randomBytes(32).toString('base64')}`, process.env);
  const artisan = (...a) => execFileSync(runtime.php, [...phpArgs(runtime, scratch), join(runtime.backendDir, 'artisan'), ...a, '--no-interaction'], { cwd: scratch, env, encoding: 'utf8', windowsHide: true });
  artisan('migrate', '--force');
  describe = JSON.parse(artisan('foodcourt:update-db', 'describe').trim().split(/\r?\n/).pop());
  if (!describe.ok) fail('The release could not describe its own schema.');
} catch (err) {
  fail(`Migrations do not run on an empty database: ${String(err.stderr || err.stdout || err.message).slice(-600)}`);
} finally {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
}

// ------------------------------------------------------------------ 5. dependencies and compatibility
const read = (rel) => {
  const f = files.find((x) => x.path === rel);
  return f ? readFileSync(f.source, 'utf8') : '';
};
const composerNow = composerPackages(read('server/backend/composer.lock'));
const npmNow = npmPackages(read('app/package.json'));
const electronMajor = (() => {
  if (opts['electron-major']) return Number(opts['electron-major']);
  const pkg = JSON.parse(read('app/package.json') || '{}');
  const declared = pkg.devDependencies?.electron || (baseline && String(baseline.electron_major));
  return Number(String(declared || '').split('.')[0]);
})();
if (!Number.isInteger(electronMajor) || electronMajor <= 0) fail('The Electron version could not be determined. Pass --electron-major.');
if (baseline && baseline.electron_major !== electronMajor) console.log(`[release] Electron ${baseline.electron_major} -> ${electronMajor}: clients will be told to run the full installer`);
const apiContract = Number(/'api_contract'\s*=>\s*(\d+)/.exec(read('server/backend/config/foodcourt.php'))?.[1]);
if (!Number.isInteger(apiContract)) fail('config/foodcourt.php declares no api_contract.');

const notes = opts.notes ? JSON.parse(readFileSync(opts.notes, 'utf8')) : {};
const privatePem = readFileSync(opts.key, 'utf8');
const publicKey = crypto.createPublicKey(privatePem).export({ format: 'jwk' });
const publicB64 = Buffer.from(publicKey.x, 'base64url').toString('base64');

// ------------------------------------------------------------------ 6. packages
const database = {
  engine: 'sqlite',
  migrations: evaluated.migrations,
  new_migrations: evaluated.new_migrations,
  changes_schema: evaluated.new_migrations.length > 0 || !baseline,
  backward_compatible: evaluated.backward_compatible,
  min_app_version: opts['min-app-version'] || null,
  expected_new_rows: evaluated.expected_new_rows,
  schema: describe.schema,
  schema_fingerprint: describe.fingerprint,
};
const composerChanges = dependencyChanges(baseline?.dependencies?.composer, composerNow);
const npmChanges = dependencyChanges(baseline?.dependencies?.npm, npmNow);

const build = async (type) => {
  const dir = join(outDir, type === 'full' ? 'full' : `incremental-${opts.baseline}`);
  mkdirSync(dir, { recursive: true });
  const changedSet = new Set([...changes.added, ...changes.modified]);
  const included = type === 'full' ? files : files.filter((f) => changedSet.has(f.path));
  const payload = await writePayload(included, join(dir, 'payload.fcpkg'));
  const manifest = {
    format: 1,
    release_id: `rel-${version}-${crypto.randomBytes(6).toString('hex')}`,
    version,
    source_version: type === 'full' ? null : opts.baseline,
    baseline_version: opts.baseline || null,
    package_type: type,
    channel,
    created_at: new Date().toISOString(),
    min_supported_version: opts['min-supported'] || null,
    required: Boolean(opts.required),
    notes,
    compatibility: { platform: 'win32', arch: 'x64', electron_major: electronMajor, api_contract: apiContract },
    required_dependencies: { composer: composerChanges, npm: npmChanges },
    changes: { categories, added: changes.added, modified: changes.modified, deleted: changes.deleted },
    deleted_files: changes.deleted,
    database,
    signing: { algorithm: 'ed25519', key_id: opts['key-id'] },
    payload_sha256: payload.payload_sha256,
    payload_size: payload.payload_size,
    files: payload.entries,
    tree: treeEntries,
  };
  const problems = manifestProblems(manifest);
  if (problems.length) fail(`The manifest is not valid: ${problems.slice(0, 5).join('; ')}`);
  const raw = JSON.stringify(manifest);
  const signature = signManifest(raw, privatePem);
  if (!verifySignature(raw, signature, opts['key-id'], { [opts['key-id']]: publicB64 })) fail('The signature did not verify with its own public key.');
  writeFileSync(join(dir, 'manifest.json'), raw);
  writeFileSync(join(dir, 'manifest.sig'), signature);
  console.log(`[release] ${type}: ${included.length} files, ${(payload.payload_size / 1048576).toFixed(1)} MB -> ${dir}`);
  return { type, dir, files: included.length, bytes: payload.payload_size };
};

mkdirSync(outDir, { recursive: true });
// --incremental-only speeds up local experiments; the update service refuses to publish a release that has no full package
const built = opts['incremental-only'] ? [] : [await build('full')];
if (baseline) built.push(await build('incremental'));

writeFileSync(join(outDir, 'tree.json'), JSON.stringify({
  version,
  electron_major: electronMajor,
  tree: treeEntries,
  migrations: evaluated.migrations.map(({ id, sha256 }) => ({ id, sha256 })),
  dependencies: { composer: composerNow, npm: npmNow },
}));

const summary = {
  version,
  baseline: opts.baseline || null,
  key_id: opts['key-id'],
  public_key: publicB64,
  changes: { added: changes.added.length, modified: changes.modified.length, deleted: changes.deleted.length, categories },
  new_migrations: evaluated.new_migrations,
  dependencies: { composer: composerChanges.length, npm: npmChanges.length },
  packages: built,
};
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`RELEASE_BUILT ${JSON.stringify(summary)}`);
void publicKeyFromBase64;
