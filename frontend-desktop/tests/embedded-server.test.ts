/**
 * Unit tests for the single-PC built-in server launcher (electron/embedded-server.cjs): the pure helpers
 * that decide where data lives, what environment PHP runs with, and where the runtime is found.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { rootedPath, locateRuntime, phpArgs, buildServerEnv, ensureAppKey } = require('../electron/embedded-server.cjs');

test('Laravel cache overrides are made drive-less so they count as absolute paths', () => {
  assert.equal(rootedPath('C:\\Users\\Asha\\AppData\\Roaming\\FoodCourt Desktop\\server\\cache\\packages.php'), '\\Users\\Asha\\AppData\\Roaming\\FoodCourt Desktop\\server\\cache\\packages.php');
  assert.equal(rootedPath('d:/data/x.php'), '/data/x.php');
  assert.equal(rootedPath('\\\\server\\share\\x.php'), '\\\\server\\share\\x.php', 'UNC paths are untouched');
});

test('server environment: local SQLite, production mode, embedded flag, nothing pointing at a network database', () => {
  const dataDir = 'C:\\Users\\Asha\\AppData\\Roaming\\FoodCourt Desktop\\server';
  const env = buildServerEnv(dataDir, 'base64:KEY', {});
  assert.equal(env.APP_ENV, 'production');
  assert.equal(env.APP_DEBUG, 'false');
  assert.equal(env.DB_CONNECTION, 'sqlite');
  assert.equal(env.DB_DATABASE, `${dataDir}\\foodcourt.sqlite`);
  assert.equal(env.FOODCOURT_EMBEDDED, 'true');
  assert.equal(env.BROADCAST_CONNECTION, 'null', 'no Reverb / websocket server is needed');
  for (const key of ['APP_PACKAGES_CACHE', 'APP_SERVICES_CACHE', 'APP_CONFIG_CACHE', 'APP_ROUTES_CACHE', 'APP_EVENTS_CACHE']) {
    assert.match(env[key], /^[\\/]/, `${key} must start with a slash so Laravel treats it as absolute`);
    assert.doesNotMatch(env[key], /^[A-Za-z]:/);
  }
  assert.ok(!('DB_HOST' in env) && !('DB_PASSWORD' in env), 'no external database settings');
});

test('app key is generated once per installation and then reused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fc-key-'));
  try {
    const first = ensureAppKey(dir);
    assert.match(first, /^base64:[A-Za-z0-9+/=]{43,}$/);
    assert.equal(ensureAppKey(dir), first, 'same key on the next launch');
    assert.equal(readFileSync(join(dir, 'app.key'), 'utf8'), first);
    writeFileSync(join(dir, 'app.key'), 'garbage');
    assert.notEqual(ensureAppKey(dir), 'garbage', 'a damaged key file is replaced');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runtime is located only when php, the API and the router are all present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fc-rt-'));
  try {
    assert.equal(locateRuntime(dir), null);
    assert.equal(locateRuntime(''), null);
    mkdirSync(join(dir, 'php'), { recursive: true });
    mkdirSync(join(dir, 'backend'), { recursive: true });
    writeFileSync(join(dir, 'php', 'php.exe'), '');
    writeFileSync(join(dir, 'backend', 'artisan'), '');
    assert.equal(locateRuntime(dir), null, 'router missing');
    writeFileSync(join(dir, 'router.php'), '');
    const rt = locateRuntime(dir);
    assert.equal(rt.php, join(dir, 'php', 'php.exe'));
    assert.equal(rt.backendDir, join(dir, 'backend'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PHP runs without any php.ini and with an explicit extension set', () => {
  const args = phpArgs({ phpDir: 'C:\\app\\server\\php' }, 'C:\\data');
  assert.equal(args[0], '-n', 'ignores php.ini files on the PC');
  assert.ok(args.includes('extension=php_pdo_sqlite.dll'));
  assert.ok(args.includes('zend_extension=php_opcache.dll'));
  assert.ok(args.includes('display_errors=0'), 'errors go to a log file, never to the page');
  assert.ok(args.some((a) => a.startsWith('error_log=') && a.includes('php-error.log')));
});

test('the database is copied aside before a new program version first starts, and only then', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fc-up-'));
  const { backupBeforeUpgrade } = require('../electron/embedded-server.cjs');
  const logs: string[] = [];
  const log = (_l: string, m: string) => logs.push(m);
  try {
    mkdirSync(join(dir, 'backups'), { recursive: true });
    writeFileSync(join(dir, 'foodcourt.sqlite'), 'ORDERS-AND-USERS');

    backupBeforeUpgrade(dir, '1.0.2', log); // very first run: nothing to protect yet
    assert.equal(readdirSync(join(dir, 'backups')).length, 0);
    assert.equal(readFileSync(join(dir, 'last-version.txt'), 'utf8'), '1.0.2');

    backupBeforeUpgrade(dir, '1.0.2', log); // same version again
    assert.equal(readdirSync(join(dir, 'backups')).length, 0);

    backupBeforeUpgrade(dir, '1.0.3', log); // upgrade: back up the existing data first
    const copies = readdirSync(join(dir, 'backups'));
    assert.equal(copies.length, 1);
    assert.match(copies[0], /^foodcourt-before-1\.0\.3-.*\.sqlite$/);
    assert.equal(readFileSync(join(dir, 'backups', copies[0]), 'utf8'), 'ORDERS-AND-USERS', 'the copy holds the old data');

    for (let v = 4; v <= 12; v++) { // only the most recent 5 copies are kept
      writeFileSync(join(dir, 'foodcourt.sqlite'), `data-${v}`);
      backupBeforeUpgrade(dir, `1.0.${v}`, log);
    }
    assert.equal(readdirSync(join(dir, 'backups')).length, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('demo database is installed once on the first start, never over an existing database, and a clean build ignores it', () => {
  const { installDemoDatabaseIfFirstRun } = require('../electron/embedded-server.cjs');
  const root = mkdtempSync(join(tmpdir(), 'fc-demo-'));
  try {
    const serverDir = join(root, 'server');
    const dataDir = join(root, 'data');
    mkdirSync(join(serverDir, 'demo'), { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    const runtime = { serverDir };

    // Clean installer: no demo file shipped -> nothing happens
    assert.equal(installDemoDatabaseIfFirstRun(runtime, dataDir, null), false);

    // Demo installer, first start -> copied
    writeFileSync(join(serverDir, 'demo', 'foodcourt-demo.sqlite'), 'DEMO-DB');
    assert.equal(installDemoDatabaseIfFirstRun(runtime, dataDir, null), true);
    assert.equal(readFileSync(join(dataDir, 'foodcourt.sqlite'), 'utf8'), 'DEMO-DB');

    // The owner then works in it; a restart must keep their data, not reinstall the demo
    writeFileSync(join(dataDir, 'foodcourt.sqlite'), 'OWNER-DATA');
    assert.equal(installDemoDatabaseIfFirstRun(runtime, dataDir, null), false);
    assert.equal(readFileSync(join(dataDir, 'foodcourt.sqlite'), 'utf8'), 'OWNER-DATA');

    // An empty placeholder file (first-run marker) does not count as a database
    writeFileSync(join(dataDir, 'foodcourt.sqlite'), '');
    assert.equal(installDemoDatabaseIfFirstRun(runtime, dataDir, null), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
