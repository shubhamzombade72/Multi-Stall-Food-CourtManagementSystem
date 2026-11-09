/**
 * Test laboratory for the update system. Everything here is real: real PHP, the real Laravel API from build-server, real
 * SQLite files, real Ed25519 signatures, real package files. It runs in a throw-away folder with synthetic data only, and
 * no real profile is touched. Needs `pnpm build` and `pnpm prepare:server` first.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const HERE = dirname(fileURLToPath(import.meta.url));
export const DESKTOP = resolve(HERE, '..', '..');
const { artisanFor, locateRuntime } = require(join(DESKTOP, 'electron/embedded-server.cjs'));
export const rel = require(join(DESKTOP, 'electron/update/releases.cjs'));
export const recovery = require(join(DESKTOP, 'electron/update/recovery.cjs'));
export const { createBootstrap } = require(join(DESKTOP, 'electron/update/bootstrap.cjs'));
export const format = require(join(DESKTOP, 'electron/update/format.cjs'));

// Set when a copy of the app is running from build-server and dist, which must not be rebuilt under it
const SOURCE_SERVER = process.env.FOODCOURT_TEST_SERVER_DIR || join(DESKTOP, 'build-server');
const SOURCE_DIST = process.env.FOODCOURT_TEST_DIST || join(DESKTOP, 'dist');
export const hasBuild = existsSync(join(SOURCE_SERVER, 'php', 'php.exe')) && existsSync(join(SOURCE_DIST, 'index.html'));

export function createLab() {
  const root = mkdtempSync(join(tmpdir(), 'fc-update-lab-'));
  const store = join(root, 'store');
  mkdirSync(store);
  const keyFile = join(root, 'signing.pem');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const publicB64 = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
  const trusted = { lab: publicB64 };

  /** A program version as files: app/ (dist, electron, package.json) and server/ (php, backend, router.php). */
  function makeTree(name, mutate = () => undefined) {
    const dir = join(root, 'trees', name);
    const appDir = join(dir, 'app');
    const serverDir = join(dir, 'server');
    mkdirSync(appDir, { recursive: true });
    cpSync(SOURCE_DIST, join(appDir, 'dist'), { recursive: true });
    cpSync(join(DESKTOP, 'electron'), join(appDir, 'electron'), { recursive: true });
    cpSync(join(DESKTOP, 'package.json'), join(appDir, 'package.json'));
    cpSync(SOURCE_SERVER, serverDir, { recursive: true, filter: (s) => !/[\\/]demo([\\/]|$)/.test(s) });
    mutate({ appDir, serverDir, migrations: join(serverDir, 'backend', 'database', 'migrations') });
    return { dir, appDir, serverDir };
  }

  function buildRelease(version, tree, { baseline, extra = [] } = {}) {
    const args = [join(DESKTOP, 'scripts/release/build-release.mjs'), '--version', version, '--store', store, '--app-root', tree.appDir, '--server-root', tree.serverDir, '--key', keyFile, '--key-id', 'lab', '--electron-major', '44', ...extra];
    if (baseline) args.push('--baseline', baseline);
    const run = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.status !== 0) throw Object.assign(new Error(`release build failed: ${run.stderr || run.stdout}`), { stderr: run.stderr });
    return JSON.parse(/RELEASE_BUILT (.*)/.exec(run.stdout)[1]);
  }

  const packageDir = (version, type) => join(store, version, type);

  /** A PC with this version installed and its own data, ready to be updated. */
  function makeClient(name, tree, version) {
    const home = join(root, 'clients', name);
    const dataDir = join(home, 'data');
    const userData = join(home, 'userdata');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(userData, { recursive: true });
    const dirs = rel.layout(join(home, 'updates'));
    mkdirSync(dirs.state, { recursive: true });
    const installed = { version, app: tree.appDir, server: tree.serverDir };
    const artisan = (args, serverDir = tree.serverDir) => artisanFor(locateRuntime(serverDir), dataDir)(args);
    const db = join(dataDir, 'foodcourt.sqlite');
    return { name, home, dataDir, userData, dirs, installed, artisan, db };
  }

  async function seedClient(client) {
    writeFileSync(client.db, '');
    await client.artisan(['migrate', '--force']);
    runSql(client.db, SEED_SQL);
    mkdirSync(join(client.dataDir, 'storage', 'app', 'menu-images'), { recursive: true });
    writeFileSync(join(client.dataDir, 'storage', 'app', 'menu-images', 'dosa.jpg'), 'synthetic-image');
    writeFileSync(join(client.userData, 'desktop-settings.json'), '{"lastBackupAt":null}');
  }

  /** Runs a job the way the agent would hand it over. `hooks` are test points in bootstrap.cjs. */
  function bootstrapFor(client, { hooks } = {}) {
    const logs = [];
    const statuses = [];
    const b = createBootstrap({
      dirs: client.dirs,
      dataDir: client.dataDir,
      userData: client.userData,
      installed: client.installed,
      trusted,
      hooks,
      log: (level, msg) => logs.push(`${level} ${msg}`),
      onStatus: (s) => statuses.push(s),
    });
    return { b, logs, statuses };
  }

  function jobFor(client, version, type, { previous = client.installed.version, targetId = 77, mode = 'embedded' } = {}) {
    const dir = packageDir(version, type);
    return { version, target_id: targetId, previous_version: previous, manifest_file: join(dir, 'manifest.json'), signature_file: join(dir, 'manifest.sig'), payload_file: copyPayload(client, dir), mode, parent_pid: 0, proof_nonce: 'n' };
  }

  // The install consumes the payload, so each job has its own copy
  let copies = 0;
  function copyPayload(client, dir) {
    const to = join(client.home, `payload-${++copies}.fcpkg`);
    cpSync(join(dir, 'payload.fcpkg'), to);
    return to;
  }

  return { root, store, keyFile, trusted, publicB64, makeTree, buildRelease, packageDir, makeClient, seedClient, bootstrapFor, jobFor, cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }) };
}

// ------------------------------------------------------------------ synthetic data and direct database access
export const SEED_SQL = `
INSERT INTO users (id, name, email, password, role, is_active, created_at, updated_at) VALUES
 (1,'Test Owner','owner@example.test','x','owner',1,'2026-01-01','2026-01-01'),
 (2,'Test Cashier','cashier@example.test','x','cashier',1,'2026-01-01','2026-01-01');
INSERT INTO stalls (id, uuid, name, code, is_active, created_at, updated_at) VALUES (1,'syn-stall-1','Synthetic Stall','SYN',1,'2026-01-01','2026-01-01');
INSERT INTO customers (id, name, phone, created_at, updated_at) VALUES (1,'Synthetic Customer','9000000001','2026-01-01','2026-01-01');
INSERT INTO suppliers (id, stall_id, name, created_at, updated_at) VALUES (1,1,'Synthetic Supplier','2026-01-01','2026-01-01');
INSERT INTO inventory_items (id, stall_id, name, unit, current_stock, unit_cost, created_at, updated_at) VALUES (1,1,'Rice','kg',12.5,40,'2026-01-01','2026-01-01');
INSERT INTO settings (key, value, created_at, updated_at) VALUES ('business_profile','{"name":"Synthetic Court"}','2026-01-01','2026-01-01');
`;

const PHP_RUN = `<?php
$pdo = new PDO('sqlite:' . $argv[1]);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$action = $argv[2];
if ($action === 'exec') { $pdo->exec(file_get_contents($argv[3])); echo '{"ok":true}'; }
if ($action === 'query') { echo json_encode($pdo->query(file_get_contents($argv[3]))->fetchAll(PDO::FETCH_ASSOC)); }
`;

const sqlDir = mkdtempSync(join(tmpdir(), 'fc-update-sql-'));
const phpFile = join(sqlDir, 'run.php');
writeFileSync(phpFile, PHP_RUN);
let sqlCounter = 0;

function phpSql(db, action, sql) {
  const file = join(sqlDir, `s${++sqlCounter}.sql`);
  writeFileSync(file, sql);
  const out = execFileSync('php', [phpFile, db, action, file], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  rmSync(file, { force: true });
  return out;
}

export const runSql = (db, sql) => phpSql(db, 'exec', sql);
export const querySql = (db, sql) => JSON.parse(phpSql(db, 'query', sql) || '[]');

/** Orders and payments: the columns the tests compare before and after. */
export function addOrders(db, count, startId = 1) {
  const chunks = [`BEGIN;`];
  for (let i = 0; i < count; i++) {
    const id = startId + i;
    chunks.push(`INSERT INTO orders (id, uuid, order_number, order_channel, order_type, status, subtotal, tax_amount, discount_amount, total_amount, created_at, updated_at) VALUES (${id},'syn-${id}','SYN-${id}','cashier_pos','dine_in','completed',${100 + (i % 50)},5,0,${105 + (i % 50)},'2026-02-01','2026-02-01');`);
  }
  chunks.push('COMMIT;');
  return runSql(db, chunks.join('\n'));
}

export const totals = (db) => querySql(db, `select (select count(*) from orders) orders, (select coalesce(sum(total_amount),0) from orders) order_total, (select count(*) from users) users, (select count(*) from customers) customers, (select count(*) from suppliers) suppliers, (select current_stock from inventory_items where id=1) rice`)[0];

export const hasColumn = (db, table, column) => querySql(db, `select name from pragma_table_info('${table}') where name='${column}'`).length > 0;
export const hasTable = (db, table) => querySql(db, `select name from sqlite_master where type='table' and name='${table}'`).length > 0;

export const migrationSource = (body, tags = '') => `<?php

use Illuminate\\Database\\Migrations\\Migration;
use Illuminate\\Database\\Schema\\Blueprint;
use Illuminate\\Support\\Facades\\DB;
use Illuminate\\Support\\Facades\\Schema;

/**
${tags}
 */
return new class extends Migration
{
    public function up(): void
    {
${body}
    }

    public function down(): void
    {
    }
};
`;

export const readText = (f) => readFileSync(f, 'utf8');
