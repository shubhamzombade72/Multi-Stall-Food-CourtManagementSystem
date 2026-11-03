/**
 * Orders & Table Tracking board, driven through the real Electron runtime with its built-in server on a brand-new
 * profile (same pattern as ui-first-run.e2e.mjs).
 *
 *   cd frontend-desktop && pnpm prepare:server && pnpm build
 *   node e2e/order-tracking.e2e.mjs
 *
 * Scenario 1: one dine-in order, 4 items from 2 stalls -> red 0/4 -> kitchen of stall A marks its ticket ready (KDS
 *             API) -> amber -> the owner marks the 2 ready items served on the board -> 2/4 -> Serve All (confirm)
 *             -> 4/4 green. Backend checked through the API: KDS tickets show every item served; audit rows exact.
 * Scenario 3: the item PATCH is aborted (page.route) -> the card shows the server state again with an error
 *             message; retry -> served, and exactly one "served" audit row exists for that item.
 * Scenario 4: the owner changes the late-order warning (D10) on Food Court Settings; the board feed uses it.
 *
 * The owner is created on the Welcome screen and stays signed in in the window (its token is reused for owner API
 * calls; logging the owner in again through the API would revoke the window's session). Cashier and kitchen steps
 * use separate accounts created by the owner. Test data only.
 */
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..');
const results = [];
const check = (id, desc, pass, ev = '') => {
  results.push({ id, desc, result: pass ? 'PASS' : 'FAIL', evidence: String(ev).slice(0, 300) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 160)}]` : ''}`);
};

const profile = mkdtempSync(join(tmpdir(), 'foodcourt-track-'));
const shots = join(HERE, '..', '..', 'qa', 'desktop', 'results');
mkdirSync(shots, { recursive: true });
const OWNER_PW = 'Str0ngPass99';
const STAFF_PW = 'StaffPass#2026';

let app;
let page;
let API = '';
const pageErrors = [];

const api = async (token, method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
};

const card = (orderId) => page.getByTestId(`order-card-${orderId}`);
const cardStateOf = async (orderId) => {
  const id = await card(orderId).locator('[data-testid^="card-state-"]').getAttribute('data-testid');
  return id ? id.replace('card-state-', '') : null;
};
const waitCardState = async (orderId, state, timeout = 15000) => {
  const end = Date.now() + timeout;
  let last = null;
  while (Date.now() < end) {
    last = await cardStateOf(orderId).catch(() => null);
    if (last === state) return last;
    await page.waitForTimeout(200);
  }
  return last;
};
const labelOf = (orderId) => page.getByTestId(`order-label-${orderId}`).innerText();
const progressOf = async (orderId) => {
  const p = page.getByTestId(`progress-${orderId}`);
  return `${await p.getAttribute('aria-valuenow')}/${await p.getAttribute('aria-valuemax')}`;
};
const statusOf = (itemId) => page.getByTestId(`item-status-${itemId}`).innerText();
const waitText = async (fn, re, timeout = 15000) => {
  const end = Date.now() + timeout;
  let last = '';
  while (Date.now() < end) {
    last = await fn().catch(() => '');
    if (re.test(last)) return last;
    await page.waitForTimeout(150);
  }
  return last;
};
const expand = async (orderId) => {
  const btn = card(orderId).locator('button[aria-expanded]');
  if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
};
const auditRows = async (ownerToken, actions) => {
  const res = await api(ownerToken, 'GET', `/reports/audit-logs?action=${actions}&per_page=200`);
  return res.data.data.map((r) => ({
    ...r,
    new_values: typeof r.new_values === 'string' ? JSON.parse(r.new_values) : r.new_values,
    old_values: typeof r.old_values === 'string' ? JSON.parse(r.old_values) : r.old_values,
  }));
};

try {
  // ------------------------------------------------------------------ fresh profile, owner via Welcome
  app = await electron.launch({
    args: [APP_DIR],
    env: { ...process.env, FOODCOURT_USER_DATA_DIR: profile, FOODCOURT_SMOKE_TEST: '', FOODCOURT_API_URL: '' },
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(m.text());
  });
  await page.getByText('Welcome', { exact: false }).first().waitFor({ timeout: 90000 });
  await page.fill('#owner-name', 'Tracking Owner');
  await page.fill('#owner-email', 'tracking.owner@example.com');
  await page.fill('#owner-password', OWNER_PW);
  await page.fill('#owner-confirm', OWNER_PW);
  await page.getByRole('button', { name: /Create account/ }).click();
  await page.getByText('Save your recovery key').waitFor({ timeout: 20000 });
  await page.check('#recovery-saved');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => /dashboard/i.test(location.hash), null, { timeout: 20000 });
  const ownerToken = await page.evaluate(() => localStorage.getItem('fc_auth_token'));
  API = (await page.evaluate(() => window.desktop.getConfig())).apiBaseUrl.replace(/\/$/, '');
  check('T-00', 'Fresh profile: built-in server started and owner created on the Welcome screen', Boolean(ownerToken) && /^http:\/\/127\.0\.0\.1:\d+\/api$/.test(API), API);

  // ------------------------------------------------------------------ test data (owner API)
  const tag = Date.now().toString(36).slice(-4).toUpperCase();
  const stallA = (await api(ownerToken, 'POST', '/stalls', { name: `Pizza ${tag}`, code: `PZ${tag}` })).data;
  const stallB = (await api(ownerToken, 'POST', '/stalls', { name: `Burger ${tag}`, code: `BG${tag}` })).data;
  const menu = {};
  for (const [stall, names] of [[stallA, ['Margherita', 'Garlic Bread']], [stallB, ['Veg Burger', 'Fries']]]) {
    const cat = (await api(ownerToken, 'POST', '/menu-categories', { stall_id: stall.id, name: `Mains ${stall.code}` })).data;
    for (const name of names) menu[name] = (await api(ownerToken, 'POST', '/menu', { stall_id: stall.id, category_id: cat.id, name, price: 100 })).data;
  }
  const table = (await api(ownerToken, 'POST', '/tables', { table_number: `T-${tag}`, capacity: 4, section: 'Main' })).data;
  await api(ownerToken, 'POST', '/staff', { name: 'Track Cashier', email: `cashier.${tag}@example.com`, password: STAFF_PW, role: 'cashier' });
  await api(ownerToken, 'POST', '/staff', { name: 'Pizza Kitchen', email: `kitchen.${tag}@example.com`, password: STAFF_PW, role: 'kitchen_staff', stall_id: stallA.id });
  const cashierToken = (await api(null, 'POST', '/auth/login', { email: `cashier.${tag}@example.com`, password: STAFF_PW })).data.token;
  const kitchenToken = (await api(null, 'POST', '/auth/login', { email: `kitchen.${tag}@example.com`, password: STAFF_PW })).data.token;
  check('T-01', 'Owner created 2 stalls, 4 menu items, a table, a cashier and stall-A kitchen staff', Boolean(cashierToken && kitchenToken && table.id));

  const placeOrder = async (names) => {
    const res = await api(cashierToken, 'POST', '/orders', {
      table_id: table.id,
      order_type: 'dine_in',
      items: names.map((n) => ({ menu_item_id: menu[n].id, quantity: 1 })),
    });
    return res.data.id ?? res.data.order?.id;
  };
  const boardOrder = async (orderId) => (await api(cashierToken, 'GET', '/orders/board')).data.orders.find((o) => o.id === orderId);
  const kdsTicketFor = async (orderId) => (await api(kitchenToken, 'GET', '/kitchen/tickets')).data.find((t) => t.order_id === orderId);

  // ================================================================== Scenario 1
  const order1 = await placeOrder(['Margherita', 'Garlic Bread', 'Veg Burger', 'Fries']);
  const b1 = await boardOrder(order1);
  const itemsA = b1.items.filter((i) => i.stall.id === stallA.id).map((i) => i.id);
  const itemsB = b1.items.filter((i) => i.stall.id === stallB.id).map((i) => i.id);
  check('S1-01', 'Order with 4 items from 2 stalls is on the board feed', b1.items.length === 4 && itemsA.length === 2 && itemsB.length === 2, `items A=${itemsA} B=${itemsB}`);

  await page.getByRole('link', { name: 'Orders & Table Tracking' }).click();
  await card(order1).waitFor({ timeout: 20000 });
  const red = await waitCardState(order1, 'red');
  const redLabel = await labelOf(order1);
  check('S1-02', 'New order shows a red card with 0/4 Served', red === 'red' && /0\/4 Served/.test(redLabel) && (await progressOf(order1)) === '0/4', `${red} | ${redLabel}`);
  await page.screenshot({ path: join(shots, 'tracking-red.png') });

  const ticketA = await kdsTicketFor(order1);
  await api(kitchenToken, 'PUT', `/kitchen/tickets/${ticketA.id}/status`, { status: 'ready' });
  const amber = await waitCardState(order1, 'amber', 15000); // next 5 s poll
  check('S1-03', 'Kitchen marks stall A ready (KDS) -> the card turns amber by itself (poll)', amber === 'amber', amber);
  await expand(order1);
  const readyChips = await Promise.all(itemsA.map((id) => statusOf(id)));
  const cookingChips = await Promise.all(itemsB.map((id) => statusOf(id)));
  check('S1-04', 'Stall A items show Ready, stall B items show Cooking', readyChips.every((t) => /Ready/.test(t)) && cookingChips.every((t) => /Cooking/.test(t)), `${readyChips} | ${cookingChips}`);
  await page.screenshot({ path: join(shots, 'tracking-amber.png') });

  for (const id of itemsA) {
    await page.getByTestId(`item-action-${id}`).click();
    await waitText(() => statusOf(id), /Served/);
  }
  const partialLabel = await waitText(() => labelOf(order1), /2\/4 Served/);
  const partialState = await cardStateOf(order1);
  check('S1-05', 'Owner marks the 2 ready items served -> 2/4 Served, card red again (rest still cooking)', /2\/4 Served/.test(partialLabel) && (await progressOf(order1)) === '2/4' && partialState === 'red', `${partialState} | ${partialLabel}`);
  await page.screenshot({ path: join(shots, 'tracking-partial.png') });

  await page.getByTestId(`serve-all-${order1}`).click();
  const confirmShown = await page.getByText('Serve 2 items?').isVisible();
  await page.getByTestId(`serve-all-confirm-${order1}`).click();
  const green = await waitCardState(order1, 'green');
  const greenLabel = await waitText(() => labelOf(order1), /4\/4 Served/);
  check('S1-06', 'Serve All asks "Serve 2 items?", then the card is green with 4/4 Served', confirmShown && green === 'green' && /4\/4 Served/.test(greenLabel) && (await progressOf(order1)) === '4/4', `${green} | ${greenLabel}`);
  await page.screenshot({ path: join(shots, 'tracking-green.png') });

  // Backend state through the API
  // Served tickets leave the active KDS list; the KDS status filter shows them as picked up
  const stillActive = (await api(ownerToken, 'GET', '/kitchen/tickets')).data.filter((t) => t.order_id === order1).length;
  const ownerTickets = (await api(ownerToken, 'GET', '/kitchen/tickets?status=picked_up')).data.filter((t) => t.order_id === order1);
  const kdsItems = ownerTickets.flatMap((t) => (t.ticket_items || t.ticketItems || []).map((i) => i.status));
  const after = await boardOrder(order1);
  check('S1-07', 'KDS API: order left the active KDS list; both tickets picked up and all 4 ticket items served', stillActive === 0 && ownerTickets.length === 2 && ownerTickets.every((t) => t.status === 'picked_up') && kdsItems.length === 4 && kdsItems.every((s) => s === 'served'), `active=${stillActive} tickets=${ownerTickets.map((t) => t.status)} items=${kdsItems}`);
  check('S1-08', 'Board API: all 4 items served', after && after.items.every((i) => i.status === 'served'), after ? after.items.map((i) => i.status).join(',') : 'missing');

  const audits = await auditRows(ownerToken, 'ticket_item_status,order_serve_remaining');
  const allIds = [...itemsA, ...itemsB];
  const itemAudits = audits.filter((r) => r.action === 'ticket_item_status' && allIds.includes(Number(r.entity_id)));
  const sig = (r) => `${r.entity_id}:${r.old_values?.status}>${r.new_values?.status}:${r.new_values?.via}`;
  const expected = [
    ...itemsA.map((id) => `${id}:pending>ready:kds`),
    ...itemsA.map((id) => `${id}:ready>served:item`),
    ...itemsB.map((id) => `${id}:pending>served:serve_remaining`),
  ].sort();
  const got = itemAudits.map(sig).sort();
  check('S1-09', 'Audit: exactly one ticket_item_status row per item change (2 ready via KDS, 2 served on board, 2 by Serve All)', JSON.stringify(got) === JSON.stringify(expected), got.join(' '));
  const serveAudits = audits.filter((r) => r.action === 'order_serve_remaining' && Number(r.entity_id) === order1);
  check('S1-10', 'Audit: exactly one order_serve_remaining row, listing the 2 stall-B items', serveAudits.length === 1 && JSON.stringify([...serveAudits[0].new_values.served_item_ids].sort()) === JSON.stringify([...itemsB].sort()), JSON.stringify(serveAudits.map((r) => r.new_values)));

  // ================================================================== Scenario 3
  const order3 = await placeOrder(['Margherita']);
  const ticket3 = await kdsTicketFor(order3);
  await api(kitchenToken, 'PUT', `/kitchen/tickets/${ticket3.id}/status`, { status: 'ready' });
  const item3 = (await boardOrder(order3)).items[0].id;
  await card(order3).waitFor({ timeout: 20000 });
  await waitCardState(order3, 'amber', 15000);
  await expand(order3);
  await waitText(() => statusOf(item3), /Ready/);

  let aborted = 0;
  const pattern = `**/ticket-items/${item3}/status`;
  await page.route(pattern, (route) => {
    aborted += 1;
    return route.abort('failed');
  });
  await page.getByTestId(`item-action-${item3}`).click();
  const alertText = await waitText(() => page.getByRole('alert').first().innerText(), /Could not update|latest/i, 15000);
  const chipAfterFail = await waitText(() => statusOf(item3), /Ready/);
  const stateAfterFail = await cardStateOf(order3);
  const server3 = (await boardOrder(order3)).items[0];
  check('S3-01', 'Aborted PATCH: the card shows the server state again (Ready, amber, 0/1) with an error message', aborted >= 1 && /Ready/.test(chipAfterFail) && stateAfterFail === 'amber' && /0\/1 Served/.test(await labelOf(order3)) && server3.status === 'ready' && /Could not update|latest/i.test(alertText), `aborted=${aborted} chip=${chipAfterFail} state=${stateAfterFail} server=${server3.status} alert="${alertText}"`);
  await page.screenshot({ path: join(shots, 'tracking-abort-error.png') });

  await page.unroute(pattern);
  await page.getByTestId(`item-action-${item3}`).click();
  const chipRetry = await waitText(() => statusOf(item3), /Served/);
  const greenRetry = await waitCardState(order3, 'green');
  check('S3-02', 'Retry succeeds: Served, card green, error cleared', /Served/.test(chipRetry) && greenRetry === 'green' && (await page.getByRole('alert').count()) === 0, `${chipRetry} | ${greenRetry}`);
  const a3 = (await auditRows(ownerToken, 'ticket_item_status')).filter((r) => Number(r.entity_id) === item3);
  const served3 = a3.filter((r) => r.new_values?.status === 'served');
  const server3b = (await boardOrder(order3)).items[0];
  check('S3-03', 'Exactly one "served" audit row for the item (the aborted attempt left none); server says served', served3.length === 1 && a3.length === 2 && server3b.status === 'served', a3.map(sig).join(' '));

  // ------------------------------------------------------------------ Scenario 4: owner edits the late-order warning (D10)
  await page.getByRole('link', { name: 'Food Court Settings' }).click();
  const delayInput = page.getByTestId('delay-minutes');
  await delayInput.waitFor({ timeout: 15000 });
  const delayBefore = await delayInput.inputValue();
  await delayInput.fill('121');
  const saveDelay = page.getByRole('button', { name: 'Save order tracking' });
  const disabledOutOfRange = await saveDelay.isDisabled();
  await delayInput.fill('25');
  await saveDelay.click();
  const savedMsg = await waitText(() => page.getByRole('status').filter({ hasText: 'Order tracking saved' }).first().innerText(), /Order tracking saved/);
  const delayAfter = (await api(ownerToken, 'GET', '/settings')).data.order_tracking?.delay_minutes;
  const boardDelay = (await api(cashierToken, 'GET', '/orders/board')).data.delay_minutes;
  check('S4-01', 'Owner sets "Late-order warning after (minutes)" 15 -> 25 on Food Court Settings; 121 cannot be saved; board uses 25', delayBefore === '15' && disabledOutOfRange && /Order tracking saved/.test(savedMsg) && delayAfter === 25 && boardDelay === 25, `before=${delayBefore} disabled@121=${disabledOutOfRange} msg="${savedMsg}" setting=${delayAfter} board=${boardDelay}`);
} catch (err) {
  check('T-ERR', 'Journey completed without an unexpected error', false, String(err?.message || err).split('\n')[0]);
  try {
    if (page) await page.screenshot({ path: join(shots, 'tracking-failure.png') });
    if (page) console.log(`url=${page.url()} windows=${app.windows().length} body=${(await page.evaluate(() => document.body.innerText)).slice(0, 300).replace(/\s+/g, ' ')}`);
  } catch {}
  if (pageErrors.length) console.log(`Renderer errors:\n${pageErrors.slice(-10).join('\n')}`);
} finally {
  try {
    if (app) await app.close();
  } catch {}
  writeFileSync(join(shots, 'order-tracking-results.json'), JSON.stringify(results, null, 2));
  await new Promise((r) => setTimeout(r, 1500));
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
  const fails = results.filter((r) => r.result === 'FAIL').length;
  console.log(`\nTOTAL: ${results.length - fails} PASS, ${fails} FAIL`);
  process.exit(fails ? 1 : 0);
}
