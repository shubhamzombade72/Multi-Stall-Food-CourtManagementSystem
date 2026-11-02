/**
 * Desktop-first end-to-end workflow (PRD §14) against an ISOLATED database (foodcourt_desktop_e2e_db).
 *
 *   owner creates stall -> creates staff -> adds category, menu items, photo
 *   -> new cashier creates multi-stall order -> each kitchen prepares only its ticket
 *   -> cashier settles the parent bill (+ receipt, payment history, duplicate blocked)
 *   -> purchase, goods receipt, stock out, ledger -> daily closing -> reports
 *
 *   node qa/desktop/desktop-e2e.mjs        (API: E2E_API, default http://127.0.0.1:8110/api)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const API = process.env.E2E_API || 'http://127.0.0.1:8110/api';
const PSQL = 'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe';
const env = Object.fromEntries(
  readFileSync(join(ROOT, 'backend', '.env.desktope2e'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')])
);
if (env.DB_DATABASE !== 'foodcourt_desktop_e2e_db') throw new Error('Refusing: not the isolated E2E database');

const results = [];
const evidence = {};
let section = '';
const sec = (s) => {
  section = s;
  console.log(`\n=== ${s} ===`);
};
const check = (id, desc, pass, ev = '') => {
  results.push({ section, id, desc, result: pass ? 'PASS' : 'FAIL', evidence: String(ev).slice(0, 300) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 140)}]` : ''}`);
};
const skip = (id, desc, reason) => {
  results.push({ section, id, desc, result: 'SKIP', evidence: reason });
  console.log(`SKIP  ${id}  ${desc}  [${reason}]`);
};
const sql = (q) =>
  execFileSync(PSQL, ['-h', env.DB_HOST, '-p', env.DB_PORT, '-U', env.DB_USERNAME, '-d', env.DB_DATABASE, '-tAc', q], {
    env: { ...process.env, PGPASSWORD: env.DB_PASSWORD },
    encoding: 'utf8',
  })
    .replace(/\r/g, '')
    .trim();

async function api(method, path, { token, body, form } = {}) {
  const headers = { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (!form) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}
const login = async (email, password) => {
  const r = await api('POST', '/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`login ${email} -> ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.data.token;
};
const paise = (v) => Math.round(Number(v) * 100);
// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const run = Date.now().toString(36).toUpperCase();
  const owner = await login('owner@foodcourt.com', 'password123'); // seeded E2E database only

  // ------------------------------------------------------------------ owner setup
  sec('Owner: stall, staff, menu');
  const stall = await api('POST', '/stalls', { token: owner, body: { name: `Dosa Corner ${run}`, code: `STALL-DOSA-${run}`, contact_phone: '9000011111' } });
  check('O-01', 'Owner creates a new stall', stall.status === 201, stall.json?.data?.code);
  const stallId = stall.json.data.id;
  const pizzaId = Number(sql(`SELECT id FROM stalls WHERE code='STALL-PIZZA'`));

  const pw = 'E2ePassword123';
  const mk = async (name, role, sid) =>
    api('POST', '/staff', { token: owner, body: { name, email: `${role}.${run.toLowerCase()}@foodcourt.com`, password: pw, role, stall_id: sid } });
  const cashierRes = await mk(`E2E Cashier ${run}`, 'cashier', null);
  const kitchenRes = await mk(`E2E Dosa Chef ${run}`, 'kitchen_staff', stallId);
  const managerRes = await mk(`E2E Dosa Manager ${run}`, 'stall_manager', stallId);
  check('O-02', 'Owner creates cashier, kitchen staff and stall manager', [cashierRes, kitchenRes, managerRes].every((r) => r.status === 201));
  const noStall = await api('POST', '/staff', { token: owner, body: { name: 'x', email: `x.${run.toLowerCase()}@foodcourt.com`, password: pw, role: 'kitchen_staff' } });
  check('O-03', 'Kitchen staff without a stall is rejected', noStall.status === 422);

  const cat = await api('POST', '/menu-categories', { token: owner, body: { stall_id: stallId, name: 'Dosas' } });
  const item1 = await api('POST', '/menu', { token: owner, body: { stall_id: stallId, category_id: cat.json.data.id, name: 'Masala Dosa', price: 120, is_veg: true } });
  const item2 = await api('POST', '/menu', { token: owner, body: { stall_id: stallId, category_id: cat.json.data.id, name: 'Rava Dosa', price: 140, is_veg: true } });
  check('O-04', 'Owner adds a category and two menu items to the new stall', cat.status === 201 && item1.status === 201 && item2.status === 201);
  const fd = new FormData();
  fd.append('image', new Blob([PNG], { type: 'image/png' }), 'dosa.png');
  const img = await api('POST', `/menu/${item1.json.data.id}/image`, { token: owner, form: fd });
  const imgGet = img.json?.data?.image_url ? await fetch(img.json.data.image_url) : { status: 0 };
  check('O-05', 'Owner uploads a product photo and it is served back', img.status === 200 && imgGet.status === 200, img.json?.data?.image_url);
  const pizzaItem = JSON.parse(sql(`SELECT row_to_json(m) FROM (SELECT id, price FROM menu_items WHERE stall_id=${pizzaId} ORDER BY id LIMIT 1) m`));

  // ------------------------------------------------------------------ cashier order
  sec('Cashier POS: multi-stall order');
  const cashier = await login(cashierRes.json.data.email, pw);
  const tableId = Number(sql(`SELECT id FROM dining_tables WHERE table_number='T-05'`));
  const order = await api('POST', '/orders', {
    token: cashier,
    body: { table_id: tableId, order_type: 'dine_in', idempotency_key: `pos_${run}`, items: [{ menu_item_id: item1.json.data.id, quantity: 2 }, { menu_item_id: pizzaItem.id, quantity: 1 }] },
  });
  const replay = await api('POST', '/orders', {
    token: cashier,
    body: { table_id: tableId, order_type: 'dine_in', idempotency_key: `pos_${run}`, items: [{ menu_item_id: item1.json.data.id, quantity: 2 }, { menu_item_id: pizzaItem.id, quantity: 1 }] },
  });
  check('C-01', 'Cashier creates one parent order (retry replays it)', order.status === 201 && replay.status === 200 && order.json.data.order_channel === 'cashier_pos', order.json?.data?.order_number);
  const orderId = order.json.data.id;
  evidence.order = order.json.data.order_number;
  const tickets = sql(`SELECT stall_id||':'||id FROM stall_kitchen_tickets WHERE order_id=${orderId} ORDER BY stall_id`).split('\n').map((r) => r.split(':').map(Number));
  check('C-02', 'Order split into one kitchen ticket per stall (2)', tickets.length === 2 && tickets.some(([s]) => s === stallId) && tickets.some(([s]) => s === pizzaId), JSON.stringify(tickets));
  const sub = 2 * paise(120) + paise(pizzaItem.price);
  check('C-03', 'Totals computed by the server from menu prices + existing 5% rule', paise(order.json.data.subtotal) === sub && paise(order.json.data.total_amount) === sub + Math.round(sub * 0.05), `${order.json.data.subtotal} / ${order.json.data.total_amount}`);

  // ------------------------------------------------------------------ kitchens
  sec('Kitchen Display: stall isolation');
  const dosaChef = await login(kitchenRes.json.data.email, pw);
  const pizzaChef = await login('kitchen.pizza@foodcourt.com', 'password123');
  const dosaTicket = tickets.find(([s]) => s === stallId)[1];
  const pizzaTicket = tickets.find(([s]) => s === pizzaId)[1];
  const dosaList = (await api('GET', '/kitchen/tickets', { token: dosaChef })).json.data;
  check('K-01', 'New stall kitchen sees only its own ticket', dosaList.length >= 1 && dosaList.every((t) => t.stall_id === stallId) && dosaList.some((t) => t.id === dosaTicket));
  const cross = await api('PUT', `/kitchen/tickets/${pizzaTicket}/status`, { token: dosaChef, body: { status: 'accepted' } });
  const pay403 = await api('POST', '/billing/pay', { token: dosaChef, body: { order_id: orderId, payment_method: 'cash', amount: order.json.data.total_amount } });
  check('K-02', 'Kitchen cannot touch another stall nor take payments', cross.status === 403 && pay403.status === 403, `${cross.status}, ${pay403.status}`);
  let ok = true;
  for (const [tok, tid] of [[dosaChef, dosaTicket], [pizzaChef, pizzaTicket]]) {
    for (const st of ['accepted', 'preparing', 'ready']) ok &&= (await api('PUT', `/kitchen/tickets/${tid}/status`, { token: tok, body: { status: st } })).status === 200;
  }
  check('K-03', 'Each kitchen prepares its ticket to ready', ok && sql(`SELECT status FROM orders WHERE id=${orderId}`) === 'ready');

  // ------------------------------------------------------------------ settlement of bill
  sec('Cashier: consolidated bill and payment');
  const pending = (await api('GET', '/billing/pending', { token: cashier })).json.data.find((o) => o.id === orderId);
  check('B-01', 'Pending bill lists both stalls', !!pending && new Set(pending.items.map((i) => i.stall_id)).size === 2);
  const [p1, p2] = await Promise.all([
    api('POST', '/billing/pay', { token: cashier, body: { order_id: orderId, payment_method: 'cash', amount: order.json.data.total_amount, cash_tendered: '1000.00' } }),
    api('POST', '/billing/pay', { token: cashier, body: { order_id: orderId, payment_method: 'cash', amount: order.json.data.total_amount, cash_tendered: '1000.00' } }),
  ]);
  const payRows = sql(`SELECT COUNT(*)||'|'||MAX(change_returned) FROM payments WHERE order_id=${orderId}`);
  check('B-02', 'Exactly one payment (double submit blocked), correct change', [p1.status, p2.status].sort().join(',') === '200,422' && payRows === `1|${(1000 - Number(order.json.data.total_amount)).toFixed(2)}`, payRows);
  const receipt = await api('GET', `/billing/receipt/${orderId}`, { token: cashier });
  check('B-03', 'Receipt groups lines by both stalls', receipt.status === 200 && Object.keys(receipt.json.data.stall_breakdown).length === 2);
  const history = (await api('GET', '/billing/payments', { token: cashier })).json.data.data;
  check('B-04', 'Payment appears in payment history', history.some((p) => p.order_id === orderId));
  check('B-05', 'Order completed and table released', sql(`SELECT status||'/'||payment_status||'/'||(SELECT status FROM dining_tables WHERE id=${tableId}) FROM orders WHERE id=${orderId}`) === 'completed/paid/available');

  // ------------------------------------------------------------------ purchasing & inventory
  sec('Purchasing and inventory');
  const manager = await login(managerRes.json.data.email, pw);
  const inv = await api('POST', '/inventory', { token: manager, body: { stall_id: stallId, name: 'Dosa Batter', unit: 'kg', current_stock: 5, minimum_alert_stock: 3, unit_cost: 60 } });
  const sup = await api('POST', '/suppliers', { token: manager, body: { name: `Batter Supplier ${run}` } });
  const po = await api('POST', '/purchases', {
    token: manager,
    body: { stall_id: stallId, supplier_id: sup.json.data.id, order_date: new Date().toISOString().slice(0, 10), items: [{ inventory_item_id: inv.json.data.id, quantity: 10, unit_price: 55.5 }] },
  });
  const recv = await api('POST', `/purchases/${po.json.data.id}/receive`, { token: manager });
  const out = await api('POST', `/inventory/${inv.json.data.id}/stock-out`, { token: manager, body: { quantity: 2.5, movement_type: 'consumption', reason: 'Morning prep' } });
  const stock = sql(`SELECT current_stock FROM inventory_items WHERE id=${inv.json.data.id}`);
  const ledger = sql(`SELECT string_agg(movement_type||':'||quantity, ',' ORDER BY id) FROM stock_movements WHERE inventory_item_id=${inv.json.data.id}`);
  check('I-01', 'Supplier, PO (₹555.00), goods receipt, stock out', inv.status === 201 && po.status === 201 && po.json.data.total_amount === '555.00' && recv.status === 200 && out.status === 200);
  check('I-02', 'Stock = 5 + 10 - 2.5 = 12.5 with a matching ledger', Number(stock) === 12.5 && ledger === 'purchase_inward:10.000,consumption:-2.500', `${stock} | ${ledger}`);
  const xStock = await api('GET', '/inventory', { token: manager });
  check('I-03', 'Manager sees only their stall inventory', xStock.json.data.every((i) => i.stall_id === stallId));

  // ------------------------------------------------------------------ staff deactivation
  sec('Staff deactivation');
  const deact = await api('PUT', `/staff/${kitchenRes.json.data.id}`, { token: owner, body: { is_active: false } });
  const after = await api('GET', '/kitchen/tickets', { token: dosaChef });
  check('S-01', 'Deactivated kitchen staff is signed out immediately', deact.status === 200 && after.status === 401, `after -> ${after.status}`);

  // ------------------------------------------------------------------ closing & reports
  sec('Daily closing and reports');
  const today = new Date().toISOString().slice(0, 10);
  // A day can be closed only once, so on a re-run against the same database the closing from the
  // earlier run already exists: verify the second close is refused and skip the payout checks.
  const alreadyClosed = Number(sql(`SELECT count(*) FROM daily_closings WHERE closing_date = '${today}'`)) > 0;
  const close = await api('POST', '/settlements/close-day', { token: owner, body: { date: today, notes: 'Desktop E2E closing' } });
  if (alreadyClosed) {
    check('R-00', 'Re-closing an already closed day is refused', close.status >= 400 && close.status < 500, `${close.status} ${close.json?.message ?? ''}`);
    skip('R-01', 'Daily closing creates a record for the new stall with its gross sales', `day ${today} was closed by an earlier run; use a fresh E2E database`);
    skip('R-02', 'Owner records the payout; closing history shows it', 'depends on R-01');
  } else {
    const rec = close.json?.data?.settlements?.find((s) => s.stall_id === stallId);
    check('R-01', 'Daily closing creates a record for the new stall with its gross sales', close.status === 201 && rec && paise(rec.stall_gross_sales) === 2 * paise(120), rec?.stall_gross_sales);
    const payout = rec ? await api('POST', `/settlements/${rec.id}/pay`, { token: owner, body: { amount_paid: '200.00', paid_to_representative: 'Dosa Manager', payment_method: 'cash' } }) : { status: 0 };
    const closings = (await api('GET', '/settlements/closings', { token: owner })).json.data.data;
    check('R-02', 'Owner records the payout; closing history shows it', payout.status === 200 && closings.some((c) => c.settlements.some((s) => s.id === rec?.id && s.settlement_status === 'paid')));
  }
  const stallSales = (await api('GET', `/reports/stall-sales?start_date=${today}&end_date=${today}`, { token: owner })).json.data.stalls_performance;
  check('R-03', 'Stall sales report: new stall revenue = its order lines', paise(stallSales.find((s) => s.stall_id === stallId)?.total_revenue) === 2 * paise(120));
  const menuPerf = (await api('GET', `/reports/menu-performance?start_date=${today}&end_date=${today}`, { token: owner })).json.data.items;
  check('R-04', 'Menu performance lists Masala Dosa x2', menuPerf.some((i) => i.item_name === 'Masala Dosa' && Number(i.quantity_sold) === 2));
  const cashierAct = (await api('GET', `/reports/cashier-activity?date=${today}`, { token: owner })).json.data.rows;
  check('R-05', 'Cashier activity shows the new cashier', cashierAct.some((r) => r.cashier_name === `E2E Cashier ${run}` && paise(r.total_amount) === paise(order.json.data.total_amount)));
  const dash = (await api('GET', '/reports/dashboard', { token: owner })).json.data;
  check('R-06', 'Dashboard: closing shown, payments today, low-stock list present', !!dash.closing_today && dash.payment_methods_today.length >= 1 && Array.isArray(dash.low_stock_items));
  const audit = sql(`SELECT string_agg(DISTINCT action, ',') FROM audit_logs WHERE action IN ('staff_created','staff_updated','order_created','daily_closing_created','day_closed')`);
  check('R-07', 'Audit log records staff and order actions', audit.includes('staff_created') && audit.includes('staff_updated') && audit.includes('order_created'), audit);

  const pass = results.filter((r) => r.result === 'PASS').length;
  const skipped = results.filter((r) => r.result === 'SKIP').length;
  const fail = results.length - pass - skipped;
  mkdirSync(join(ROOT, 'qa', 'staging', 'results'), { recursive: true });
  writeFileSync(join(ROOT, 'qa', 'staging', 'results', 'desktop-e2e.json'), JSON.stringify({ ran_at: new Date().toISOString(), api: API, database: env.DB_DATABASE, pass, fail, skipped, evidence, results }, null, 2));
  console.log(`\nTOTAL: ${pass} PASS, ${fail} FAIL, ${skipped} SKIP  (order ${evidence.order})`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exit(3);
});
