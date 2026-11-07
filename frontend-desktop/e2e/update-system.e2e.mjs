/**
 * Both update workflows for real:
 *   Developer: build the app, detect changes against the installed baseline, incremental + full packages, sign, publish.
 *   Client:    check, read notes, approve, download, verify, back up, migrate, install, health check, restart, and the update
 *              service accepts the completion only after validating it.
 *
 * Real Electron runs the real packaged asar and real PHP/SQLite. The update service is the real Laravel backend on loopback with
 * a temporary database. Synthetic data, throw-away profiles, throw-away signing key.
 *
 *   pnpm build && pnpm prepare:server
 *   node_modules/.bin/electron-builder --win --x64 --dir --config.directories.output=<dir>
 *   UPDATE_E2E_UNPACKED=<dir>/win-unpacked node e2e/update-system.e2e.mjs
 *
 * A running copy of the app or a real profile is never touched: only processes this script started are stopped.
 */
import { _electron as electron } from 'playwright-core';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { posRegression } from './update-pos-regression.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = join(HERE, '..');
const BACKEND = join(DESKTOP, '..', 'backend');
const results = [];
const check = (id, desc, pass, ev = '') => {
  results.push({ id, desc, result: pass ? 'PASS' : 'FAIL', evidence: String(ev).slice(0, 300) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 160)}]` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, timeout = 60000, every = 400) => {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(every);
  }
  return last;
};
const readJson = (f, fallback = null) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return fallback;
  }
};

const UNPACKED = process.env.UPDATE_E2E_UNPACKED ? resolve(process.env.UPDATE_E2E_UNPACKED) : null;
if (!UNPACKED || !existsSync(join(UNPACKED, 'resources', 'app.asar'))) {
  console.error('Set UPDATE_E2E_UNPACKED to a win-unpacked folder built from the current code.');
  process.exit(2);
}
const ASAR = join(UNPACKED, 'resources', 'app.asar');
const BASE_SERVER = join(UNPACKED, 'resources', 'server');
const BASE_VERSION = '1.2.0';

const T = mkdtempSync(join(tmpdir(), 'fc-update-e2e-'));
const STORE = join(T, 'store');
mkdirSync(STORE);
const keyFile = join(T, 'key.pem');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
const publicB64 = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
const trustFile = join(T, 'trust.json');
writeFileSync(trustFile, JSON.stringify({ keys: { e2e: publicB64 } }));

const freePort = () => new Promise((res) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => res(port));
  });
});

// ------------------------------------------------------------------ the update service: the real backend
const servicePort = await freePort();
const SERVICE = `http://127.0.0.1:${servicePort}/api`;
const serviceDb = join(T, 'service.sqlite');
writeFileSync(serviceDb, '');
const serviceEnv = {
  ...process.env,
  APP_ENV: 'production',
  APP_DEBUG: 'false',
  APP_KEY: `base64:${randomBytes(32).toString('base64')}`,
  DB_CONNECTION: 'sqlite',
  DB_DATABASE: serviceDb,
  CACHE_STORE: 'file',
  SESSION_DRIVER: 'array',
  QUEUE_CONNECTION: 'sync',
  BROADCAST_CONNECTION: 'null',
  FOODCOURT_EMBEDDED: 'false',
  FOODCOURT_UPDATE_SERVICE: 'true',
  FOODCOURT_UPDATE_TRUSTED_KEYS: `e2e:${publicB64}`,
  FOODCOURT_UPDATE_STORAGE: join(T, 'service-packages'),
  LOG_CHANNEL: 'null',
};
const art = (...a) => execFileSync('php', ['artisan', ...a, '--no-interaction'], { cwd: BACKEND, env: serviceEnv, encoding: 'utf8' });
art('migrate', '--force');
const OWNER = { email: 'release.owner@example.test', password: 'Str0ngPass99' };
art('tinker', '--execute', `\\App\\Models\\User::create(['name'=>'Release Owner','email'=>'${OWNER.email}','password'=>'${OWNER.password}','role'=>'owner','is_active'=>true]);`);
const service = spawn('php', ['-S', `127.0.0.1:${servicePort}`, join(BACKEND, 'vendor', 'laravel', 'framework', 'src', 'Illuminate', 'Foundation', 'resources', 'server.php')], { cwd: join(BACKEND, 'public'), env: serviceEnv, stdio: 'ignore', windowsHide: true });

const http = async (method, url, { token, body } = {}) => {
  const res = await fetch(url, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
};

const processes = []; // PIDs this script started, only ever these are stopped
const killPid = (pid) => {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    // already gone
  }
};

let failure = null;
let adminToken = null;

// ------------------------------------------------------------------ developer workflow
function makeVersionTree(name, version, { migration, marker = true } = {}) {
  const dir = join(T, 'trees', name);
  const app = join(dir, 'app');
  const server = join(dir, 'server');
  mkdirSync(app, { recursive: true });
  cpSync(process.env.FOODCOURT_TEST_DIST || join(DESKTOP, 'dist'), join(app, 'dist'), { recursive: true });
  cpSync(join(DESKTOP, 'electron'), join(app, 'electron'), { recursive: true });
  const pkg = JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8'));
  writeFileSync(join(app, 'package.json'), JSON.stringify({ ...pkg, version }, null, 2));
  cpSync(BASE_SERVER, server, { recursive: true, filter: (s) => !/[\\/]demo([\\/]|$)/.test(s) });
  if (marker) {
    // A UI change, a desktop change and a backend route: each must really be running after the update
    const index = join(app, 'dist', 'index.html');
    writeFileSync(index, readFileSync(index, 'utf8').replace('<head>', `<head>\n    <meta name="fc-update-marker" content="${version}" />`));
    writeFileSync(join(app, 'electron', 'release-marker.cjs'), `module.exports = '${version}';\n`);
    const routes = join(server, 'backend', 'routes', 'api.php');
    writeFileSync(routes, `${readFileSync(routes, 'utf8')}\nRoute::get('/release-marker', fn () => ['version' => '${version}']);\n`);
  }
  if (migration) writeFileSync(join(server, 'backend', 'database', 'migrations', migration.name), migration.source);
  return { app, server };
}

const migrationFile = (body) => `<?php

use Illuminate\\Database\\Migrations\\Migration;
use Illuminate\\Database\\Schema\\Blueprint;
use Illuminate\\Support\\Facades\\DB;
use Illuminate\\Support\\Facades\\Schema;

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

function buildAndPublish(version, tree, notes) {
  const notesFile = join(T, `notes-${version}.json`);
  writeFileSync(notesFile, JSON.stringify(notes));
  const build = spawnSync(process.execPath, [join(DESKTOP, 'scripts/release/build-release.mjs'), '--version', version, '--baseline', BASE_VERSION, '--store', STORE, '--app-root', tree.app, '--server-root', tree.server, '--key', keyFile, '--key-id', 'e2e', '--notes', notesFile, '--electron-major', process.env.UPDATE_E2E_ELECTRON_MAJOR || '44'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (build.status !== 0) throw new Error(`build ${version}: ${build.stderr}`);
  const summary = JSON.parse(/RELEASE_BUILT (.*)/.exec(build.stdout)[1]);
  const publish = spawnSync(process.execPath, [join(DESKTOP, 'scripts/release/publish-release.mjs'), '--server', SERVICE, '--version', version, '--store', STORE, '--publish', '--deploy', 'all'], { encoding: 'utf8', env: { ...process.env, FOODCOURT_RELEASE_TOKEN: adminToken }, maxBuffer: 16 * 1024 * 1024 });
  if (publish.status !== 0) throw new Error(`publish ${version}: ${publish.stderr}${publish.stdout}`);
  return { summary, published: JSON.parse(/RELEASE_PUBLISHED (.*)/.exec(publish.stdout)[1]) };
}

// ------------------------------------------------------------------ one client PC
function makePc(name) {
  const home = join(T, 'pcs', name);
  const userData = join(home, 'profile');
  const root = join(home, 'updates');
  mkdirSync(userData, { recursive: true });
  return { name, home, userData, root, active: join(root, 'state', 'active.json'), log: join(root, 'logs', 'update.log'), lastResult: join(root, 'state', 'last-result.json'), journal: join(root, 'state', 'journal.json'), db: join(userData, 'server', 'foodcourt.sqlite'), pidFile: join(userData, 'server', 'server.pid'), env: {} };
}

const envFor = (pc, extra = {}) => ({
  ...process.env,
  FOODCOURT_USER_DATA_DIR: pc.userData,
  FOODCOURT_UPDATE_ROOT: pc.root,
  FOODCOURT_UPDATE_URL: SERVICE,
  FOODCOURT_UPDATE_TRUST: trustFile,
  FOODCOURT_SERVER_DIR: BASE_SERVER,
  FOODCOURT_PIN_LOCK: 'off',
  FOODCOURT_SMOKE_TEST: '',
  FOODCOURT_API_URL: '',
  FOODCOURT_DATA_DIR: '',
  FOODCOURT_UPDATE_FIRST_CHECK_MS: '3600000',
  FOODCOURT_FIRST_BACKUP_DELAY_MS: '3600000',
  ...extra,
});

async function launch(pc, extra) {
  const app = await electron.launch({ args: [ASAR], env: envFor(pc, extra), timeout: 90000 });
  processes.push(app.process().pid);
  const page = await app.firstWindow();
  return { app, page };
}

const close = async (app) => {
  await app.close().catch(() => undefined);
  await sleep(800);
};

/** Waits until the built-in server answers, then returns its API address. */
const apiOf = async (page) => waitFor(async () => {
  const cfg = await page.evaluate(() => window.desktop.getConfig()).catch(() => null);
  return cfg && cfg.apiBaseUrl;
}, 90000);

const CLIENT_OWNER = { email: 'client.owner@example.test', password: 'Str0ngPass99', name: 'Client Owner' };

// A new sign-in revokes the owner's earlier token, so each stretch uses the API first and signs in to the window last.
const apiLogin = async (api) => (await http('POST', `${api}/auth/login`, { body: { email: CLIENT_OWNER.email, password: CLIENT_OWNER.password } })).json.data.token;

async function createOwner(page) {
  const api = await apiOf(page);
  const setup = await http('POST', `${api}/setup/owner`, { body: { ...CLIENT_OWNER, password_confirmation: CLIENT_OWNER.password } });
  if (setup.status >= 300) throw new Error(`setup owner: ${setup.status} ${JSON.stringify(setup.json).slice(0, 200)}`);
  await page.reload();
  return api;
}

async function signIn(page) {
  await page.waitForSelector('input[type=email], [data-testid="updates-page"], nav', { timeout: 60000 });
  if (await page.locator('input[type=email]').count()) {
    await page.fill('input[type=email]', CLIENT_OWNER.email);
    await page.fill('input[type=password]', CLIENT_OWNER.password);
    await page.keyboard.press('Enter');
  }
  await waitFor(() => page.evaluate(() => /dashboard|pos|updates/i.test(location.hash)).catch(() => false), 30000);
}

const goUpdates = async (page) => {
  await page.evaluate(() => {
    location.hash = '#/updates';
  });
  await page.getByTestId('updates-page').waitFor({ timeout: 20000 });
};

async function enrollPc(page) {
  const code = (await http('POST', `${SERVICE}/update-admin/enrollment-codes`, { token: adminToken, body: { customer_label: 'Synthetic Court' } })).json.data.code;
  await page.getByLabel('Update code').fill(code);
  await page.getByRole('button', { name: 'Register' }).click();
  await page.getByRole('button', { name: 'Check now' }).waitFor({ timeout: 20000 });
}

/** Business data the update must preserve, placed through the real API before updating. */
async function seedBusiness(api, token) {
  const post = async (path, body) => {
    const r = await http('POST', `${api}${path}`, { token, body });
    if (r.status >= 300) throw new Error(`${path}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    return r.json.data;
  };
  const stall = await post('/stalls', { name: 'Before Stall', code: 'BEF' });
  const cat = await post('/menu-categories', { stall_id: stall.id, name: 'Before Mains' });
  const item = await post('/menu', { stall_id: stall.id, category_id: cat.id, name: 'Before Dosa', price: 123 });
  await post('/inventory', { stall_id: stall.id, name: 'Before Rice', unit: 'kg', current_stock: 42, minimum_alert_stock: 1, unit_cost: 10 });
  await post('/customers', { name: 'Before Customer', phone: '9000000099' });
  const order = await post('/orders', { order_type: 'takeaway', items: [{ menu_item_id: item.id, quantity: 2 }] });
  const detail = (await http('GET', `${api}/orders/${order.id}`, { token })).json.data;
  const ids = detail.kitchen_tickets.flatMap((t) => t.ticket_items.map((i) => i.id));
  await post(`/orders/${order.id}/serve-remaining`, { idempotency_key: `seed-order-${order.id}`, item_ids: ids });
  await post('/billing/pay', { order_id: order.id, payment_method: 'cash', amount: order.total_amount, cash_tendered: 1000 });
  return { orderId: order.id, total: order.total_amount };
}

async function businessFacts(api, token) {
  const get = async (path) => (await http('GET', `${api}${path}`, { token })).json;
  const orders = await get('/orders?per_page=200');
  const payments = await get('/billing/payments');
  const customers = await get('/customers');
  const inventory = await get('/inventory');
  const inv = inventory.data?.data ?? inventory.data;
  const custList = customers.data?.data ?? customers.data;
  return {
    orderCount: orders.data.total,
    orderSum: orders.data.data.reduce((n, o) => n + Number(o.total_amount), 0),
    paymentCount: payments.data.total,
    customerNames: custList.map((c) => c.name).sort(),
    stock: inv.map((i) => `${i.name}:${Number(i.current_stock)}`).sort(),
  };
}

const targetFor = async (version, deviceName) => {
  const dep = (await http('GET', `${SERVICE}/update-admin/deployments`, { token: adminToken })).json.data.find((d) => d.release.version === version);
  const detail = (await http('GET', `${SERVICE}/update-admin/deployments/${dep.id}`, { token: adminToken })).json.data;
  const target = detail.deployment.targets.find((t) => t.client.name === deviceName || t.client_id === deviceName);
  return { target, events: detail.events.filter((e) => e.target_id === target?.id) };
};

/** Drives the Updates screen to the handover. The app closes itself. */
async function clickUpdateNow(page, app, version) {
  const exited = new Promise((r) => app.process().once('exit', r));
  await page.getByRole('button', { name: 'Check now' }).click();
  await page.getByTestId('update-available-version').waitFor({ timeout: 30000 });
  const offered = await page.getByTestId('update-available-version').textContent();
  if (offered !== version) throw new Error(`offered ${offered}, expected ${version}`);
  await page.getByTestId('update-now').click();
  await page.getByTestId('update-confirm-yes').click();
  await Promise.race([exited, sleep(180000).then(() => {
    throw new Error('the app did not close for the update');
  })]);
}

/** The app that the bootstrapper restarted: only its own process (recorded by the loader) is stopped. */
function stopRestarted(pc) {
  try {
    const lines = readFileSync(pc.log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const started = lines.filter((l) => /Program running/.test(l.msg)).at(-1);
    if (started) killPid(started.pid);
  } catch {
    // no log means nothing was restarted
  }
  try {
    const server = readJson(pc.pidFile);
    if (server?.pid) killPid(server.pid);
  } catch {
    // none
  }
}

const printerStub = () => new Promise((res) => {
  const jobs = [];
  const srv = createServer((sock) => {
    const chunks = [];
    sock.on('data', (c) => chunks.push(c));
    sock.on('end', () => jobs.push(Buffer.concat(chunks)));
    sock.on('error', () => undefined);
  });
  srv.listen(0, '127.0.0.1', () => res({ port: srv.address().port, jobs, close: () => srv.close() }));
});

// ================================================================== run
try {
  await waitFor(async () => (await fetch(`http://127.0.0.1:${servicePort}/up`).catch(() => null))?.status === 200, 30000);
  adminToken = (await http('POST', `${SERVICE}/auth/login`, { body: OWNER })).json?.data?.token;
  check('SVC-01', 'Update service (real backend) is up and the owner is signed in', Boolean(adminToken));
  const closed = await http('GET', `${SERVICE}/update-admin/releases`);
  check('SVC-02', 'Admin API refuses anonymous access', closed.status === 401, closed.status);

  // Baseline: what the installer really shipped
  const baseline = spawnSync(process.execPath, [join(DESKTOP, 'scripts/release/baseline.mjs'), '--from-unpacked', UNPACKED, '--version', BASE_VERSION, '--store', STORE, '--electron-major', '44'], { encoding: 'utf8' });
  check('DEV-01', 'Baseline recorded from the packaged app, asar included', baseline.status === 0, /BASELINE_RECORDED (.*)/.exec(baseline.stdout)?.[1] ?? baseline.stderr);

  const SCHEMA = { name: '2040_01_01_000000_add_e2e_column.php', source: migrationFile("Schema::table('orders', function (Blueprint $t) { $t->string('e2e_note')->nullable(); });") };
  const good = makeVersionTree('v1.3.0', '1.3.0', { migration: SCHEMA });
  const { summary } = buildAndPublish('1.3.0', good, {
    features: ['Synthetic new feature'],
    bug_fixes: ['Synthetic bug fix'],
    performance: ['Synthetic speed up'],
    database_changes: ['Adds one column to orders'],
    security: ['Synthetic hardening'],
  });
  check('DEV-02', 'Change detection: frontend, desktop, backend and migration found against the baseline', summary.changes.categories.frontend && summary.changes.categories.desktop && summary.changes.categories.backend && summary.changes.categories.migrations, JSON.stringify(summary.changes.categories));
  check('DEV-03', 'Migration identified as new', summary.new_migrations.join() === '2040_01_01_000000_add_e2e_column');
  const incremental = summary.packages.find((p) => p.type === 'incremental');
  const full = summary.packages.find((p) => p.type === 'full');
  check('DEV-04', 'Incremental package is a fraction of the full recovery package', incremental && full && incremental.bytes < full.bytes / 20 && incremental.files < 30, `${incremental?.files} files ${incremental?.bytes} B vs ${full?.files} files ${full?.bytes} B`);
  const releases = (await http('GET', `${SERVICE}/update-admin/releases`, { token: adminToken })).json.data;
  const r130 = releases.find((r) => r.version === '1.3.0');
  check('DEV-05', 'Signed and published: service verified the signature and payloads', r130?.status === 'RELEASE_PUBLISHED' && r130.packages.length === 2 && r130.packages.every((p) => p.uploaded_at), r130?.status);

  // ------------------------------------------------------------------ client: success
  const pcA = makePc('success');
  let { app, page } = await launch(pcA);
  let api = await createOwner(page);
  let token = await apiLogin(api);
  const seeded = await seedBusiness(api, token);
  const before = await businessFacts(api, token);
  await signIn(page);
  await goUpdates(page);
  check('CLI-01', 'Updates screen shows the installed version', (await page.getByTestId('update-current-version').textContent()) === BASE_VERSION);
  await enrollPc(page);
  check('CLI-02', 'Computer registered with a one-time code; token sealed, not readable on disk', !readFileSync(join(pcA.root, 'state', 'device.json'), 'utf8').includes('"token"'));

  await page.getByRole('button', { name: 'Check now' }).click();
  await page.getByTestId('update-available-version').waitFor({ timeout: 30000 });
  const notesText = await page.getByTestId('update-notes').innerText();
  check('CLI-03', 'Notes shown: features, fixes, performance, database, security', ['New features', 'Synthetic new feature', 'Bug fixes', 'Performance', 'Database changes', 'Adds one column', 'Security'].every((s) => notesText.includes(s)));
  check('CLI-04', 'Available version, release date and package size shown', (await page.getByTestId('update-available-version').textContent()) === '1.3.0' && (await page.getByTestId('update-release-date').textContent()) !== 'Not stated' && /MB/.test(await page.getByTestId('update-size').textContent()));
  await page.screenshot({ path: join(T, 'updates-available.png') }).catch(() => undefined);

  await page.getByTestId('update-later').click();
  await page.getByTestId('update-snoozed').waitFor({ timeout: 5000 });
  const notInstalled = !existsSync(pcA.active) && !existsSync(pcA.journal);
  const unapproved = (await targetFor('1.3.0', (await http('GET', `${SERVICE}/update-admin/clients`, { token: adminToken })).json.data[0].id)).target;
  check('CLI-05', 'Remind Me Later installs nothing, and the download carries on in the background', notInstalled && ['UPDATE_AVAILABLE', 'DOWNLOADING', 'VERIFYING', 'CLIENT_APPROVED'].includes(unapproved.status), unapproved.status);

  await clickUpdateNow(page, app, '1.3.0');
  check('CLI-06', 'After approval the app closed and handed over to the bootstrapper', true);

  const confirmed = await waitFor(() => readJson(pcA.active)?.state === 'confirmed' ? readJson(pcA.active) : null, 240000, 1000);
  check('CLI-07', 'Bootstrapper installed; the restarted new version confirmed it started', confirmed?.version === '1.3.0', JSON.stringify(confirmed ?? readJson(pcA.active)));
  const lastLog = existsSync(pcA.log) ? readFileSync(pcA.log, 'utf8').slice(-1500) : '';
  if (!confirmed) console.log(lastLog);

  const pcAClient = (await http('GET', `${SERVICE}/update-admin/clients`, { token: adminToken })).json.data[0];
  const completed = await waitFor(async () => {
    const t = await targetFor('1.3.0', pcAClient.id);
    return t.target?.status === 'COMPLETED' ? t : null;
  }, 60000, 1000);
  check('CLI-08', 'Update service validated and accepted the completion', Boolean(completed), completed?.target?.status);
  const seen = (completed?.events ?? []).map((e) => e.status);
  const required = ['DOWNLOADING', 'VERIFYING', 'CLIENT_APPROVED', 'BACKUP_IN_PROGRESS', 'MIGRATING', 'INSTALLING', 'HEALTH_CHECK', 'COMPLETED'];
  check('CLI-09b', 'No status was refused along the way', !(completed?.events ?? []).some((e) => /^Refused/.test(e.message ?? '')), (completed?.events ?? []).filter((e) => /^Refused/.test(e.message ?? '')).map((e) => e.status).join(','));
  check('CLI-09', 'Every lifecycle status reached the service, in order', required.every((s, i) => seen.indexOf(s) >= 0 && (i === 0 || seen.indexOf(s) > seen.indexOf(required[i - 1]))), seen.join(','));
  const afterClient = (await http('GET', `${SERVICE}/update-admin/clients`, { token: adminToken })).json.data[0];
  check('CLI-10', 'Service records the verified version and schema, set only by the validated completion', afterClient.verified_app_version === '1.3.0' && Boolean(afterClient.verified_schema_fingerprint), afterClient.verified_app_version);

  // The restarted app is the real thing: it answers on the new backend route
  const running = await waitFor(() => readJson(pcA.pidFile), 30000);
  const liveBase = `http://127.0.0.1:${running.port}/api`;
  const marker = await http('GET', `${liveBase}/release-marker`);
  check('CLI-11', 'Restarted app runs the NEW backend code', marker.json?.version === '1.3.0', JSON.stringify(marker.json));
  const ready = await http('GET', `${liveBase}/system/ready`);
  check('CLI-12', 'New version healthy: database reachable, migrations current, schema compatible', ready.json?.data?.ready === true && ready.json?.data?.schema_compatible === true);

  stopRestarted(pcA);
  await sleep(1500);

  // Back with a window we can look at
  ({ app, page } = await launch(pcA));
  api = await apiOf(page);
  token = await apiLogin(api);
  const after = await businessFacts(api, token);
  check('INT-01', 'Business data identical after the update: orders, payments, customers, stock', JSON.stringify(after) === JSON.stringify(before), `orders ${after.orderCount}, payments ${after.paymentCount}, sum ${after.orderSum}`);
  const paid = (await http('GET', `${api}/orders/${seeded.orderId}`, { token })).json.data;
  check('INT-02', 'The order from before the update is intact and paid', paid.payment_status === 'paid' && paid.total_amount === seeded.total);
  await signIn(page);
  await goUpdates(page);
  check('CLI-13', 'Screen reports the new version and final status', (await page.getByTestId('update-current-version').textContent()) === '1.3.0' && (await page.getByTestId('update-completed').count()) === 1);
  check('CLI-14', 'Frontend update is live', (await page.evaluate(() => document.querySelector('meta[name="fc-update-marker"]')?.content)) === '1.3.0');
  const release = await app.evaluate(({ app: a }) => a.getVersion());
  check('CLI-15', 'Desktop process reports the new version', release === '1.3.0', release);
  check('CLI-16', 'Files run from the versioned release folder; installed files were not changed', existsSync(join(pcA.root, 'releases', '1.3.0', 'app', 'electron', 'release-marker.cjs')) && !existsSync(join(BASE_SERVER, 'backend', 'database', 'migrations', SCHEMA.name)));

  const points = readdirSafe(join(pcA.root, 'recovery'));
  check('REC-01', 'A verified recovery point was kept', points.length === 1, points.join());

  // POS regression on the updated version
  const printer = await printerStub();
  await posRegression({
    api,
    ownerEmail: CLIENT_OWNER.email,
    ownerPassword: CLIENT_OWNER.password,
    tag: 'A1',
    check,
    kotPrint: async () => {
      const cfg = await page.evaluate(() => window.desktop.getPrintConfig());
      await page.evaluate(([c, port]) => window.desktop.setPrintConfig({ ...c, kot: { ...c.kot, transport: 'network', host: '127.0.0.1', port } }), [cfg, printer.port]);
      await page.evaluate(() => window.desktop.sendTestPrint('kot'));
      return Boolean(await waitFor(() => printer.jobs.length > 0, 20000));
    },
  });
  printer.close();
  await close(app);

  // ------------------------------------------------------------------ client: migration fails
  const bad = makeVersionTree('v1.3.1', '1.3.1', {
    migration: { name: '2040_01_02_000000_fails_on_real_data.php', source: migrationFile("Schema::table('orders', function (Blueprint $t) { $t->string('half')->nullable(); });\n        if (DB::table('orders')->count() > 0) { throw new \\RuntimeException('synthetic migration failure'); }") },
  });
  buildAndPublish('1.3.1', bad, { bug_fixes: ['This release fails on purpose'] });

  const pcB = makePc('failure');
  ({ app, page } = await launch(pcB));
  api = await createOwner(page);
  token = await apiLogin(api);
  await seedBusiness(api, token);
  const bBefore = await businessFacts(api, token);
  await signIn(page);
  await goUpdates(page);
  await enrollPc(page);
  const pcBClient = (await http('GET', `${SERVICE}/update-admin/clients`, { token: adminToken })).json.data.find((c) => c.id !== pcAClient.id);
  await clickUpdateNow(page, app, '1.3.1');

  const bResult = await waitFor(() => readJson(pcB.lastResult), 240000, 1000);
  check('FAIL-01', 'Failed migration stops the deployment and recovery runs', bResult?.outcome === 'recovered', JSON.stringify(bResult));
  check('FAIL-02', 'No restore was needed: the transaction rolled back', bResult?.restored_database === false);
  const bReported = await waitFor(async () => {
    const t = await targetFor('1.3.1', pcBClient.id);
    return t.target?.status === 'RECOVERED' ? t : null;
  }, 60000, 1000);
  const bStatuses = (bReported?.events ?? []).map((e) => e.status);
  check('FAIL-03', 'Failure and recovery accurately reported to the service', Boolean(bReported) && bStatuses.includes('FAILED') && bStatuses.includes('RECOVERED'), bStatuses.join(','));
  check('FAIL-04', 'Monitoring shows the migration error', (bReported?.events ?? []).some((e) => e.category === 'migration' && e.is_error && /synthetic migration failure/.test(e.message ?? '')));
  const bClient = (await http('GET', `${SERVICE}/update-admin/clients`, { token: adminToken })).json.data.find((c) => c.id === pcBClient.id);
  check('FAIL-05', 'Service did not record a new verified version', bClient.verified_app_version === null && Boolean(bClient.last_failure_at));
  check('FAIL-06', 'Previous program remains active', !existsSync(pcB.active));
  await sleep(2000);
  stopRestarted(pcB);
  await sleep(1500);

  ({ app, page } = await launch(pcB));
  api = await apiOf(page);
  token = await apiLogin(api);
  check('FAIL-08', 'Business data intact after the failure', JSON.stringify(await businessFacts(api, token)) === JSON.stringify(bBefore));
  await signIn(page);
  await goUpdates(page);
  check('FAIL-07', 'Previous version runs and the screen explains what happened', (await page.getByTestId('update-current-version').textContent()) === BASE_VERSION && (await page.getByTestId('update-recovered').count()) === 1);
  await close(app);

  // ------------------------------------------------------------------ client: new version fails its trial boot
  const trialTree = makeVersionTree('v1.3.2', '1.3.2', { migration: SCHEMA });
  buildAndPublish('1.3.2', trialTree, { features: ['Good release'] });
  const pcC = makePc('trial');
  ({ app, page } = await launch(pcC, { FOODCOURT_UPDATE_FAIL_TRIAL: '1' }));
  api = await createOwner(page);
  token = await apiLogin(api);
  await seedBusiness(api, token);
  const cBefore = await businessFacts(api, token);
  await signIn(page);
  await goUpdates(page);
  await enrollPc(page);
  const known = new Set([pcAClient.id, pcBClient.id]);
  const pcCClient = (await http('GET', `${SERVICE}/update-admin/clients`, { token: adminToken })).json.data.find((c) => !known.has(c.id));
  await clickUpdateNow(page, app, '1.3.2');

  const cResult = await waitFor(() => (readJson(pcC.lastResult)?.outcome === 'recovered' ? readJson(pcC.lastResult) : null), 300000, 1000);
  check('TRIAL-01', 'New version failed to confirm: rolled back automatically on its own', cResult?.outcome === 'recovered', JSON.stringify(cResult));
  check('TRIAL-02', 'Additive schema kept: the old version runs on it, no restore needed', cResult?.restored_database === false);
  check('TRIAL-03', 'Previous program active again', !existsSync(pcC.active) || readJson(pcC.active)?.version !== '1.3.2');
  const cReported = await waitFor(async () => {
    const t = await targetFor('1.3.2', pcCClient.id);
    return t.target?.status === 'RECOVERED' ? t : null;
  }, 60000, 1000);
  check('TRIAL-04', 'Service shows RECOVERED, not COMPLETED', Boolean(cReported), cReported?.target?.status);
  await sleep(3000);
  stopRestarted(pcC);
  await sleep(1500);

  // Retry with a working start: the same release completes
  ({ app, page } = await launch(pcC));
  api = await apiOf(page);
  token = await apiLogin(api);
  check('TRIAL-05', 'Data intact after the rollback', JSON.stringify(await businessFacts(api, token)) === JSON.stringify(cBefore));
  await signIn(page);
  await goUpdates(page);
  await clickUpdateNow(page, app, '1.3.2');
  const cRetry = await waitFor(() => readJson(pcC.active)?.state === 'confirmed' ? readJson(pcC.active) : null, 240000, 1000);
  check('TRIAL-06', 'A retry after recovery completes', cRetry?.version === '1.3.2', JSON.stringify(readJson(pcC.lastResult)));
  await waitFor(async () => (await targetFor('1.3.2', pcCClient.id)).target?.status === 'COMPLETED', 60000, 1000);
  check('TRIAL-07', 'Service accepted the retried completion', (await targetFor('1.3.2', pcCClient.id)).target?.status === 'COMPLETED');
  stopRestarted(pcC);

  // ------------------------------------------------------------------ security in the real app
  const pcD = makePc('no-trust');
  writeFileSync(join(T, 'empty-trust.json'), JSON.stringify({ keys: {} }));
  ({ app, page } = await launch(pcD, { FOODCOURT_UPDATE_TRUST: join(T, 'empty-trust.json') }));
  await createOwner(page);
  await signIn(page);
  await goUpdates(page);
  check('SEC-01', 'With no trusted key the app says updates are disabled and offers nothing', /disabled/.test(await page.getByTestId('update-disabled').textContent()));
  const bridge = await page.evaluate(() => Object.keys(window.desktop).sort());
  check('SEC-02', 'Renderer has only the known update actions, and no filesystem or token access', bridge.filter((k) => /^update/.test(k)).join() === 'updateApprove,updateCheck,updateEnroll,updateGetState,updateInstallFromFolder,updateNow,updatePauseDownload,updateRemindLater,updateReportActivity,updateSetPolicy' && (await page.evaluate(() => typeof require)) === 'undefined');
  const refused = await page.evaluate(() => window.desktop.updateNow('not-a-real-token'));
  check('SEC-03', 'The main process itself refuses Update Now without an owner token', refused.ok === false && refused.code === 'not_owner', JSON.stringify(refused));
  await close(app);
} catch (err) {
  failure = err;
  console.error(err);
  check('E2E', 'Script ran to the end', false, err.message);
}

function readdirSafe(dir) {
  try {
    return spawnSync('cmd', ['/c', 'dir', '/b', dir], { encoding: 'utf8' }).stdout.trim().split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------ report and clean up
const failed = results.filter((r) => r.result === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} passed`);
const outDir = join(DESKTOP, '..', 'qa', 'desktop', 'results');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'update-system-results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));

for (const pid of processes) killPid(pid);
for (const name of ['success', 'failure', 'trial', 'no-trust']) {
  const pc = makePcPaths(name);
  stopRestarted(pc);
}
killPid(service.pid);
await sleep(1500);
rmSync(T, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
process.exit(failed.length || failure ? 1 : 0);

function makePcPaths(name) {
  const home = join(T, 'pcs', name);
  return { log: join(home, 'updates', 'logs', 'update.log'), pidFile: join(home, 'profile', 'server', 'server.pid') };
}
