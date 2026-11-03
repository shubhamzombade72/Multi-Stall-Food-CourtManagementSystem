/**
 * Multi-PC integration test: ONE shared host (the real Laravel API on PostgreSQL, started with the pairing
 * requirement switched on) and several paired terminals that reach it over its LAN address, not localhost.
 *
 *   node --test --test-timeout=300000 qa/multi-pc/multipc.e2e.mjs
 *
 * Needs: PHP on PATH, a local PostgreSQL 17 (postgres/root as in backend/phpunit.xml). It creates and drops
 * its own database `foodcourt_multipc_e2e`; no other database is touched.
 *
 * What this does NOT prove: it runs on a single physical PC (terminals and host are separate clients and
 * processes, talking over the PC's LAN address). Firewall behaviour between two real machines is not tested.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACKEND = join(REPO, 'backend');
const pairing = require(join(REPO, 'frontend-desktop', 'electron', 'pairing.cjs'));
const PSQL = 'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe';
const DB = 'foodcourt_multipc_e2e';
const SEED_PASSWORD = 'password123';

const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
assert.ok(lanIp, 'this test needs a network adapter with an IPv4 address');

const psql = (sql, db = 'postgres') =>
  execFileSync(PSQL, ['-h', '127.0.0.1', '-U', 'postgres', '-d', db, '-w', '-tAc', sql], { env: { ...process.env, PGPASSWORD: 'root' }, encoding: 'utf8' }).trim();

const hostEnv = (port) => ({
  ...process.env,
  APP_ENV: 'local',
  APP_DEBUG: 'false',
  DB_CONNECTION: 'pgsql',
  DB_HOST: '127.0.0.1',
  DB_PORT: '5432',
  DB_DATABASE: DB,
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'root',
  CACHE_STORE: 'database',
  SESSION_DRIVER: 'array',
  QUEUE_CONNECTION: 'sync',
  BROADCAST_CONNECTION: 'null',
  LOG_CHANNEL: 'stderr',
  FOODCOURT_EMBEDDED: 'false',
  FOODCOURT_REQUIRE_PAIRING: 'true',
  FOODCOURT_PUBLIC_API_URL: `http://${lanIp}:${port}/api`,
});

const artisan = (port, ...args) => execFileSync('php', ['artisan', ...args], { cwd: BACKEND, env: hostEnv(port), encoding: 'utf8' });

let port;
let host = null;

const startHost = () => {
  host = spawn('php', ['-S', `${lanIp}:${port}`, '-t', join(BACKEND, 'public'), join(BACKEND, 'vendor', 'laravel', 'framework', 'src', 'Illuminate', 'Foundation', 'resources', 'server.php')], {
    cwd: join(BACKEND, 'public'), // the router script resolves index.php from the working directory
    env: hostEnv(port),
    stdio: 'ignore',
    windowsHide: true,
  });
};
const stopHost = async () => {
  if (!host) return;
  const h = host;
  host = null;
  await new Promise((r) => {
    h.once('exit', r);
    h.kill();
    setTimeout(r, 3000);
  });
};
const waitUp = async (ms = 30000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await fetch(`http://${lanIp}:${port}/up`).catch(() => null);
    if (r && r.status === 200) return true;
    await new Promise((r2) => setTimeout(r2, 300));
  }
  return false;
};

/** A paired computer: its own device token, and whoever is signed in on it. */
class Terminal {
  constructor(name) {
    this.name = name;
    this.device = null;
    this.user = null;
  }
  async pair(pairingString) {
    const d = pairing.decodePairingString(pairingString);
    assert.ok(d.ok, d.error);
    assert.equal(new URL(d.url).hostname, lanIp, 'the code carries the host address, not localhost');
    const res = await fetch(`${d.url}/pairing/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ code: d.code, device_name: this.name }) });
    const json = await res.json().catch(() => null);
    if (res.ok) {
      this.device = json.data.device_token;
      this.base = d.url;
    }
    return { status: res.status, json };
  }
  async call(method, path, body, { noDevice = false, as = this.user } = {}) {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(this.device && !noDevice ? { 'X-Device-Token': this.device } : {}), ...(as ? { Authorization: `Bearer ${as}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  }
  async signIn(email) {
    const r = await this.call('POST', '/auth/login', { email, password: SEED_PASSWORD }, { as: null });
    assert.equal(r.status, 200, `${email}: ${JSON.stringify(r.json)}`);
    return r.json.data.token;
  }
}

before(async () => {
  port = await new Promise((res) => {
    const t = net.createServer().listen(0, '0.0.0.0', () => {
      const p = t.address().port;
      t.close(() => res(p));
    });
  });
  psql(`DROP DATABASE IF EXISTS ${DB}`);
  psql(`CREATE DATABASE ${DB}`);
  artisan(port, 'migrate', '--seed', '--force');
  startHost();
  assert.ok(await waitUp(), 'host did not start');
});

after(async () => {
  await stopHost();
  psql(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
});

const state = {};

test('pairing: unpaired computers cannot sign in; the administrator pairs the first, the owner adds the rest', async () => {
  const stranger = new Terminal('STRANGER');
  stranger.base = `http://${lanIp}:${port}/api`;
  const blocked = await stranger.call('POST', '/auth/login', { email: 'owner@foodcourt.com', password: SEED_PASSWORD }, { as: null });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.code, 'device_not_paired');
  assert.equal((await stranger.call('GET', '/public/stalls')).status, 200, 'customer QR ordering stays open');
  assert.equal((await fetch(`http://${lanIp}:${port}/api/system/ready`)).status, 200);

  // First terminal: the administrator creates the code on the host (the command prints the pairing string)
  const out = artisan(port, 'foodcourt:pairing-code');
  const first = out.match(/FCPAIR1\.[A-Za-z0-9_-]+/)[0];
  const counter = new Terminal('COUNTER-1');
  assert.equal((await counter.pair(first)).status, 200);
  assert.equal((await counter.pair(first)).status, 422, 'a code works once');

  // The owner (signed in on the counter) creates codes for the other computers
  const owner = await counter.signIn('owner@foodcourt.com');
  counter.user = owner;
  state.counter = counter;
  state.ownerToken = owner;
  const mk = await counter.call('POST', '/pairing/codes');
  assert.equal(mk.status, 201);
  const kitchen = new Terminal('KITCHEN-1');
  assert.equal((await kitchen.pair(mk.json.data.pairing_string)).status, 200);
  const mk2 = await counter.call('POST', '/pairing/codes');
  const kitchen2 = new Terminal('KITCHEN-2');
  assert.equal((await kitchen2.pair(mk2.json.data.pairing_string)).status, 200);
  state.kitchen = kitchen;
  state.kitchen2 = kitchen2;

  const wrong = await new Terminal('X').pair('FCPAIR1.' + Buffer.from(JSON.stringify({ u: `http://${lanIp}:${port}/api`, c: 'AAAA-BBBB' })).toString('base64url'));
  assert.equal(wrong.status, 422);

  const list = await counter.call('GET', '/pairing/devices');
  assert.deepEqual(list.json.data.map((d) => d.name).sort(), ['COUNTER-1', 'KITCHEN-1', 'KITCHEN-2']);
});

test('shared data: an order placed at the counter is seen by every kitchen terminal, only for their own stall', async () => {
  const { counter, kitchen, kitchen2 } = state;
  const cashier = await counter.signIn('cashier@foodcourt.com');
  const menu = (await counter.call('GET', '/menu', null, { as: cashier })).json.data;
  const items = Array.isArray(menu) ? menu : menu.data;
  const byStall = {};
  for (const m of items) if (m.is_available !== false && !byStall[m.stall_id]) byStall[m.stall_id] = m;
  const stallIds = Object.keys(byStall).slice(0, 2);
  assert.equal(stallIds.length, 2, 'seed data has at least two stalls with menu items');
  const table = (await counter.call('GET', '/tables', null, { as: cashier })).json.data[0];

  const placed = await counter.call('POST', '/orders', { table_id: table.id, order_type: 'dine_in', items: stallIds.map((s) => ({ menu_item_id: byStall[s].id, quantity: 1 })) }, { as: cashier });
  assert.equal(placed.status, 201, JSON.stringify(placed.json));
  state.orderId = placed.json.data.id;

  // Two different kitchen PCs, signed in as the two stalls' kitchen staff, see the new tickets
  const pizza = await kitchen.signIn('kitchen.pizza@foodcourt.com');
  const burger = await kitchen2.signIn('kitchen.burger@foodcourt.com');
  const t1 = (await kitchen.call('GET', '/kitchen/tickets', null, { as: pizza })).json.data;
  const t2 = (await kitchen2.call('GET', '/kitchen/tickets', null, { as: burger })).json.data;
  const mine1 = t1.filter((t) => t.order_id === state.orderId);
  const mine2 = t2.filter((t) => t.order_id === state.orderId);
  assert.equal(mine1.length, 1, 'kitchen PC 1 sees the order placed on another computer');
  assert.equal(mine2.length, 1, 'kitchen PC 2 sees it too');
  assert.notEqual(mine1[0].stall_id, mine2[0].stall_id, 'each kitchen sees only its own stall ticket (stall isolation)');
  assert.ok(t1.every((t) => t.stall_id === mine1[0].stall_id), 'kitchen 1 never receives another stall\'s tickets');
  assert.ok(t2.every((t) => t.stall_id === mine2[0].stall_id), 'kitchen 2 never receives another stall\'s tickets');
  state.tickets = { pizza: mine1[0], burger: mine2[0], pizzaToken: pizza, burgerToken: burger };
});

test('cross-stall authorization: a kitchen cannot change another stall\'s ticket', async () => {
  const { kitchen, tickets } = state;
  const r = await kitchen.call('PUT', `/kitchen/tickets/${tickets.burger.id}/status`, { status: 'preparing' }, { as: tickets.pizzaToken });
  assert.ok([403, 404].includes(r.status), `expected refusal, got ${r.status}`);
});

test('kitchen progress and payment on different terminals are visible everywhere', async () => {
  const { counter, kitchen, kitchen2, tickets } = state;
  assert.equal((await kitchen.call('PUT', `/kitchen/tickets/${tickets.pizza.id}/status`, { status: 'preparing' }, { as: tickets.pizzaToken })).status, 200);
  assert.equal((await kitchen.call('PUT', `/kitchen/tickets/${tickets.pizza.id}/status`, { status: 'ready' }, { as: tickets.pizzaToken })).status, 200);
  assert.equal((await kitchen2.call('PUT', `/kitchen/tickets/${tickets.burger.id}/status`, { status: 'ready' }, { as: tickets.burgerToken })).status, 200);

  const cashier = await counter.signIn('cashier@foodcourt.com');
  const order = (await counter.call('GET', `/orders/${state.orderId}`, null, { as: cashier })).json.data;
  assert.equal(order.status, 'ready', 'the counter sees what the two kitchens did');

  const receipt = (await counter.call('GET', `/billing/receipt/${state.orderId}`, null, { as: cashier })).json.data;
  const total = Number(receipt.order.total_amount);
  const pay = await counter.call('POST', '/billing/pay', { order_id: state.orderId, payment_method: 'cash', amount: total, cash_tendered: total + 100 }, { as: cashier });
  assert.equal(pay.status, 200, JSON.stringify(pay.json));

  // A third computer (the owner's, using the kitchen PC's device) reads the same payment history
  const owner = await kitchen.signIn('owner@foodcourt.com');
  const payments = (await kitchen.call('GET', '/billing/payments', null, { as: owner })).json.data;
  const rows = Array.isArray(payments) ? payments : payments.data;
  assert.ok(rows.some((p) => p.order_id === state.orderId && p.status === 'success'), 'payment taken at the counter is visible on another terminal');
  const done = (await kitchen2.call('GET', `/orders/${state.orderId}`, null, { as: owner })).json.data;
  assert.equal(done.payment_status, 'paid');
});

test('a terminal disconnected by the owner is locked out at once, others keep working', async () => {
  const { counter, kitchen2 } = state;
  const owner = await counter.signIn('owner@foodcourt.com'); // one active session per account: a new sign-in replaces the old
  const list = (await counter.call('GET', '/pairing/devices', null, { as: owner })).json.data;
  const k2 = list.find((d) => d.name === 'KITCHEN-2');
  assert.equal((await counter.call('DELETE', `/pairing/devices/${k2.id}`, null, { as: owner })).status, 200);

  const dead = await kitchen2.call('POST', '/auth/login', { email: 'kitchen.burger@foodcourt.com', password: SEED_PASSWORD }, { as: null });
  assert.equal(dead.status, 403);
  assert.equal(dead.json.code, 'device_not_paired');
  assert.equal((await counter.call('GET', '/auth/me', null, { as: owner })).status, 200, 'the counter is unaffected');
  state.ownerToken = owner;
});

test('network interruption: terminals fail while the host is down and recover without re-pairing', async () => {
  const { counter } = state;
  const me = state.ownerToken;
  const before = await counter.call('GET', '/auth/me', null, { as: me });
  assert.equal(before.status, 200);

  await stopHost();
  const down = await counter.call('GET', '/auth/me', null, { as: me }).then(() => 'answered', () => 'unreachable');
  assert.equal(down, 'unreachable', 'with the host off, requests fail (the app shows its reconnecting banner)');

  startHost();
  assert.ok(await waitUp(), 'host did not come back');
  const after = await counter.call('GET', '/auth/me', null, { as: me });
  assert.equal(after.status, 200, 'same device token and sign-in still valid after the outage');
  const order = await counter.call('GET', `/orders/${state.orderId}`, null, { as: me });
  assert.equal(order.status, 200, 'data written before the outage is still there');
});

test('the database is reachable only through the host: PostgreSQL is not part of what terminals receive', async () => {
  const { counter } = state;
  const r = await counter.call('GET', '/system/ready', null, { noDevice: true });
  const body = JSON.stringify(r.json);
  assert.doesNotMatch(body, /5432|postgres|pgsql|password|DB_/i);
});
