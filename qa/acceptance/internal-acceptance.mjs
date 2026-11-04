/**
 * Internal Acceptance Testing Suite for Multi-Stall Food Court System
 * Validates:
 *   - Critical API contracts (409 version conflict, 200 no-op, 422 invalid transition, 409 key reuse)
 *   - Scenario A: Multi-stall order & stall isolation
 *   - Scenario B: Item-level fulfillment & reconciliation
 *   - Scenario C: Concurrency & audit integrity
 *   - Scenario D: Persistence across server process restart
 *   - Scenario E: Role authorization & access controls
 *   - Scalability & Data Integrity (>150 active orders, pagination, unserved orders board visibility, cancelled handling)
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACKEND = join(REPO, 'backend');
const ROUTER = join(BACKEND, 'vendor', 'laravel', 'framework', 'src', 'Illuminate', 'Foundation', 'resources', 'server.php');
const PSQL = 'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe';
const DB = 'foodcourt_acceptance_db';
const SEED_PASSWORD = 'password123';

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

let serverProc = null;
let serverPort = null;
let serverLog = '';

const startServer = (port) => {
  serverProc = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', join(BACKEND, 'public'), ROUTER], {
    cwd: join(BACKEND, 'public'),
    env: apiEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  serverProc.stdout.on('data', (d) => (serverLog += d));
  serverProc.stderr.on('data', (d) => (serverLog += d));
  serverPort = port;
};

const stopServer = async () => {
  if (!serverProc) return;
  const p = serverProc;
  serverProc = null;
  await new Promise((r) => {
    if (p.exitCode !== null) return r();
    p.once('exit', r);
    p.kill();
    setTimeout(r, 3000);
  });
};

const waitUp = async (port, ms = 30000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await fetch(`http://127.0.0.1:${port}/up`).catch(() => null);
    if (r && r.status === 200) return true;
    await new Promise((r2) => setTimeout(r2, 200));
  }
  return false;
};

const tokens = {};
const call = async (method, path, body, as = null, port = serverPort) => {
  const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(as ? { Authorization: `Bearer ${tokens[as]}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
};

const ids = {};
const testResults = [];
const record = (scenario, testId, description, passed, details = '') => {
  testResults.push({ scenario, testId, description, status: passed ? 'PASS' : 'FAIL', details });
  console.log(`${passed ? 'PASS' : 'FAIL'} [${scenario}] ${testId}: ${description} ${details ? '(' + details + ')' : ''}`);
};

// ------------------------------------------------------------------ Lifecycle
before(async () => {
  psql(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`, 'postgres');
  psql(`CREATE DATABASE ${DB}`, 'postgres');
  execFileSync('php', ['artisan', 'migrate', '--seed', '--force'], { cwd: BACKEND, env: apiEnv, encoding: 'utf8' });

  serverPort = await freePort();
  startServer(serverPort);
  assert.ok(await waitUp(serverPort), 'Server did not start');

  // Authenticate users
  for (const [as, email] of Object.entries({
    owner: 'owner@foodcourt.com',
    cashier: 'cashier@foodcourt.com',
    waiter: 'waiter1@foodcourt.com',
    pizza: 'kitchen.pizza@foodcourt.com',
    burger: 'kitchen.burger@foodcourt.com',
  })) {
    const r = await call('POST', '/auth/login', { email, password: SEED_PASSWORD }, null);
    assert.equal(r.status, 200, `login failed for ${email}`);
    tokens[as] = r.json.data.token;
  }

  ids.pizzaStall = psqlInt(`SELECT stall_id FROM users WHERE email = 'kitchen.pizza@foodcourt.com'`);
  ids.burgerStall = psqlInt(`SELECT stall_id FROM users WHERE email = 'kitchen.burger@foodcourt.com'`);

  const getMenu = (sid) => psql(`SELECT id FROM menu_items WHERE stall_id = ${sid} AND is_available ORDER BY id LIMIT 2`).split('\n').map(Number);
  ids.pizzaMenu = getMenu(ids.pizzaStall);
  ids.burgerMenu = getMenu(ids.burgerStall);
});

after(async () => {
  try {
    await stopServer();
  } finally {
    psql(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`, 'postgres');
    mkdirSync(join(REPO, 'qa', 'acceptance', 'results'), { recursive: true });
    writeFileSync(join(REPO, 'qa', 'acceptance', 'results', 'acceptance-results.json'), JSON.stringify(testResults, null, 2), 'utf8');
  }
});

// ------------------------------------------------------------------ Scenarios

test('Contract Reconciliation: 409 version conflict, 200 no-op, 422 invalid transition, 409 key reuse', async () => {
  const ord = await call('POST', '/orders', {
    order_type: 'dine_in',
    items: [{ menu_item_id: ids.pizzaMenu[0], quantity: 1 }],
  }, 'cashier');
  assert.equal(ord.status, 201);
  const orderId = ord.json.data.id;
  const itemId = psqlInt(`SELECT sti.id FROM stall_ticket_items sti JOIN stall_kitchen_tickets skt ON skt.id = sti.ticket_id WHERE skt.order_id = ${orderId}`);

  // Check 1: stale expected_version -> 409 Conflict
  const stale = await call('PATCH', `/ticket-items/${itemId}/status`, { status: 'ready', expected_version: 999 }, 'pizza');
  const check1 = stale.status === 409 && stale.json.error === 'version_conflict' && stale.json.data.item.id === itemId;
  record('Contract', 'CTR-01', 'Stale expected_version returns HTTP 409 with version_conflict and current item', check1, `HTTP ${stale.status}`);
  assert.ok(check1);

  // Check 2: valid advance to ready with version 0 -> 200
  const adv = await call('PATCH', `/ticket-items/${itemId}/status`, { status: 'ready', expected_version: 0 }, 'pizza');
  const check2 = adv.status === 200 && adv.json.data.changed === true && adv.json.data.item.status === 'ready' && adv.json.data.item.version === 1;
  record('Contract', 'CTR-02', 'Valid advance increments version to 1 with changed:true', check2, `Version ${adv.json.data.item.version}`);
  assert.ok(check2);

  // Check 3: same-status request with stale expected_version -> 200 no-op (D4)
  const noop = await call('PATCH', `/ticket-items/${itemId}/status`, { status: 'ready', expected_version: 0 }, 'pizza');
  const check3 = noop.status === 200 && noop.json.data.changed === false && noop.json.data.item.status === 'ready';
  record('Contract', 'CTR-03', 'Same-status request returns HTTP 200 with changed:false (no-op)', check3, `Changed: ${noop.json.data.changed}`);
  assert.ok(check3);

  // Check 4: invalid backward transition (ready -> preparing) -> 422
  const backward = await call('PATCH', `/ticket-items/${itemId}/status`, { status: 'preparing' }, 'pizza');
  const check4 = backward.status === 422 && backward.json.error === 'invalid_transition';
  record('Contract', 'CTR-04', 'Backward transition returns HTTP 422 with invalid_transition', check4, `HTTP ${backward.status}`);
  assert.ok(check4);

  // Check 5: Serve All Remaining with key -> 200
  const key = `idemp-${Date.now()}`;
  const s1 = await call('POST', `/orders/${orderId}/serve-remaining`, { idempotency_key: key, item_ids: [itemId] }, 'cashier');
  const check5 = s1.status === 200 && s1.json.data.order.items[0].status === 'served';
  record('Contract', 'CTR-05', 'Serve All Remaining returns HTTP 200', check5);
  assert.ok(check5);

  // Check 6: Replay same key with same payload -> 200 cached
  const s2 = await call('POST', `/orders/${orderId}/serve-remaining`, { idempotency_key: key, item_ids: [itemId] }, 'cashier');
  const check6 = s2.status === 200 && s2.json.data.order.id === orderId;
  record('Contract', 'CTR-06', 'Replay identical key returns HTTP 200', check6);
  assert.ok(check6);

  // Check 7: Replay same key with conflicting payload -> 409 Conflict
  const s3 = await call('POST', `/orders/${orderId}/serve-remaining`, { idempotency_key: key, item_ids: [itemId, 99999] }, 'cashier');
  const check7 = s3.status === 409 && s3.json.error === 'idempotency_key_reused';
  record('Contract', 'CTR-07', 'Same key with different payload returns HTTP 409 idempotency_key_reused', check7, `HTTP ${s3.status}`);
  assert.ok(check7);
});

test('Scenario A: Multi-Stall Order Placement & Kitchen Ticket Splitting', async () => {
  const res = await call('POST', '/orders', {
    order_type: 'dine_in',
    items: [
      { menu_item_id: ids.pizzaMenu[0], quantity: 2 },
      { menu_item_id: ids.burgerMenu[0], quantity: 1 },
    ],
  }, 'cashier');
  assert.equal(res.status, 201);
  const orderId = res.json.data.id;

  // Verify tickets in database: select id, stall_id, status
  const tickets = psql(`SELECT id, stall_id, status FROM stall_kitchen_tickets WHERE order_id = ${orderId} ORDER BY stall_id`)
    .split('\n')
    .map((l) => l.split('|'));
  const checkA1 = tickets.length === 2 && tickets.some(([id, s]) => Number(s) === ids.pizzaStall) && tickets.some(([id, s]) => Number(s) === ids.burgerStall);
  record('Scenario A', 'SCN-A01', 'Multi-stall order generates 1 ticket per stall (2 tickets total)', checkA1, `Found ${tickets.length} tickets`);
  assert.ok(checkA1);

  // Stall isolation on KDS
  const pizzaKds = await call('GET', '/kitchen/tickets', null, 'pizza');
  const burgerKds = await call('GET', '/kitchen/tickets', null, 'burger');
  const checkA2 = pizzaKds.status === 200 && pizzaKds.json.data.every((t) => t.stall_id === ids.pizzaStall) &&
                  burgerKds.status === 200 && burgerKds.json.data.every((t) => t.stall_id === ids.burgerStall);
  record('Scenario A', 'SCN-A02', 'Each stall KDS sees ONLY its own stall tickets', checkA2, 'Strict stall isolation confirmed');
  assert.ok(checkA2);

  // Cross-stall modification rejection: pizza chef tries to update burger ticket
  const burgerTicket = tickets.find(([id, s]) => Number(s) === ids.burgerStall);
  const burgerTicketId = Number(burgerTicket[0]);
  const cross = await call('PUT', `/kitchen/tickets/${burgerTicketId}/status`, { status: 'accepted' }, 'pizza');
  const checkA3 = cross.status === 403;
  record('Scenario A', 'SCN-A03', 'Cross-stall ticket update rejected with HTTP 403', checkA3, `HTTP ${cross.status}`);
  assert.ok(checkA3);
});

test('Scenario B: Item-Level Fulfillment & Status Reconciliation', async () => {
  const res = await call('POST', '/orders', {
    order_type: 'dine_in',
    items: [
      { menu_item_id: ids.pizzaMenu[0], quantity: 1 },
      { menu_item_id: ids.pizzaMenu[1], quantity: 1 },
      { menu_item_id: ids.burgerMenu[0], quantity: 1 },
      { menu_item_id: ids.burgerMenu[1], quantity: 1 },
    ],
  }, 'cashier');
  assert.equal(res.status, 201);
  const orderId = res.json.data.id;

  const itemRows = psql(`SELECT sti.id, skt.stall_id FROM stall_ticket_items sti JOIN stall_kitchen_tickets skt ON skt.id = sti.ticket_id WHERE skt.order_id = ${orderId} ORDER BY sti.id`)
    .split('\n')
    .map((l) => l.split('|').map(Number));
  const pizzaItemIds = itemRows.filter(([id, sid]) => sid === ids.pizzaStall).map(([id]) => id);
  const burgerItemIds = itemRows.filter(([id, sid]) => sid === ids.burgerStall).map(([id]) => id);

  // Move 1 pizza item to Ready
  await call('PATCH', `/ticket-items/${pizzaItemIds[0]}/status`, { status: 'ready' }, 'pizza');
  let orderStatus = psql(`SELECT status FROM orders WHERE id = ${orderId}`);
  const checkB1 = orderStatus === 'partially_ready' || orderStatus === 'in_preparation';
  record('Scenario B', 'SCN-B01', '1 item ready moves order to partially_ready / in_preparation', checkB1, `Status: ${orderStatus}`);
  assert.ok(checkB1);

  // Serve 1 pizza item
  await call('PATCH', `/ticket-items/${pizzaItemIds[0]}/status`, { status: 'served' }, 'cashier');
  const unservedCount = psqlInt(`SELECT count(*) FROM stall_ticket_items sti JOIN stall_kitchen_tickets skt ON skt.id = sti.ticket_id WHERE skt.order_id = ${orderId} AND sti.status <> 'served'`);
  const checkB2 = unservedCount === 3;
  record('Scenario B', 'SCN-B02', 'Serving 1 item leaves other 3 items unserved', checkB2, `Unserved: ${unservedCount}`);
  assert.ok(checkB2);

  // Execute Serve All Remaining for this order
  const sKey = `serve-all-${Date.now()}`;
  const allRes = await call('POST', `/orders/${orderId}/serve-remaining`, { idempotency_key: sKey, item_ids: [pizzaItemIds[1], ...burgerItemIds] }, 'cashier');
  assert.equal(allRes.status, 200);

  const allServed = psqlInt(`SELECT count(*) FROM stall_ticket_items sti JOIN stall_kitchen_tickets skt ON skt.id = sti.ticket_id WHERE skt.order_id = ${orderId} AND sti.status = 'served'`);
  const finalOrder = psql(`SELECT status FROM orders WHERE id = ${orderId}`);
  const ticketsPickedUp = psqlInt(`SELECT count(*) FROM stall_kitchen_tickets WHERE order_id = ${orderId} AND status = 'picked_up'`);
  const checkB3 = allServed === 4 && finalOrder === 'served' && ticketsPickedUp === 2;
  record('Scenario B', 'SCN-B03', 'Serve All Remaining reconciles order to served and all tickets to picked_up', checkB3, `Items: ${allServed}/4, Order: ${finalOrder}, Tickets picked_up: ${ticketsPickedUp}`);
  assert.ok(checkB3);
});

test('Scenario C: Concurrency & Audit Integrity', async () => {
  const ord = await call('POST', '/orders', {
    order_type: 'takeaway',
    items: [
      { menu_item_id: ids.pizzaMenu[0], quantity: 1 },
      { menu_item_id: ids.burgerMenu[0], quantity: 1 },
    ],
  }, 'cashier');
  const orderId = ord.json.data.id;
  const itemIds = psql(`SELECT id FROM stall_ticket_items WHERE ticket_id IN (SELECT id FROM stall_kitchen_tickets WHERE order_id = ${orderId})`).split('\n').map(Number);

  // Concurrently dispatch: 1 single-item serve + 1 Serve All Remaining
  const p1 = call('PATCH', `/ticket-items/${itemIds[0]}/status`, { status: 'served', expected_version: 0 }, 'cashier');
  const p2 = call('POST', `/orders/${orderId}/serve-remaining`, { idempotency_key: `race-${Date.now()}`, item_ids: itemIds }, 'waiter');

  const [r1, r2] = await Promise.all([p1, p2]);
  const statuses = [r1.status, r2.status];
  const checkC1 = statuses.every((s) => s === 200 || s === 409 || s === 422);
  record('Scenario C', 'SCN-C01', 'Concurrent item serve and Serve All complete without 500 error', checkC1, `Statuses: ${statuses.join(',')}`);
  assert.ok(checkC1);

  // Check no lost updates: each item's version == count of audit rows
  for (const itId of itemIds) {
    const version = psqlInt(`SELECT version FROM stall_ticket_items WHERE id = ${itId}`);
    const audits = psqlInt(`SELECT count(*) FROM audit_logs WHERE action = 'ticket_item_status' AND entity_type = 'StallTicketItem' AND entity_id = '${itId}'`);
    assert.equal(version, audits, `Item ${itId}: version ${version} != audits ${audits}`);
  }
  record('Scenario C', 'SCN-C02', 'Audit trail matches version exactly (no lost updates)', true);
});

test('Scenario D: Persistence Across Backend Restart', async () => {
  const ord = await call('POST', '/orders', {
    order_type: 'dine_in',
    items: [{ menu_item_id: ids.pizzaMenu[0], quantity: 1 }],
  }, 'cashier');
  const orderId = ord.json.data.id;
  const pay = await call('POST', '/billing/pay', {
    order_id: orderId,
    payment_method: 'cash',
    amount: ord.json.data.total_amount,
  }, 'cashier');
  assert.equal(pay.status, 200);

  // Stop the server process
  await stopServer();
  assert.equal(serverProc, null);

  // Restart server process on a new free port
  serverPort = await freePort();
  startServer(serverPort);
  assert.ok(await waitUp(serverPort));

  // Query order and payment through the newly started server
  const recheck = await call('GET', `/orders/${orderId}`, null, 'owner');
  const checkD1 = recheck.status === 200 && recheck.json.data.payment_status === 'paid' && recheck.json.data.id === orderId;
  record('Scenario D', 'SCN-D01', 'Order and payment records persist across process restart', checkD1, `Payment status: ${recheck.json?.data?.payment_status}`);
  assert.ok(checkD1);

  // Audit trail persists in PostgreSQL
  const auditCount = psqlInt(`SELECT count(*) FROM audit_logs WHERE entity_id = '${orderId}'`);
  const checkD2 = auditCount >= 1;
  record('Scenario D', 'SCN-D02', 'Audit records persist in PostgreSQL across server restart', checkD2, `Audit rows: ${auditCount}`);
  assert.ok(checkD2);
});

test('Scenario E: Role Authorization & Stall Isolation', async () => {
  // 1. Kitchen staff cannot access billing/pay
  const payAttempt = await call('POST', '/billing/pay', { order_id: 1, payment_method: 'cash', amount: 100 }, 'pizza');
  const checkE1 = payAttempt.status === 403;
  record('Scenario E', 'SCN-E01', 'Kitchen staff cannot access payment endpoints (HTTP 403)', checkE1, `HTTP ${payAttempt.status}`);
  assert.ok(checkE1);

  // 2. Kitchen staff cannot access settings/owner setup (PUT /settings/food_court_name)
  const settingsAttempt = await call('PUT', '/settings/food_court_name', { value: 'Hacked Name' }, 'pizza');
  const checkE2 = settingsAttempt.status === 403;
  record('Scenario E', 'SCN-E02', 'Kitchen staff cannot modify food court settings (HTTP 403)', checkE2, `HTTP ${settingsAttempt.status}`);
  assert.ok(checkE2);

  // 3. Cashier cannot directly modify kitchen ticket status
  const ticketId = psqlInt(`SELECT id FROM stall_kitchen_tickets LIMIT 1`);
  const ticketAttempt = await call('PUT', `/kitchen/tickets/${ticketId}/status`, { status: 'preparing' }, 'cashier');
  const checkE3 = ticketAttempt.status === 403;
  record('Scenario E', 'SCN-E03', 'Cashier cannot directly update kitchen ticket status (HTTP 403)', checkE3, `HTTP ${ticketAttempt.status}`);
  assert.ok(checkE3);
});

test('Scalability: 160 Active Orders, Pagination, Board Retention & Cancelled Edge Cases', async () => {
  console.log('Generating 160 active orders for scalability testing...');
  const batchSize = 20;
  for (let b = 0; b < 8; b++) {
    const promises = [];
    for (let i = 0; i < batchSize; i++) {
      promises.push(call('POST', '/orders', {
        order_type: 'takeaway',
        items: [{ menu_item_id: ids.pizzaMenu[0], quantity: 1 }],
      }, 'cashier'));
    }
    const resps = await Promise.all(promises);
    assert.ok(resps.every((r) => r.status === 201));
  }

  const activeCount = psqlInt(`SELECT count(*) FROM orders WHERE status NOT IN ('served', 'completed', 'cancelled')`);
  assert.ok(activeCount >= 160, `Expected >= 160 active orders, found ${activeCount}`);

  // Fetch board page 1 (GET /orders/board?limit=100)
  const page1 = await call('GET', '/orders/board?limit=100', null, 'owner');
  assert.equal(page1.status, 200, `Page 1 status ${page1.status}`);
  const p1Orders = page1.json.data.orders;
  const checkS1 = p1Orders.length === 100 && typeof page1.json.data.next_cursor === 'string' && page1.json.data.next_cursor.length > 0;
  record('Scalability', 'SCN-S01', 'Board returns 100 orders on page 1 with has_more: true and cursor', checkS1, `Received: ${p1Orders.length}`);
  assert.ok(checkS1);

  // Fetch page 2 with next_cursor
  const cursor = encodeURIComponent(page1.json.data.next_cursor);
  const page2 = await call('GET', `/orders/board?limit=100&cursor=${cursor}`, null, 'owner');
  assert.equal(page2.status, 200, `Page 2 status ${page2.status}`);
  const p2Orders = page2.json.data.orders;
  const checkS2 = p2Orders.length >= 60;
  record('Scalability', 'SCN-S02', 'Board fetches remaining orders via cursor pagination without drops', checkS2, `Page 2 received: ${p2Orders.length}`);
  assert.ok(checkS2);

  // Verify no overlap/duplicate IDs between pages
  const p1Ids = new Set(p1Orders.map((o) => o.id));
  const overlap = p2Orders.filter((o) => p1Ids.has(o.id));
  const checkS3 = overlap.length === 0;
  record('Scalability', 'SCN-S03', 'Zero duplicate orders between page 1 and page 2', checkS3, `Overlaps: ${overlap.length}`);
  assert.ok(checkS3);

  // Test Paid Order with Unserved Items stays on board
  const sampleOrder = p1Orders[0];
  await call('POST', '/billing/pay', {
    order_id: sampleOrder.id,
    payment_method: 'cash',
    amount: sampleOrder.total_amount,
  }, 'cashier');
  const boardCheck = await call('GET', '/orders/board?limit=100', null, 'owner');
  const stillPresent = boardCheck.json.data.orders.some((o) => o.id === sampleOrder.id);
  record('Scalability', 'SCN-S04', 'Paid order with unserved items remains on tracking board', stillPresent, `Order ${sampleOrder.id} retained`);
  assert.ok(stillPresent);

  // Test All-Cancelled Order exclusion from active board
  const cancelOrd = await call('POST', '/orders', {
    order_type: 'takeaway',
    items: [{ menu_item_id: ids.pizzaMenu[0], quantity: 1 }],
  }, 'cashier');
  const cId = cancelOrd.json.data.id;
  await call('POST', `/orders/${cId}/cancel`, { reason: 'Customer changed mind' }, 'owner');
  const boardAfterCancel = await call('GET', '/orders/board?limit=100', null, 'owner');
  const cancelledOnBoard = boardAfterCancel.json.data.orders.some((o) => o.id === cId);
  record('Scalability', 'SCN-S05', 'Cancelled order does not appear as active unserved order on board', !cancelledOnBoard, `Cancelled order ${cId} excluded`);
  assert.ok(!cancelledOnBoard);
});
