/**
 * Billing eligibility and Payments & Closing navigation, driven through the real Electron runtime with its built-in server
 * and a real SQLite database on a brand-new profile (test data only).
 *
 *   cd frontend-desktop && pnpm build && pnpm prepare:server
 *   node e2e/billing-eligibility.e2e.mjs
 *   PACKAGED_EXE=<win-unpacked exe> node e2e/billing-eligibility.e2e.mjs      runs the packaged build instead of the sources
 *
 * The critical scenario: a 5-item order across 2 stalls never reaches Pending Bills, and no direct API request can bill it,
 * until every item is Served or Cancelled. It is then billed in full exactly once, and the payment and receipt survive a restart.
 */
import electronPath from 'electron';
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..');
const shots = join(HERE, '..', '..', 'qa', 'desktop', 'results', 'billing-eligibility');
mkdirSync(shots, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'foodcourt-billing-'));
const BLOCKED = 'Billing is unavailable. All order items must be Served or Cancelled before generating the final bill.';
const OWNER_PW = 'Str0ngPass99';
const STAFF_PW = 'StaffPass#2026';

const results = [];
const check = (id, desc, pass, ev = '') => {
  results.push({ id, desc, result: pass ? 'PASS' : 'FAIL', evidence: String(ev).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 180)}]` : ''}`);
};

let app;
let page;
let API = '';
const pageErrors = [];

const launch = async () => {
  // Smart App Control can block a freshly built unsigned exe. PACKAGED_ASAR=<win-unpacked>/resources/app.asar (with
  // FOODCOURT_SERVER_DIR=<win-unpacked>/resources/server) runs the same packaged code in the signed Electron runtime.
  const target = process.env.PACKAGED_EXE
    ? { executablePath: process.env.PACKAGED_EXE, args: [] }
    : { executablePath: electronPath, args: [process.env.PACKAGED_ASAR || APP_DIR] };
  const env = { ...process.env, FOODCOURT_USER_DATA_DIR: profile, FOODCOURT_SMOKE_TEST: '', FOODCOURT_PIN_LOCK: 'off', FOODCOURT_API_URL: '' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ ...target, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
};

const raw = async (token, method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
const api = async (token, method, path, body) => {
  const r = await raw(token, method, path, body);
  if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
};
const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`) });
const goto = async (hash) => {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(300);
};
const sidebar = () => page.evaluate(() => {
  const groups = {};
  for (const group of document.querySelectorAll('nav[aria-label="Main navigation"] > div')) {
    groups[group.querySelector('p').innerText.trim().toUpperCase()] = [...group.querySelectorAll('a')].map((a) => ({
      label: a.querySelector('span').innerText.trim(),
      href: a.getAttribute('href'),
      active: a.classList.contains('bg-primary'),
    }));
  }
  return groups;
});
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

try {
  // ------------------------------------------------------------------ the actual app, on a fresh database
  await launch();
  await page.getByText('Welcome', { exact: false }).first().waitFor({ timeout: 90000 });
  await page.fill('#owner-name', 'Billing Owner');
  await page.fill('#owner-email', 'billing.owner@example.com');
  await page.fill('#owner-password', OWNER_PW);
  await page.fill('#owner-confirm', OWNER_PW);
  await page.getByRole('button', { name: /Create account/ }).click();
  await page.getByText('Save your recovery key').waitFor({ timeout: 20000 });
  await page.check('#recovery-saved');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => /dashboard/i.test(location.hash), null, { timeout: 20000 });
  const ownerToken = await page.evaluate(() => localStorage.getItem('fc_auth_token'));
  API = (await page.evaluate(() => window.desktop.getConfig())).apiBaseUrl.replace(/\/$/, '');
  const runtime = await app.evaluate(({ app: a }) => ({ electron: process.versions.electron, packaged: a.isPackaged, name: a.getName() }));
  const url = await page.evaluate(() => location.href);
  check('R-01', 'Running in Electron from the production renderer with its built-in server', !!runtime.electron && url.startsWith('file:') && /dist[\\/]index\.html|app\.asar/.test(decodeURI(url)) && /^http:\/\/127\.0\.0\.1:\d+\/api$/.test(API), `electron ${runtime.electron}, packaged=${runtime.packaged}, ${API}`);
  writeFileSync(join(shots, 'runtime.json'), JSON.stringify({ ...runtime, url, api: API, version: await app.evaluate(({ app: a }) => a.getVersion()) }, null, 2));

  const tag = Date.now().toString(36).slice(-4).toUpperCase();
  const stallA = (await api(ownerToken, 'POST', '/stalls', { name: `Tandoor ${tag}`, code: `TA${tag}` })).data;
  const stallB = (await api(ownerToken, 'POST', '/stalls', { name: `Dosa ${tag}`, code: `DO${tag}` })).data;
  const menu = {};
  for (const [stall, names] of [[stallA, ['Naan', 'Kebab']], [stallB, ['Plain Dosa', 'Idli', 'Vada', 'Upma']]]) {
    const cat = (await api(ownerToken, 'POST', '/menu-categories', { stall_id: stall.id, name: `Mains ${stall.code}` })).data;
    for (const name of names) menu[name] = (await api(ownerToken, 'POST', '/menu', { stall_id: stall.id, category_id: cat.id, name, price: 100 })).data;
  }
  const table = (await api(ownerToken, 'POST', '/tables', { table_number: `B-${tag}`, capacity: 4, section: 'Main' })).data;
  await api(ownerToken, 'POST', '/staff', { name: 'Bill Cashier', email: `cashier.${tag}@example.com`, password: STAFF_PW, role: 'cashier' });
  await api(ownerToken, 'POST', '/staff', { name: 'Tandoor Kitchen', email: `ka.${tag}@example.com`, password: STAFF_PW, role: 'kitchen_staff', stall_id: stallA.id });
  await api(ownerToken, 'POST', '/staff', { name: 'Dosa Kitchen', email: `kb.${tag}@example.com`, password: STAFF_PW, role: 'kitchen_staff', stall_id: stallB.id });
  const login = async (email) => (await api(null, 'POST', '/auth/login', { email, password: STAFF_PW })).data.token;
  const cashierToken = await login(`cashier.${tag}@example.com`);
  const kitchenA = await login(`ka.${tag}@example.com`);
  const kitchenB = await login(`kb.${tag}@example.com`);
  // A UPI QR must be creatable, so that its refusal below can only come from the billing rule
  await api(ownerToken, 'PUT', '/settings/upi', { enabled: true, vpa: 'mangalmurti@oksbi' });
  await page.reload();

  // ------------------------------------------------------------------ navigation
  await page.getByRole('link', { name: 'Orders', exact: true }).waitFor({ timeout: 20000 });
  const nav = await sidebar();
  const pc = nav['PAYMENTS & CLOSING'].map((l) => l.label);
  check('N-01', 'Payments & Closing holds Orders, Receipts, End-of-Day Closing & Stall Settlements, in that order', JSON.stringify(pc.slice(0, 3)) === JSON.stringify(['Orders', 'Receipts', 'End-of-Day Closing & Stall Settlements']), pc.join(' | '));
  const others = Object.entries(nav).filter(([g]) => g !== 'PAYMENTS & CLOSING').flatMap(([, ls]) => ls.map((l) => l.label));
  check('N-02', 'None of them is left in another sidebar section, and no entry is duplicated', !others.some((l) => /^Orders$|Receipt|End-of-Day|Payment History/.test(l)) && new Set([...others, ...pc]).size === others.length + pc.length, others.join(' | '));
  check('N-03', 'Cashier POS, Pending Bills and Orders & Table Tracking are under Operations; Pending Bills is not under Payments & Closing', ['Cashier POS', 'Pending Bills', 'Orders & Table Tracking'].every((n) => nav.OPERATIONS.some((l) => l.label === n)) && !pc.includes('Pending Bills'), nav.OPERATIONS.map((l) => l.label).join(' | '));
  const pages = [
    ['Orders', '#/orders', 'Orders'],
    ['Receipts', '#/payments', 'Receipts'],
    ['End-of-Day Closing & Stall Settlements', '#/settlements', /End-of-Day Closing & Stall Settlements/],
  ];
  for (const [label, href, heading] of pages) {
    await page.locator('nav[aria-label="Main navigation"]').getByRole('link', { name: label, exact: true }).click();
    await page.getByRole('heading', { name: heading }).first().waitFor({ timeout: 15000 });
    const active = (await sidebar())['PAYMENTS & CLOSING'].filter((l) => l.active).map((l) => l.label);
    check(`N-04-${href}`, `${label}: link opens ${href}, its heading matches, only it is highlighted`, (await page.evaluate(() => location.hash)) === href && active.length === 1 && active[0] === label, active.join(','));
    if (label === 'Receipts') await shot('01-sidebar-payments-and-closing');
  }
  // Existing deep links keep working
  await goto('#/pending-bills');
  await page.waitForFunction(() => location.hash === '#/pos?mode=pending_bills', null, { timeout: 10000 });
  check('N-05', 'The old #/pending-bills deep link lands on Pending Bills with the right item highlighted', Object.values(await sidebar()).flat().filter((l) => l.active).map((l) => l.label).join() === 'Pending Bills');
  await goto('#/kitchen');
  await page.waitForFunction(() => location.hash === '#/tracking', null, { timeout: 10000 });
  check('N-06', '#/kitchen still redirects to the tracking board (the separate KDS screen was decommissioned earlier)', true);

  // ------------------------------------------------------------------ Cashier Closing is gone
  const allLinks = Object.values(await sidebar()).flat().map((l) => l.label);
  check('N-07', 'Cashier Closing is not in the sidebar', !allLinks.some((l) => /Cashier Closing/i.test(l)), allLinks.join(' | '));
  await goto('#/cashier-closing');
  await page.waitForFunction(() => location.hash !== '#/cashier-closing', null, { timeout: 10000 });
  check('N-08', 'An old #/cashier-closing link falls back to the home screen', (await page.evaluate(() => location.hash)) === '#/dashboard', await page.evaluate(() => location.hash));
  const closingApi = await raw(ownerToken, 'GET', '/cashier-closings');
  check('N-09', 'The Cashier Closing API no longer exists', closingApi.status === 404, closingApi.status);
  await page.getByRole('link', { name: 'Reports & Audit' }).click();
  await page.getByRole('heading', { name: /Report/ }).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  check('N-10', 'Reports no longer offers Cashier Closings', !/Cashier Closings/i.test(await page.locator('main').innerText()));

  // ------------------------------------------------------------------ 5 items, 2 stalls, placed at the POS
  await goto('#/pos');
  await page.locator('[data-category-chip="All Categories"]').click(); // the POS opens on one category; these dishes span two
  const dishes = ['Naan', 'Kebab', 'Plain Dosa', 'Idli', 'Vada'];
  for (const name of dishes) await page.locator(`[data-menu-item="${name}"]`).first().click();
  await page.selectOption('select[aria-label="Dining table"]', String(table.id));
  await shot('02-pos-cart-five-items');
  await page.keyboard.press('F8');
  const notice = page.getByText(/sent to 2 stall kitchen/);
  await notice.waitFor({ timeout: 15000 });
  const orderNumber = /Order (\S+) sent/.exec(await notice.innerText())[1];
  check('O-01', 'POS sends the order to both kitchens; no payment dialog opens at order time', (await page.getByRole('dialog', { name: 'Consolidated bill settlement' }).count()) === 0, orderNumber);
  await shot('03-pos-order-placed-no-payment');
  const orderId = (await api(ownerToken, 'GET', `/orders?search=${orderNumber}`)).data.data[0].id;
  const totalOf = async () => (await api(ownerToken, 'GET', `/orders/${orderId}`)).data.total_amount;
  const total = await totalOf();

  const items = (await api(ownerToken, 'GET', '/orders/board')).data.orders.find((o) => o.id === orderId).items;
  const itemOf = (name) => items.find((i) => i.name === name).id;
  const kitchenFor = { Naan: kitchenA, Kebab: kitchenA, 'Plain Dosa': kitchenB, Idli: kitchenB, Vada: kitchenB };
  const kitchen = (name, status) => api(kitchenFor[name], 'PATCH', `/ticket-items/${itemOf(name)}/status`, { status });
  const serve = (name) => api(cashierToken, 'PATCH', `/ticket-items/${itemOf(name)}/status`, { status: 'served' });

  // Stall A finishes both items; stall B only one of three
  await serve('Naan');
  await serve('Kebab');
  await serve('Plain Dosa');
  await kitchen('Idli', 'preparing');
  // Vada stays pending: the exact mix from the bug report, 3 Served + 1 Cooking + 1 Pending

  await goto('#/tracking');
  await page.getByTestId(`order-card-${orderId}`).waitFor({ timeout: 15000 });
  check('O-02', 'Tracking board shows 3 of 5 served', /3\/5 Served/.test(await page.getByTestId(`order-label-${orderId}`).innerText()), await page.getByTestId(`order-label-${orderId}`).innerText());
  await shot('04-tracking-3-served-cooking-pending');

  // ------------------------------------------------------------------ not on the list, whatever is tried
  const listIds = async () => (await api(cashierToken, 'GET', '/billing/pending')).data.map((o) => o.id);
  await page.locator('nav[aria-label="Main navigation"]').getByRole('link', { name: /Pending Bills/ }).click();
  await page.getByTestId('awaiting-fulfilment').waitFor({ timeout: 15000 });
  check('B-01', 'Pending Bills does not show the order; it says one order is still being prepared', !(await listIds()).includes(orderId) && (await page.locator(`[data-settle-order="${orderNumber}"]`).count()) === 0, norm(await page.getByTestId('awaiting-fulfilment').innerText()));
  await shot('05-pending-bills-order-absent');
  await page.locator('nav[aria-label="Main navigation"]').getByRole('link', { name: /Pending Bills/ }).waitFor();
  const badge = norm(await page.locator('nav[aria-label="Main navigation"]').getByRole('link', { name: /Pending Bills/ }).innerText());
  check('B-02', 'Sidebar badge counts only billable orders', /0$/.test(badge), badge);

  const attempt = async (id, label) => {
    const pay = await raw(cashierToken, 'POST', '/billing/pay', { order_id: orderId, payment_method: 'cash', amount: total, cash_tendered: 5000 });
    const partial = await raw(cashierToken, 'POST', '/billing/pay', { order_id: orderId, payment_method: 'cash', amount: 1, cash_tendered: 1 });
    const open = await raw(cashierToken, 'GET', `/billing/orders/${orderId}/open`);
    const receipt = await raw(cashierToken, 'GET', `/billing/receipt/${orderId}`);
    const upi = await raw(cashierToken, 'POST', `/billing/orders/${orderId}/upi-request`);
    const paths = { pay, partial, open, receipt, upi };
    const refused = Object.values(paths).every((r) => r.status === 422 && r.json.message === BLOCKED);
    const o = (await api(ownerToken, 'GET', `/orders/${orderId}`)).data;
    const payments = (await api(ownerToken, 'GET', '/billing/payments')).data.total;
    check(id, `Direct billing with an item ${label}: pay, part-pay, open, final bill and UPI QR are all refused; nothing was recorded`, refused && o.payment_status === 'unpaid' && payments === 0, Object.entries(paths).map(([k, r]) => `${k}=${r.status}`).join(' ') + ` paid=${o.payment_status} payments=${payments}`);
    return pay;
  };
  const blockedPending = await attempt('B-03', 'Pending');
  check('B-04', 'The refusal names the outstanding items and their statuses', JSON.stringify(blockedPending.json.data.outstanding_items.map((i) => [i.name, i.status_label])) === JSON.stringify([['Idli', 'Cooking'], ['Vada', 'Pending']]), JSON.stringify(blockedPending.json.data.outstanding_items.map((i) => [i.name, i.status_label])));
  await kitchen('Vada', 'preparing');
  await attempt('B-05', 'Cooking');
  await kitchen('Idli', 'ready');
  await kitchen('Vada', 'ready');
  await attempt('B-06', 'Ready');
  await serve('Idli');
  await attempt('B-07', 'Ready (4 of 5 served)');

  // The Orders screen tells the same story and offers no bill
  await goto('#/orders');
  await page.getByRole('button', { name: `Open ${orderNumber}` }).click();
  await page.getByTestId('order-billing-blocked').waitFor({ timeout: 15000 });
  const blockedText = norm(await page.getByTestId('order-billing-blocked').innerText());
  check('B-08', 'Orders: an unfinished order shows why, lists the items and offers no bill or settle button', blockedText.includes(BLOCKED) && /Vada.*Ready/.test(blockedText) && (await page.getByRole('button', { name: /Print bill|Preview|Settle/ }).count()) === 0, blockedText);
  await shot('06-orders-detail-billing-blocked');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Close|✕/ }).first().click().catch(() => {});

  // ------------------------------------------------------------------ the last item served: the bill appears, in full
  await serve('Vada');
  await goto('#/tracking');
  await goto('#/pos?mode=pending_bills');
  await page.locator(`[data-settle-order="${orderNumber}"]`).waitFor({ timeout: 15000 });
  check('C-01', 'As soon as all 5 are served the order appears in Pending Bills exactly once', (await listIds()).filter((i) => i === orderId).length === 1 && (await page.locator(`[data-settle-order="${orderNumber}"]`).count()) === 1);
  await shot('07-pending-bills-order-eligible');
  const card = page.locator(`[data-settle-order="${orderNumber}"]`).locator('xpath=ancestor::div[contains(@class,"hover:border-primary")][1]');
  const cardText = await card.innerText();
  check('C-02', 'The bill lists all 5 dishes at the full amount, not only the first ones served', dishes.every((d) => cardText.includes(d)) && total === '525.00', `total ${total} (₹500 + 5% GST)`);

  // Stale screen: the bill is open, the waiter adds a dish, the cashier confirms
  await page.locator(`[data-settle-order="${orderNumber}"]`).click();
  const dialog = page.getByRole('dialog', { name: 'Consolidated bill settlement' });
  await dialog.waitFor({ timeout: 15000 });
  check('C-03', 'Opening the bill re-validates on the server and shows the amount', /₹525\.00/.test(await dialog.innerText()));
  await api(cashierToken, 'POST', `/orders/${orderId}/items`, { menu_item_id: menu.Upma.id });
  await dialog.getByRole('button', { name: 'Cash', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm Payment & Settle' }).click();
  await dialog.getByTestId('pay-error').waitFor({ timeout: 15000 });
  const payErr = norm(await dialog.getByTestId('pay-error').innerText());
  const stillNone = (await api(ownerToken, 'GET', '/billing/payments')).data.total;
  check('C-04', 'Confirming a bill that went stale is refused with the new item listed; no payment recorded', payErr.includes(BLOCKED) && /Upma.*Pending/.test(payErr) && stillNone === 0, payErr);
  await shot('08-payment-refused-item-added-while-open');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForFunction((n) => !document.querySelector(`[data-settle-order="${n}"]`), orderNumber, { timeout: 15000 });
  check('C-05', 'The refused order leaves Pending Bills', !(await listIds()).includes(orderId));

  // Back through the real board UI: the owner serves the added dish
  await goto('#/tracking');
  const upmaId = (await api(ownerToken, 'GET', '/orders/board')).data.orders.find((o) => o.id === orderId).items.find((i) => i.name === 'Upma').id;
  await page.getByTestId(`item-action-${upmaId}`).waitFor({ timeout: 15000 });
  await page.getByTestId(`item-action-${upmaId}`).click();
  await page.waitForFunction(() => /Served/.test(document.body.innerText), null, { timeout: 5000 });
  const upmaStatus = async () => norm(await page.getByTestId(`item-status-${upmaId}`).innerText());
  while (!/Served/.test(await upmaStatus())) {
    await page.getByTestId(`item-action-${upmaId}`).click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.waitForFunction(() => /6\/6 Served/.test(document.body.innerText), null, { timeout: 15000 });
  await shot('09-tracking-all-served');
  const totalAfter = await totalOf();
  check('C-06', 'Tracking board shows 6/6 served; the bill total now covers the sixth dish', totalAfter === '630.00', totalAfter);

  // Pay through the real dialog
  await page.getByTestId('go-to-pending-bills').click();
  await page.locator(`[data-settle-order="${orderNumber}"]`).waitFor({ timeout: 15000 });
  await page.locator(`[data-settle-order="${orderNumber}"]`).click();
  await dialog.waitFor({ timeout: 15000 });
  check('C-07', 'The reopened bill shows the full new amount and all 6 dishes', /₹630\.00/.test(await dialog.innerText()) && /Covers 6 dishes/.test(await dialog.innerText()));
  await dialog.getByRole('button', { name: 'Cash', exact: true }).click();
  await dialog.locator('input[type=number]').fill('700');
  await shot('10-payment-dialog-full-bill');
  await dialog.getByRole('button', { name: 'Confirm Payment & Settle' }).click();
  await page.getByText('Bill Settled Successfully').waitFor({ timeout: 20000 });
  await shot('11-bill-settled');
  await page.getByRole('button', { name: 'Close' }).last().click();

  const again = await raw(cashierToken, 'POST', '/billing/pay', { order_id: orderId, payment_method: 'cash', amount: 630 });
  const paidOrder = (await api(ownerToken, 'GET', `/orders/${orderId}`)).data;
  const payments = (await api(ownerToken, 'GET', '/billing/payments')).data;
  check('P-01', 'Exactly one payment for the full bill, change recorded; a repeat is refused; order paid and table released', again.status === 422 && paidOrder.payment_status === 'paid' && paidOrder.status === 'completed' && payments.total === 1 && payments.data[0].amount === '630.00' && payments.data[0].change_returned === '70.00' && (await api(ownerToken, 'GET', '/tables')).data.find((t) => t.id === table.id).status === 'available', `${payments.total} payment(s), ${payments.data[0].amount}, change ${payments.data[0].change_returned}`);

  // Two simultaneous submissions of another finished bill
  const order2 = (await api(cashierToken, 'POST', '/orders', { order_type: 'takeaway', items: [{ menu_item_id: menu.Upma.id, quantity: 1 }] })).data;
  const o2item = (await api(ownerToken, 'GET', '/orders/board')).data.orders.find((o) => o.id === order2.id).items[0].id;
  await api(cashierToken, 'PATCH', `/ticket-items/${o2item}/status`, { status: 'served' });
  const body = { order_id: order2.id, payment_method: 'cash', amount: order2.total_amount };
  const both = await Promise.all([raw(cashierToken, 'POST', '/billing/pay', body), raw(cashierToken, 'POST', '/billing/pay', body), raw(ownerToken, 'POST', '/billing/pay', body)]);
  const o2payments = (await api(ownerToken, 'GET', `/orders/${order2.id}`)).data.payments;
  check('P-02', 'Three simultaneous payment requests for one bill record exactly one payment', both.filter((r) => r.status === 200).length === 1 && both.filter((r) => r.status === 422).length === 2 && o2payments.length === 1, both.map((r) => r.status).join(','));

  // A stale list: the row is on screen, the bill stopped being eligible, Settle is clicked before the next poll
  const order3 = (await api(cashierToken, 'POST', '/orders', { order_type: 'takeaway', items: [{ menu_item_id: menu.Naan.id, quantity: 1 }] })).data;
  const o3item = (await api(ownerToken, 'GET', '/orders/board')).data.orders.find((o) => o.id === order3.id).items[0].id;
  await api(cashierToken, 'PATCH', `/ticket-items/${o3item}/status`, { status: 'served' });
  await goto('#/tracking');
  await goto('#/pos?mode=pending_bills');
  await page.locator(`[data-settle-order="${order3.order_number}"]`).waitFor({ timeout: 15000 });
  await api(cashierToken, 'POST', `/orders/${order3.id}/items`, { menu_item_id: menu.Idli.id });
  await page.locator(`[data-settle-order="${order3.order_number}"]`).click();
  await page.getByTestId('bill-blocked').waitFor({ timeout: 15000 });
  const blockText = norm(await page.getByTestId('bill-blocked').innerText());
  check('P-03', 'Settling from a stale list is refused when the bill opens; the dialog does not appear', blockText.includes(BLOCKED) && /Idli.*Pending/.test(blockText) && (await dialog.count()) === 0, blockText);
  await shot('12-stale-list-refused-on-open');

  // ------------------------------------------------------------------ Receipts, Orders and closing agree
  await page.locator('nav[aria-label="Main navigation"]').getByRole('link', { name: 'Receipts', exact: true }).click();
  await page.getByRole('heading', { name: 'Receipts' }).waitFor({ timeout: 15000 });
  await page.getByText(orderNumber).first().waitFor({ timeout: 15000 });
  await page.locator('tr', { hasText: orderNumber }).getByRole('button', { name: 'Preview' }).click();
  await page.getByTestId('receipt-preview-paper').waitFor({ timeout: 15000 });
  const receiptText = norm(await page.getByTestId('receipt-preview-paper').innerText());
  check('L-01', 'Receipts: the receipt lists all 6 dishes and the full total, and is not marked unpaid', [...dishes, 'Upma'].every((d) => receiptText.includes(d)) && /630\.00/.test(receiptText) && !/UNPAID/.test(receiptText), receiptText.slice(0, 200));
  await shot('13-receipt-preview-full-bill');
  await page.keyboard.press('Escape');
  await page.getByTestId('receipt-preview').getByRole('button', { name: /Close/ }).click().catch(() => {});

  const today = (await api(ownerToken, 'GET', '/settings')).data ? new Date().toLocaleDateString('en-CA') : '';
  const summary = (await api(ownerToken, 'GET', `/settlements/daily-summary?date=${today}`)).data;
  const closing = (await api(ownerToken, 'POST', '/settlements/close-day', { date: today })).data;
  const gross = closing.settlements.reduce((s, r) => s + Number(r.stall_gross_sales), 0);
  const count = closing.settlements.reduce((s, r) => s + Number(r.stall_item_count), 0);
  check('L-02', 'Daily closing counts each payment once: 2 paid bills, ₹735 cash (₹700 + GST), stall payables add up to the 7 dishes sold; the unfinished order is not revenue', summary.summary.total_orders === 2 && summary.summary.net_sales === '735.00' && summary.summary.cash_collected === '735.00' && Number(closing.total_net_sales) === 735 && gross === 700 && count === 7, `orders ${summary.summary.total_orders}, net ${summary.summary.net_sales}, cash ${summary.summary.cash_collected}, stall gross ${gross}, items ${count}`);
  await page.locator('nav[aria-label="Main navigation"]').getByRole('link', { name: 'End-of-Day Closing & Stall Settlements' }).click();
  await page.getByRole('heading', { name: /End-of-Day Closing & Stall Settlements/ }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  await shot('14-end-of-day-closing');

  const dash = (await api(ownerToken, 'GET', '/reports/dashboard')).data;
  const pendingNow = (await api(cashierToken, 'GET', '/billing/pending'));
  check('L-03', 'Dashboard, Pending Bills and the awaiting count agree: 0 billable, 1 still in the kitchen', dash.pending_bills.count === pendingNow.data.length && pendingNow.data.length === 0 && pendingNow.awaiting_fulfilment_count === 1, `dashboard ${dash.pending_bills.count}, list ${pendingNow.data.length}, awaiting ${pendingNow.awaiting_fulfilment_count}`);

  // ------------------------------------------------------------------ persisted: a real restart on the same database
  await app.close();
  await launch();
  await page.getByRole('link', { name: 'Receipts', exact: true }).waitFor({ timeout: 90000 });
  API = (await page.evaluate(() => window.desktop.getConfig())).apiBaseUrl.replace(/\/$/, '');
  await page.getByRole('link', { name: 'Receipts', exact: true }).click();
  await page.getByText(orderNumber).first().waitFor({ timeout: 20000 });
  const tokenAfter = await page.evaluate(() => localStorage.getItem('fc_auth_token'));
  const persisted = (await api(tokenAfter, 'GET', `/orders/${orderId}`)).data;
  const receiptAfter = await api(tokenAfter, 'GET', `/billing/receipt/${orderId}`);
  check('L-04', 'After restarting the app the payment, receipt and order are intact', persisted.payment_status === 'paid' && persisted.payments.length === 1 && receiptAfter.data.total_paid === '630.00' && receiptAfter.data.order.items.length === 6, `${persisted.payment_status}, ${persisted.payments.length} payment, receipt ${receiptAfter.data.total_paid}`);
  await goto('#/orders');
  await page.getByRole('heading', { name: 'Orders' }).first().waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: `Open ${orderNumber}` }).waitFor({ timeout: 15000 });
  await shot('15-orders-after-restart');
  check('L-05', 'Orders still lists the paid order after the restart', true);

  check('Z-01', 'No uncaught errors in the renderer', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (err) {
  check('ABORT', 'The script stopped early', false, `${err?.stack || err} cause=${err?.cause?.code || err?.cause || ''}`);
  await page?.screenshot({ path: join(shots, 'abort.png') }).catch(() => {});
} finally {
  await app?.close().catch(() => {});
  if (process.env.KEEP_PROFILE) console.log('profile kept: ' + profile);
  else rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}

const failed = results.filter((r) => r.result === 'FAIL');
writeFileSync(join(shots, 'results.json'), JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
