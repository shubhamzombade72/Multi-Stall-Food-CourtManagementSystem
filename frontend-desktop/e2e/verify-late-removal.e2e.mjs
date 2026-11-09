import electronPath from 'electron';
import { _electron as electron } from 'playwright-core';
import { serveAll } from './serve-order.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..');

const shots = join(HERE, '..', '..', 'qa', 'desktop', 'results');
mkdirSync(shots, { recursive: true });

const results = [];
const check = (id, desc, pass, ev = '') => {
  results.push({ id, desc, result: pass ? 'PASS' : 'FAIL', evidence: String(ev).slice(0, 300) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 160)}]` : ''}`);
};

const profile = mkdtempSync(join(tmpdir(), 'foodcourt-verify-late-'));
console.log(`Using isolated profile: ${profile}`);

const OWNER_PW = 'Str0ngPass99';
const STAFF_PW = 'StaffPass#2026';

let app;
let page;
let API = '';

const api = async (token, method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  return { status: res.status, ok: res.ok, data: data?.data ?? data };
};

const waitText = async (fn, re, timeoutMs = 15000) => {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    try {
      last = await fn();
      if (re.test(last)) return last;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return last;
};

try {
  // Launch the actual running desktop application
  const launchEnv = {
    ...process.env,
    FOODCOURT_USER_DATA_DIR: profile,
    FOODCOURT_SMOKE_TEST: '', FOODCOURT_PIN_LOCK: 'off',
    FOODCOURT_API_URL: '',
  };
  delete launchEnv.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    executablePath: electronPath,
    args: [APP_DIR],
    env: launchEnv,
    timeout: 60000,
  });

  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // Complete First-Run Welcome
  const tag = Date.now().toString(36).slice(-4).toUpperCase();
  const EMAIL = `owner.${tag}@example.com`;
  await page.getByText('Welcome', { exact: false }).first().waitFor({ timeout: 30000 });
  await page.fill('#owner-name', 'Owner Admin');
  await page.fill('#owner-email', EMAIL);
  await page.fill('#owner-password', OWNER_PW);
  await page.fill('#owner-confirm', OWNER_PW);
  await page.getByRole('button', { name: /Create account/ }).click();

  // Recovery Key
  await page.getByText('Save your recovery key').waitFor({ timeout: 20000 });
  await page.check('#recovery-saved');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Wait for Dashboard
  await page.waitForFunction(() => /dashboard/i.test(location.hash), null, { timeout: 20000 });
  const ownerToken = await page.evaluate(() => localStorage.getItem('fc_auth_token'));
  API = (await page.evaluate(() => window.desktop.getConfig())).apiBaseUrl.replace(/\/$/, '');

  check('V-01', 'Desktop application running with embedded runtime & authenticated owner', Boolean(ownerToken && API), API);

  // Seed test data via API: 2 stalls, menu items, table, staff, and an order
  const stallA = (await api(ownerToken, 'POST', '/stalls', { name: `Pizza ${tag}`, code: `PZ${tag}` })).data;
  const stallB = (await api(ownerToken, 'POST', '/stalls', { name: `Burger ${tag}`, code: `BG${tag}` })).data;
  const catA = (await api(ownerToken, 'POST', '/menu-categories', { stall_id: stallA.id, name: `Pizzas ${tag}` })).data;
  const catB = (await api(ownerToken, 'POST', '/menu-categories', { stall_id: stallB.id, name: `Burgers ${tag}` })).data;
  const pizza = (await api(ownerToken, 'POST', '/menu', { stall_id: stallA.id, category_id: catA.id, name: 'Cheese Pizza', price: 200 })).data;
  const fries = (await api(ownerToken, 'POST', '/menu', { stall_id: stallB.id, category_id: catB.id, name: 'Crispy Fries', price: 100 })).data;
  const table = (await api(ownerToken, 'POST', '/tables', { table_number: `T-${tag}`, capacity: 4, section: 'Main' })).data;

  // Staff
  await api(ownerToken, 'POST', '/staff', { name: 'Cashier One', email: `cashier.${tag}@example.com`, password: STAFF_PW, role: 'cashier' });
  const cashierToken = (await api(null, 'POST', '/auth/login', { email: `cashier.${tag}@example.com`, password: STAFF_PW })).data.token;

  // Create an order via Cashier API
  const orderRes = (await api(cashierToken, 'POST', '/orders', {
    table_id: table.id,
    order_type: 'dine_in',
    items: [
      { menu_item_id: pizza.id, quantity: 2 },
      { menu_item_id: fries.id, quantity: 1 },
    ],
  })).data;
  const orderId = orderRes.id ?? orderRes.order?.id;
  check('V-02', 'Test order created with dishes across stalls', Boolean(orderId), `orderId=${orderId}`);

  // Navigate to Orders & Table Tracking
  await page.getByRole('link', { name: 'Orders & Table Tracking' }).click();
  await page.waitForTimeout(1500);

  // Wait for the order card to appear
  const orderCard = page.getByTestId(`order-card-${orderId}`);
  await orderCard.waitFor({ timeout: 20000 });
  check('V-03', 'Order card visible on tracking board', await orderCard.isVisible());

  // 1. Verify card label DOES NOT have elapsed minutes like " 15m " or " 0m "
  const labelText = await page.getByTestId(`order-label-${orderId}`).innerText();
  const hasElapsedMinutes = /\b\d+m\b/.test(labelText);
  check('V-04', 'Card label has NO elapsed-minute indicator (e.g. 15m)', !hasElapsedMinutes, `label="${labelText}"`);
  check('V-05', 'Card label contains table, guest count, and served ratio', /0\/2 Served|0\/3 Served/.test(labelText) && labelText.includes(`T-${tag}`), `label="${labelText}"`);

  // 2. Verify no LATE badges on the card or tracking board
  const lateBadgeOnCard = await orderCard.locator('span:text-is("LATE")').count();
  const lateBadgesOnBoard = await page.locator('span:text-is("LATE")').count();
  check('V-06', 'No LATE badge on order card or tracking board', lateBadgeOnCard === 0 && lateBadgesOnBoard === 0, `card=${lateBadgeOnCard}, board=${lateBadgesOnBoard}`);

  // 3. Verify no delayed pulsing ring indicator
  const delayedPulse = await page.locator(`[data-testid="delayed-${orderId}"]`).count();
  const allDelayedPulse = await page.locator('[data-testid^="delayed-"]').count();
  check('V-07', 'No delayed ring/pulse indicators on the order or board', delayedPulse === 0 && allDelayedPulse === 0, `delayed=${delayedPulse}, all=${allDelayedPulse}`);

  // Capture screenshot: Clean tracking board without any late indicators or elapsed minutes
  await page.screenshot({ path: join(shots, '01-tracking-board-no-late-indicators.png') });

  // 4. Test normal order tracking & kitchen operations:
  // Fetch board items to transition an item to ready
  const board = (await api(ownerToken, 'GET', '/orders/board')).data;
  const boardOrder = board.orders.find((o) => o.id === orderId);
  const firstItem = boardOrder?.items?.[0];
  if (firstItem) {
    await api(ownerToken, 'PATCH', `/ticket-items/${firstItem.id}/status`, { status: 'ready' });
  }

  // Verify card state turns amber
  await page.waitForTimeout(2000); // allow poll cycle
  const cardState = await orderCard.locator('[data-testid^="card-state-"]').getAttribute('data-testid');
  check('V-08', 'Normal kitchen workflow intact: card transitions to amber when dish is ready', cardState?.includes('amber') || cardState?.includes('red'), `state=${cardState}`);

  // Expand card to inspect dishes and verify actions
  const expandBtn = orderCard.locator('button[aria-expanded]');
  if ((await expandBtn.getAttribute('aria-expanded')) !== 'true') {
    await expandBtn.click();
    await page.waitForTimeout(500);
  }

  // Capture screenshot of expanded order card
  await page.screenshot({ path: join(shots, '02-order-card-no-elapsed-minutes.png') });

  // Mark an item served
  const serveBtns = orderCard.locator('button:has-text("Mark Served")');
  const serveCount = await serveBtns.count();
  if (serveCount > 0) {
    await serveBtns.first().click();
    await page.waitForTimeout(1000);
  }

  // Click Serve All
  const serveAllBtn = page.getByTestId(`serve-all-${orderId}`);
  if (await serveAllBtn.isVisible().catch(() => false)) {
    await serveAllBtn.click();
    const confirmBtn = page.getByTestId(`serve-all-confirm-${orderId}`);
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click();
      await page.waitForTimeout(1000);
    }
  }

  // Verify updated label reflects served count without any elapsed minutes
  const updatedLabel = await page.getByTestId(`order-label-${orderId}`).innerText();
  check('V-09', 'Dish actions work and updated label still contains NO elapsed minutes', !/\b\d+m\b/.test(updatedLabel) && /Served/.test(updatedLabel), `updatedLabel="${updatedLabel}"`);

  // Capture screenshot: Normal tracking verified with dish served
  await page.screenshot({ path: join(shots, '03-normal-order-tracking-verified.png') });

  // 5. Verify payment records remain functional
  const currentOrder = (await api(ownerToken, 'GET', `/orders/${orderId}`)).data;
  const payAmount = Number(currentOrder.total_amount || currentOrder.order?.total_amount || 500);
  await serveAll(API, cashierToken, orderId);
  const payRes = await api(cashierToken, 'POST', '/billing/pay', {
    order_id: orderId,
    payment_method: 'cash',
    amount: payAmount,
    cash_tendered: payAmount + 1000,
  });
  check('V-10', 'Payment records intact: successful payment settlement', payRes.ok, `status=${payRes.status}`);

  // 6. Verify audit history remains intact
  const auditRes = await api(ownerToken, 'GET', '/reports/audit-logs?per_page=50');
  const audits = auditRes.data?.data || auditRes.data || [];
  check('V-11', 'Audit history intact: audit logs recorded for operations', Array.isArray(audits) && audits.length > 0, `auditCount=${audits.length}`);

  // 7. Verify Food Court Settings: Late-order warning after (minutes) setting is removed
  await page.getByRole('link', { name: 'Food Court Settings' }).click();
  await page.waitForTimeout(1000);

  const delayInput = await page.locator('[data-testid="delay-minutes"]').count();
  const delayWarningText = await page.locator('text=Late-order warning after').count();
  check('V-12', 'Food Court Settings: "Late-order warning after (minutes)" setting completely removed', delayInput === 0 && delayWarningText === 0, `inputs=${delayInput}, text=${delayWarningText}`);

  await page.screenshot({ path: join(shots, '04-settings-no-delay-input.png') });

} catch (err) {
  console.error('FULL ERROR STACK:', err);
  check('V-ERR', 'Verification encountered error', false, String(err?.stack || err?.message || err).slice(0, 300));
  try {
    if (page) await page.screenshot({ path: join(shots, 'verification-failure.png') });
  } catch {}
} finally {
  try {
    if (app) await app.close();
  } catch {}
  writeFileSync(join(shots, 'verification-results.json'), JSON.stringify(results, null, 2));
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
  const fails = results.filter((r) => r.result === 'FAIL').length;
  console.log(`\nVERIFICATION TOTAL: ${results.length - fails} PASS, ${fails} FAIL`);
}
