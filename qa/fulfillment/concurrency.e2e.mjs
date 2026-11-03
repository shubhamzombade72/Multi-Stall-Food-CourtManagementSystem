/**
 * Fulfilment concurrency verification on PostgreSQL (Task 4 of the Smart Order Tracking plan).
 *
 *   node --test --test-timeout=300000 qa/fulfillment/concurrency.e2e.mjs
 *
 * Starts FOUR separate `php -S` API processes (PHP_CLI_SERVER_WORKERS is not supported on Windows), all on
 * one throw-away PostgreSQL database `foodcourt_concurrency_e2e`, and spreads every burst round-robin over
 * them, so up to four requests really run at the same time in four PHP processes / four DB sessions.
 *
 * Overlap is proven inside PostgreSQL, not inferred from client timings. A psql `\watch` session samples
 * pg_stat_activity every 20 ms. For the single-order bursts (a), (b), (b2), (c) a separate "lock gate" psql
 * session holds that order's row FOR UPDATE for 1.5 s while the burst is fired, so every API request blocks
 * on the same row lock and all four PHP workers are inside the critical section together; when the gate
 * commits they race. Each of those bursts asserts >= 2 API sessions active at the same instant AND >= 2
 * API sessions waiting on a row lock (gate session excluded). The 30-order bursts (d), which share no lock,
 * assert >= 2 API sessions active at once. Client-side start/end times and servers-in-flight are recorded
 * for the report only: they include time queued in a busy php -S listen backlog, so they prove nothing.
 *
 * Needs PHP on PATH and a local PostgreSQL 17 (postgres/root as in backend/phpunit.xml). Only the database
 * `foodcourt_concurrency_e2e` is created and dropped; only the PHP processes started here are stopped.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACKEND = join(REPO, 'backend');
const ROUTER = join(BACKEND, 'vendor', 'laravel', 'framework', 'src', 'Illuminate', 'Foundation', 'resources', 'server.php');
const PSQL = 'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe';
const DB = 'foodcourt_concurrency_e2e';
const SEED_PASSWORD = 'password123'; // seeded test data only
const WORKERS = 4;

const pgEnv = { ...process.env, PGPASSWORD: 'root' };
const psql = (sql, db = DB) =>
  execFileSync(PSQL, ['-h', '127.0.0.1', '-U', 'postgres', '-d', db, '-w', '-tAc', sql], { env: pgEnv, encoding: 'utf8' }).trim();
const psqlInt = (sql) => Number(psql(sql));

const apiEnv = {
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
  LOG_LEVEL: 'debug',
  FOODCOURT_EMBEDDED: 'false',
  FOODCOURT_REQUIRE_PAIRING: 'false',
};

const freePort = () =>
  new Promise((res) => {
    const t = net.createServer().listen(0, '127.0.0.1', () => {
      const p = t.address().port;
      t.close(() => res(p));
    });
  });

/** Only processes started by this script live here; nothing else is ever killed. */
const servers = [];
let serverLog = '';
let sampler = null;
const samples = []; // {t, active, waiting}

const startServer = (port) => {
  const proc = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', join(BACKEND, 'public'), ROUTER], {
    cwd: join(BACKEND, 'public'), // the router script resolves index.php from the working directory
    env: apiEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  proc.stdout.on('data', (d) => (serverLog += d));
  proc.stderr.on('data', (d) => (serverLog += d));
  servers.push({ port, proc });
};
const stopServers = async () => {
  await Promise.all(
    servers.splice(0).map(
      ({ proc }) =>
        new Promise((r) => {
          if (proc.exitCode !== null) return r();
          proc.once('exit', r);
          proc.kill();
          setTimeout(r, 3000);
        }),
    ),
  );
};
const waitUp = async (port, ms = 30000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await fetch(`http://127.0.0.1:${port}/up`).catch(() => null);
    if (r && r.status === 200) return true;
    await new Promise((r2) => setTimeout(r2, 300));
  }
  return false;
};

/** Background psql session sampling pg_stat_activity for this DB every 20 ms (evidence of DB-level overlap). */
const startSampler = () => {
  sampler = spawn(PSQL, ['-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres', '-w', '-tA', '-q'], { env: pgEnv, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  let buf = '';
  sampler.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      const m = line.match(/^(\d+(?:\.\d+)?)\|(\d+)\|(\d+)$/);
      if (m) samples.push({ t: Number(m[1]), active: Number(m[2]), waiting: Number(m[3]) });
    }
  });
  sampler.stdin.write(
    `SELECT extract(epoch from clock_timestamp())*1000, ` +
      `count(*) FILTER (WHERE state = 'active'), count(*) FILTER (WHERE wait_event_type = 'Lock') ` +
      `FROM pg_stat_activity WHERE datname = '${DB}' AND pid <> pg_backend_pid() AND application_name <> '${GATE_APP}' \\watch 0.02\n`,
  );
};
const stopSampler = async () => {
  if (!sampler) return;
  const s = sampler;
  sampler = null;
  await new Promise((r) => {
    if (s.exitCode !== null) return r();
    s.once('exit', r);
    s.kill();
    setTimeout(r, 2000);
  });
};

/**
 * Lock gate: a separate psql session takes the order row FOR UPDATE and holds it for GATE_MS while a burst is
 * fired. Every API request on that order then blocks inside PostgreSQL on the same row lock, so all four PHP
 * workers are provably inside the critical section at once; when the gate commits they race each other.
 * The gate session is excluded from the sampler's counts (application_name).
 */
const GATE_APP = 'e2e-lock-gate';
const GATE_MS = 1500;
const openGate = async (orderId) => {
  const gate = spawn(PSQL, ['-h', '127.0.0.1', '-U', 'postgres', '-d', DB, '-w', '-q', '-v', 'ON_ERROR_STOP=1'], { env: { ...pgEnv, PGAPPNAME: GATE_APP }, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
  let err = '';
  gate.stderr.on('data', (d) => (err += d));
  const done = new Promise((r) => gate.once('exit', (code) => r(code)));
  gate.stdin.end(`BEGIN;\nSELECT id FROM orders WHERE id = ${orderId} FOR UPDATE;\nSELECT pg_sleep(${GATE_MS / 1000});\nCOMMIT;\n`);
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    const holding = psqlInt(`SELECT count(*) FROM pg_stat_activity WHERE application_name = '${GATE_APP}' AND query LIKE '%pg_sleep%' AND state = 'active'`);
    if (holding === 1) return async () => assert.equal(await done, 0, `lock gate failed: ${err}`);
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`lock gate did not take the order lock: ${err}`);
};

// ------------------------------------------------------------------ HTTP with timing

let rr = 0;
const tokens = {};
const call = async (method, path, body, as, port = servers[rr++ % servers.length].port) => {
  const start = performance.timeOrigin + performance.now();
  const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(as ? { Authorization: `Bearer ${tokens[as]}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  const end = performance.timeOrigin + performance.now();
  return { status: res.status, json, port, start, end };
};

/**
 * Fires all requests at once (round-robin over the four servers) and asserts real overlap: at some instant,
 * requests to every server were in flight together. Returns the responses in request order.
 */
const evidence = [];
const burst = async (label, requests, { minDbActive = 0, minLockWaiting = 0, gateOrderId = null } = {}) => {
  const closeGate = gateOrderId ? await openGate(gateOrderId) : null;
  const t0 = Date.now();
  const results = await Promise.all(requests.map((r) => call(r.method, r.path, r.body, r.as)));
  if (closeGate) await closeGate();
  const t1 = Date.now();

  // Sweep: max number of distinct ports with a request in flight at the same instant
  const events = results.flatMap((r) => [
    { t: r.start, d: +1, port: r.port },
    { t: r.end, d: -1, port: r.port },
  ]);
  events.sort((a, b) => a.t - b.t || a.d - b.d); // ends before starts at equal times (no false overlap)
  const inFlight = new Map();
  let maxPorts = 0;
  let maxRequests = 0;
  let total = 0;
  for (const e of events) {
    inFlight.set(e.port, (inFlight.get(e.port) ?? 0) + e.d);
    if (inFlight.get(e.port) === 0) inFlight.delete(e.port);
    total += e.d;
    maxPorts = Math.max(maxPorts, inFlight.size);
    maxRequests = Math.max(maxRequests, total);
  }
  // Pairwise overlap of the first request sent to each server (each was accepted by an idle server at once)
  const firstPerPort = [...new Map(results.map((r) => [r.port, r])).values()];
  const window = { from: Math.max(...firstPerPort.map((r) => r.start)), to: Math.min(...firstPerPort.map((r) => r.end)) };
  const db = samples.filter((s) => s.t >= t0 && s.t <= t1 + 50);
  const statuses = results.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
  const row = {
    label,
    requests: results.length,
    wallMs: t1 - t0,
    maxConcurrentServers: maxPorts,
    maxConcurrentRequests: maxRequests,
    firstPerServerCommonWindowMs: Math.round(window.to - window.from),
    dbMaxActive: db.length ? Math.max(...db.map((s) => s.active)) : null,
    dbMaxLockWaiting: db.length ? Math.max(...db.map((s) => s.waiting)) : null,
    dbSamples: db.length,
    statuses,
  };
  evidence.push(row);
  console.log('[burst]', JSON.stringify(row));

  // Sanity only (client timings include backlog queueing): every server received part of the burst
  assert.equal(new Set(results.map((r) => r.port)).size, WORKERS, `${label}: the burst is spread over all ${WORKERS} servers`);
  // Proof of overlap, measured inside PostgreSQL
  if (minDbActive) {
    assert.ok(db.length > 0, `${label}: the pg_stat_activity sampler produced samples during the burst`);
    assert.ok(row.dbMaxActive >= minDbActive, `${label}: ${row.dbMaxActive} API sessions active at once in PostgreSQL, need >= ${minDbActive}`);
  }
  if (minLockWaiting) {
    assert.ok(row.dbMaxLockWaiting >= minLockWaiting, `${label}: ${row.dbMaxLockWaiting} sessions waited on a row lock, need >= ${minLockWaiting}`);
  }
  for (const r of results) assert.notEqual(r.status, 500, `${label}: 500 from server: ${JSON.stringify(r.json)}`);
  return results;
};

// ------------------------------------------------------------------ fixtures

const ids = {};
const placeOrder = async (pizzaCount, burgerCount) => {
  const items = [...ids.pizzaMenu.slice(0, pizzaCount), ...ids.burgerMenu.slice(0, burgerCount)].map((id) => ({ menu_item_id: id, quantity: 1 }));
  const r = await call('POST', '/orders', { order_type: 'takeaway', items }, 'cashier');
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const orderId = r.json.data.id;
  const rows = psql(
    `SELECT sti.id, skt.stall_id, skt.id FROM stall_ticket_items sti JOIN stall_kitchen_tickets skt ON skt.id = sti.ticket_id WHERE skt.order_id = ${orderId} ORDER BY sti.id`,
  )
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('|').map(Number));
  const pizza = rows.filter((x) => x[1] === ids.pizzaStall).map((x) => x[0]);
  const burger = rows.filter((x) => x[1] === ids.burgerStall).map((x) => x[0]);
  const ticket = (stall) => rows.find((x) => x[1] === stall)?.[2];
  return { orderId, all: rows.map((x) => x[0]), pizza, burger, pizzaTicket: ticket(ids.pizzaStall), burgerTicket: ticket(ids.burgerStall) };
};

const item = (id) => {
  const [status, version] = psql(`SELECT status, version FROM stall_ticket_items WHERE id = ${id}`).split('|');
  return { status, version: Number(version) };
};
const itemAudits = (idList) =>
  psqlInt(`SELECT count(*) FROM audit_logs WHERE action = 'ticket_item_status' AND entity_type = 'StallTicketItem' AND entity_id IN (${idList.map((i) => `'${i}'`).join(',')})`);
const versionsSum = (idList) => psqlInt(`SELECT COALESCE(sum(version), 0) FROM stall_ticket_items WHERE id IN (${idList.join(',')})`);
/** No lost update: for every item, version == number of audited writes (each write is +1 and one audit). */
const assertVersionsMatchAudits = (idList, label) => {
  const rows = psql(
    `SELECT sti.id, sti.version, (SELECT count(*) FROM audit_logs a WHERE a.action = 'ticket_item_status' AND a.entity_type = 'StallTicketItem' AND a.entity_id = sti.id::text) FROM stall_ticket_items sti WHERE sti.id IN (${idList.join(',')})`,
  )
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('|').map(Number));
  for (const [id, version, audits] of rows) assert.equal(version, audits, `${label}: item ${id} version ${version} but ${audits} audited writes`);
};
const shuffle = (a) => {
  const c = [...a];
  for (let i = c.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c;
};

// ------------------------------------------------------------------ lifecycle

before(async () => {
  psql(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`, 'postgres');
  psql(`CREATE DATABASE ${DB}`, 'postgres');
  execFileSync('php', ['artisan', 'migrate', '--seed', '--force'], { cwd: BACKEND, env: apiEnv, encoding: 'utf8' });

  const ports = [];
  while (ports.length < WORKERS) {
    const p = await freePort();
    if (p !== 8100 && !ports.includes(p)) ports.push(p);
  }
  ports.forEach(startServer);
  for (const p of ports) assert.ok(await waitUp(p), `php -S on ${p} did not start`);
  startSampler();

  // Log every user in ONCE (login revokes earlier tokens) and reuse the token on all four servers
  for (const [as, email] of Object.entries({
    cashier: 'cashier@foodcourt.com',
    waiter: 'waiter1@foodcourt.com',
    pizza: 'kitchen.pizza@foodcourt.com',
    burger: 'kitchen.burger@foodcourt.com',
  })) {
    const r = await call('POST', '/auth/login', { email, password: SEED_PASSWORD }, null);
    assert.equal(r.status, 200, `${email}: ${JSON.stringify(r.json)}`);
    tokens[as] = r.json.data.token;
  }
  ids.pizzaStall = psqlInt(`SELECT stall_id FROM users WHERE email = 'kitchen.pizza@foodcourt.com'`);
  ids.burgerStall = psqlInt(`SELECT stall_id FROM users WHERE email = 'kitchen.burger@foodcourt.com'`);
  const menu = (stall) => psql(`SELECT id FROM menu_items WHERE stall_id = ${stall} AND is_available ORDER BY id LIMIT 2`).split('\n').map(Number);
  ids.pizzaMenu = menu(ids.pizzaStall);
  ids.burgerMenu = menu(ids.burgerStall);
  assert.equal(ids.pizzaMenu.length, 2);
  assert.equal(ids.burgerMenu.length, 2);
});

after(async () => {
  try {
    await stopSampler();
    await stopServers();
  } finally {
    psql(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`, 'postgres');
    console.log('[evidence]', JSON.stringify(evidence));
  }
});

// ------------------------------------------------------------------ scenarios

test('(a) 20 parallel "served" taps on one item with the same expected_version: exactly one change', async () => {
  for (let round = 0; round < 3; round++) {
    const o = await placeOrder(1, 0);
    const id = o.pizza[0];
    assert.deepEqual(item(id), { status: 'pending', version: 0 });

    const results = await burst(`a#${round}`, Array.from({ length: 20 }, (_, i) => ({
      method: 'PATCH',
      path: `/ticket-items/${id}/status`,
      body: { status: 'served', expected_version: 0 },
      as: i % 2 ? 'waiter' : 'cashier',
    })), { gateOrderId: o.orderId, minDbActive: 2, minLockWaiting: 2 });

    const changed = results.filter((r) => r.status === 200 && r.json.data.changed === true);
    assert.equal(changed.length, 1, 'exactly one request changes the item');
    for (const r of results) {
      if (r.status === 200) continue; // the winner, or a harmless no-op
      assert.equal(r.status, 409, `loser must be 409, got ${r.status} ${JSON.stringify(r.json)}`);
      assert.equal(r.json.error, 'version_conflict');
      assert.equal(r.json.data.item.status, 'served', '409 carries the latest item');
      assert.equal(r.json.data.item.version, 1);
    }
    for (const r of results.filter((x) => x.status === 200 && !x.json.data.changed)) assert.equal(r.json.data.item.status, 'served');
    assert.deepEqual(item(id), { status: 'served', version: 1 }, 'version moved by exactly +1');
    assert.equal(itemAudits([id]), 1, 'exactly one audit row');
    assert.equal(psql(`SELECT status FROM orders WHERE id = ${o.orderId}`), 'served');
  }
});

test('(b) 10 parallel Serve All with the same key: identical results, served once, one operation, one audit', async () => {
  for (let round = 0; round < 3; round++) {
    const o = await placeOrder(2, 1);
    const key = `concurrency-b-${round}-${Date.now()}`;
    const results = await burst(`b#${round}`, Array.from({ length: 10 }, () => ({
      method: 'POST',
      path: `/orders/${o.orderId}/serve-remaining`,
      body: { idempotency_key: key, item_ids: shuffle(o.all) }, // same set, any order → same request hash
      as: 'cashier',
    })), { gateOrderId: o.orderId, minDbActive: 2, minLockWaiting: 2 });

    for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(results.filter((r) => r.json.data.replayed === false).length, 1, 'one request does the work');
    assert.equal(results.filter((r) => r.json.data.replayed === true).length, 9, 'the rest replay it');
    for (const r of results) {
      assert.deepEqual(r.json.data.served_item_ids, [...o.all].sort((x, y) => x - y), 'identical served_item_ids');
      assert.ok(r.json.data.order.items.every((i) => i.status === 'served' && i.version === 1));
    }
    for (const id of o.all) assert.deepEqual(item(id), { status: 'served', version: 1 }, `item ${id} served once`);
    assert.equal(itemAudits(o.all), o.all.length, 'one item audit per item');
    assert.equal(psqlInt(`SELECT count(*) FROM fulfillment_operations WHERE order_id = ${o.orderId}`), 1, 'one operation row');
    assert.equal(psqlInt(`SELECT count(*) FROM audit_logs WHERE action = 'order_serve_remaining' AND entity_id = '${o.orderId}'`), 1, 'one bulk audit');
  }
});

test('(b2) same key raced with two different item sets: the first committed set wins, the other gets 409', async () => {
  const o = await placeOrder(2, 1);
  const key = `concurrency-b2-${Date.now()}`;
  const setA = o.all;
  const setB = o.all.slice(0, 2);
  const results = await burst('b2', Array.from({ length: 10 }, (_, i) => ({
    method: 'POST',
    path: `/orders/${o.orderId}/serve-remaining`,
    body: { idempotency_key: key, item_ids: i % 2 ? setB : setA },
    as: 'cashier',
  })), { gateOrderId: o.orderId, minDbActive: 2, minLockWaiting: 2 });

  const winners = results.filter((r) => r.status === 200 && r.json.data.replayed === false);
  assert.equal(winners.length, 1);
  const winnerSet = results.indexOf(winners[0]) % 2 ? setB : setA;
  results.forEach((r, i) => {
    const mine = i % 2 ? setB : setA;
    if (mine === winnerSet) {
      assert.equal(r.status, 200);
      assert.deepEqual(r.json.data.served_item_ids, winners[0].json.data.served_item_ids);
    } else {
      assert.equal(r.status, 409, JSON.stringify(r.json));
      assert.equal(r.json.error, 'idempotency_key_reused');
    }
  });
  assert.equal(psqlInt(`SELECT count(*) FROM fulfillment_operations WHERE order_id = ${o.orderId}`), 1);
  assert.equal(psqlInt(`SELECT count(*) FROM audit_logs WHERE action = 'order_serve_remaining' AND entity_id = '${o.orderId}'`), 1);
  assert.equal(itemAudits(o.all), winnerSet.length);
  assertVersionsMatchAudits(o.all, 'b2');
});

test('(c) Serve All racing single-item taps and KDS ticket updates on one order: consistent final state', async () => {
  for (let round = 0; round < 5; round++) {
    const o = await placeOrder(2, 2);
    const [p1, p2] = o.pizza;
    const [b1, b2] = o.burger;
    const reqs = shuffle([
      { method: 'POST', path: `/orders/${o.orderId}/serve-remaining`, body: { idempotency_key: `concurrency-c-${round}-${Date.now()}`, item_ids: o.all }, as: 'cashier' },
      { method: 'PATCH', path: `/ticket-items/${p1}/status`, body: { status: 'served' }, as: 'cashier' },
      { method: 'PATCH', path: `/ticket-items/${b1}/status`, body: { status: 'served', expected_version: 0 }, as: 'waiter' },
      { method: 'PATCH', path: `/ticket-items/${p2}/status`, body: { status: 'ready' }, as: 'pizza' },
      { method: 'PATCH', path: `/ticket-items/${b2}/status`, body: { status: 'ready' }, as: 'burger' },
      { method: 'PUT', path: `/kitchen/tickets/${o.pizzaTicket}/status`, body: { status: 'preparing' }, as: 'pizza' },
      { method: 'PUT', path: `/kitchen/tickets/${o.burgerTicket}/status`, body: { status: 'ready' }, as: 'burger' },
      { method: 'PATCH', path: `/ticket-items/${p2}/status`, body: { status: 'served' }, as: 'waiter' },
    ]);
    const results = await burst(`c#${round}`, reqs, { gateOrderId: o.orderId, minDbActive: 2, minLockWaiting: 2 });
    results.forEach((r, i) => {
      // 409 (stale expected_version) and 422 (would move backwards / ticket already past that state) are
      // legitimate outcomes of a race; anything else is a bug.
      assert.ok([200, 409, 422].includes(r.status), `${reqs[i].method} ${reqs[i].path} → ${r.status} ${JSON.stringify(r.json)}`);
    });
    const serveAll = results[reqs.findIndex((r) => r.path.endsWith('/serve-remaining'))];
    assert.equal(serveAll.status, 200, 'Serve All always succeeds');

    for (const id of o.all) assert.equal(item(id).status, 'served', `item ${id} ends served`);
    assert.equal(psql(`SELECT string_agg(DISTINCT status, ',') FROM stall_kitchen_tickets WHERE order_id = ${o.orderId}`), 'picked_up');
    assert.ok(['served', 'completed'].includes(psql(`SELECT status FROM orders WHERE id = ${o.orderId}`)));
    assert.equal(psqlInt(`SELECT count(*) FROM order_items WHERE order_id = ${o.orderId} AND status <> 'served'`), 0, 'order_items mirror is served');
    assertVersionsMatchAudits(o.all, `c#${round}`);
  }
});

test('(d) 30 orders x 4 items updated concurrently across orders: every item served, no lost update', async () => {
  const orders = [];
  for (let i = 0; i < 30; i++) orders.push(await placeOrder(2, 2));
  const all = orders.flatMap((o) => o.all);
  assert.equal(all.length, 120);
  const pizzaItems = new Set(orders.flatMap((o) => o.pizza));

  // Burst 1: the kitchens mark every item ready (each stall its own items), all at once across 30 orders
  const ready = await burst('d-ready', shuffle(all).map((id) => ({ method: 'PATCH', path: `/ticket-items/${id}/status`, body: { status: 'ready' }, as: pizzaItems.has(id) ? 'pizza' : 'burger' })), { minDbActive: 2 });
  // Burst 2: cashier and waiter both tap Served on every item at the same time
  const served = await burst('d-served', shuffle(all.flatMap((id) => [
    { method: 'PATCH', path: `/ticket-items/${id}/status`, body: { status: 'served' }, as: 'cashier' },
    { method: 'PATCH', path: `/ticket-items/${id}/status`, body: { status: 'served' }, as: 'waiter' },
  ])), { minDbActive: 2 });

  for (const r of [...ready, ...served]) assert.equal(r.status, 200, JSON.stringify(r.json));
  const changes = [...ready, ...served].filter((r) => r.json.data.changed).length;
  assert.equal(changes, 240, 'one ready + one served change per item');
  assert.equal(psqlInt(`SELECT count(*) FROM stall_ticket_items WHERE id IN (${all.join(',')}) AND status = 'served'`), 120, 'every item served');
  assert.equal(versionsSum(all), changes, 'sum of versions = number of changes (no lost update)');
  assert.equal(itemAudits(all), changes, 'one audit per change');
  assertVersionsMatchAudits(all, 'd');
  const orderStatuses = psql(`SELECT string_agg(DISTINCT status, ',') FROM orders WHERE id IN (${orders.map((o) => o.orderId).join(',')})`);
  assert.equal(orderStatuses, 'served');
});

test('no deadlocks or serialization failures anywhere: server log and pg_stat_database', async () => {
  // Shared-memory stats are flushed at most once a second by idle backends
  await new Promise((r) => setTimeout(r, 1500));
  const deadlocks = psqlInt(`SELECT deadlocks FROM pg_stat_database WHERE datname = '${DB}'`);
  assert.equal(deadlocks, 0, 'PostgreSQL recorded no deadlock in this database');
  assert.doesNotMatch(serverLog, /deadlock|40P01|40001|could not serialize|lock timeout/i, 'no deadlock / serialization error in the API log');
  // Expected 409/422 refusals are not reported (dontReport FulfillmentException): zero error-level lines allowed
  const errorLines = serverLog.split('\n').filter((l) => /\.(ERROR|CRITICAL|EMERGENCY|ALERT|WARNING):/.test(l));
  console.log('[log]', JSON.stringify({ errorOrWarningLines: errorLines.length }));
  assert.deepEqual(errorLines, [], 'no error- or warning-level log line at all');
  assert.doesNotMatch(serverLog, /\[500\]:/, 'no HTTP 500 in the access log');
  assert.ok(samples.length > 0, 'the pg_stat_activity sampler produced samples');
  const peak = Math.max(...samples.map((s) => s.active));
  console.log('[db-overlap]', JSON.stringify({ samples: samples.length, peakActiveSessions: peak, peakLockWaiting: Math.max(...samples.map((s) => s.waiting)) }));
  assert.ok(peak >= 2, 'PostgreSQL saw at least two API sessions active at the same instant');
});
