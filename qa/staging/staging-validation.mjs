/**
 * Staging validation harness for the Multi-Stall Food Court system.
 *
 * Drives the REAL staging stack over HTTP/WebSocket (no mocks):
 *   - Laravel API on STAGING_PORTS (several `artisan serve` workers sharing foodcourt_staging_db,
 *     so concurrency tests produce genuinely parallel database transactions)
 *   - Laravel Reverb on REVERB_PORT
 *   - the mobile app's own offline sync engine (mobile-app/src/offline/syncEngine.ts)
 *
 * Usage (Node >= 22.6 for TypeScript type stripping):
 *   node qa/staging/staging-validation.mjs
 *
 * Never point this at production: it creates orders, payments, purchases and a daily closing.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { syncQueue, newIdempotencyKey } from '../../mobile-app/src/offline/syncEngine.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const ENV_FILE = join(ROOT, 'backend', '.env.staging');
const PSQL = process.env.PSQL_BIN || 'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe';
const HOST = process.env.STAGING_HOST || '127.0.0.1';
const PORTS = (process.env.STAGING_PORTS || '8100,8101,8102,8103').split(',').map(Number);
const PASSWORD = process.env.STAGING_SEED_PASSWORD || 'password123'; // DatabaseSeeder default

// ------------------------------------------------------------------ env (secrets never printed)
const env = Object.fromEntries(
  readFileSync(ENV_FILE, 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')];
    })
);
if (env.APP_ENV !== 'staging' || env.DB_DATABASE !== 'foodcourt_staging_db') {
  console.error('Refusing to run: .env.staging is not pointing at foodcourt_staging_db');
  process.exit(2);
}
const REVERB_PORT = Number(env.REVERB_PORT || 8180);

// ------------------------------------------------------------------ result bookkeeping
const results = [];
let section = '';
const setSection = (s) => {
  section = s;
  console.log(`\n=== ${s} ===`);
};
const check = (id, description, pass, evidence = '') => {
  results.push({ section, id, description, result: pass ? 'PASS' : 'FAIL', evidence: String(evidence).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${description}${evidence ? `  [${String(evidence).slice(0, 160)}]` : ''}`);
};
const metrics = {};

// ------------------------------------------------------------------ helpers
const base = (port = PORTS[0]) => `http://${HOST}:${port}/api`;

async function api(method, path, { token, body, port, signal } = {}) {
  const res = await fetch(base(port) + path, {
    method,
    signal,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, json };
}

function sql(query) {
  return execFileSync(
    PSQL,
    ['-h', env.DB_HOST, '-p', env.DB_PORT, '-U', env.DB_USERNAME, '-d', env.DB_DATABASE, '-tAc', query],
    { env: { ...process.env, PGPASSWORD: env.DB_PASSWORD }, encoding: 'utf8' }
  ).trim();
}
const countWhere = (table, where) => Number(sql(`SELECT COUNT(*) FROM ${table} WHERE ${where}`));
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const percentile = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? Number(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(1)) : 0;
};

async function login(email) {
  const r = await api('POST', '/auth/login', { body: { email, password: PASSWORD } });
  if (r.status !== 200) throw new Error(`login ${email} -> ${r.status} ${JSON.stringify(r.json)}`);
  return { token: r.json.data.token, user: r.json.data.user };
}

// ------------------------------------------------------------------ Reverb (Pusher protocol) client
function wsConnect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${HOST}:${REVERB_PORT}/app/${env.REVERB_APP_KEY}?protocol=7&client=js&version=8.4.0`);
    const events = [];
    const waiters = [];
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.event === 'pusher:connection_established') {
        ws.socketId = JSON.parse(msg.data).socket_id;
        resolve(conn);
        return;
      }
      events.push(msg);
      for (const w of [...waiters]) {
        if (w.match(msg)) {
          waiters.splice(waiters.indexOf(w), 1);
          clearTimeout(w.timer);
          w.resolve(msg);
        }
      }
    };
    ws.onerror = (e) => reject(new Error('websocket error ' + (e.message || '')));
    const conn = {
      ws,
      events,
      get socketId() {
        return ws.socketId;
      },
      send: (obj) => ws.send(JSON.stringify(obj)),
      waitFor: (match, ms = 5000) =>
        new Promise((res) => {
          const existing = events.find(match);
          if (existing) return res(existing);
          const w = { match, resolve: res, timer: setTimeout(() => res(null), ms) };
          waiters.push(w);
        }),
      close: () => ws.close(),
    };
    setTimeout(() => reject(new Error('websocket connect timeout')), 5000);
  });
}

async function subscribePrivate(conn, channel, token) {
  const auth = await api('POST', '/broadcasting/auth', { token, body: { socket_id: conn.socketId, channel_name: channel } });
  if (auth.status !== 200) return { authStatus: auth.status, subscribed: false };
  conn.send({ event: 'pusher:subscribe', data: { channel, auth: auth.json.auth } });
  const ok = await conn.waitFor(
    (m) => m.channel === channel && (m.event === 'pusher_internal:subscription_succeeded' || m.event.includes('error')),
    4000
  );
  return { authStatus: 200, subscribed: ok?.event === 'pusher_internal:subscription_succeeded' };
}

// ------------------------------------------------------------------ main
(async () => {
  const started = new Date();
  setSection('0. Preconditions');
  const up = await fetch(`http://${HOST}:${PORTS[0]}/up`).then((r) => r.status).catch(() => 0);
  check('PRE-01', 'Staging API reachable', up === 200, `GET /up -> ${up}`);
  for (const p of PORTS.slice(1)) {
    const s = await fetch(`http://${HOST}:${p}/up`).then((r) => r.status).catch(() => 0);
    check(`PRE-02-${p}`, `Staging API worker on :${p} reachable`, s === 200, `GET /up -> ${s}`);
  }

  const owner = await login('owner@foodcourt.com');
  const cashier = await login('cashier@foodcourt.com');
  const waiter = await login('waiter1@foodcourt.com');
  const waiter2 = await login('waiter2@foodcourt.com');
  const kPizza = await login('kitchen.pizza@foodcourt.com');
  const kBurger = await login('kitchen.burger@foodcourt.com');
  const kBev = await login('kitchen.bev@foodcourt.com');
  const mPizza = await login('manager.pizza@foodcourt.com');
  check('PRE-03', 'All seeded roles can log in', true, 'owner, cashier, 2 waiters, 3 kitchens, pizza manager');

  const tables = (await api('GET', '/tables', { token: owner.token })).json.data;
  const menu = (await api('GET', '/menu?available_only=1', { token: cashier.token })).json.data;
  const stalls = (await api('GET', '/stalls', { token: cashier.token })).json.data;
  const byStall = (code) => menu.filter((m) => m.stall?.code === code);
  const pizza = byStall('STALL-PIZZA');
  const burger = byStall('STALL-BURGER');
  const bev = byStall('STALL-BEV');
  const stallId = (code) => stalls.find((s) => s.code === code).id;
  check('PRE-04', 'Owner can read table QR secrets for printing', tables.every((t) => typeof t.qr_token === 'string'), `${tables.length} tables`);
  const cashierTables = (await api('GET', '/tables', { token: cashier.token })).json.data;
  check('PRE-05', 'Non-owner table listing hides QR secrets', cashierTables.every((t) => !('qr_token' in t)));
  const publicTables = (await api('GET', '/public/tables')).json.data;
  check('PRE-06', 'Public table listing hides QR secrets', publicTables.every((t) => !('qr_token' in t)));

  // ================================================================ Workflow A: Customer QR
  setSection('Workflow A — Customer QR ordering');
  const tA = tables[0];
  const qrMenu = await api('GET', `/public/qr/${tA.qr_token}`);
  check('A-01', 'QR scan resolves table and multi-stall menu', qrMenu.status === 200 && qrMenu.json.data.stalls.length >= 3, `table ${qrMenu.json?.data?.table?.table_number}, ${qrMenu.json?.data?.stalls?.length} stalls`);
  const forged = await api('GET', '/public/qr/TBL-FORGED123');
  check('A-02', 'Forged QR token rejected', forged.status === 404, `-> ${forged.status}`);

  const keyA = `qr_staging_${Date.now()}`;
  const orderBodyA = {
    qr_token: tA.qr_token,
    idempotency_key: keyA,
    order_type: 'dine_in',
    customer_name: 'Staging Customer A',
    customer_phone: '9000000001',
    items: [
      { menu_item_id: pizza[0].id, quantity: 2 },
      { menu_item_id: burger[0].id, quantity: 1 },
      { menu_item_id: bev[0].id, quantity: 3 },
    ],
  };
  const createA = await api('POST', '/public/orders', { body: orderBodyA });
  check('A-03', 'Customer places one multi-stall order', createA.status === 201, `-> ${createA.status} ${createA.json?.data?.order_number}`);
  const trkA = createA.json?.data?.tracking_token;
  check('A-04', 'Public order response carries no customer phone / internal ids', !JSON.stringify(createA.json).includes('9000000001') && createA.json?.data?.id === undefined);
  const ticketCountA = countWhere('stall_kitchen_tickets t JOIN orders o ON o.id=t.order_id', `o.idempotency_key=${q(keyA)}`);
  check('A-05', 'Order split into exactly one ticket per stall (3)', ticketCountA === 3, `${ticketCountA} tickets`);
  const tamper = await api('POST', '/public/orders', { body: { ...orderBodyA, idempotency_key: undefined, qr_token: undefined, table_id: tables[5].id } });
  check('A-06', 'Public order without QR secret rejected (table spoofing)', tamper.status === 422, `-> ${tamper.status}`);
  const priceTamper = await api('POST', '/public/orders', {
    body: { qr_token: tA.qr_token, order_type: 'dine_in', items: [{ menu_item_id: pizza[0].id, quantity: 1, unit_price: 1 }] },
  });
  const tamperTotal = priceTamper.json?.data?.subtotal;
  check('A-07', 'Client-sent prices ignored (server-side pricing)', Number(tamperTotal) === Number(pizza[0].price), `subtotal ${tamperTotal} vs menu ${pizza[0].price}`);

  // Kitchens see only their own ticket
  const kdsPizza = (await api('GET', '/kitchen/tickets', { token: kPizza.token })).json.data;
  const kdsBurger = (await api('GET', '/kitchen/tickets', { token: kBurger.token })).json.data;
  check('A-08', 'Pizza KDS sees only pizza tickets', kdsPizza.every((t) => t.stall_id === stallId('STALL-PIZZA')) && kdsPizza.length > 0, `${kdsPizza.length} tickets`);
  check('A-09', 'Burger KDS sees only burger tickets', kdsBurger.every((t) => t.stall_id === stallId('STALL-BURGER')) && kdsBurger.length > 0, `${kdsBurger.length} tickets`);

  const ticketsOf = async (key) =>
    sql(`SELECT t.id||':'||t.stall_id FROM stall_kitchen_tickets t JOIN orders o ON o.id=t.order_id WHERE o.idempotency_key=${q(key)} ORDER BY t.id`)
      .split('\n')
      .filter(Boolean)
      .map((r) => r.split(':').map(Number));
  const kitchenFor = { [stallId('STALL-PIZZA')]: kPizza, [stallId('STALL-BURGER')]: kBurger, [stallId('STALL-BEV')]: kBev };

  const ticketsA = await ticketsOf(keyA);
  const crossStall = await api('PUT', `/kitchen/tickets/${ticketsA.find(([, s]) => s === stallId('STALL-BURGER'))[0]}/status`, { token: kPizza.token, body: { status: 'accepted' } });
  check('A-10', 'Pizza kitchen cannot move burger ticket', crossStall.status === 403, `-> ${crossStall.status}`);
  let allOk = true;
  for (const [tid, sid] of ticketsA) {
    for (const st of ['accepted', 'preparing', 'ready']) {
      const r = await api('PUT', `/kitchen/tickets/${tid}/status`, { token: kitchenFor[sid].token, body: { status: st } });
      allOk &&= r.status === 200;
    }
  }
  check('A-11', 'Each stall kitchen prepares and marks its ticket ready', allOk);
  const backwards = await api('PUT', `/kitchen/tickets/${ticketsA[0][0]}/status`, { token: kitchenFor[ticketsA[0][1]].token, body: { status: 'preparing' } });
  check('A-12', 'Ticket status cannot move backwards', backwards.status === 422, `-> ${backwards.status}`);

  const trackA = await api('GET', `/public/orders/track/${trkA}`);
  check('A-13', 'Customer tracking shows order ready', trackA.json?.data?.status === 'ready', `status ${trackA.json?.data?.status}`);
  check('A-14', 'Tracking payload has no PII', !JSON.stringify(trackA.json).includes('9000000001'));

  const pending = (await api('GET', '/billing/pending', { token: cashier.token })).json.data;
  const pendingA = pending.find((o) => o.tracking_token === trkA);
  check('A-15', 'QR order appears in cashier pending bills', !!pendingA, pendingA?.order_number);
  const underpay = await api('POST', '/billing/pay', { token: cashier.token, body: { order_id: pendingA.id, payment_method: 'upi_qr', amount: '10.00' } });
  check('A-16', 'Under-payment rejected', underpay.status === 422, `-> ${underpay.status}`);
  const payA = await api('POST', '/billing/pay', {
    token: cashier.token,
    body: { order_id: pendingA.id, payment_method: 'cash', amount: pendingA.total_amount, cash_tendered: '2000.00' },
  });
  const expectedChange = (2000 - Number(pendingA.total_amount)).toFixed(2);
  check('A-17', 'Cashier collects exact bill with correct change', payA.status === 200 && payA.json.data.change_returned === expectedChange, `change ${payA.json?.data?.change_returned} expected ${expectedChange}`);
  const receiptA = await api('GET', `/billing/receipt/${pendingA.id}`, { token: cashier.token });
  check('A-18', 'Consolidated receipt groups items by 3 stalls', receiptA.status === 200 && Object.keys(receiptA.json.data.stall_breakdown).length === 3);
  const trackPaid = await api('GET', `/public/orders/track/${trkA}`);
  check('A-19', 'Customer tracking shows paid', trackPaid.json?.data?.payment_status === 'paid');

  // ================================================================ Workflow B: Waiter
  setSection('Workflow B — Waiter Android flow (API level)');
  const wTables = await api('GET', '/waiter/tables', { token: waiter.token });
  check('B-01', 'Waiter loads active tables', wTables.status === 200 && wTables.json.data.length === tables.length);
  const keyB = newIdempotencyKey('waiter');
  const createB = await api('POST', '/orders', {
    token: waiter.token,
    body: { table_id: tables[1].id, order_type: 'dine_in', idempotency_key: keyB, items: [{ menu_item_id: pizza[1].id, quantity: 1 }, { menu_item_id: bev[1].id, quantity: 2 }] },
  });
  check('B-02', 'Waiter places multi-stall order (channel waiter_app)', createB.status === 201 && createB.json.data.order_channel === 'waiter_app', `-> ${createB.status}`);
  const orderB = createB.json.data;

  // Realtime: waiter + pizza kitchen subscribed before the kitchen marks ready
  const wsWaiter = await wsConnect();
  const subW = await subscribePrivate(wsWaiter, 'private-waiters', waiter.token);
  const wsKitchen = await wsConnect();
  const subK = await subscribePrivate(wsKitchen, `private-stall.${stallId('STALL-PIZZA')}`, kPizza.token);
  check('B-03', 'Waiter subscribed to private-waiters, pizza KDS to its private stall channel', subW.subscribed && subK.subscribed, JSON.stringify({ subW, subK }));

  const ticketsB = await ticketsOf(keyB);
  const notReady = await api('POST', `/waiter/tickets/${ticketsB[0][0]}/served`, { token: waiter.token });
  check('B-04', 'Waiter cannot serve a ticket that is not ready', notReady.status === 422, `-> ${notReady.status}`);
  const tReady0 = performance.now();
  for (const [tid, sid] of ticketsB) {
    await api('PUT', `/kitchen/tickets/${tid}/status`, { token: kitchenFor[sid].token, body: { status: 'preparing' } });
    await api('PUT', `/kitchen/tickets/${tid}/status`, { token: kitchenFor[sid].token, body: { status: 'ready' } });
  }
  const readyEvt = await wsWaiter.waitFor((m) => m.event === 'TicketReady' && JSON.parse(m.data).order_id === orderB.id, 5000);
  metrics.realtime_ready_event_ms = Number((performance.now() - tReady0).toFixed(1));
  check('B-05', 'Waiter receives TicketReady over Reverb', !!readyEvt, readyEvt ? `latency incl. 4 API calls ${metrics.realtime_ready_event_ms}ms` : 'no event in 5s');
  const kitchenEvt = await wsKitchen.waitFor((m) => m.event === 'TicketStatusUpdated' && JSON.parse(m.data).order_id === orderB.id, 3000);
  check('B-06', 'Pizza KDS receives TicketStatusUpdated over Reverb', !!kitchenEvt);
  const leaked = [...wsKitchen.events].some((m) => m.data && m.event.startsWith('Ticket') && JSON.parse(m.data).stall_id !== stallId('STALL-PIZZA'));
  check('B-07', 'Pizza KDS socket received no other stall events', !leaked);

  const readyList = (await api('GET', '/waiter/ready-tickets', { token: waiter.token })).json.data;
  check('B-08', 'Ready tickets list shows both stall tickets', ticketsB.every(([tid]) => readyList.some((t) => t.id === tid)));
  const kitchenServe = await api('POST', `/waiter/tickets/${ticketsB[0][0]}/served`, { token: kPizza.token });
  check('B-09', 'Kitchen staff cannot confirm serving', kitchenServe.status === 403, `-> ${kitchenServe.status}`);
  let servedOk = true;
  for (const [tid] of ticketsB) servedOk &&= (await api('POST', `/waiter/tickets/${tid}/served`, { token: waiter.token })).status === 200;
  const again = await api('POST', `/waiter/tickets/${ticketsB[0][0]}/served`, { token: waiter2.token });
  check('B-10', 'Waiter confirms serving; repeat tap is idempotent', servedOk && again.status === 200);
  const statusB = sql(`SELECT status FROM orders WHERE id=${orderB.id}`);
  check('B-11', 'Parent order becomes served', statusB === 'served', statusB);
  const waiterPay = await api('POST', '/billing/pay', { token: waiter.token, body: { order_id: orderB.id, payment_method: 'cash', amount: orderB.total_amount } });
  check('B-12', 'Waiter cannot take payment', waiterPay.status === 403, `-> ${waiterPay.status}`);
  const payB = await api('POST', '/billing/pay', { token: cashier.token, body: { order_id: orderB.id, payment_method: 'upi_qr', amount: orderB.total_amount, transaction_reference: 'UPI-STG-B' } });
  check('B-13', 'Cashier settles the waiter order', payB.status === 200);
  const payEvt = await (async () => {
    const wsCash = await wsConnect();
    const s = await subscribePrivate(wsCash, 'private-cashier', cashier.token);
    const createdKey = newIdempotencyKey('waiter');
    await api('POST', '/orders', { token: waiter.token, body: { table_id: tables[2].id, order_type: 'dine_in', idempotency_key: createdKey, items: [{ menu_item_id: bev[0].id, quantity: 1 }] } });
    const e = await wsCash.waitFor((m) => m.event === 'OrderCreated', 4000);
    wsCash.close();
    return { s, e };
  })();
  check('B-14', 'Cashier counter receives OrderCreated on private-cashier', payEvt.s.subscribed && !!payEvt.e);

  // ================================================================ Realtime security
  setSection('Realtime channel security (live Reverb)');
  const wsAttacker = await wsConnect();
  const crossAuth = await api('POST', '/broadcasting/auth', { token: kPizza.token, body: { socket_id: wsAttacker.socketId, channel_name: `private-stall.${stallId('STALL-BURGER')}` } });
  check('RT-01', 'Pizza kitchen denied auth for burger stall channel', crossAuth.status === 403, `-> ${crossAuth.status}`);
  const anonAuth = await api('POST', '/broadcasting/auth', { body: { socket_id: wsAttacker.socketId, channel_name: 'private-cashier' } });
  check('RT-02', 'Unauthenticated channel auth rejected', anonAuth.status === 401, `-> ${anonAuth.status}`);
  wsAttacker.send({ event: 'pusher:subscribe', data: { channel: 'private-cashier', auth: `${env.REVERB_APP_KEY}:forgedsignature0000` } });
  const forgedRes = await wsAttacker.waitFor((m) => m.event?.includes('error') || m.event === 'pusher_internal:subscription_succeeded', 3000);
  check('RT-03', 'Forged channel signature refused by Reverb', !!forgedRes && forgedRes.event !== 'pusher_internal:subscription_succeeded', forgedRes?.event + ' ' + (forgedRes?.data ? JSON.stringify(forgedRes.data).slice(0, 80) : ''));
  wsAttacker.send({ event: 'pusher:subscribe', data: { channel: 'private-waiters' } });
  const noAuthRes = await wsAttacker.waitFor((m) => (m.event?.includes('error') || m.event === 'pusher_internal:subscription_succeeded') && m !== forgedRes, 3000);
  check('RT-04', 'Private subscription without signature refused', !!noAuthRes && noAuthRes.event !== 'pusher_internal:subscription_succeeded', noAuthRes?.event);
  for (const legacy of ['orders', 'waiters', `stalls.${stallId('STALL-PIZZA')}`]) {
    wsAttacker.send({ event: 'pusher:subscribe', data: { channel: legacy } });
  }
  const tLegacy = newIdempotencyKey('waiter');
  await api('POST', '/orders', { token: waiter.token, body: { table_id: tables[3].id, order_type: 'dine_in', idempotency_key: tLegacy, items: [{ menu_item_id: pizza[0].id, quantity: 1 }] } });
  const legacyLeak = await wsAttacker.waitFor((m) => m.event === 'OrderCreated', 2500);
  check('RT-05', 'Old public channels (orders/waiters/stalls.N) carry no business events', !legacyLeak);
  const kitchenCash = await subscribePrivate(await wsConnect(), 'private-cashier', kPizza.token);
  check('RT-06', 'Kitchen staff denied cashier channel', kitchenCash.authStatus === 403);
  const waiterStall = await subscribePrivate(await wsConnect(), `private-stall.${stallId('STALL-PIZZA')}`, waiter.token);
  check('RT-07', 'Waiter denied stall kitchen channel', waiterStall.authStatus === 403);
  const evtPayloads = [...wsWaiter.events, ...wsKitchen.events].filter((m) => m.data && !m.event.startsWith('pusher'));
  const piiLeak = evtPayloads.some((m) => /customer_phone|customer_name|total_amount|qr_token/.test(m.data));
  check('RT-08', 'No customer PII / bill totals in staff broadcast payloads', !piiLeak, `${evtPayloads.length} payloads inspected`);
  wsWaiter.close();
  wsKitchen.close();
  wsAttacker.close();

  // ================================================================ Workflow C: Counter POS
  setSection('Workflow C — Counter POS');
  const keyC = newIdempotencyKey('pos');
  const createC = await api('POST', '/orders', {
    token: cashier.token,
    body: { order_type: 'takeaway', idempotency_key: keyC, customer_name: 'Counter Walk-in', items: [{ menu_item_id: burger[1].id, quantity: 2 }, { menu_item_id: bev[2].id, quantity: 1 }] },
  });
  check('C-01', 'Cashier creates multi-stall counter order', createC.status === 201 && createC.json.data.order_channel === 'cashier_pos');
  const payC = await api('POST', '/billing/pay', { token: cashier.token, body: { order_id: createC.json.data.id, payment_method: 'card', amount: createC.json.data.total_amount, transaction_reference: 'CARD-STG-C' } });
  check('C-02', 'Card payment for exact total accepted', payC.status === 200);
  check('C-03', 'Counter order produced one kitchen ticket per stall (2)', (await ticketsOf(keyC)).length === 2);
  const doublePay = await api('POST', '/billing/pay', { token: cashier.token, body: { order_id: createC.json.data.id, payment_method: 'card', amount: createC.json.data.total_amount } });
  check('C-04', 'Second payment on settled bill rejected', doublePay.status === 422, `-> ${doublePay.status}`);
  const cancelPaid = await api('POST', `/orders/${createC.json.data.id}/cancel`, { token: cashier.token, body: { reason: 'QA paid order' } });
  check('C-05', 'Paid order cannot be cancelled', cancelPaid.status === 422);

  // ================================================================ Workflow D: Purchases & inventory
  setSection('Workflow D — Stall purchases & inventory');
  const pizzaStall = stallId('STALL-PIZZA');
  const sup = await api('POST', '/suppliers', { token: mPizza.token, body: { name: `Staging Flour Mill ${Date.now()}`, phone: '9000000099' } });
  check('D-01', 'Pizza manager adds a supplier to own stall', sup.status === 201 && sup.json.data.stall_id === pizzaStall);
  const inv = (await api('GET', '/inventory', { token: mPizza.token })).json.data;
  check('D-02', 'Pizza manager sees only pizza stock', inv.length > 0 && inv.every((i) => i.stall_id === pizzaStall), `${inv.length} items`);
  const flour = inv[0];
  const before = Number(sql(`SELECT current_stock FROM inventory_items WHERE id=${flour.id}`));
  const po = await api('POST', '/purchases', {
    token: mPizza.token,
    body: { stall_id: pizzaStall, supplier_id: sup.json.data.id, order_date: new Date().toISOString().slice(0, 10), items: [{ inventory_item_id: flour.id, quantity: 12.5, unit_price: 64.5 }] },
  });
  check('D-03', 'Purchase order created with decimal total', po.status === 201 && po.json.data.total_amount === '806.25', `total ${po.json?.data?.total_amount}`);
  const recv = await api('POST', `/purchases/${po.json.data.id}/receive`, { token: mPizza.token });
  const after = Number(sql(`SELECT current_stock FROM inventory_items WHERE id=${flour.id}`));
  check('D-04', 'Goods receipt increases stock exactly', recv.status === 200 && Math.abs(after - before - 12.5) < 1e-9, `${before} -> ${after}`);
  const mv = sql(`SELECT movement_type||'|'||quantity||'|'||previous_stock||'|'||new_stock FROM stock_movements WHERE inventory_item_id=${flour.id} ORDER BY id DESC LIMIT 1`);
  check('D-05', 'Stock ledger records the inward movement', mv.startsWith('purchase_inward|12.5'), mv);
  const recv2 = await api('POST', `/purchases/${po.json.data.id}/receive`, { token: mPizza.token });
  check('D-06', 'Same PO cannot be received twice', recv2.status === 422);
  const burgerItem = (await api('GET', `/inventory?stall_id=${stallId('STALL-BURGER')}`, { token: owner.token })).json.data[0];
  const xpo = await api('POST', '/purchases', {
    token: mPizza.token,
    body: { stall_id: pizzaStall, supplier_id: sup.json.data.id, order_date: new Date().toISOString().slice(0, 10), items: [{ inventory_item_id: burgerItem.id, quantity: 1, unit_price: 1 }] },
  });
  check('D-07', "Cannot purchase into another stall's stock item", xpo.status === 422, `-> ${xpo.status}`);
  const kAdj = await api('POST', `/inventory/${flour.id}/adjust`, { token: kPizza.token, body: { new_stock: 0, reason: 'x', movement_type: 'manual_adjustment' } });
  check('D-08', 'Kitchen staff cannot adjust stock', kAdj.status === 403);
  const audit = countWhere('audit_logs', `entity_type ILIKE '%Purchase%' OR action ILIKE '%purchase%'`);
  check('D-09', 'Purchase activity is audit-logged', audit > 0, `${audit} audit rows`);

  // ================================================================ Offline / sync (mobile sync engine)
  setSection('Offline queue & synchronisation (mobile syncEngine.ts against live API)');
  const STORE_DIR = join(HERE, 'results', 'device-storage');
  rmSync(STORE_DIR, { recursive: true, force: true });
  mkdirSync(STORE_DIR, { recursive: true });
  /** File-backed queue store == AsyncStorage persistence across app restarts. */
  const fileStore = (name) => {
    const f = join(STORE_DIR, `${name}.json`);
    const read = () => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : []);
    const write = (qq) => writeFileSync(f, JSON.stringify(qq, null, 2));
    return {
      file: f,
      enqueue: async (o) => write([...read(), o]),
      getQueue: async () => read(),
      updateQueueItem: async (id, u) => write(read().map((x) => (x.id === id ? { ...x, ...u } : x))),
      removeQueueItem: async (id) => write(read().filter((x) => x.id !== id)),
    };
  };
  const mkOrder = (tableId, items) => ({
    id: newIdempotencyKey('waiter'),
    sync_status: 'pending',
    retry_count: 0,
    order_type: 'dine_in',
    table_id: tableId,
    items,
  });
  const realPost = (token, port = PORTS[0]) => async (item) => {
    const r = await api('POST', '/orders', { token, port, body: { table_id: item.table_id, order_type: item.order_type, order_channel: 'waiter_app', idempotency_key: item.id, items: item.items } });
    return { status: r.status, data: r.json };
  };
  const ordersWithKey = (k) => countWhere('orders', `idempotency_key=${q(k)}`);
  const ticketsWithKey = (k) => countWhere('stall_kitchen_tickets t JOIN orders o ON o.id=t.order_id', `o.idempotency_key=${q(k)}`);

  // OFF-1 normal connection
  const s1 = fileStore('device1');
  const o1 = mkOrder(tables[4].id, [{ menu_item_id: pizza[0].id, quantity: 1 }, { menu_item_id: burger[0].id, quantity: 1 }]);
  await s1.enqueue(o1);
  const r1 = await syncQueue(s1, realPost(waiter.token), { force: true });
  check('OFF-1', 'Normal connection: queued order syncs once, removed from queue', r1.synced === 1 && ordersWithKey(o1.id) === 1 && (await s1.getQueue()).length === 0, JSON.stringify(r1));

  // OFF-2/3 server unreachable (Wi-Fi off / LAN down): nothing sent, order retained
  const s2 = fileStore('device2');
  const o2 = mkOrder(tables[5].id, [{ menu_item_id: bev[0].id, quantity: 2 }]);
  await s2.enqueue(o2);
  const deadPost = async (item) => {
    const r = await fetch(`http://${HOST}:1/api/orders`, { method: 'POST', body: '{}' }); // closed port == no route to server
    return { status: r.status, data: {} };
  };
  const r2 = await syncQueue(s2, deadPost, { force: true });
  const q2 = await s2.getQueue();
  check('OFF-2', 'Server unreachable: order kept, marked failed, nothing created', r2.failed === 1 && q2[0]?.sync_status === 'failed' && ordersWithKey(o2.id) === 0, `${q2[0]?.sync_status}: ${q2[0]?.error_message}`);
  const r2b = await syncQueue(s2, realPost(waiter.token), {});
  check('OFF-3', 'Backoff: automatic retry inside backoff window is skipped', r2b.skipped === 1 && ordersWithKey(o2.id) === 0, JSON.stringify(r2b));

  // OFF-4 app closed & reopened: a fresh store instance reads the persisted file
  const s2reopened = fileStore('device2');
  const r4 = await syncQueue(s2reopened, realPost(waiter.token), { force: true });
  check('OFF-4', 'App restart: persisted queue survives and syncs once', r4.synced === 1 && ordersWithKey(o2.id) === 1 && ticketsWithKey(o2.id) === 1, JSON.stringify(r4));

  // OFF-5 network interrupted mid-submission (request aborted before the server answers)
  const s5 = fileStore('device5');
  const o5 = mkOrder(tables[6].id, [{ menu_item_id: pizza[1].id, quantity: 1 }]);
  await s5.enqueue(o5);
  const abortingPost = async (item) => {
    const ctl = new AbortController();
    ctl.abort();
    await api('POST', '/orders', { token: waiter.token, signal: ctl.signal, body: { table_id: item.table_id, order_type: 'dine_in', idempotency_key: item.id, items: item.items } });
    return { status: 0, data: {} };
  };
  const r5 = await syncQueue(s5, abortingPost, { force: true });
  const r5b = await syncQueue(s5, realPost(waiter.token), { force: true });
  check('OFF-5', 'Interrupted submission: marked failed, retried, exactly one order', r5.failed === 1 && r5b.synced === 1 && ordersWithKey(o5.id) === 1, `${JSON.stringify(r5)} then ${JSON.stringify(r5b)}`);

  // OFF-6 server commits but response is lost
  const s6 = fileStore('device6');
  const o6 = mkOrder(tables[7].id, [{ menu_item_id: burger[1].id, quantity: 1 }, { menu_item_id: bev[1].id, quantity: 1 }]);
  await s6.enqueue(o6);
  const lostResponsePost = async (item) => {
    await realPost(waiter.token)(item); // server processes the order...
    throw new Error('socket hang up (response lost)'); // ...but the device never sees the reply
  };
  const r6 = await syncQueue(s6, lostResponsePost, { force: true });
  const committed = ordersWithKey(o6.id);
  const r6b = await syncQueue(s6, realPost(waiter.token), { force: true });
  check('OFF-6', 'Lost response: retry replays (HTTP 200), still 1 order / 2 tickets', r6.failed === 1 && committed === 1 && r6b.synced === 1 && ordersWithKey(o6.id) === 1 && ticketsWithKey(o6.id) === 2, `after lost=${committed}, after retry=${ordersWithKey(o6.id)}, tickets=${ticketsWithKey(o6.id)}`);

  // OFF-7 repeated synchronisation (double-tap + timer) — concurrent calls share one run
  const s7 = fileStore('device7');
  const o7 = mkOrder(tables[8].id, [{ menu_item_id: bev[2].id, quantity: 1 }]);
  await s7.enqueue(o7);
  const runs = await Promise.all(Array.from({ length: 5 }, () => syncQueue(s7, realPost(waiter.token), { force: true })));
  for (let i = 0; i < 3; i++) await syncQueue(s7, realPost(waiter.token), { force: true });
  check('OFF-7', 'Repeated/concurrent sync: one order, no duplicate tickets', ordersWithKey(o7.id) === 1 && ticketsWithKey(o7.id) === 1, `run results ${JSON.stringify(runs[0])}`);

  // OFF-8 two devices simultaneously, different API workers
  const dA = fileStore('waiterA');
  const dB = fileStore('waiterB');
  const oA = mkOrder(tables[0].id, [{ menu_item_id: pizza[0].id, quantity: 1 }]);
  const oB = mkOrder(tables[1].id, [{ menu_item_id: pizza[0].id, quantity: 1 }]);
  await dA.enqueue(oA);
  await dB.enqueue(oB);
  // The engine's single-flight guard is per app process; two real devices are two processes, so run them sequentially-started but overlapping via raw posts
  const [pa, pb] = await Promise.all([realPost(waiter.token, PORTS[1])(oA), realPost(waiter2.token, PORTS[2])(oB)]);
  check('OFF-8', 'Two devices submit different orders simultaneously: both created once', pa.status === 201 && pb.status === 201 && ordersWithKey(oA.id) === 1 && ordersWithKey(oB.id) === 1);

  // OFF-9 same key hits 4 API workers at the same instant (retry storm) -> unique-constraint race path
  const raceKey = newIdempotencyKey('waiter');
  const race = await Promise.all(
    PORTS.map((p) => api('POST', '/orders', { token: waiter.token, port: p, body: { table_id: tables[9].id, order_type: 'dine_in', idempotency_key: raceKey, items: [{ menu_item_id: burger[0].id, quantity: 1 }] } }))
  );
  const raceStatuses = race.map((r) => r.status).sort();
  check('OFF-9', 'Same idempotency key on 4 workers at once: 1 order, others replay', ordersWithKey(raceKey) === 1 && ticketsWithKey(raceKey) === 1 && race.every((r) => r.status === 200 || r.status === 201), `statuses ${raceStatuses.join(',')}`);

  // OFF-10 business rejection is not retried forever
  const s10 = fileStore('device10');
  const o10 = mkOrder(tables[2].id, [{ menu_item_id: 99999999, quantity: 1 }]);
  await s10.enqueue(o10);
  const r10 = await syncQueue(s10, realPost(waiter.token), { force: true });
  const q10 = await s10.getQueue();
  check('OFF-10', 'Server rejection (422) marked rejected, kept for review, not auto-retried', r10.rejected === 1 && q10[0]?.sync_status === 'rejected', q10[0]?.error_message);

  // ================================================================ Concurrency & performance
  setSection('Concurrency, integrity & performance');
  const N = 40;
  const lat = [];
  const createdIds = [];
  const t0 = performance.now();
  const many = await Promise.all(
    Array.from({ length: N }, (_, i) => {
      const s = performance.now();
      const tbl = tables[i % tables.length];
      return api('POST', '/public/orders', {
        port: PORTS[i % PORTS.length],
        body: { qr_token: tbl.qr_token, idempotency_key: `load_${Date.now()}_${i}`, order_type: 'dine_in', items: [{ menu_item_id: pizza[i % pizza.length].id, quantity: 1 }, { menu_item_id: bev[i % bev.length].id, quantity: 1 }] },
      }).then((r) => {
        lat.push(performance.now() - s);
        if (r.status === 201) createdIds.push(r.json.data.order_number);
        return r.status;
      });
    })
  );
  metrics.concurrent_orders = { n: N, workers: PORTS.length, total_ms: Number((performance.now() - t0).toFixed(0)), p50_ms: percentile(lat, 50), p95_ms: percentile(lat, 95), max_ms: percentile(lat, 100) };
  const loadTickets = countWhere('stall_kitchen_tickets t JOIN orders o ON o.id=t.order_id', `o.idempotency_key LIKE 'load_%'`);
  const statusMix = many.reduce((acc, s) => ({ ...acc, [s]: (acc[s] || 0) + 1 }), {});
  metrics.concurrent_orders.statuses = statusMix;
  check('PERF-01', `${N} simultaneous customer orders all created with 2 tickets each`, many.every((s) => s === 201) && loadTickets === N * 2, JSON.stringify(metrics.concurrent_orders));

  // Duplicate payment race: same bill paid from 4 counters at once
  const victim = (await api('GET', '/billing/pending', { token: cashier.token })).json.data[0];
  const payRace = await Promise.all(PORTS.map((p) => api('POST', '/billing/pay', { token: cashier.token, port: p, body: { order_id: victim.id, payment_method: 'cash', amount: victim.total_amount, cash_tendered: victim.total_amount } })));
  const paySt = payRace.map((r) => r.status).sort();
  check('PERF-02', 'Concurrent duplicate payment: exactly one payment row', countWhere('payments', `order_id=${victim.id}`) === 1 && paySt.filter((s) => s === 200).length === 1, `statuses ${paySt.join(',')}`);

  // Many different bills paid concurrently
  const pend = (await api('GET', '/billing/pending', { token: cashier.token })).json.data.slice(0, 20);
  const pl = [];
  const payMany = await Promise.all(
    pend.map((o, i) => {
      const s = performance.now();
      return api('POST', '/billing/pay', { token: cashier.token, port: PORTS[i % PORTS.length], body: { order_id: o.id, payment_method: 'upi_qr', amount: o.total_amount, transaction_reference: `UPI-LOAD-${i}` } }).then((r) => {
        pl.push(performance.now() - s);
        return r.status;
      });
    })
  );
  metrics.concurrent_payments = { n: pend.length, p50_ms: percentile(pl, 50), p95_ms: percentile(pl, 95) };
  check('PERF-03', `${pend.length} concurrent payments on different bills all succeed once`, payMany.every((s) => s === 200) && pend.every((o) => countWhere('payments', `order_id=${o.id}`) === 1), JSON.stringify(metrics.concurrent_payments));

  // Concurrent stock receiving on the same item (row lock)
  const mk = async () =>
    (await api('POST', '/purchases', { token: mPizza.token, body: { stall_id: pizzaStall, supplier_id: sup.json.data.id, order_date: new Date().toISOString().slice(0, 10), items: [{ inventory_item_id: flour.id, quantity: 1.25, unit_price: 60 }] } })).json.data.id;
  const poIds = await Promise.all([mk(), mk(), mk(), mk()]);
  const stockBefore = Number(sql(`SELECT current_stock FROM inventory_items WHERE id=${flour.id}`));
  const recvAll = await Promise.all(poIds.map((id, i) => api('POST', `/purchases/${id}/receive`, { token: mPizza.token, port: PORTS[i % PORTS.length] })));
  const stockAfter = Number(sql(`SELECT current_stock FROM inventory_items WHERE id=${flour.id}`));
  check('PERF-04', '4 goods receipts for the same item at once: no lost update', recvAll.every((r) => r.status === 200) && Math.abs(stockAfter - stockBefore - 5) < 1e-9, `${stockBefore} -> ${stockAfter} (expected +5)`);
  const dupPo = await mk();
  const dupRecv = await Promise.all(PORTS.map((p) => api('POST', `/purchases/${dupPo}/receive`, { token: mPizza.token, port: p })));
  const dupMv = countWhere('stock_movements', `reference_id=(SELECT purchase_number FROM purchase_orders WHERE id=${dupPo})`);
  check('PERF-05', 'Same PO received from 4 devices at once: stock added once', dupRecv.filter((r) => r.status === 200).length === 1 && dupMv === 1, `statuses ${dupRecv.map((r) => r.status).sort().join(',')}, movements ${dupMv}`);

  // Multiple kitchen users polling at KDS cadence while orders flow
  const kl = [];
  await Promise.all(
    Array.from({ length: 30 }, (_, i) => {
      const s = performance.now();
      const k = [kPizza, kBurger, kBev][i % 3];
      return api('GET', '/kitchen/tickets', { token: k.token, port: PORTS[i % PORTS.length] }).then(() => kl.push(performance.now() - s));
    })
  );
  metrics.kds_polling = { requests: 30, p50_ms: percentile(kl, 50), p95_ms: percentile(kl, 95) };
  check('PERF-06', '30 concurrent KDS polls served', kl.length === 30, JSON.stringify(metrics.kds_polling));

  const pb0 = performance.now();
  const pbr = await api('GET', '/billing/pending', { token: cashier.token });
  metrics.pending_bills = { ms: Number((performance.now() - pb0).toFixed(1)), rows: pbr.json.data.length };
  check('PERF-07', 'Cashier pending-bill refresh under 1s', metrics.pending_bills.ms < 1000, JSON.stringify(metrics.pending_bills));

  // ================================================================ Auth hardening
  setSection('Authentication hardening');
  let last;
  for (let i = 0; i < 6; i++) last = await api('POST', '/auth/login', { body: { email: 'bruteforce@foodcourt.com', password: 'nope' } });
  check('AUTH-01', 'Brute-force login throttled after 5 attempts', last.status === 429, `6th -> ${last.status}`);
  const okAfter = await api('POST', '/auth/login', { body: { email: 'waiter2@foodcourt.com', password: PASSWORD } });
  check('AUTH-02', 'Throttle is per account: other staff can still log in', okAfter.status === 200);

  // ================================================================ Workflow E: End of day
  setSection('Workflow E — End-of-day closing');
  const today = new Date().toISOString().slice(0, 10);
  const sumE = await api('GET', `/settlements/daily-summary?date=${today}`, { token: owner.token });
  const dbStallGross = sql(`SELECT string_agg(s.code||'='||COALESCE(x.g,0)::text, ',' ORDER BY s.code) FROM stalls s LEFT JOIN (SELECT oi.stall_id, SUM(oi.subtotal) g FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.payment_status='paid' AND DATE(o.created_at)=${q(today)} GROUP BY oi.stall_id) x ON x.stall_id=s.id`);
  check('E-01', 'Owner sees daily summary with stall-wise breakdown', sumE.status === 200 && sumE.json.data.stall_breakdown.length >= 3, dbStallGross);
  const kSum = await api('GET', '/settlements/daily-summary', { token: kPizza.token });
  const kDash = await api('GET', '/reports/dashboard', { token: kPizza.token });
  check('E-02', 'Kitchen staff blocked from summary and dashboard', kSum.status === 403 && kDash.status === 403);
  const cashSum = Number(sql(`SELECT COALESCE(SUM(amount),0) FROM payments WHERE payment_method='cash' AND DATE(created_at)=${q(today)}`));
  check('E-03', 'Cash-collected figure matches payments ledger', Number(sumE.json.data.summary.cash_collected) === cashSum, `${sumE.json.data.summary.cash_collected} vs ${cashSum}`);
  const close = await api('POST', '/settlements/close-day', { token: owner.token, body: { date: today, notes: 'Staging validation closing' } });
  const recs = close.json?.data?.settlements || [];
  check('E-04', 'Closing creates one settlement record per active stall', close.status === 201 && recs.length === stalls.length, `${recs.length} records`);
  check('E-05', 'No settlement amount is invented at closing (all 0 until owner records payout)', recs.every((r) => Number(r.settlement_amount) === 0), recs.map((r) => `${r.stall_id}:${r.stall_gross_sales}`).join(' '));
  const reclose = await api('POST', '/settlements/close-day', { token: owner.token, body: { date: today } });
  check('E-06', 'Day cannot be closed twice', reclose.status === 422);
  const payoutNoAmt = await api('POST', `/settlements/${recs[0].id}/pay`, { token: owner.token, body: { paid_to_representative: 'Marco', payment_method: 'cash' } });
  const payout = await api('POST', `/settlements/${recs[0].id}/pay`, { token: owner.token, body: { amount_paid: '1234.50', paid_to_representative: 'Marco', payment_method: 'cash', notes: 'Staging payout' } });
  const payoutAgain = await api('POST', `/settlements/${recs[0].id}/pay`, { token: owner.token, body: { amount_paid: '1.00', paid_to_representative: 'X', payment_method: 'cash' } });
  check('E-07', 'Owner records payout with explicit amount; cannot be overwritten', payoutNoAmt.status === 422 && payout.status === 200 && payoutAgain.status === 422 && sql(`SELECT settlement_amount FROM stall_settlement_records WHERE id=${recs[0].id}`) === '1234.50');
  const auditClose = countWhere('audit_logs', `action ILIKE '%clos%'`);
  check('E-08', 'Closing recorded in audit log', auditClose > 0, `${auditClose} rows`);

  // ================================================================ Query plans
  setSection('Database query plans');
  const plan = sql(`EXPLAIN (FORMAT TEXT) SELECT * FROM orders WHERE payment_status='unpaid' AND status <> 'cancelled' ORDER BY id DESC`);
  metrics.pending_bills_plan = plan.split('\n')[0];
  check('DB-01', 'Pending-bills query plan captured', plan.length > 0, metrics.pending_bills_plan);
  metrics.row_counts = Object.fromEntries(['orders', 'order_items', 'stall_kitchen_tickets', 'payments', 'stock_movements', 'audit_logs'].map((t) => [t, Number(sql(`SELECT COUNT(*) FROM ${t}`))]));

  // ------------------------------------------------------------------ report
  const summary = {
    started: started.toISOString(),
    finished: new Date().toISOString(),
    target: { api: PORTS.map((p) => `http://${HOST}:${p}`), reverb: `ws://${HOST}:${REVERB_PORT}`, database: env.DB_DATABASE },
    totals: { pass: results.filter((r) => r.result === 'PASS').length, fail: results.filter((r) => r.result === 'FAIL').length },
    metrics,
    results,
  };
  mkdirSync(join(HERE, 'results'), { recursive: true });
  writeFileSync(join(HERE, 'results', 'latest.json'), JSON.stringify(summary, null, 2));
  console.log(`\nTOTAL: ${summary.totals.pass} PASS, ${summary.totals.fail} FAIL`);
  console.log('Metrics:', JSON.stringify(metrics));
  process.exit(summary.totals.fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exit(3);
});
