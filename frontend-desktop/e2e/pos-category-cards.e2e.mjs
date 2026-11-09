/**
 * Cashier POS category cards: every category is its own card and its dishes are added to the cart straight from the card.
 * Driven through the real Electron runtime with its built-in server and a real SQLite database on a brand-new throw-away
 * profile (test data only, created through the real API; nothing here reaches a real install).
 *
 *   cd frontend-desktop && pnpm build && pnpm prepare:server
 *   node e2e/pos-category-cards.e2e.mjs
 *   PACKAGED_EXE="<win-unpacked>/MangalMurti POS.exe" node e2e/pos-category-cards.e2e.mjs
 *
 * Covers: categories with 1, 10 and 55 dishes, 100+ categories, long names, three stalls with different categories,
 * All Stalls with same-named dishes, repeated clicks, cart kept across stall switches, and stall-wise kitchen tickets.
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
const shots = join(HERE, '..', '..', 'qa', 'desktop', 'results', process.env.PACKAGED_EXE ? 'pos-category-cards-packaged' : 'pos-category-cards');
mkdirSync(shots, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'foodcourt-poscards-'));
const OWNER_PW = 'Str0ngPass99';
const STAFF_PW = 'StaffPass#2026';

const results = [];
const check = (id, desc, pass, ev = '') => {
  results.push({ id, desc, result: pass ? 'PASS' : 'FAIL', evidence: String(ev).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 200)}]` : ''}`);
};

let app;
let page;
let API = '';
const pageErrors = [];

const launch = async () => {
  const target = process.env.PACKAGED_EXE
    ? { executablePath: process.env.PACKAGED_EXE, args: [] }
    : { executablePath: electronPath, args: [process.env.PACKAGED_ASAR || APP_DIR] };
  const env = { ...process.env, FOODCOURT_USER_DATA_DIR: profile, FOODCOURT_SMOKE_TEST: '', FOODCOURT_PIN_LOCK: 'off', FOODCOURT_API_URL: '' };
  // A packaged exe runs an installed update from %LOCALAPPDATA% when there is one: give it an empty one, so the run tests this build
  if (process.env.PACKAGED_EXE) {
    env.LOCALAPPDATA = join(profile, 'localappdata');
    mkdirSync(env.LOCALAPPDATA, { recursive: true });
  }
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ ...target, env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
  await resize(1440, 900);
};

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

/** Runs async jobs a few at a time, so seeding a big menu does not take one request after another. */
const pool = async (jobs, width = 4) => {
  const out = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await jobs[i]();
    }
  }));
  return out;
};

const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`) });
const goto = async (hash) => {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(300);
};
const card = (name) => page.locator(`[data-category-name="${name}"]`);
const rowsIn = (name) => card(name).locator('[data-menu-item]');
const rowNames = async (name) => rowsIn(name).evaluateAll((rows) => rows.map((r) => r.getAttribute('data-menu-item')));
const cardNames = () => page.locator('[data-category-card]').evaluateAll((cards) => cards.map((c) => c.getAttribute('data-category-name')));
const pickStall = async (id) => {
  await page.locator(`[data-stall-tab="${id}"]`).click();
  await page.waitForTimeout(120);
};
const cart = () => page.evaluate(() =>
  [...document.querySelectorAll('h5')].map((h) => ({
    name: h.textContent,
    stall: h.parentElement.querySelector('span')?.textContent,
    qty: Number(h.parentElement.parentElement.querySelector('span.w-5')?.textContent),
  })).sort((a, b) => (a.name + a.stall).localeCompare(b.name + b.stall))
);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const grandTotal = () => page.getByText('Grand Total:').locator('xpath=..').innerText();

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
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
};

const LONG_CAT = 'Traditional Maharashtrian Thali Specials and Seasonal Festival Platters';
const LONG_DISH = 'Puran Poli with Katachi Amti, Masale Bhaat, Kurdai, Papad and Fresh Shrikhand Bowl';
const FILLER = 102; // filler categories, two dishes each, so the POS has 100+ categories

try {
  await launch();
  await page.getByText('Welcome', { exact: false }).first().waitFor({ timeout: 90000 });
  await page.fill('#owner-name', 'Cards Owner');
  await page.fill('#owner-email', 'cards.owner@example.com');
  await page.fill('#owner-password', OWNER_PW);
  await page.fill('#owner-confirm', OWNER_PW);
  await page.getByRole('button', { name: /Create account/ }).click();
  await page.getByText('Save your recovery key').waitFor({ timeout: 20000 });
  await page.check('#recovery-saved');
  await page.getByRole('button', { name: 'Continue' }).click();
  await finishSignIn();
  await page.waitForFunction(() => /dashboard/i.test(location.hash), null, { timeout: 20000 });
  API = (await page.evaluate(() => window.desktop.getConfig())).apiBaseUrl.replace(/\/$/, '');
  const runtime = await app.evaluate(({ app: a }) => ({ electron: process.versions.electron, packaged: a.isPackaged, version: a.getVersion(), exe: process.execPath }));
  const url = await page.evaluate(() => location.href);
  check('R-01', 'Running in Electron from the production renderer with its built-in server', !!runtime.electron && url.startsWith('file:') && (!process.env.PACKAGED_EXE || (runtime.packaged && url.includes('/resources/app.asar/'))) && /^http:\/\/127\.0\.0\.1:\d+\/api$/.test(API), `electron ${runtime.electron}, packaged=${runtime.packaged}, v${runtime.version}, ${runtime.exe}`);
  writeFileSync(join(shots, 'runtime.json'), JSON.stringify({ ...runtime, url, api: API }, null, 2));
  await page.click('[title^="Sign Out"]');
  await page.locator('input[type=email]').waitFor({ timeout: 15000 });

  // ------------------------------------------------------------------ test catalogue through the real API
  const t0 = Date.now();
  const owner = (await api(null, 'POST', '/auth/login', { email: 'cards.owner@example.com', password: OWNER_PW })).data.token;
  const stallA = (await api(owner, 'POST', '/stalls', { name: 'Biryani House', code: 'BIR' })).data;
  const stallB = (await api(owner, 'POST', '/stalls', { name: 'Dragon Wok', code: 'WOK' })).data;
  const stallC = (await api(owner, 'POST', '/stalls', { name: "Aaji's Authentic Maharashtrian Kitchen and Sweet Mart", code: 'AAJI' })).data;
  const category = async (stall, name, display_order) => (await api(owner, 'POST', '/menu-categories', { stall_id: stall.id, name, display_order })).data;
  const dish = async (stall, cat, name, price, is_veg = true) => (await api(owner, 'POST', '/menu', { stall_id: stall.id, category_id: cat.id, name, price, is_veg })).data;

  const single = await category(stallA, 'Single Dish', 1);
  const biryani = await category(stallA, 'Biryani & Rice', 2);
  const pizzaA = await category(stallA, 'Pizza', 3);
  const pizzaB = await category(stallB, 'Pizza', 3); // same name, other stall: one card
  const chinese = await category(stallB, 'Chinese', 4);
  const big = await category(stallB, 'Big Menu', 5);
  const longCat = await category(stallC, LONG_CAT, 6);
  const retired = await category(stallA, 'Retired Menu', 0);
  await api(owner, 'PUT', `/menu-categories/${retired.id}`, { is_active: false });
  await category(stallC, 'Empty Shelf', 7); // active but no dishes: no card

  const menu = {};
  const add = async (stall, cat, name, price, veg = true) => {
    const d = await dish(stall, cat, name, price, veg);
    menu[`${name}@${stall.code}`] = d;
    return d;
  };
  await add(stallA, single, 'Masala Chaas', 40);
  await pool([
    ['Chicken Biryani', 180, false], ['Veg Biryani', 140], ['Egg Biryani', 150, false], ['Paneer Biryani', 160],
  ].map(([n, p, v]) => () => add(stallA, biryani, n, p, v)));
  await add(stallA, pizzaA, 'Cheese Pizza', 180);
  await add(stallA, pizzaA, 'Sold Out Pizza', 250);
  await add(stallB, pizzaB, 'Cheese Pizza', 190); // same dish name, other stall: two rows, each naming its stall
  await add(stallB, pizzaB, 'Corn Pizza', 160);
  await add(stallA, retired, 'Discontinued Special', 999);
  const chineseNames = ['Veg Noodles', 'Hakka Noodles', 'Manchurian', 'Fried Rice', 'Schezwan Rice', 'Spring Roll', 'Chilli Paneer', 'Momos', 'Hot & Sour Soup', 'Chopsuey'];
  await pool(chineseNames.map((n, i) => () => add(stallB, chinese, n, 120 + i * 5)));
  const bigNames = Array.from({ length: 55 }, (_, i) => `Big Menu Dish ${String(i + 1).padStart(2, '0')}`);
  await pool(bigNames.map((n, i) => () => add(stallB, big, n, 50 + i)));
  await add(stallC, longCat, LONG_DISH, 320);
  await api(owner, 'POST', `/menu/${menu['Sold Out Pizza@BIR'].id}/toggle`, {});
  const fillers = await pool(Array.from({ length: FILLER }, (_, i) => () => category(stallC, `Filler Category ${String(i + 1).padStart(3, '0')}`, 100 + i)));
  await pool(fillers.flatMap((cat, i) => [
    () => add(stallC, cat, `Filler ${String(i + 1).padStart(3, '0')} Vada`, 30 + (i % 20)),
    () => add(stallC, cat, `Filler ${String(i + 1).padStart(3, '0')} Misal`, 60 + (i % 20)),
  ]));

  const form = new FormData();
  form.append('image', new Blob([solidPng(96, 96, [214, 120, 40])], { type: 'image/png' }), 'biryani.png');
  const upload = await fetch(`${API}/menu/${menu['Chicken Biryani@BIR'].id}/image`, { method: 'POST', headers: { Authorization: `Bearer ${owner}`, Accept: 'application/json' }, body: form });
  await api(owner, 'POST', '/staff', { name: 'Cards Cashier', email: 'cards.cashier@example.com', password: STAFF_PW, role: 'cashier' });
  const table = (await api(owner, 'POST', '/tables', { table_number: 'K-1', capacity: 4, section: 'Main' })).data;
  const totalDishes = 1 + 4 + 1 + 2 + 10 + 55 + 1 + FILLER * 2; // eligible: no sold-out, no retired
  const totalCards = 6 + FILLER; // Single, Biryani, Pizza, Chinese, Big Menu, long + fillers
  console.log(`seeded ${Object.keys(menu).length} dishes in ${Math.round((Date.now() - t0) / 1000)} s`);

  // ------------------------------------------------------------------ the cashier opens the POS
  await page.fill('input[type=email]', 'cards.cashier@example.com');
  await page.fill('input[type=password]', STAFF_PW);
  const openStart = Date.now();
  await page.click('button[type=submit]');
  await finishSignIn();
  await page.waitForFunction(() => location.hash.includes('pos'), null, { timeout: 20000 });
  await page.locator('[data-category-card]').first().waitFor({ timeout: 30000 });
  const openMs = Date.now() - openStart;

  const names = await cardNames();
  const dom = await page.evaluate(() => ({
    cards: document.querySelectorAll('[data-category-card]').length,
    rows: document.querySelectorAll('[data-menu-item]').length,
    imgs: document.querySelectorAll('[data-category-card] img').length,
    nodes: document.querySelectorAll('*').length,
  }));
  check('N-01', `100+ categories: one card per category with dishes (${totalCards}), none for empty, inactive or sold-out`, dom.cards === totalCards && !names.includes('Empty Shelf') && !names.includes('Retired Menu'), `${dom.cards} cards`);
  check('N-02', 'Only the cards near the screen draw their dish rows; the rest wait until scrolled to', dom.rows > 0 && dom.rows < 120, `${dom.rows} rows drawn of ${totalDishes}, ${dom.nodes} DOM nodes, ${dom.imgs} images`);
  check('N-03', 'POS is usable soon after sign-in, even with 100+ categories', openMs < 8000, `${openMs} ms from sign-in click to first card`);
  check('N-04', 'Cards follow display order: Single Dish first, fillers last', names[0] === 'Single Dish' && names[1] === 'Biryani & Rice' && names[names.length - 1] === `Filler Category ${String(FILLER).padStart(3, '0')}`, names.slice(0, 4).join(' | '));
  const header = await card('Biryani & Rice').locator('header').innerText();
  check('C-01', 'A card shows its category name and its number of dishes', /Biryani & Rice/.test(header) && /4 dishes/.test(header), header.replace(/\s+/g, ' '));
  check('C-02', 'Biryani card lists its dishes with name and price, directly selectable', same(await rowNames('Biryani & Rice'), ['Chicken Biryani', 'Egg Biryani', 'Paneer Biryani', 'Veg Biryani']) && /₹180\.00/.test(await rowsIn('Biryani & Rice').first().innerText()));
  const photo = await card('Biryani & Rice').locator('img').first().evaluate((img) => new Promise((done) => {
    const report = () => done({ loaded: img.naturalWidth > 0, src: img.src });
    if (img.complete) report();
    img.addEventListener('load', report);
    img.addEventListener('error', report);
    setTimeout(report, 8000);
  })).catch((e) => ({ loaded: false, src: String(e).slice(0, 100) }));
  check('C-03', 'An uploaded dish photo is kept on its row', upload.ok && photo.loaded, JSON.stringify(photo));
  await shot('01-all-stalls-category-cards');

  // 1 dish
  check('T-01', 'Category with 1 dish: one row, "1 dish", no Show all', same(await rowNames('Single Dish'), ['Masala Chaas']) && /1 dish\b/.test(await card('Single Dish').locator('header').innerText()) && (await card('Single Dish').locator('[data-card-toggle]').count()) === 0);
  // 10 dishes
  check('T-02a', 'Category with 10 dishes: shows the first 6 and a Show all 10 control', (await rowsIn('Chinese').count()) === 6 && /Show all 10 \(4 more\)/.test(await card('Chinese').locator('[data-card-toggle]').innerText()));
  await card('Chinese').locator('[data-card-toggle]').click();
  check('T-02b', 'Show all opens all 10 in the same card, in menu order (by name)', same(await rowNames('Chinese'), [...chineseNames].sort()));
  await shot('02-ten-dish-card-open');
  await card('Chinese').locator('[data-card-toggle]').click();
  check('T-02c', 'Show fewer closes it again', (await rowsIn('Chinese').count()) === 6);
  // 55 dishes
  await card('Big Menu').locator('[data-card-toggle]').click();
  const bigBox = await card('Big Menu').evaluate((el) => ({ w: el.getBoundingClientRect().width, grid: el.parentElement.getBoundingClientRect().width, h: el.getBoundingClientRect().height }));
  check('T-03', 'Category with 55 dishes opens in place across the full row, in columns, all 55 selectable', same(await rowNames('Big Menu'), bigNames) && bigBox.w > bigBox.grid - 4 && bigBox.h < 900, JSON.stringify(bigBox));
  await card('Big Menu').scrollIntoViewIfNeeded();
  await shot('03-fifty-five-dish-card-open');
  await card('Big Menu').locator('[data-card-toggle]').click();

  // Long names
  await card(LONG_CAT).scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const longM = await card(LONG_CAT).evaluate((el) => ({
    headerOverflow: el.querySelector('h3').scrollWidth > el.querySelector('h3').clientWidth + 1,
    rowOverflow: [...el.querySelectorAll('[data-menu-item]')].some((r) => r.scrollWidth > r.clientWidth + 1),
    cardWidth: Math.round(el.getBoundingClientRect().width),
    pageOverflow: document.documentElement.scrollWidth > innerWidth,
    title: el.querySelector('h3').textContent,
  }));
  check('T-05', 'Long category and dish names wrap inside the card without overflow', !longM.headerOverflow && !longM.rowOverflow && !longM.pageOverflow && longM.title === LONG_CAT, JSON.stringify(longM));
  await shot('04-long-names');

  // Scroll to the end: the last cards draw their rows
  const scrollStart = Date.now();
  await page.evaluate(() => { const g = document.querySelector('[data-testid="pos-category-cards"]').parentElement; g.scrollTop = g.scrollHeight; });
  await page.waitForTimeout(400);
  const lastName = `Filler Category ${String(FILLER).padStart(3, '0')}`;
  check('N-05', 'Scrolling to the 100th+ card draws its dishes on demand', (await rowsIn(lastName).count()) === 2, `${Date.now() - scrollStart} ms`);
  await shot('05-end-of-100-plus-categories');

  // ------------------------------------------------------------------ stalls
  await page.evaluate(() => { const g = document.querySelector('[data-testid="pos-category-cards"]').parentElement; g.scrollTop = 0; });
  const tabs = await page.locator('[data-testid="pos-stall-tabs"] button').allInnerTexts();
  check('S-01', 'Stall row shows All Stalls and each stall number and name from the database', tabs[0] === `All Stalls (${totalDishes})` && tabs[1] === 'Stall 01 · Biryani House' && tabs[2] === 'Stall 02 · Dragon Wok' && /^Stall 03 · Aaji's/.test(tabs[3]), tabs.join(' | '));
  const pizzaRows = await rowsIn('Pizza').evaluateAll((rows) => rows.map((r) => `${r.getAttribute('data-menu-item')}@${r.getAttribute('data-stall-id')}`));
  const pizzaText = await card('Pizza').innerText();
  check('S-02', 'All Stalls: same-named Pizza categories are one card; each stall\'s Cheese Pizza is one row naming its stall, no repeats', pizzaRows.length === 3 && new Set(pizzaRows).size === 3 && pizzaRows.filter((r) => r.startsWith('Cheese Pizza@')).length === 2 && /Biryani House/.test(pizzaText) && /Dragon Wok/.test(pizzaText) && !/Sold Out/.test(pizzaText), pizzaRows.join(', '));

  const singleStall = await card('Biryani & Rice').locator('[data-card-stall]').innerText().catch(() => '');
  const singleRows = await rowsIn('Biryani & Rice').first().innerText();
  check('S-02b', 'All Stalls: a one-stall card names its stall once in the header, not on every row', singleStall === 'Biryani House' && !/Biryani House/.test(singleRows) && (await card('Pizza').locator('[data-card-stall]').count()) === 0, `${singleStall} | ${singleRows.replace(/\s+/g, ' ')}`);
  const longRow = await rowsIn(LONG_CAT).first().evaluate((r) => { const n = r.querySelector('.line-clamp-2'); return { lines: Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight)), display: getComputedStyle(n).display }; });
  check('T-05b', 'A very long dish name is clamped to 2 lines (full name in its tooltip)', longRow.lines <= 2, JSON.stringify(longRow));
  const before = Date.now();
  await pickStall(stallA.id);
  const switchMs = Date.now() - before;
  check('S-03', 'Stall 01 shows only its own categories and dishes', same(await cardNames(), ['Single Dish', 'Biryani & Rice', 'Pizza']) && same(await rowNames('Pizza'), ['Cheese Pizza']), `${(await cardNames()).join(' | ')} (${switchMs} ms)`);
  await shot('06-stall-01-selected');
  await pickStall(stallB.id);
  check('S-04', 'Stall 02 shows only its own categories', same(await cardNames(), ['Pizza', 'Chinese', 'Big Menu']) && same(await rowNames('Pizza'), ['Cheese Pizza', 'Corn Pizza']));
  await pickStall(stallC.id);
  check('S-05', 'Stall 03 shows its long-named category and its 102 fillers', (await cardNames()).length === 1 + FILLER && (await cardNames())[0] === LONG_CAT);
  await shot('07-stall-03-selected');
  await pickStall('all');
  check('S-06', 'All Stalls shows every stall\'s cards again', (await cardNames()).length === totalCards);
  await shot('08-stall-navigation-all');

  // ------------------------------------------------------------------ cart
  const cheeseA = page.locator(`[data-dish-id="${menu['Cheese Pizza@BIR'].id}"]`);
  for (let i = 0; i < 3; i++) await cheeseA.click();
  await page.locator(`[data-dish-id="${menu['Cheese Pizza@WOK'].id}"]`).click();
  await page.locator(`[data-dish-id="${menu['Chicken Biryani@BIR'].id}"]`).click();
  let lines = await cart();
  check('K-01', 'Three clicks on one dish give quantity 3; the other stall\'s Cheese Pizza is its own line', same(lines.map((l) => `${l.name}|${l.stall}|${l.qty}`), ['Cheese Pizza|Biryani House|3', 'Cheese Pizza|Dragon Wok|1', 'Chicken Biryani|Biryani House|1']), JSON.stringify(lines));
  check('K-02', 'The dish row shows its quantity in the cart', (await cheeseA.locator('[data-cart-qty]').innerText()) === '×3');
  await pickStall(stallB.id);
  await card('Chinese').locator('[data-card-toggle]').click(); // Veg Noodles is the 10th by name
  await page.locator(`[data-dish-id="${menu['Veg Noodles@WOK'].id}"]`).click();
  await pickStall(stallC.id);
  await rowsIn(LONG_CAT).first().click();
  lines = await cart();
  const totalBefore = await grandTotal();
  for (const s of ['all', stallA.id, stallB.id, stallC.id, 'all']) await pickStall(s);
  await page.getByLabel('Search menu').fill('noodles');
  await page.waitForTimeout(100);
  const searched = await cardNames();
  check('K-03', 'Switching stalls and searching never changes the cart or the total', same(await cart(), lines) && (await grandTotal()) === totalBefore && lines.length === 5, totalBefore.replace(/\s+/g, ' '));
  check('K-04', 'Search narrows to the cards with matches, each showing every match', same(searched, ['Chinese']) && same(await rowNames('Chinese'), ['Hakka Noodles', 'Veg Noodles']));
  await page.getByLabel('Search menu').fill('');
  await page.keyboard.press('F2');
  await page.waitForTimeout(50);
  check('K-05', 'F2 still focuses the search field', (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Search menu');
  await page.locator(`[data-dish-id="${menu['Masala Chaas@BIR'].id}"]`).focus();
  await page.keyboard.press('Enter');
  check('K-06', 'A dish row can be added from the keyboard (Tab to it, Enter)', (await cart()).some((l) => l.name === 'Masala Chaas' && l.qty === 1));
  // The minus button still works and a dish can be removed
  const chaasRow = page.locator('h5', { hasText: 'Masala Chaas' }).locator('xpath=../..');
  await chaasRow.locator('button').first().click();
  check('K-07', 'Decrement to zero removes the line, as before', !(await cart()).some((l) => l.name === 'Masala Chaas'));
  await page.selectOption('[data-testid="pos-category-select"]', { label: 'Chinese (10)' });
  await page.waitForTimeout(100);
  check('K-08', 'The category picker narrows to one card showing all its dishes', same(await cardNames(), ['Chinese']) && (await rowsIn('Chinese').count()) === 10);
  await page.selectOption('[data-testid="pos-category-select"]', 'all');
  await shot('09-cart-from-several-stalls');

  // ------------------------------------------------------------------ fold, drag, keyboard, saved layout
  const cardHead = (name) => card(name).locator('header');
  await cardHead('Biryani & Rice').click();
  check('L-01', 'Clicking a card header folds it to its name; its dishes are hidden', (await card('Biryani & Rice').getAttribute('data-collapsed')) === 'true' && (await rowsIn('Biryani & Rice').count()) === 0 && (await cardHead('Biryani & Rice').getAttribute('aria-expanded')) === 'false');
  await shot('12-card-folded');
  await page.getByLabel('Search menu').fill('egg biryani');
  await page.waitForTimeout(100);
  check('L-02', 'A search still shows matches inside a folded card', same(await rowNames('Biryani & Rice'), ['Egg Biryani']));
  await page.getByLabel('Search menu').fill('');
  await cardHead('Biryani & Rice').focus();
  await page.keyboard.press('Enter');
  check('L-03', 'Enter on a focused header opens it again', (await card('Biryani & Rice').getAttribute('data-collapsed')) === 'false' && (await rowsIn('Biryani & Rice').count()) === 4);
  const cartBeforeLayout = await cart();

  const order0 = (await cardNames()).slice(0, 4);
  await cardHead('Chinese').dragTo(card('Single Dish'), { targetPosition: { x: 10, y: 40 } });
  await page.waitForTimeout(150);
  const order1 = (await cardNames()).slice(0, 4);
  check('L-04', 'Dragging the Chinese card onto the left of Single Dish moves it to the front', order1[0] === 'Chinese' && order1[1] === 'Single Dish', `${order0.join(' | ')}  ->  ${order1.join(' | ')}`);
  await shot('13-card-dragged-to-front');
  await cardHead('Single Dish').focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForTimeout(100);
  const order2 = (await cardNames()).slice(0, 2);
  check('L-05', 'Alt + Left Arrow on a header moves that card one place back', same(order2, ['Single Dish', 'Chinese']), order2.join(' | '));
  await cardHead('Chinese').focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await cardHead('Pizza').click(); // fold one, to see it kept
  await pickStall(stallB.id);
  check('L-06', "Inside one stall the cards keep the cashier's order", same(await cardNames(), ['Chinese', 'Pizza', 'Big Menu']), (await cardNames()).join(' | '));
  await pickStall('all');
  check('L-07', 'Folding and moving cards never touches the cart', same(await cart(), cartBeforeLayout));
  const saved = await page.evaluate(() => localStorage.getItem('foodcourt.pos.cardLayout.v1'));
  check('L-08', 'The layout is saved on this PC', /chinese/.test(saved || '') && /pizza/.test(saved || ''), saved?.slice(0, 160));

  await page.getByTestId('pos-cards-fold-all').click();
  await page.waitForTimeout(150);
  const foldedAll = await page.locator('[data-category-card][data-collapsed="true"]').count();
  check('L-09', 'Fold all folds every card on screen to its name (100+ cards stay quick to scan)', foldedAll === totalCards && (await page.locator('[data-menu-item]').count()) === 0, `${foldedAll} folded`);
  await shot('14-all-folded');
  await page.getByTestId('pos-cards-fold-all').click();
  check('L-10', 'Open all brings every card back', (await page.locator('[data-category-card][data-collapsed="true"]').count()) === 0);
  await page.getByTestId('pos-cards-reset').click();
  await page.waitForTimeout(100);
  check('L-11', 'Reset puts the menu order back and opens every card', (await cardNames())[0] === 'Single Dish' && (await card('Pizza').getAttribute('data-collapsed')) === 'false' && (await page.getByTestId('pos-cards-reset').count()) === 0);
  // Leave a layout behind to check it survives a restart at the end
  await cardHead('Chinese').dragTo(card('Single Dish'), { targetPosition: { x: 10, y: 40 } });
  await cardHead('Big Menu').click();

  // Window sizes
  for (const [w, h] of [[1920, 1080], [1280, 720], [1093, 614], [800, 560]]) {
    await resize(w, h);
    const m = await page.evaluate(() => {
      const grid = document.querySelector('[data-testid="pos-category-cards"]');
      const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
      const first = grid.querySelector('[data-category-card]').getBoundingClientRect();
      return { innerWidth, cols, cardWidth: Math.round(first.width), pageOverflow: document.documentElement.scrollWidth > innerWidth };
    });
    const shell = await page.evaluate(() => ({ sidebar: Math.round(document.querySelector('aside').getBoundingClientRect().width), cart: Math.round(document.querySelector('[aria-label="Dining table"]')?.closest('.shrink-0')?.getBoundingClientRect().width ?? 0), cartLines: Math.round(document.querySelector('[data-testid="pos-cart-lines"]').getBoundingClientRect().height), placeVisible: (() => { const b = [...document.querySelectorAll('button')].find((x) => /Place Order/.test(x.textContent)); const r = b?.getBoundingClientRect(); return !!r && r.bottom <= innerHeight && r.right <= innerWidth; })() }));
    check(`W-${w}`, `${w}x${h}: window really is that size, no sideways page scroll, cards usable, Place Order on screen`, Math.abs(m.innerWidth - w) <= 2 && !m.pageOverflow && m.cardWidth >= 250 && m.cols >= 1 && shell.placeVisible && shell.cartLines >= 140, JSON.stringify({ ...m, ...shell }));
    await shot(`10-window-${w}x${h}`);
  }
  await resize(1440, 900);

  // ------------------------------------------------------------------ order: kitchen tickets per stall
  await page.selectOption('select[aria-label="Dining table"]', String(table.id));
  await page.keyboard.press('F8');
  const notice = page.getByText(/sent to 3 stall kitchen/);
  await notice.waitFor({ timeout: 20000 });
  const orderNumber = /Order (\S+) sent/.exec(await notice.innerText())[1];
  await shot('11-order-placed');
  check('O-01', 'After F8 the cart is empty and the cards are still there', (await cart()).length === 0 && (await cardNames()).length === totalCards);

  const orderId = (await api(owner, 'GET', `/orders?search=${orderNumber}`)).data.data[0].id;
  const order = (await api(owner, 'GET', `/orders/${orderId}`)).data;
  const got = order.items.map((i) => `${i.item_name}|${i.stall_id}|${Number(i.quantity)}`).sort();
  const want = [
    `Cheese Pizza|${stallA.id}|3`, `Cheese Pizza|${stallB.id}|1`, `Chicken Biryani|${stallA.id}|1`, `Veg Noodles|${stallB.id}|1`, `${LONG_DISH}|${stallC.id}|1`,
  ].sort();
  check('O-02', 'Every order item keeps its own dish\'s stall and quantity', same(got, want), got.join(' ; '));
  const ticketStalls = order.kitchen_tickets.map((t) => t.stall_id).sort((a, b) => a - b);
  check('O-03', 'One kitchen ticket per stall (3)', same(ticketStalls, [stallA.id, stallB.id, stallC.id].sort((a, b) => a - b)), ticketStalls.join());
  const expectSubtotal = 180 * 3 + 190 + 180 + 120 + 320;
  check('O-04', 'Server priced the bill from its own menu prices', Number(order.subtotal) === expectSubtotal, `${order.subtotal} vs ${expectSubtotal}`);

  for (const item of order.items) await api(owner, 'PATCH', `/ticket-items/${item.id}/status`, { status: 'served' });
  const opened = (await api(owner, 'GET', `/billing/orders/${orderId}/open`)).data;
  const payable = Number(opened.remaining_balance ?? opened.total_amount);
  await api(owner, 'POST', '/billing/pay', { order_id: orderId, payment_method: 'cash', amount: payable, expected_balance: payable, cash_tendered: payable });
  const rows = (await api(owner, 'GET', '/reports/stall-sales')).data.stalls_performance;
  const salesOf = (id) => Number(rows.find((r) => r.stall_id === id)?.total_revenue);
  check('O-05', 'Bill settles and stall-wise sales credit each stall with its own dishes', salesOf(stallA.id) === 720 && salesOf(stallB.id) === 310 && salesOf(stallC.id) === 320, JSON.stringify(rows.map((r) => [r.stall_id, r.total_revenue])));

  // The card layout survives closing and reopening the app
  await app.close();
  await launch();
  await page.waitForSelector('[data-category-card], input[type=email]', { timeout: 90000 });
  if (await page.locator('input[type=email]').count()) {
    await page.fill('input[type=email]', 'cards.cashier@example.com');
    await page.fill('input[type=password]', STAFF_PW);
    await page.click('button[type=submit]');
    await finishSignIn();
  }
  await page.locator('[data-category-card]').first().waitFor({ timeout: 60000 });
  check('L-12', "After a restart the cashier's card order and folded cards are still there", (await cardNames())[0] === 'Chinese' && (await card('Big Menu').getAttribute('data-collapsed')) === 'true', (await cardNames()).slice(0, 3).join(' | '));
  await shot('15-layout-after-restart');

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
