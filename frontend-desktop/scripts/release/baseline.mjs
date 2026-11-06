/**
 * Records what an installer really shipped, as the baseline later incremental packages are compared with. Reads the built
 * win-unpacked folder (asar included), because electron-builder rewrites package.json, so the source tree is not the same.
 *
 *   node scripts/release/baseline.mjs --from-unpacked installers/1.3.0/win-unpacked --version 1.3.0
 *   node scripts/release/baseline.mjs --from-source --version 1.3.0 [--app-root <dir>] [--server-root <dir>]
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectTree, composerPackages, evaluateMigrations, npmPackages, readAsar } from './lib.mjs';

const require = createRequire(import.meta.url);
const { isValidVersion } = require('../../electron/update/format.cjs');
const DESKTOP = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const value = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const next = process.argv[i + 1];
  return next === undefined || next.startsWith('--') ? true : next;
};
const version = value('version');
if (!isValidVersion(version)) {
  console.error('--version x.y.z is required.');
  process.exit(1);
}
const store = resolve(value('store') || join(DESKTOP, 'release', 'updates'));
const outDir = join(store, version);
if (existsSync(join(outDir, 'tree.json'))) {
  console.error(`A baseline for ${version} already exists.`);
  process.exit(1);
}

let scratch = null;
let roots;
const unpacked = value('from-unpacked');
if (typeof unpacked === 'string') {
  const resources = join(resolve(unpacked), 'resources');
  scratch = mkdtempSync(join(tmpdir(), 'fc-baseline-'));
  for (const { path, buffer } of readAsar(join(resources, 'app.asar'))) {
    const dest = join(scratch, ...path.split('/'));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buffer);
  }
  roots = {
    'app/dist': join(scratch, 'dist'),
    'app/electron': join(scratch, 'electron'),
    'app/package.json': join(scratch, 'package.json'),
    'server/backend': join(resources, 'server', 'backend'),
    'server/php': join(resources, 'server', 'php'),
    'server/router.php': join(resources, 'server', 'router.php'),
  };
} else {
  const appRoot = resolve(value('app-root') || DESKTOP);
  const serverRoot = resolve(value('server-root') || join(DESKTOP, 'build-server'));
  roots = {
    'app/dist': join(appRoot, 'dist'),
    'app/electron': join(appRoot, 'electron'),
    'app/package.json': join(appRoot, 'package.json'),
    'server/backend': join(serverRoot, 'backend'),
    'server/php': join(serverRoot, 'php'),
    'server/router.php': join(serverRoot, 'router.php'),
  };
}

try {
  const { files, forbidden } = collectTree(roots);
  if (forbidden.length) {
    console.error(`These must never be shipped:\n${forbidden.map((f) => `  ${f.path}: ${f.why}`).join('\n')}`);
    process.exit(1);
  }
  const read = (rel) => {
    const f = files.find((x) => x.path === rel);
    return f ? readFileSync(f.source, 'utf8') : '';
  };
  const electronMajor = Number(value('electron-major') || String(JSON.parse(read('app/package.json') || '{}').devDependencies?.electron || JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8')).devDependencies.electron).split('.')[0]);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'tree.json'), JSON.stringify({
    version,
    electron_major: electronMajor,
    tree: files.map(({ path, sha256, size }) => ({ path, sha256, size })),
    migrations: evaluateMigrations(files, null).migrations.map(({ id, sha256 }) => ({ id, sha256 })),
    dependencies: { composer: composerPackages(read('server/backend/composer.lock')), npm: npmPackages(read('app/package.json')) },
  }));
  console.log(`BASELINE_RECORDED ${JSON.stringify({ version, files: files.length, at: outDir })}`);
} finally {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}
