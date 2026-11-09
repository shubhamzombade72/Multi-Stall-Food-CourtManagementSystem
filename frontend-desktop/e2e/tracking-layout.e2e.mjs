/**
 * Orders & Table Tracking layout with real orders of 1, 10, 20 and 55 items, short and very long dish names, three stalls,
 * at four desktop window sizes. Measures every item row in the real renderer: the full name is shown (no ellipsis, nothing
 * clipped), name, quantity, status and action never overlap, and the page never scrolls sideways. Then the fulfilment
 * controls are used once each.
 *
 *   cd frontend-desktop && pnpm build && pnpm prepare:server
 *   node e2e/tracking-layout.e2e.mjs
 *   PACKAGED_EXE=<win-unpacked exe> node e2e/tracking-layout.e2e.mjs
 */
import electronPath from 'electron';
import { _electron as electron } from 'playwright-core';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..');
const shots = join(HERE, '..', '..', 'qa', 'desktop', 'results', 'tracking-layout');
mkdirSync(shots, { recursive: true });
const root = mkdtempSync(join(tmpdir(), 'foodcourt-tracking-layout-'));
const results = [];
const check = (id, desc, pass, ev = '') => {
  results.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 260)}]` : ''}`);
};

const DISHES = {
  'Tandoor Tales': ['Naan', 'Paneer Tikka', 'Hyderabadi Dum Chicken Biryani with Mirchi Ka Salan and Boondi Raita', 'Special Punjabi Thali with Dal Makhani, Shahi Paneer, Butter Roti, Jeera Rice, Salad and Gulab Jamun'],
  'Dosa Junction': ['Idli', 'Masala Dosa', 'Mysore Masala Dosa with Coconut Chutney, Tomato Chutney and Hot Sambar', 'South Indian Mini Tiffin with Idli, Vada, Mini Dosa, Pongal, Kesari and Filter Coffee'],
  'Juice Junction': ['Lassi', 'Cold Coffee', 'Royal Falooda with Rose Syrup, Basil Seeds, Vermicelli and Kulfi Scoop', 'Fresh Seasonal Fruit Juice Platter with Mosambi, Watermelon, Pineapple and Pomegranate'],
};
const WIDTHS = [[1920, 1080], [1366, 768], [1280, 720], [1024, 700]];

let app;
let page;
let API = '';
const pageErrors = [];
const api = async (token, method, path, body) => {
  const res = await fetch(`${API}${path}`, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
};

/** Every visible item row, measured in the page. */
const measure = () => page.evaluate(() => {
  const rect = (el) => (el ? el.getBoundingClientRect() : null);
  const overlap = (a, b) => a && b && a.width > 0 && b.width > 0 && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const rows = [...document.querySelectorAll('[data-testid^="item-row-"]')];
  const problems = [];
  let longest = 0;
  for (const row of rows) {
    const id = row.dataset.testid.slice('item-row-'.length);
    // Falls back to the older row structure, so the same measurement can be taken before and after a change
    const name = row.querySelector(`[data-testid="item-name-${id}"]`) || row.querySelector('p');
    const qty = row.querySelector(`[data-testid="item-qty-${id}"]`);
    const controls = row.querySelector(`[data-testid="item-controls-${id}"]`) || row.lastElementChild;
    const status = row.querySelector(`[data-testid="item-status-${id}"]`);
    const action = row.querySelector(`[data-testid="item-action-${id}"]`);
    const card = row.closest('[data-testid^="order-card-"]');
    longest = Math.max(longest, name.textContent.length);
    const style = getComputedStyle(name);
    if (style.textOverflow === 'ellipsis' || name.scrollWidth > name.clientWidth + 1 || name.scrollHeight > name.clientHeight + 1) problems.push(`${id}: name clipped`);
    if (overlap(rect(name), rect(controls)) || overlap(rect(name), rect(qty)) || overlap(rect(qty), rect(controls))) problems.push(`${id}: overlap`);
    if (status && action && overlap(rect(status), rect(action))) problems.push(`${id}: status over action`);
    const c = rect(card);
    for (const [label, el] of [['status', status], ['action', action], ['name', name]]) {
      const r = rect(el);
      if (r && r.width > 0 && (r.right > c.right + 0.5 || r.left < c.left - 0.5)) problems.push(`${id}: ${label} outside card`);
    }
    if (action && action.getBoundingClientRect().width < 90) problems.push(`${id}: action narrower than usable`);
    if (status && status.scrollWidth > status.clientWidth + 1) problems.push(`${id}: status text squeezed`);
  }
  const doc = document.scrollingElement;
  return { rows: rows.length, problems, longest, pageScrollsSideways: doc.scrollWidth > window.innerWidth + 1, cards: document.querySelectorAll('[data-testid^="order-card-"]').length };
});

try {
  const target = process.env.PACKAGED_EXE ? { executablePath: process.env.PACKAGED_EXE, args: [] } : { executablePath: electronPath, args: [process.env.PACKAGED_ASAR || APP_DIR] };
  const env = { ...process.env, LOCALAPPDATA: join(root, 'local'), FOODCOURT_USER_DATA_DIR: join(root, 'profile'), FOODCOURT_UPDATE_NO_TASK: '1', FOODCOURT_UPDATE_FIRST_CHECK_MS: '86400000', FOODCOURT_SMOKE_TEST: '', FOODCOURT_PIN_LOCK: 'off', FOODCOURT_API_URL: '' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ ...target, env, timeout: 90000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
  // The built-in server may still be starting when the window first paints: wait until it answers
  const serverDeadline = Date.now() + 120000;
  while (Date.now() < serverDeadline) {
    const cfg = await page.evaluate(() => window.desktop?.getConfig?.()).catch(() => null);
    if (cfg?.apiBaseUrl) {
      API = cfg.apiBaseUrl.replace(/\/$/, '');
      const ready = await fetch(`${API}/setup/status`, { headers: { Accept: 'application/json' } }).then((r) => r.ok, () => false);
      if (ready) break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!API) throw new Error('The built-in server did not start');
  // Owner and data through the API first; the window signs in last, because a new sign-in replaces older tokens
  const OWNER = { name: 'Layout Owner', email: 'layout.owner@example.com', password: 'Str0ngPass99' };
  const setupRes = await fetch(`${API}/setup/owner`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(OWNER) });
  const token = (await setupRes.json()).data.token;
  const runtime = await app.evaluate(({ app: a }) => ({ packaged: a.isPackaged, version: a.getVersion() }));
  check('R-01', 'Runs in the desktop app with its built-in server', /^http:\/\/127\.0\.0\.1:\d+\/api$/.test(API), `packaged=${runtime.packaged} version=${runtime.version}`);

  // ---------------- stalls, dishes and orders of 1, 10, 20 and 55 items
  const menu = [];
  let n = 0;
  for (const [stallName, dishes] of Object.entries(DISHES)) {
    n += 1;
    const stall = (await api(token, 'POST', '/stalls', { name: stallName, code: `L${n}` })).data;
    const cat = (await api(token, 'POST', '/menu-categories', { stall_id: stall.id, name: `Menu ${n}` })).data;
    for (const name of dishes) menu.push((await api(token, 'POST', '/menu', { stall_id: stall.id, category_id: cat.id, name, price: 120 })).data);
  }
  const orderOf = async (count) => (await api(token, 'POST', '/orders', {
    order_type: 'takeaway', order_channel: 'cashier_pos', customer_name: `Layout ${count}`,
    items: Array.from({ length: count }, (_, i) => ({ menu_item_id: menu[(i * 5 + count) % menu.length].id, quantity: 1 + (i % 3) })),
  })).data;
  const orders = {};
  for (const count of [1, 10, 20, 55]) orders[count] = await orderOf(count);

  await page.reload();
  await page.waitForSelector('input[type=email]', { timeout: 60000 });
  await page.fill('input[type=email]', OWNER.email);
  await page.fill('input[type=password]', OWNER.password);
  await page.keyboard.press('Enter');
  // A packaged build asks each new user for a PIN first
  await page.waitForFunction(() => document.querySelector('#pin-new') || document.querySelector('aside nav'), null, { timeout: 30000 });
  if (await page.locator('#pin-new').count()) {
    const pin = '482915'.slice(0, Number(await page.getAttribute('#pin-new', 'maxlength')));
    await page.fill('#pin-new', pin);
    await page.fill('#pin-confirm', pin);
    await page.getByRole('button', { name: /Save PIN/ }).click();
    await page.waitForFunction(() => document.querySelector('aside nav'), null, { timeout: 30000 });
  }
  await page.evaluate(() => { location.hash = '#/tracking'; });
  await page.getByTestId('board-grid').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="item-row-"]').length > 0, null, { timeout: 30000 });

  // ---------------- every width
  for (const [w, h] of WIDTHS) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(700);
    const m = await measure().catch((err) => ({ rows: 0, problems: [`measure failed: ${err.message.split('\n')[0]}`], longest: 0, pageScrollsSideways: false, cards: 0 }));
    check(`L-${w}`, `${w}x${h}: every dish name complete and wrapped, nothing overlaps or leaves its card, no sideways scroll`, m.rows > 0 && m.problems.length === 0 && !m.pageScrollsSideways, `${m.rows} rows in ${m.cards} cards, longest name ${m.longest} chars; ${m.problems.slice(0, 6).join('; ') || 'no problems'}${m.pageScrollsSideways ? '; PAGE SCROLLS SIDEWAYS' : ''}`);
    await page.screenshot({ path: join(shots, `tracking-${w}x${h}.png`) });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(500);

  // The longest names are shown in full, word for word
  const longest = menu.map((d) => d.name).sort((a, b) => b.length - a.length)[0];
  const shown = await page.locator('[data-testid^="item-name-"]', { hasText: longest }).first().innerText().catch(() => '');
  check('L-FULL', 'The longest dish name appears complete, with no "..."', shown.trim() === longest && !/…|\.\.\./.test(shown), `${longest.length} chars`);
  const cardRows = await page.evaluate((id) => document.querySelectorAll(`[data-testid="order-card-${id}"] [data-testid^="item-row-"]`).length, orders[55].id);
  check('L-55', 'The 55-item order shows all of its items', cardRows === 55, cardRows);
  const stalls = await page.evaluate((id) => document.querySelector(`[data-testid="order-details-${id}"]`)?.innerText || '', orders[20].id);
  check('L-STALLS', 'A multi-stall order lists its stalls in the card details without overflowing', stalls.length > 0 && await page.evaluate((id) => { const el = document.querySelector(`[data-testid="order-details-${id}"]`); return el.scrollWidth <= el.clientWidth + 1; }, orders[20].id), stalls.replace(/\s+/g, ' ').slice(0, 160));

  // ---------------- the controls still work
  const card10 = page.getByTestId(`order-card-${orders[10].id}`);
  const firstRow = card10.locator('[data-testid^="item-row-"]').first();
  const itemId = (await firstRow.getAttribute('data-testid')).slice('item-row-'.length);
  const qtyBefore = await firstRow.getByTestId(`item-qty-${itemId}`).innerText();
  await page.getByTestId(`qty-increase-${itemId}`).click();
  const qtyAfter = await page.waitForFunction(([id, before]) => { const t = document.querySelector(`[data-testid="item-qty-${id}"]`)?.innerText; return t && t !== before ? t : null; }, [itemId, qtyBefore], { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => qtyBefore);
  check('F-QTY', 'Quantity + still changes the quantity', qtyAfter !== qtyBefore, `${qtyBefore.trim()} -> ${String(qtyAfter).trim()}`);

  const action = page.getByTestId(`item-action-${itemId}`);
  if (await action.count()) {
    const before = (await page.getByTestId(`item-status-${itemId}`).innerText()).trim();
    await action.click();
    const after = await page.waitForFunction(([id, b]) => { const t = document.querySelector(`[data-testid="item-status-${id}"]`)?.innerText.trim(); return t && t !== b ? t : null; }, [itemId, before], { timeout: 15000 }).then((x) => x.jsonValue()).catch(() => before);
    check('F-ACTION', 'The item action button still moves the item on (Cooking -> Ready -> Served)', after !== before, `${before} -> ${after}`);
  } else {
    check('F-ACTION', 'The item action button still moves the item on (Cooking -> Ready -> Served)', false, 'no action button on this item');
  }

  await page.getByTestId(`add-item-${orders[10].id}`).click();
  const addOpen = await page.getByRole('dialog').first().waitFor({ timeout: 8000 }).then(() => true, () => false);
  check('F-ADD', 'Add Item still opens its dialog', addOpen);
  await page.screenshot({ path: join(shots, 'tracking-add-item.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  if (await page.getByRole('dialog').count()) await page.getByRole('button', { name: /Cancel|Close/ }).first().click().catch(() => undefined);

  await page.getByTestId(`serve-all-${orders[1].id}`).click();
  const served = await page.waitForFunction((id) => !document.querySelector(`[data-testid="serve-all-${id}"]`), orders[1].id, { timeout: 15000 }).then(() => true, () => false);
  check('F-SERVE-ALL', 'Serve All Remaining still serves the order', served);
  await page.screenshot({ path: join(shots, 'tracking-after-actions.png') });

  check('Z-01', 'No uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  console.log(`[abort] ${err?.stack}\n[abort] cause: ${err?.cause?.code || ''} ${err?.cause?.message || ''}`);
  check('ABORT', 'The script stopped early', false, err?.stack || err);
} finally {
  if (app) await app.close().catch(() => undefined);
  await new Promise((r) => setTimeout(r, 1500));
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
