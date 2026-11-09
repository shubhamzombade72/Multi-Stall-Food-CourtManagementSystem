/**
 * Cashier POS category browsing, driven through the real Electron runtime with its built-in server and a real SQLite database
 * on a brand-new throw-away profile (test data only; nothing here reaches a real install).
 *
 *   cd frontend-desktop && pnpm build && pnpm prepare:server
 *   node e2e/pos-categories.e2e.mjs
 *   PACKAGED_ASAR=<win-unpacked>/resources/app.asar FOODCOURT_SERVER_DIR=<win-unpacked>/resources/server node e2e/pos-categories.e2e.mjs
 *
 * The critical scenario: browsing by category never decides where an order item goes. Two dishes in one category but different
 * stalls produce two kitchen tickets, and two dishes in different categories of one stall share one ticket.
 */
import electronPath from 'electron';
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..');
const shots = join(HERE, '..', '..', 'qa', 'desktop', 'results', 'pos-categories');
mkdirSync(shots, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'foodcourt-poscat-'));
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
const catalogRequests = [];

const launch = async () => {
  const target = process.env.PACKAGED_EXE
    ? { executablePath: process.env.PACKAGED_EXE, args: [] }
    : { executablePath: electronPath, args: [process.env.PACKAGED_ASAR || APP_DIR] };
  const env = { ...process.env, FOODCOURT_USER_DATA_DIR: profile, FOODCOURT_SMOKE_TEST: '', FOODCOURT_PIN_LOCK: 'off', FOODCOURT_API_URL: '' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ ...target, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
  page.on('request', (r) => {
    if (/\/api\/(menu|menu-categories)(\?|$)/.test(r.url())) catalogRequests.push(r.url());
  });
  await resize(1440, 900);
};

/** Resizes the real window, not just the page, so the layout is judged at the size a cashier would have. */
const resize = async (width, height) => {
  await app.evaluate(({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w.isMaximized()) w.unmaximize();
    w.setContentSize(size.width, size.height);
  }, { width, height });
  await page.waitForTimeout(350);
};

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
  await page.waitForTimeout(300);
};
const chip = (name) => page.locator(`[data-category-chip="${name}"]`);
const clickChip = async (name) => {
  await chip(name).click();
  await page.waitForTimeout(60);
};
const search = () => page.getByLabel('Search menu');
const shownDishes = async () => (await page.locator('[data-menu-item]').evaluateAll((cards) => cards.map((c) => c.getAttribute('data-menu-item')))).sort();
const pressedChips = () => page.locator('[data-category-chip][aria-pressed="true"]').evaluateAll((chips) => chips.map((c) => c.getAttribute('data-category-chip')));
const cartLines = async () => (await page.locator('h5').allInnerTexts()).sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const addDish = (name) => page.locator(`[data-menu-item="${name}"]`).first().click();

/** The packaged app always asks each new user for a PIN; an unpacked run has that switched off for tests. */
let pin = '';
const finishSignIn = async () => {
  await page.waitForFunction(() => document.querySelector('#pin-new') || document.querySelector('aside nav'), null, { timeout: 30000 });
  if (await page.locator('#pin-new').count()) {
    pin = '739146'.slice(0, Number(await page.getAttribute('#pin-new', 'maxlength')));
    await page.fill('#pin-new', pin);
    await page.fill('#pin-confirm', pin);
    await page.getByRole('button', { name: /Save PIN/ }).click();
    await page.locator('aside nav').waitFor({ timeout: 30000 });
  }
};

/** A valid single-colour PNG, built here so the run needs no image file. */
const solidPng = (width, height, [r, g, b]) => {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
};

try {
  // ------------------------------------------------------------------ the actual app, on a fresh database
  await launch();
  await page.getByText('Welcome', { exact: false }).first().waitFor({ timeout: 90000 });
  await page.fill('#owner-name', 'Category Owner');
  await page.fill('#owner-email', 'category.owner@example.com');
  await page.fill('#owner-password', OWNER_PW);
  await page.fill('#owner-confirm', OWNER_PW);
  await page.getByRole('button', { name: /Create account/ }).click();
  await page.getByText('Save your recovery key').waitFor({ timeout: 20000 });
  await page.check('#recovery-saved');
  await page.getByRole('button', { name: 'Continue' }).click();
  await finishSignIn();
  await page.waitForFunction(() => /dashboard/i.test(location.hash), null, { timeout: 20000 });
  API = (await page.evaluate(() => window.desktop.getConfig())).apiBaseUrl.replace(/\/$/, '');
  const runtime = await app.evaluate(({ app: a }) => ({ electron: process.versions.electron, packaged: a.isPackaged, version: a.getVersion() }));
  const url = await page.evaluate(() => location.href);
  check('R-01', 'Running in Electron from the production renderer with its built-in server', !!runtime.electron && url.startsWith('file:') && /^http:\/\/127\.0\.0\.1:\d+\/api$/.test(API), `electron ${runtime.electron}, packaged=${runtime.packaged}, v${runtime.version}, ${API}`);
  writeFileSync(join(shots, 'runtime.json'), JSON.stringify({ ...runtime, url, api: API }, null, 2));

  // ------------------------------------------------------------------ no categories at all
  await goto('#/pos');
  await page.getByTestId('pos-empty-state').getByText('No dishes to sell yet').waitFor({ timeout: 15000 });
  check('E-01', 'With no categories the POS shows a clean empty state and only the All Categories chip', (await page.locator('[data-category-chip]').count()) === 1 && (await chip('All Categories').innerText()) === 'All Categories (0)', await chip('All Categories').innerText());
  await shot('01-no-categories');

  // The owner leaves the window now: one user has one session, so the API token below would otherwise end the window's
  await page.click('[title^="Sign Out"]');
  await page.locator('input[type=email]').waitFor({ timeout: 15000 });

  // ------------------------------------------------------------------ test catalogue, persisted through the real API
  const ownerToken = (await api(null, 'POST', '/auth/login', { email: 'category.owner@example.com', password: OWNER_PW })).data.token;
  const stallA = (await api(ownerToken, 'POST', '/stalls', { name: 'Stall Alpha', code: 'ALPHA' })).data;
  const stallB = (await api(ownerToken, 'POST', '/stalls', { name: 'Stall Bravo', code: 'BRAVO' })).data;
  const category = async (stall, name, display_order) => (await api(ownerToken, 'POST', '/menu-categories', { stall_id: stall.id, name, display_order })).data;
  const dish = async (stall, cat, name, price, is_veg = true) => (await api(ownerToken, 'POST', '/menu', { stall_id: stall.id, category_id: cat.id, name, price, is_veg })).data;

  await category(stallB, 'Soups', 0); // comes first but has no dishes: must not be the default
  const pizzaA = await category(stallA, 'Pizza', 1);
  const pizzaB = await category(stallB, 'Pizza', 4); // same name, other stall: one chip
  const burgerA = await category(stallA, 'Burger', 2);
  const burgerB = await category(stallB, 'Burger', 2);
  const drinksB = await category(stallB, 'Beverages', 3);
  const retired = await category(stallA, 'Retired Menu', 0);
  await api(ownerToken, 'PUT', `/menu-categories/${retired.id}`, { is_active: false });

  const menu = {};
  for (const [stall, cat, name, price, veg] of [
    [stallA, pizzaA, 'Cheese Pizza', 180],
    [stallA, pizzaA, 'Margherita Pizza', 160],
    [stallB, pizzaB, 'Corn Pizza', 200],
    [stallB, pizzaB, 'Paneer Pizza', 220],
    [stallA, burgerA, 'Veg Burger', 120],
    [stallB, burgerB, 'Chicken Burger', 170, false],
    [stallB, drinksB, 'Cold Coffee', 90],
    [stallA, retired, 'Discontinued Special', 999],
    [stallA, pizzaA, 'Sold Out Pizza', 250],
  ]) menu[name] = await dish(stall, cat, name, price, veg);
  await api(ownerToken, 'POST', `/menu/${menu['Sold Out Pizza'].id}/toggle`, {});

  // Enough categories to overflow a narrower window
  const extras = ['Sandwich', 'Chinese', 'South Indian', 'Desserts', 'Salads', 'Momos', 'Pasta', 'Thali', 'Wraps', 'Rolls', 'Juices', 'Ice Cream'];
  for (const [i, name] of extras.entries()) await dish(stallB, await category(stallB, name, 10 + i), `${name} Special`, 100 + i);
  const eligibleTotal = 7 + extras.length;

  // A real uploaded photo, so the card image is exercised end to end
  const form = new FormData();
  form.append('image', new Blob([solidPng(96, 96, [214, 120, 40])], { type: 'image/png' }), 'pizza.png');
  const upload = await fetch(`${API}/menu/${menu['Cheese Pizza'].id}/image`, { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}`, Accept: 'application/json' }, body: form });
  const uploadBody = await upload.text();

  await api(ownerToken, 'POST', '/staff', { name: 'Category Cashier', email: 'cat.cashier@example.com', password: STAFF_PW, role: 'cashier' });
  const table = (await api(ownerToken, 'POST', '/tables', { table_number: 'C-1', capacity: 4, section: 'Main' })).data;

  // ------------------------------------------------------------------ a real cashier opens the POS
  await page.fill('input[type=email]', 'cat.cashier@example.com');
  await page.fill('input[type=password]', STAFF_PW);
  await page.click('button[type=submit]');
  await finishSignIn();
  await page.waitForFunction(() => location.hash.includes('pos'), null, { timeout: 20000 });
  await page.locator('[data-menu-item]').first().waitFor({ timeout: 20000 });
  const pizzaDishes = ['Cheese Pizza', 'Corn Pizza', 'Margherita Pizza', 'Paneer Pizza'];

  check('O-01', 'POS opens on the first active category with dishes (Pizza), skipping the empty Soups', same(await pressedChips(), ['Pizza']), (await pressedChips()).join());
  check('O-02', 'Only Pizza dishes are shown on open, not every dish', same(await shownDishes(), pizzaDishes), (await shownDishes()).join(', '));
  const bodyText = await page.locator('main').innerText();
  check('O-03', 'No stall filter chip is left on the POS', !/All Stalls/.test(bodyText) && (await page.getByRole('button', { name: 'Stall Alpha' }).count()) === 0);
  const chipTexts = await page.locator('[data-category-chip]').allInnerTexts();
  check('O-04', 'Stalls sharing a category name share one chip, with a count of eligible dishes', chipTexts.filter((t) => /^Pizza/.test(t)).length === 1 && chipTexts.includes('Pizza (4)') && chipTexts.includes('Burger (2)'), chipTexts.slice(0, 6).join(' | '));
  check('O-05', 'An inactive category and its dish are hidden; a sold-out dish is not counted', !chipTexts.some((t) => /Retired/.test(t)) && chipTexts[0] === `All Categories (${eligibleTotal})`, chipTexts[0]);
  check('O-06', 'Upload of a dish photo through the real API succeeded', upload.ok, `${upload.status} ${uploadBody.slice(0, 120)}`);
  const cheeseCard = page.locator('[data-menu-item="Cheese Pizza"]');
  const photo = await cheeseCard.locator('img').evaluate((img) => new Promise((done) => {
    const report = () => done({ loaded: img.naturalWidth > 0, width: img.naturalWidth, src: img.src });
    if (img.complete) report();
    img.addEventListener('load', report);
    img.addEventListener('error', report);
    setTimeout(report, 8000);
  }), null, { timeout: 10000 }).catch((e) => ({ loaded: false, src: String(e).slice(0, 120) }));
  const cardText = await cheeseCard.innerText();
  check('O-07', 'Card shows photo, name, price, availability and its own stall', photo.loaded && /Cheese Pizza/.test(cardText) && /₹180\.00/.test(cardText) && /Available/.test(cardText) && /Stall Alpha/.test(cardText), `${cardText.replace(/\s+/g, ' ')} | ${JSON.stringify(photo)}`);
  await shot('02-opens-on-first-category');

  const before = catalogRequests.length;
  await clickChip('Burger');
  check('C-01', 'Burger shows only Burger dishes, from both stalls', same(await shownDishes(), ['Chicken Burger', 'Veg Burger']), (await shownDishes()).join(', '));
  check('C-02', 'Only the selected chip is highlighted', same(await pressedChips(), ['Burger']) && /bg-primary/.test(await chip('Burger').getAttribute('class')) && !/bg-primary/.test(await chip('Pizza').getAttribute('class')));
  await shot('03-burger-category');
  await clickChip('Pizza');
  check('C-03', 'Pizza shows only Pizza dishes', same(await shownDishes(), pizzaDishes));
  await clickChip('All Categories');
  check('C-04', 'All Categories shows every eligible dish and nothing else', (await shownDishes()).length === eligibleTotal && !(await shownDishes()).some((d) => /Discontinued|Sold Out/.test(d)), `${(await shownDishes()).length} dishes`);
  await shot('04-all-categories');
  check('C-05', 'Switching categories fetches nothing (no reload, no waiting)', catalogRequests.length === before, `${catalogRequests.length - before} catalogue requests`);

  // ------------------------------------------------------------------ empty category
  await clickChip('Soups');
  await page.getByTestId('pos-empty-state').getByText('No dishes available in Soups').waitFor({ timeout: 5000 });
  check('E-02', 'An empty category shows a clean empty state and an honest count of 0', (await page.locator('[data-menu-item]').count()) === 0 && (await chip('Soups').innerText()) === 'Soups (0)', await chip('Soups').innerText());
  await shot('05-empty-category');

  // ------------------------------------------------------------------ cart across categories, search, keyboard
  await clickChip('Pizza');
  await addDish('Cheese Pizza');
  const cartPrice = await page.locator('h5', { hasText: 'Cheese Pizza' }).locator('xpath=..').innerText();
  check('K-01', 'Cheese Pizza goes into the cart at its own price and stall', /₹180\.00/.test(cartPrice) && /Stall Alpha/.test(cartPrice), cartPrice.replace(/\s+/g, ' '));

  await page.keyboard.press('F2');
  await page.waitForTimeout(50); // the POS moves focus on the next tick
  check('S-01', 'F2 still focuses the search field', (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Search menu');
  await search().fill('corn');
  await page.waitForTimeout(60);
  check('S-02', 'Search inside Pizza finds the matching Pizza dish', same(await shownDishes(), ['Corn Pizza']), (await shownDishes()).join());
  await shot('06-search-in-pizza');
  await addDish('Corn Pizza');
  await search().fill('burger');
  await page.waitForTimeout(60);
  await page.getByTestId('pos-empty-state').getByText(/No dishes match .burger. in Pizza/).waitFor({ timeout: 5000 });
  check('S-03', 'A dish outside the selected category is not found, and the screen says so', (await page.locator('[data-menu-item]').count()) === 0);
  await shot('07-search-no-match-in-category');
  check('S-04', 'Search never touches the cart', same(await cartLines(), ['Cheese Pizza', 'Corn Pizza']), (await cartLines()).join());
  await search().fill('');
  await page.waitForTimeout(60);
  check('S-05', 'Clearing the search restores the selected category', same(await shownDishes(), pizzaDishes) && same(await pressedChips(), ['Pizza']));
  await search().fill('burger');
  await page.getByTestId('pos-search-all-categories').click();
  await page.waitForTimeout(60);
  check('S-06', 'From no match, one click widens the search to All Categories', same(await shownDishes(), ['Chicken Burger', 'Veg Burger']) && same(await pressedChips(), ['All Categories']));
  await search().fill('');

  await clickChip('Burger');
  await addDish('Veg Burger');
  await clickChip('Beverages');
  await addDish('Cold Coffee');
  const expectedCart = ['Cheese Pizza', 'Cold Coffee', 'Corn Pizza', 'Veg Burger'];
  check('K-02', 'Dishes from several categories all stay in the cart', same(await cartLines(), expectedCart), (await cartLines()).join());
  const totalBefore = await page.getByText('Grand Total:').locator('xpath=..').innerText();
  for (const name of ['Soups', 'Pizza', 'All Categories', 'Burger']) await clickChip(name);
  check('K-03', 'Changing category leaves the cart and total unchanged', same(await cartLines(), expectedCart) && (await page.getByText('Grand Total:').locator('xpath=..').innerText()) === totalBefore, totalBefore.replace(/\s+/g, ' '));

  await chip('Burger').focus();
  await page.keyboard.press('ArrowRight');
  const afterArrow = await pressedChips();
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-category-chip'));
  check('K-04', 'Arrow keys move between category chips and select them', afterArrow.length === 1 && afterArrow[0] !== 'Burger' && focused === afterArrow[0], afterArrow.join());
  await clickChip('Pizza');
  await shot('08-cart-from-several-categories');

  // ------------------------------------------------------------------ window sizes
  for (const [w, h] of [[1920, 1080], [1280, 720], [1024, 700]]) {
    await resize(w, h);
    const m = await page.evaluate(() => {
      const row = document.querySelector('[data-testid="pos-category-chips"]');
      const selected = row.querySelector('[aria-pressed="true"]').getBoundingClientRect();
      const box = row.getBoundingClientRect();
      const search = document.querySelector('[aria-label="Search menu"]').getBoundingClientRect();
      const card = document.querySelector('[data-menu-item]').getBoundingClientRect();
      return {
        innerWidth,
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
        chipsScroll: row.scrollWidth > row.clientWidth,
        chipVisible: selected.left >= box.left - 1 && selected.right <= box.right + 1,
        searchVisible: search.top >= 0 && search.bottom <= innerHeight && search.width > 100,
        cardWidth: Math.round(card.width),
      };
    });
    check(`W-${w}`, `${w}x${h}: no sideways page scroll, search and selected chip in view, cards usable`, !m.pageOverflow && m.chipVisible && m.searchVisible && m.cardWidth >= 150, JSON.stringify(m));
    await shot(`09-window-${w}x${h}`);
    if (w === 1024) check('W-02', 'A narrow window scrolls the chips sideways instead of wrapping them', m.chipsScroll);
  }
  await chip('Ice Cream').scrollIntoViewIfNeeded();
  await clickChip('Ice Cream');
  check('W-03', 'The last chip can be reached and used in a narrow window', same(await shownDishes(), ['Ice Cream Special']));
  await shot('10-narrow-window-last-chip');
  await clickChip('Pizza');
  await resize(1440, 900);

  // ------------------------------------------------------------------ stall routing: the point of the whole feature
  await page.selectOption('select[aria-label="Dining table"]', String(table.id));
  await page.keyboard.press('F8');
  const notice = page.getByText(/sent to 2 stall kitchen/);
  await notice.waitFor({ timeout: 15000 });
  const orderNumber = /Order (\S+) sent/.exec(await notice.innerText())[1];
  await shot('11-order-placed');
  check('T-01', 'After placing the order the cashier is still on the same category', same(await pressedChips(), ['Pizza']));

  const orderId = (await api(ownerToken, 'GET', `/orders?search=${orderNumber}`)).data.data[0].id;
  const order = (await api(ownerToken, 'GET', `/orders/${orderId}`)).data;
  const stallOf = Object.fromEntries(order.items.map((i) => [i.item_name, i.stall_id]));
  check('T-02', 'Every order item keeps the stall of its dish', stallOf['Cheese Pizza'] === stallA.id && stallOf['Veg Burger'] === stallA.id && stallOf['Corn Pizza'] === stallB.id && stallOf['Cold Coffee'] === stallB.id, JSON.stringify(stallOf));
  const ticketStalls = order.kitchen_tickets.map((t) => t.stall_id).sort((a, b) => a - b);
  check('T-03', 'One kitchen ticket per stall: one category across two stalls gives two tickets', same(ticketStalls, [stallA.id, stallB.id].sort((a, b) => a - b)), ticketStalls.join());

  const board = (await api(ownerToken, 'GET', '/orders/board')).data.orders.find((o) => o.id === orderId);
  const boardText = JSON.stringify(board);
  check('T-04', 'The tracking board shows the order with all four items', board.items.length === 4 && expectedCart.every((n) => boardText.includes(n)), `${board.items.length} items`);
  check('T-05', 'Server priced the bill from its own menu prices', Number(order.subtotal) === 180 + 200 + 120 + 90, order.subtotal);

  await goto('#/tracking');
  await page.getByTestId(`order-card-${orderId}`).waitFor({ timeout: 20000 });
  await shot('12-tracking-board');

  // Serve, pay, then read the stall-wise sales report
  for (const item of board.items) await api(ownerToken, 'PATCH', `/ticket-items/${item.id}/status`, { status: 'served' });
  const open = (await api(ownerToken, 'GET', `/billing/orders/${orderId}/open`)).data;
  const payable = Number(open.remaining_balance ?? open.total_amount);
  await api(ownerToken, 'POST', '/billing/pay', { order_id: orderId, payment_method: 'cash', amount: payable, expected_balance: payable, cash_tendered: payable });
  const rows = (await api(ownerToken, 'GET', '/reports/stall-sales')).data.stalls_performance;
  const salesOf = (id) => Number(rows.find((r) => r.stall_id === id)?.total_revenue);
  check('T-06', 'Stall-wise sales credit each stall with its own dishes', salesOf(stallA.id) === 300 && salesOf(stallB.id) === 290, JSON.stringify(rows).slice(0, 300));

  // ------------------------------------------------------------------ persisted records survive a restart
  await app.close();
  await launch();
  // Whichever way the app brings the cashier back: saved session, PIN keypad, or the sign-in form
  await page.waitForSelector('[data-menu-item], [data-testid="pin-key-0"], input[type=email]', { timeout: 90000 });
  if (await page.getByTestId('pin-key-0').count()) {
    for (const digit of pin) await page.getByTestId(`pin-key-${digit}`).click();
    const unlock = page.getByRole('button', { name: 'Unlock' });
    if (await unlock.count()) await unlock.click();
  } else if (await page.locator('input[type=email]').count()) {
    await page.fill('input[type=email]', 'cat.cashier@example.com');
    await page.fill('input[type=password]', STAFF_PW);
    await page.click('button[type=submit]');
    await finishSignIn();
  }
  await page.locator('[data-menu-item]').first().waitFor({ timeout: 60000 });
  check('P-01', 'After a restart the POS rebuilds the same chips and default from the saved database', same(await pressedChips(), ['Pizza']) && same(await shownDishes(), pizzaDishes) && (await chip('All Categories').innerText()) === `All Categories (${eligibleTotal})`, (await pressedChips()).join());
  await page.waitForTimeout(1500);
  const restartedApi = (await page.evaluate(() => window.desktop.getConfig())).apiBaseUrl.replace(/\/$/, '');
  const afterRestart = await page.locator('[data-menu-item="Cheese Pizza"] img').evaluate((img) => ({ loaded: img.naturalWidth > 0, src: img.src })).catch(() => ({ loaded: false, src: 'no <img>: fell back to the plain tile' }));
  // The address matters: a photo loaded from the old port would only be the browser cache, which expires after a day
  check('P-02', 'A saved dish photo still shows after a restart, from the server now running', afterRestart.loaded && afterRestart.src.startsWith(`${restartedApi}/`), `api was ${API}, now ${restartedApi}; ${JSON.stringify(afterRestart)}`);
  await shot('13-after-restart');

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
