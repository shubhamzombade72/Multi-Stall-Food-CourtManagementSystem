/**
 * Phase 4 — Workstreams C–F: one real customer-to-cashier scenario across all three stalls, plus
 * waiter / kitchen role checks and the security checklist, against the live staging stack.
 *
 *   node qa/staging/phase4-workflow-e2e.mjs
 *
 * Every step records API status codes and database evidence (order number, ticket ids, payment rows).
 * Writes qa/staging/results/phase4-e2e.json. Never point this at production.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PSQL = process.env.PSQL_BIN || 'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe';
const API = process.env.STAGING_API || 'http://127.0.0.1:8100/api';
const PASSWORD = process.env.STAGING_SEED_PASSWORD || 'password123'; // DatabaseSeeder default (staging only)

const env = Object.fromEntries(
  readFileSync(join(ROOT, 'backend', '.env.staging'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')])
);
if (env.DB_DATABASE !== 'foodcourt_staging_db') throw new Error('Refusing to run outside foodcourt_staging_db');

const results = [];
let section = '';
const evidence = {};
const check = (id, desc, pass, ev = '') => {
  results.push({ section, id, description: desc, result: pass ? 'PASS' : 'FAIL', evidence: String(ev).slice(0, 300) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 150)}]` : ''}`);
};
const sec = (s) => {
  section = s;
  console.log(`\n=== ${s} ===`);
};
const sql = (q) =>
  execFileSync(PSQL, ['-h', env.DB_HOST, '-p', env.DB_PORT, '-U', env.DB_USERNAME, '-d', env.DB_DATABASE, '-tAc', q], {
    env: { ...process.env, PGPASSWORD: env.DB_PASSWORD },
    encoding: 'utf8',
  })
    .replace(/\r/g, '') // psql on Windows emits CRLF
    .trim();
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function api(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}
const login = async (email) => {
  const r = await api('POST', '/auth/login', { body: { email, password: PASSWORD } });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status}`);
  return { token: r.json.data.token, user: r.json.data.user };
};

// Pusher-protocol client for Reverb
const wsConnect = () =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${env.REVERB_PORT}/app/${env.REVERB_APP_KEY}?protocol=7&client=js&version=8.4.0`);
    const events = [];
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.event === 'pusher:connection_established') {
        ws.socketId = JSON.parse(msg.data).socket_id;
        resolve({ ws, events });
      } else events.push(msg);
    };
    ws.onerror = () => reject(new Error('ws error'));
  });
const subscribe = async (conn, channel, token) => {
  const a = await api('POST', '/broadcasting/auth', { token, body: { socket_id: conn.ws.socketId, channel_name: channel } });
  if (a.status !== 200) return a.status;
  conn.ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { channel, auth: a.json.auth } }));
  await new Promise((r) => setTimeout(r, 400));
  return conn.events.some((e) => e.channel === channel && e.event === 'pusher_internal:subscription_succeeded') ? 200 : 'not-subscribed';
};
const waitEvent = async (conn, pred, ms = 5000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const e = conn.events.find(pred);
    if (e) return e;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
};

(async () => {
  const owner = await login('owner@foodcourt.com');
  const cashier = await login('cashier@foodcourt.com');
  const waiter = await login('waiter1@foodcourt.com');
  const kitchens = {
    'STALL-PIZZA': await login('kitchen.pizza@foodcourt.com'),
    'STALL-BURGER': await login('kitchen.burger@foodcourt.com'),
    'STALL-BEV': await login('kitchen.bev@foodcourt.com'),
  };
  const managerPizza = await login('manager.pizza@foodcourt.com');
  const stalls = Object.fromEntries((await api('GET', '/stalls', { token: cashier.token })).json.data.map((s) => [s.code, s]));
  const stallById = (id) => Object.values(stalls).find((s) => s.id === id).code;

  // A free table, so the "table released" check is meaningful
  const tables = (await api('GET', '/tables', { token: owner.token })).json.data;
  const table = tables.find((t) => t.status === 'available') || tables[0];
  sql(`SELECT 1`); // DB reachable

  // ======================================================== E. customer → cashier
  sec('Workstream E — customer-to-cashier (multi-stall QR order)');
  const menu = await api('GET', `/public/qr/${table.qr_token}`);
  check('E-01', 'Customer opens QR menu for the table', menu.status === 200 && menu.json.data.table.table_number === table.table_number, `table ${table.table_number}`);
  const pick = (code, n) => menu.json.data.stalls.find((s) => s.code === code).categories.flatMap((c) => c.menu_items)[n];
  const items = [
    { m: pick('STALL-PIZZA', 0), q: 2 },
    { m: pick('STALL-BURGER', 1), q: 1 },
    { m: pick('STALL-BEV', 2), q: 3 },
  ];
  const key = `qr_phase4_${Date.now()}`;
  const body = { qr_token: table.qr_token, idempotency_key: key, order_type: 'dine_in', customer_name: 'Phase 4 UAT', customer_phone: '9000000044', items: items.map((i) => ({ menu_item_id: i.m.id, quantity: i.q })) };
  const created = await api('POST', '/public/orders', { body });
  const replay = await api('POST', '/public/orders', { body }); // network retry with the same key
  check('E-02', 'One parent order created; retry with same key replays it (201 then 200)', created.status === 201 && replay.status === 200 && replay.json.data.order_number === created.json.data.order_number, `${created.json?.data?.order_number}`);
  const orderNumber = created.json.data.order_number;
  const order = JSON.parse(sql(`SELECT row_to_json(o) FROM (SELECT id, order_number, table_id, order_channel, status, payment_status, subtotal, tax_amount, total_amount FROM orders WHERE order_number=${lit(orderNumber)}) o`));
  evidence.order = order;
  check('E-03', 'Exactly one parent order row for the idempotency key', Number(sql(`SELECT COUNT(*) FROM orders WHERE idempotency_key=${lit(key)}`)) === 1, `order id ${order.id}, channel ${order.order_channel}`);

  // Bill total vs the existing server rule (5% GST, hard-coded, OPEN-05): integer paise arithmetic
  const paise = (s) => Math.round(Number(s) * 100);
  const sub = items.reduce((a, i) => a + paise(i.m.price) * i.q, 0);
  const tax = Math.round(sub * 0.05);
  check('E-04', 'Bill total equals menu prices × qty + existing 5% tax rule', paise(order.subtotal) === sub && paise(order.total_amount) === sub + tax, `subtotal ${order.subtotal}, tax ${order.tax_amount}, total ${order.total_amount}`);

  const tickets = sql(`SELECT id||':'||stall_id||':'||status FROM stall_kitchen_tickets WHERE order_id=${order.id} ORDER BY stall_id`).split('\n').map((r) => r.split(':')).map(([id, sid, st]) => ({ id: +id, stall: stallById(+sid), status: st }));
  evidence.tickets = tickets;
  check('E-05', 'One kitchen ticket per stall (3), each with its own items', tickets.length === 3 && new Set(tickets.map((t) => t.stall)).size === 3, tickets.map((t) => `${t.stall}#${t.id}`).join(' '));
  const itemsPerTicket = sql(`SELECT t.stall_id||'='||COUNT(i.id) FROM stall_kitchen_tickets t JOIN stall_ticket_items i ON i.ticket_id=t.id WHERE t.order_id=${order.id} GROUP BY t.stall_id ORDER BY t.stall_id`);
  check('E-06', 'Ticket items match the ordered lines per stall', itemsPerTicket.split('\n').every((r) => r.endsWith('=1')), itemsPerTicket.replace(/\n/g, ' '));

  // Realtime: waiter + each kitchen subscribed before preparation
  const wsWaiter = await wsConnect();
  const subW = await subscribe(wsWaiter, 'private-waiters', waiter.token);
  const wsK = {};
  for (const code of Object.keys(kitchens)) {
    wsK[code] = await wsConnect();
    await subscribe(wsK[code], `private-stall.${stalls[code].id}`, kitchens[code].token);
  }

  // ======================================================== D. kitchens
  sec('Workstream D — kitchen UAT per stall (API level)');
  for (const code of Object.keys(kitchens)) {
    const list = (await api('GET', '/kitchen/tickets', { token: kitchens[code].token })).json.data;
    const own = tickets.find((t) => t.stall === code);
    check(`D-${code}-1`, `${code} kitchen sees its ticket and only its stall's tickets`, list.some((t) => t.id === own.id) && list.every((t) => t.stall_id === stalls[code].id), `${list.length} tickets visible`);
    const other = tickets.find((t) => t.stall !== code);
    const x = await api('PUT', `/kitchen/tickets/${other.id}/status`, { token: kitchens[code].token, body: { status: 'accepted' } });
    check(`D-${code}-2`, `${code} kitchen cannot update another stall's ticket`, x.status === 403, `-> ${x.status}`);
    const steps = [];
    for (const st of ['accepted', 'preparing', 'ready']) steps.push((await api('PUT', `/kitchen/tickets/${own.id}/status`, { token: kitchens[code].token, body: { status: st } })).status);
    check(`D-${code}-3`, `${code} kitchen accepts → prepares → marks ready`, steps.every((s) => s === 200), steps.join(','));
    const back = await api('PUT', `/kitchen/tickets/${own.id}/status`, { token: kitchens[code].token, body: { status: 'preparing' } });
    check(`D-${code}-4`, `${code} ticket cannot go backwards`, back.status === 422, `-> ${back.status}`);
  }
  for (const code of Object.keys(kitchens)) {
    const foreign = wsK[code].events.filter((e) => e.data && e.event.startsWith('Ticket') && JSON.parse(e.data).stall_id !== stalls[code].id);
    const own = await waitEvent(wsK[code], (e) => e.event === 'TicketReady' && JSON.parse(e.data).order_id === order.id, 3000);
    check(`D-${code}-5`, `${code} KDS got its own TicketReady and no other stall's events (Reverb)`, !!own && foreign.length === 0, `${foreign.length} foreign events`);
  }
  const kdsDash = await api('GET', '/reports/dashboard', { token: kitchens['STALL-PIZZA'].token });
  const kdsOrders = await api('GET', `/orders/${order.id}`, { token: kitchens['STALL-PIZZA'].token });
  check('D-6', 'Kitchen staff denied revenue dashboard and full order (customer data)', kdsDash.status === 403 && kdsOrders.status === 403, `${kdsDash.status}, ${kdsOrders.status}`);

  // ======================================================== C. waiter
  sec('Workstream C — waiter UAT (API level; device UI pending)');
  const readyEvents = await waitEvent(wsWaiter, (e) => e.event === 'TicketReady' && JSON.parse(e.data).order_id === order.id, 5000);
  check('C-01', 'Waiter subscribed to private-waiters and received TicketReady (Reverb)', subW === 200 && !!readyEvents, `subscribe ${subW}`);
  const readyList = (await api('GET', '/waiter/ready-tickets', { token: waiter.token })).json.data;
  check('C-02', 'Polling fallback: /waiter/ready-tickets lists all 3 tickets', tickets.every((t) => readyList.some((r) => r.id === t.id)));
  const track = await api('GET', `/public/orders/track/${created.json.data.tracking_token}`);
  check('C-03', 'Order status visible as ready', track.json.data.status === 'ready', track.json.data.status);
  const serve = [];
  for (const t of tickets) serve.push((await api('POST', `/waiter/tickets/${t.id}/served`, { token: waiter.token })).status);
  const serveAgain = (await api('POST', `/waiter/tickets/${tickets[0].id}/served`, { token: waiter.token })).status;
  check('C-04', 'Waiter confirms serving each ticket; repeated tap is harmless', serve.every((s) => s === 200) && serveAgain === 200, serve.join(','));
  check('C-05', 'Parent order status → served', sql(`SELECT status FROM orders WHERE id=${order.id}`) === 'served');
  const waiterPay = await api('POST', '/billing/pay', { token: waiter.token, body: { order_id: order.id, payment_method: 'cash', amount: order.total_amount } });
  check('C-06', 'Waiter cannot take payment', waiterPay.status === 403, `-> ${waiterPay.status}`);

  // ======================================================== E (continued): cashier
  sec('Workstream E — cashier settlement');
  const pending = (await api('GET', '/billing/pending', { token: cashier.token })).json.data.find((o) => o.order_number === orderNumber);
  check('E-07', 'Cashier sees one consolidated pending bill with all 3 stalls', !!pending && new Set(pending.items.map((i) => i.stall_id)).size === 3 && paise(pending.total_amount) === paise(order.total_amount), `total ${pending?.total_amount}`);
  const wrong = await api('POST', '/billing/pay', { token: cashier.token, body: { order_id: order.id, payment_method: 'upi_qr', amount: '1.00' } });
  check('E-08', 'Wrong amount rejected', wrong.status === 422, `-> ${wrong.status}`);
  const [p1, p2] = await Promise.all([
    api('POST', '/billing/pay', { token: cashier.token, body: { order_id: order.id, payment_method: 'cash', amount: order.total_amount, cash_tendered: '2000.00' } }),
    api('POST', '/billing/pay', { token: cashier.token, body: { order_id: order.id, payment_method: 'cash', amount: order.total_amount, cash_tendered: '2000.00' } }),
  ]);
  const payRows = sql(`SELECT id||'|'||payment_method||'|'||amount||'|'||change_returned FROM payments WHERE order_id=${order.id}`);
  evidence.payment = payRows;
  check('E-09', 'Double-submitted payment: exactly one payment row, correct change', [p1.status, p2.status].sort().join(',') === '200,422' && payRows.split('\n').length === 1 && payRows.endsWith(`|${(2000 - Number(order.total_amount)).toFixed(2)}`), payRows);
  const receipt = await api('GET', `/billing/receipt/${order.id}`, { token: cashier.token });
  check('E-10', 'Receipt shows 3 stall sections', receipt.status === 200 && Object.keys(receipt.json.data.stall_breakdown).length === 3);
  const final = JSON.parse(sql(`SELECT row_to_json(x) FROM (SELECT o.status, o.payment_status, (SELECT status FROM dining_tables WHERE id=o.table_id) AS table_status, (SELECT string_agg(DISTINCT status, ',') FROM stall_kitchen_tickets WHERE order_id=o.id) AS ticket_statuses FROM orders o WHERE o.id=${order.id}) x`));
  evidence.final = final;
  check('E-11', 'Final state: order completed + paid, tickets picked_up, table released', final.status === 'completed' && final.payment_status === 'paid' && final.ticket_statuses === 'picked_up' && final.table_status === 'available', JSON.stringify(final));
  check('E-12', 'Customer tracking shows paid', (await api('GET', `/public/orders/track/${created.json.data.tracking_token}`)).json.data.payment_status === 'paid');

  // Waiter order settled by cashier too
  const wKey = `waiter_phase4_${Date.now()}`;
  const wOrder = await api('POST', '/orders', { token: waiter.token, body: { table_id: tables[1].id, order_type: 'dine_in', idempotency_key: wKey, items: [{ menu_item_id: pick('STALL-BEV', 0).id, quantity: 1 }] } });
  const wPay = await api('POST', '/billing/pay', { token: cashier.token, body: { order_id: wOrder.json.data.id, payment_method: 'upi_qr', amount: wOrder.json.data.total_amount, transaction_reference: 'UPI-PH4' } });
  check('E-13', 'Cashier settles a waiter-app order', wOrder.status === 201 && wOrder.json.data.order_channel === 'waiter_app' && wPay.status === 200, wOrder.json.data.order_number);

  // ======================================================== F. security checklist
  sec('Workstream F — security checklist (live)');
  check('F-01', 'Public tracking uses a 36-char random token (trk_)', /^trk_[A-Za-z0-9]{36}$/.test(created.json.data.tracking_token));
  const idor = await api('GET', `/public/orders/${order.id}`);
  check('F-02', 'Sequential order id is not publicly readable', idor.status === 404, `-> ${idor.status}`);
  check('F-03', 'Public responses carry no customer phone', !JSON.stringify(created.json).includes('9000000044') && !JSON.stringify(track.json).includes('9000000044'));
  const spoof = await api('POST', '/public/orders', { body: { qr_token: table.qr_token, order_type: 'dine_in', order_channel: 'cashier_pos', items: [{ menu_item_id: pick('STALL-BEV', 0).id, quantity: 1 }] } });
  check('F-04', 'Public order cannot spoof channel (forced qr_customer)', spoof.status === 201 && spoof.json.data.order_channel === 'qr_customer', spoof.json?.data?.order_channel);
  const forged = await api('POST', '/public/orders', { body: { qr_token: 'TBL-FORGED-0000', order_type: 'dine_in', items: [{ menu_item_id: pick('STALL-BEV', 0).id, quantity: 1 }] } });
  const noToken = await api('POST', '/public/orders', { body: { table_id: table.id, order_type: 'dine_in', items: [{ menu_item_id: pick('STALL-BEV', 0).id, quantity: 1 }] } });
  check('F-05', 'QR tokens validated (forged / missing → 422)', forged.status === 422 && noToken.status === 422, `${forged.status}, ${noToken.status}`);
  const pizzaItem = pick('STALL-PIZZA', 0);
  const kPrice = await api('PUT', `/menu/${pizzaItem.id}`, { token: kitchens['STALL-PIZZA'].token, body: { price: 1 } });
  const otherMgr = await api('PUT', `/menu/${pick('STALL-BURGER', 0).id}`, { token: managerPizza.token, body: { price: 1 } });
  check('F-06', 'Menu price changes need owner / own-stall manager (kitchen 403, other-stall manager 403)', kPrice.status === 403 && otherMgr.status === 403, `${kPrice.status}, ${otherMgr.status}`);
  check('F-07', 'Payment requires cashier/owner (waiter 403)', waiterPay.status === 403);
  const toCancel = await api('POST', '/orders', { token: cashier.token, body: { order_type: 'takeaway', items: [{ menu_item_id: pick('STALL-BEV', 1).id, quantity: 1 }] } });
  const wCancel = await api('POST', `/orders/${toCancel.json.data.id}/cancel`, { token: waiter.token });
  const cCancel = await api('POST', `/orders/${toCancel.json.data.id}/cancel`, { token: cashier.token });
  const paidCancel = await api('POST', `/orders/${order.id}/cancel`, { token: cashier.token });
  check('F-08', 'Cancellation: waiter 403, cashier 200 on unpaid, 422 on paid', wCancel.status === 403 && cCancel.status === 200 && paidCancel.status === 422, `${wCancel.status}, ${cCancel.status}, ${paidCancel.status}`);
  check('F-09', 'Idempotency enforced by backend (unique key → single row)', Number(sql(`SELECT COUNT(*) FROM orders WHERE idempotency_key=${lit(key)}`)) === 1);
  const burgerInv = (await api('GET', `/inventory?stall_id=${stalls['STALL-BURGER'].id}`, { token: owner.token })).json.data[0];
  const xInv = await api('POST', `/inventory/${burgerInv.id}/adjust`, { token: managerPizza.token, body: { new_stock: 0, reason: 'x', movement_type: 'manual_adjustment' } });
  const xStall = await api('GET', `/stalls/${stalls['STALL-BURGER'].id}`, { token: managerPizza.token });
  check('F-10', 'Cross-stall access denied (stock adjust, stall details)', xInv.status === 403 && xStall.status === 403, `${xInv.status}, ${xStall.status}`);
  const audit = sql(`SELECT string_agg(DISTINCT action, ',') FROM audit_logs WHERE entity_id IN (${lit(order.id)}, ${lit(String(order.id))}) OR (entity_type ILIKE '%Payment%' AND created_at > now() - interval '5 minutes')`);
  check('F-11', 'Audit log rows persisted for this order / payment', audit.length > 0, audit);
  const wsX = await wsConnect();
  const cross = await subscribe(wsX, `private-stall.${stalls['STALL-BURGER'].id}`, kitchens['STALL-PIZZA'].token);
  const anon = await api('POST', '/broadcasting/auth', { body: { socket_id: wsX.ws.socketId, channel_name: 'private-cashier' } });
  wsX.ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { channel: 'private-cashier', auth: `${env.REVERB_APP_KEY}:forged` } }));
  const forgedSub = await waitEvent(wsX, (e) => e.event?.includes('error') || (e.channel === 'private-cashier' && e.event === 'pusher_internal:subscription_succeeded'), 3000);
  check('F-12', 'Private channels: cross-stall 403, anonymous 401, forged signature refused by Reverb', cross === 403 && anon.status === 401 && forgedSub && forgedSub.event !== 'pusher_internal:subscription_succeeded', `${cross}, ${anon.status}, ${forgedSub?.event}`);
  for (const c of [wsWaiter, wsX, ...Object.values(wsK)]) c.ws.close();

  const summary = { ran_at: new Date().toISOString(), api: API, database: env.DB_DATABASE, pass: results.filter((r) => r.result === 'PASS').length, fail: results.filter((r) => r.result === 'FAIL').length, evidence, results };
  mkdirSync(join(HERE, 'results'), { recursive: true });
  writeFileSync(join(HERE, 'results', 'phase4-e2e.json'), JSON.stringify(summary, null, 2));
  console.log(`\nTOTAL: ${summary.pass} PASS, ${summary.fail} FAIL`);
  console.log('Evidence:', JSON.stringify(evidence));
  process.exit(summary.fail ? 1 : 0);
})().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exit(3);
});
