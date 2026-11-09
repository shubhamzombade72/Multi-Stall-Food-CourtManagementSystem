/**
 * The central raw material store, driven through the real Electron runtime with its built-in server and a real SQLite database
 * on a brand-new throw-away profile (test data only; nothing here reaches a real install).
 *
 *   cd frontend-desktop && pnpm build && pnpm prepare:server
 *   node e2e/central-store.e2e.mjs
 *
 * CENTRAL_STORE_SHOTS=<folder> writes screenshots and results somewhere other than the tracked qa/desktop/results folder.
 * FOODCOURT_SERVER_DIR=<folder> uses a server built elsewhere (FOODCOURT_SERVER_STAGE=<folder> node scripts/prepare-embedded-server.mjs).
 */
import electronPath from 'electron';
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..');
const shots = process.env.CENTRAL_STORE_SHOTS || join(HERE, '..', '..', 'qa', 'desktop', 'results', 'central-store');
mkdirSync(shots, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'foodcourt-store-'));
const OWNER = { email: 'store.owner@example.com', password: 'Str0ngPass99' };
const STORE = { email: 'store.keeper@example.com', password: 'StaffPass#2026' };
const MANAGER = { email: 'store.manager@example.com', password: 'StaffPass#2026' };
const CASHIER = { email: 'store.cashier@example.com', password: 'StaffPass#2026' };

const results = [];
const check = (id, desc, pass, ev = '') => {
  results.push({ id, desc, result: pass ? 'PASS' : 'FAIL', evidence: String(ev).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 180)}]` : ''}`);
};

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
  if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
};

const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`) });
const goto = async (hash) => {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(400);
};
const signOut = async () => {
  await page.click('[title^="Sign Out"]');
  await page.locator('input[type=email]').waitFor({ timeout: 15000 });
};
const signIn = async ({ email, password }) => {
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await page.click('button[type=submit]');
  await page.locator('aside nav').waitFor({ timeout: 30000 });
  await page.waitForTimeout(400);
};
const sidebar = () => page.locator('aside nav').innerText();
const dialog = () => page.getByRole('dialog');
const closed = () => dialog().waitFor({ state: 'hidden', timeout: 15000 });
const save = (name = /^Save$/) => dialog().getByRole('button', { name }).click();
const row = (text) => page.locator('tbody tr', { hasText: text }).first();
const rowText = async (text) => (await row(text).innerText()).replace(/\s+/g, ' ');

const addMaterial = async (name, unit, alert, price, opening) => {
  await page.getByRole('button', { name: 'Add raw material' }).click();
  await dialog().getByLabel(/^Name/).fill(name);
  await dialog().getByLabel('Unit', { exact: true }).selectOption(unit);
  await dialog().getByLabel(/Alert when/).fill(alert);
  await dialog().getByLabel(/Price per unit/).fill(price);
  await dialog().getByLabel(/Opening stock/).fill(opening);
  await save();
  await closed();
};

try {
  const target = { executablePath: electronPath, args: [APP_DIR] };
  const env = { ...process.env, FOODCOURT_USER_DATA_DIR: profile, FOODCOURT_SMOKE_TEST: '', FOODCOURT_PIN_LOCK: 'off', FOODCOURT_API_URL: '' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ ...target, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w.isMaximized()) w.unmaximize();
    w.setContentSize(1440, 900);
  });

  await page.getByText('Welcome', { exact: false }).first().waitFor({ timeout: 90000 });
  await page.fill('#owner-name', 'Store Owner');
  await page.fill('#owner-email', OWNER.email);
  await page.fill('#owner-password', OWNER.password);
  await page.fill('#owner-confirm', OWNER.password);
  await page.getByRole('button', { name: /Create account/ }).click();
  await page.getByText('Save your recovery key').waitFor({ timeout: 20000 });
  await page.check('#recovery-saved');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('aside nav').waitFor({ timeout: 30000 });
  API = (await page.evaluate(() => window.desktop.getConfig())).apiBaseUrl.replace(/\/$/, '');
  check('R-01', 'Running in Electron with the built-in server and SQLite', /^http:\/\/127\.0\.0\.1:\d+\/api$/.test(API), API);
  await signOut();

  // ------------------------------------------------------------------ staff, stalls and old per-stall stock, through the API
  const ownerToken = (await api(null, 'POST', '/auth/login', OWNER)).data.token;
  const stallA = (await api(ownerToken, 'POST', '/stalls', { name: 'Pizza Stall', code: 'PIZZA' })).data;
  const stallB = (await api(ownerToken, 'POST', '/stalls', { name: 'Burger Stall', code: 'BURGER' })).data;
  const staff = (who, name, role, stall_id = null) => api(ownerToken, 'POST', '/staff', { name, email: who.email, password: who.password, role, stall_id });
  await staff(STORE, 'Store Keeper', 'store_staff');
  await staff(MANAGER, 'Pizza Manager', 'stall_manager', stallA.id);
  await staff(CASHIER, 'Till Cashier', 'cashier');
  await api(ownerToken, 'POST', '/inventory', { stall_id: stallA.id, name: 'Rice', unit: 'kg', current_stock: 4.5, minimum_alert_stock: 1, unit_cost: 80 });
  await api(ownerToken, 'POST', '/inventory', { stall_id: stallB.id, name: 'rice', unit: 'kg', current_stock: 1.5, minimum_alert_stock: 2, unit_cost: 85 });
  await api(ownerToken, 'POST', '/suppliers', { stall_id: stallA.id, name: 'Old Traders', phone: '9000000001' });

  // ------------------------------------------------------------------ owner: the one-time move
  await signIn(OWNER);
  const ownerNav = await sidebar();
  check('N-01', 'Owner sees Raw Materials and Purchases & Suppliers, and not Stock Received', /Raw Materials/.test(ownerNav) && /Purchases & Suppliers/.test(ownerNav) && !/Stock Received/.test(ownerNav));
  await page.locator('aside').getByRole('link', { name:'Raw Materials' }).click();
  await page.getByText(/Old per-stall records are waiting/).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Review and move' }).click();
  const preview = (await dialog().innerText()).replace(/\s+/g, ' ');
  check('M-01', 'The move preview shows Rice merged to 6 kg from both stalls, and warns about the different prices', /Rice 6 kg/.test(preview) && /Pizza Stall/.test(preview) && /Burger Stall/.test(preview) && /different prices/.test(preview), preview);
  await shot('01-move-preview');
  await save('Move now');
  await closed();
  await page.getByText(/Moved 2 old stock record/).waitFor({ timeout: 15000 });
  check('M-02', 'After the move Rice is one item with 6 kg, and the banner is gone', /6 kg/.test(await rowText('Rice')) && (await page.getByText(/Old per-stall records are waiting/).count()) === 0, await rowText('Rice'));

  // ------------------------------------------------------------------ owner: stock actions through the screen
  await addMaterial('Paneer', 'kg', '5', '100', '10');
  check('S-01', 'A new raw material appears with its opening stock', /10 kg/.test(await rowText('Paneer')), await rowText('Paneer'));
  await page.getByRole('button', { name: 'Issue Paneer to a stall' }).click();
  await dialog().getByLabel('Stall', { exact: true }).selectOption({ label: 'Pizza Stall' });
  await dialog().getByLabel(/^Quantity/).fill('99');
  await save();
  await dialog().getByRole('alert').waitFor({ timeout: 10000 });
  check('S-02', 'Issuing more than the store holds shows a clear error and changes nothing', /more than the 10 kg/.test(await dialog().getByRole('alert').innerText()), await dialog().getByRole('alert').innerText());
  await shot('02-issue-too-much');
  await dialog().getByLabel(/^Quantity/).fill('4');
  await save();
  await closed();
  await page.waitForTimeout(400);
  check('S-03', 'Issuing 4 kg leaves 6 kg in the store', /\b6 kg/.test(await rowText('Paneer')), await rowText('Paneer'));

  await page.getByRole('button', { name: 'Return Paneer from a stall' }).click();
  await dialog().getByLabel('Stall', { exact: true }).selectOption({ label: 'Pizza Stall' });
  await dialog().getByLabel(/^Quantity/).fill('1');
  await dialog().getByLabel(/^Reason/).fill('Extra');
  await save();
  await closed();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Record waste of Paneer' }).click();
  await dialog().getByLabel(/^Quantity/).fill('2');
  await dialog().getByLabel(/^Reason/).fill('Spoiled');
  await save();
  await closed();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Count Paneer' }).click();
  await dialog().getByLabel(/Counted quantity/).fill('4.5');
  await save();
  await closed();
  await page.waitForTimeout(600);
  const paneer = await rowText('Paneer');
  check('S-04', 'Return, waste and count bring the store to the counted 4.5 kg and mark it low', /4\.5 kg/.test(paneer) && /Low/.test(paneer), paneer);
  await shot('03-raw-materials');
  const history = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  check('S-05', 'The history lists every kind of change with the stall', /Issue To Stall/i.test(history) && /Return From Stall/i.test(history) && /Waste Loss/i.test(history) && /Stock Count/i.test(history) && /Opening Stock/i.test(history), history.slice(-300));

  // ------------------------------------------------------------------ owner: purchases
  await page.locator('aside').getByRole('link', { name:'Purchases & Suppliers' }).click();
  await page.getByRole('tab', { name: 'Suppliers' }).click();
  await page.getByText('Old Traders').waitFor({ timeout: 10000 });
  check('P-01', 'The old supplier was moved to the store list', true);
  await page.getByRole('button', { name: 'Add supplier' }).click();
  await dialog().getByLabel(/^Name/).fill('Fresh Dairy');
  await dialog().getByLabel(/^Phone/).fill('9000000002');
  await save();
  await closed();
  await page.getByRole('tab', { name: 'Purchase orders' }).click();
  await page.getByRole('button', { name: 'New purchase order' }).click();
  await dialog().getByLabel('Supplier', { exact: true }).locator('option', { hasText: 'Fresh Dairy' }).waitFor({ state: 'attached', timeout: 10000 });
  await dialog().getByLabel('Supplier', { exact: true }).selectOption({ label: 'Fresh Dairy' });
  await dialog().getByLabel('Raw material line 1').selectOption({ label: 'Paneer (kg)' });
  await dialog().getByLabel('Quantity line 1').fill('10');
  await dialog().getByLabel('Price line 1').fill('120');
  await shot('04-new-purchase');
  await save('Create order');
  await closed();
  await page.waitForTimeout(500);
  check('P-02', 'The new order is listed as ordered with its total', /ordered/i.test(await rowText('Fresh Dairy')) && /1,?200/.test(await rowText('Fresh Dairy')), await rowText('Fresh Dairy'));
  await page.locator('tbody tr', { hasText: 'Fresh Dairy' }).getByRole('button', { name: /^Receive/ }).click();
  await save('Receive all');
  await closed();
  await page.waitForTimeout(500);
  check('P-03', 'Receiving marks the order received and removes its Receive button', /received/i.test(await rowText('Fresh Dairy')) && (await page.locator('tbody tr', { hasText: 'Fresh Dairy' }).getByRole('button', { name: /^Receive/ }).count()) === 0, await rowText('Fresh Dairy'));
  await shot('05-purchases');
  await page.locator('aside').getByRole('link', { name:'Raw Materials' }).click();
  await page.waitForTimeout(600);
  const received = await rowText('Paneer');
  check('P-04', 'The store now has 14.5 kg at the new price of 120', /14\.5 kg/.test(received) && /120/.test(received), received);

  // ------------------------------------------------------------------ owner: reports and dashboard
  await page.locator('aside').getByRole('link', { name:'Reports & Audit' }).click();
  await page.getByRole('tab', { name: 'Issued to Stalls' }).click();
  await page.waitForTimeout(800);
  const issued = await rowText('Paneer');
  check('T-01', 'Issued to Stalls shows 4 issued, 1 returned, 3 net, worth 300', /Pizza Stall/.test(issued) && /\b4\b/.test(issued) && /\b1\b/.test(issued) && /\b3\b/.test(issued) && /300\.00/.test(issued), issued);
  await shot('06-report-issued');
  await page.getByRole('tab', { name: 'Store Stock' }).click();
  await page.waitForTimeout(600);
  check('T-02', 'Store Stock values Paneer at 14.5 x 120 = 1740', /1740\.00/.test(await rowText('Paneer')), await rowText('Paneer'));
  await page.getByRole('tab', { name: 'Count Differences' }).click();
  await page.waitForTimeout(600);
  check('T-03', 'Count Differences shows 5 in the app, 4.5 counted, -0.5 difference', /\b5\b/.test(await rowText('Paneer')) && /4\.5/.test(await rowText('Paneer')) && /-0\.5/.test(await rowText('Paneer')), await rowText('Paneer'));
  await page.getByRole('tab', { name: 'Store Purchases' }).click();
  await page.waitForTimeout(600);
  check('T-04', 'Store Purchases shows Fresh Dairy received 1200', /1200\.00/.test(await rowText('Fresh Dairy')), await rowText('Fresh Dairy'));
  await page.getByRole('tab', { name: 'Store Waste' }).click();
  await page.waitForTimeout(600);
  check('T-05', 'Store Waste shows the 2 kg of spoiled Paneer', /Spoiled/.test(await rowText('Paneer')) && /200\.00/.test(await rowText('Paneer')), await rowText('Paneer'));
  await addLowStockCheck();
  await signOut();

  // ------------------------------------------------------------------ the other roles
  await signIn(STORE);
  check('N-02', 'Store Staff land on Raw Materials', /#\/store$/.test(await page.evaluate(() => location.hash)), await page.evaluate(() => location.hash));
  const storeNav = await sidebar();
  check('N-03', 'Store Staff see the store but not reports, POS or staff', /Raw Materials/.test(storeNav) && /Purchases & Suppliers/.test(storeNav) && !/Reports/.test(storeNav) && !/Cashier POS/.test(storeNav) && !/Staff & Permissions/.test(storeNav), storeNav.replace(/\s+/g, ' '));
  await page.getByText('Paneer').first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Issue Paneer to a stall' }).click();
  await dialog().getByLabel('Stall', { exact: true }).selectOption({ label: 'Burger Stall' });
  await dialog().getByLabel(/^Quantity/).fill('1');
  await save();
  await closed();
  await page.waitForTimeout(400);
  check('N-04', 'Store Staff can issue stock, and the move banner is hidden from them', /13\.5 kg/.test(await rowText('Paneer')) && (await page.getByRole('button', { name: 'Review and move' }).count()) === 0, await rowText('Paneer'));
  await signOut();

  await signIn(MANAGER);
  const managerNav = await sidebar();
  check('N-05', 'A Stall Manager sees Stock Received only', /Stock Received/.test(managerNav) && !/Raw Materials/.test(managerNav) && !/Purchases & Suppliers/.test(managerNav), managerNav.replace(/\s+/g, ' '));
  await page.locator('aside').getByRole('link', { name:'Stock Received' }).click();
  await page.getByText('Paneer').first().waitFor({ timeout: 10000 });
  const received2 = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  check('N-06', "The manager sees their stall's issue and return, and not the other stall's or the waste", /Pizza Stall/.test(received2) && !/Burger Stall/.test(received2) && !/Waste/i.test(received2) && !/Stock after/i.test(received2), received2.slice(0, 300));
  check('N-09', 'From the stall\'s side, stock received reads +4 kg and stock returned reads -1 kg', /Received from store Paneer Pizza Stall \+4 kg/.test(received2) && /Returned to store Paneer Pizza Stall -1 kg/.test(received2), received2.slice(0, 300));
  await shot('07-stock-received');
  await goto('#/store');
  check('N-07', 'A Stall Manager typing the store address is sent away', !/#\/store$/.test(await page.evaluate(() => location.hash)), await page.evaluate(() => location.hash));
  await signOut();

  await signIn(CASHIER);
  const cashierNav = await sidebar();
  check('N-08', 'A cashier sees none of the store screens', !/Raw Materials/.test(cashierNav) && !/Stock Received/.test(cashierNav) && !/Purchases & Suppliers/.test(cashierNav));
  await signOut();

  // ------------------------------------------------------------------ the saved data agrees with the screens
  const token = (await api(null, 'POST', '/auth/login', OWNER)).data.token;
  const items = (await api(token, 'GET', '/store/items')).data;
  const saved = items.find((i) => i.name === 'Paneer');
  const movements = (await api(token, 'GET', `/store/movements?store_item_id=${saved.id}&per_page=200`)).data.data;
  const sum = movements.reduce((s, m) => s + Number(m.quantity), 0);
  check('D-01', 'The saved history adds up to the saved stock', Math.abs(sum - Number(saved.current_stock)) < 0.0001 && Number(saved.current_stock) === 13.5, `sum ${sum}, stock ${saved.current_stock}, ${movements.length} rows`);
  const old = (await api(token, 'GET', '/inventory')).data;
  check('D-02', 'The old stall rows are still there and unchanged', old.length === 2 && Number(old.find((o) => o.name === 'Rice').current_stock) === 4.5, JSON.stringify(old.map((o) => [o.name, o.current_stock])));

  check('Z-01', 'No uncaught page errors during the run', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (err) {
  check('FATAL', 'Run aborted', false, err?.stack || err);
  await page?.screenshot({ path: join(shots, 'fatal.png') }).catch(() => undefined);
} finally {
  await app?.close().catch(() => undefined);
  writeFileSync(join(shots, 'results.json'), JSON.stringify(results, null, 2));
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
  } catch {
    // the embedded server may still hold a file for a moment; it is a temp folder
  }
  const failed = results.filter((r) => r.result === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exitCode = failed.length ? 1 : 0;
}

async function addLowStockCheck() {
  // Paneer is no longer low after the purchase, so this adds an item that is
  await page.locator('aside').getByRole('link', { name:'Raw Materials' }).click();
  await page.waitForTimeout(500);
  await addMaterial('Saffron', 'g', '50', '300', '5');
  await page.locator('aside').getByRole('link', { name:'Dashboard' }).click();
  await page.getByText('Low Stock in Central Store').waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  const card = (await page.getByRole('heading', { name: 'Low Stock in Central Store' }).locator('xpath=../../..').innerText()).replace(/\s+/g, ' ');
  check('T-06', 'The dashboard low-stock card lists Saffron and today\'s store purchases', /Saffron/.test(card) && /5 \/ 50 g/.test(card) && /purchases today: 1/.test(card), card);
  await shot('08-dashboard');
}
