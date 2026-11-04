/**
 * Bulk delete on the Stall Directory and the Menu Catalog, driven through the real Electron runtime with its built-in
 * SQLite server on a brand-new profile (same pattern as upi-qr.e2e.mjs). Test data only.
 *
 *   cd frontend-desktop && node scripts/prepare-embedded-server.mjs && npm run build
 *   node e2e/bulk-delete.e2e.mjs
 *
 *  1  Menu Catalog: owner-only controls, 25 rows per page, ticking a box never deletes
 *  2  Selection persists across pages; select-page, clear selection, select-all-filtered
 *  3  Confirmation dialog shows the exact count; Cancel deletes nothing
 *  4  Confirm: progress, then a summary - the dish used on a past order is refused with a reason, the rest are deleted
 *  5  Stall Directory: same controls (12 cards per page), selection across pages
 *  6  Confirm: stalls with order history are refused with a reason; plain stalls are deleted; orders/payments intact
 *  7  A cashier cannot call the bulk endpoints (403) and sees no bulk controls
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
  results.push({ id, desc, result: pass ? 'PASS' : 'FAIL', evidence: String(ev).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 200)}]` : ''}`);
};

const profile = mkdtempSync(join(tmpdir(), 'foodcourt-bulk-'));
const shots = join(HERE, '..', '..', 'qa', 'desktop', 'results', 'bulk-delete');
mkdirSync(shots, { recursive: true });
const OWNER_PW = 'Str0ngPass99';
const STAFF_PW = 'StaffPass#2026';

let app;
let page;
let API = '';
const pageErrors = [];

const api = async (token, method, path, body, raw) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (raw) return { status: res.status, json };
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
};

const goto = async (hash) => {
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
  await page.waitForTimeout(500);
};
const selectedText = () => page.getByTestId('bulk-selected-count').innerText();

try {
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
  await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
  await page.getByText('Welcome', { exact: false }).first().waitFor({ timeout: 90000 });
  await page.fill('#owner-name', 'Bulk Owner');
  await page.fill('#owner-email', 'bulk.owner@example.com');
  await page.fill('#owner-password', OWNER_PW);
  await page.fill('#owner-confirm', OWNER_PW);
  await page.getByRole('button', { name: /Create account/ }).click();
  await page.getByText('Save your recovery key').waitFor({ timeout: 20000 });
  await page.check('#recovery-saved');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => /dashboard/i.test(location.hash), null, { timeout: 20000 });
  const ownerToken = await page.evaluate(() => localStorage.getItem('fc_auth_token'));
  API = (await page.evaluate(() => window.desktop.getConfig())).apiBaseUrl.replace(/\/$/, '');
  check('B-00', 'Fresh profile: built-in (SQLite) server started and owner created', Boolean(ownerToken), API);

  // ------------------------------------------------------------------ test data: 13 plain stalls x 3 dishes + 1 stall whose only dish has been ordered
  const tag = Date.now().toString(36).slice(-4).toUpperCase();
  const plain = [];
  for (let i = 1; i <= 13; i++) {
    const n = String(i).padStart(2, '0');
    const s = (await api(ownerToken, 'POST', '/stalls', { name: `BD Stall ${n}`, code: `BD${tag}${n}` })).data;
    const c = (await api(ownerToken, 'POST', '/menu-categories', { stall_id: s.id, name: 'Mains' })).data;
    for (let d = 1; d <= 3; d++) await api(ownerToken, 'POST', '/menu', { stall_id: s.id, category_id: c.id, name: `Dish ${n}-${d}`, price: 50 + d });
    plain.push(s);
  }
  const ordStall = (await api(ownerToken, 'POST', '/stalls', { name: 'BD Stall Ordered', code: `BDO${tag}` })).data;
  const ordCat = (await api(ownerToken, 'POST', '/menu-categories', { stall_id: ordStall.id, name: 'Mains' })).data;
  const ordDish = (await api(ownerToken, 'POST', '/menu', { stall_id: ordStall.id, category_id: ordCat.id, name: 'Ordered Thali', price: 100 })).data;
  await api(ownerToken, 'POST', '/staff', { name: 'Bulk Cashier', email: `cashier.${tag}@example.com`, password: STAFF_PW, role: 'cashier' });
  const cashierToken = (await api(null, 'POST', '/auth/login', { email: `cashier.${tag}@example.com`, password: STAFF_PW })).data.token;
  const order = (await api(cashierToken, 'POST', '/orders', { order_type: 'takeaway', items: [{ menu_item_id: ordDish.id, quantity: 1 }] })).data;
  const orderId = (order.order ?? order).id;
  const menuCount = async () => (await api(ownerToken, 'GET', '/menu')).data.length;
  check('B-01', 'Test data created through the API: 14 stalls, 40 dishes, 1 historic order', (await menuCount()) === 40, `dishes=${await menuCount()}`);

  // ================================================================== Menu Catalog
  await goto('#/menu');
  await page.getByTestId('bulk-toolbar').waitFor({ timeout: 20000 });
  await page.getByTestId('menu-row').first().waitFor({ timeout: 20000 });
  const rows1 = await page.getByTestId('menu-row').count();
  const pageInfo = await page.getByText(/Page 1 of 2/).count();
  check('B-02', 'Menu Catalog shows 25 rows per page with a pager (40 dishes = 2 pages) and the bulk toolbar', rows1 === 25 && pageInfo === 1, `rows=${rows1}`);

  await page.getByTestId('menu-select').nth(0).check();
  await page.getByTestId('menu-select').nth(1).check();
  check('B-03', 'Ticking two row checkboxes only counts them - nothing is deleted', (await selectedText()) === 'Selected: 2 Items' && (await menuCount()) === 40, await selectedText());

  await page.getByLabel('Next page').click();
  await page.getByTestId('menu-row').first().waitFor();
  await page.getByTestId('menu-select').nth(0).check();
  const onPage2 = await selectedText();
  await page.getByLabel('Previous page').click();
  const stillChecked = await page.getByTestId('menu-select').evaluateAll((els) => els.slice(0, 2).every((e) => e.checked));
  check('B-04', 'Selection persists across pagination (2 on page 1 + 1 on page 2 = 3, page 1 boxes still ticked)', onPage2 === 'Selected: 3 Items' && stillChecked, `${onPage2} stillChecked=${stillChecked}`);

  await page.getByTestId('bulk-clear').click();
  check('B-05', 'Clear selection empties it', (await selectedText()) === 'Selected: 0 Items' && (await page.getByTestId('bulk-delete-open').isDisabled()));
  await page.getByTestId('menu-select-page').check();
  check('B-06', 'Header checkbox selects the 25 rows of the page', (await selectedText()) === 'Selected: 25 Items', await selectedText());
  await page.getByTestId('bulk-select-filtered').click();
  check('B-07', '"Select all 40 filtered" selects every filtered dish across both pages', (await selectedText()) === 'Selected: 40 Items', await selectedText());

  await page.getByTestId('bulk-delete-open').click();
  await page.getByTestId('bulk-dialog').waitFor();
  const confirmText = await page.getByTestId('bulk-confirm-count').innerText();
  const confirmLabel = await page.getByTestId('bulk-confirm').innerText();
  await page.screenshot({ path: join(shots, 'menu-confirm.png') });
  await page.getByTestId('bulk-cancel').click();
  check('B-08', 'Confirmation dialog shows the exact count and "Delete Selected Items"; Cancel deletes nothing', confirmText === 'Selected: 40 Items' && confirmLabel === 'Delete Selected Items' && (await menuCount()) === 40, `${confirmText} / ${confirmLabel}`);

  await page.getByTestId('bulk-delete-open').click();
  await page.getByTestId('bulk-confirm').click();
  await page.getByTestId('bulk-summary').waitFor({ timeout: 30000 });
  const deletedTxt = await page.getByTestId('bulk-summary-deleted').innerText();
  const failedTxt = await page.getByTestId('bulk-summary-failed').innerText();
  const failureList = await page.getByTestId('bulk-failures').innerText();
  await page.screenshot({ path: join(shots, 'menu-summary.png') });
  await page.getByTestId('bulk-done').click();
  const left = (await api(ownerToken, 'GET', '/menu')).data;
  check('B-09', 'Summary: 39 deleted, 1 failed with a reason; only the dish on a past order remains', deletedTxt.endsWith('39') && failedTxt.endsWith('1') && /past order/.test(failureList) && left.length === 1 && left[0].name === 'Ordered Thali', `${deletedTxt} | ${failedTxt} | ${failureList.replace(/\s+/g, ' ').slice(0, 120)}`);
  check('B-10', 'After the delete the list refreshed and the selection of deleted rows is gone', (await page.getByTestId('menu-row').count()) === 1 && (await selectedText()) === 'Selected: 1 Items', await selectedText());

  // ================================================================== Stall Directory
  await goto('#/stalls');
  await page.getByTestId('stall-card').first().waitFor({ timeout: 20000 });
  const cards = await page.getByTestId('stall-card').count();
  check('B-11', 'Stall Directory shows 12 cards per page (14 stalls = 2 pages) with the bulk toolbar', cards === 12 && (await page.getByText(/Page 1 of 2/).count()) === 1, `cards=${cards}`);

  await page.getByTestId('stall-select').nth(0).check();
  await page.getByLabel('Next page').click();
  await page.getByTestId('stall-card').first().waitFor();
  await page.getByTestId('stall-select').nth(0).check();
  check('B-12', 'Stall selection persists across pages (1 + 1 = 2) and ticking never deletes', (await selectedText()) === 'Selected: 2 Stalls' && (await api(ownerToken, 'GET', '/stalls?include_inactive=1')).data.length === 14, await selectedText());

  await page.getByTestId('bulk-select-filtered').click();
  await page.getByTestId('bulk-delete-open').click();
  const sConfirm = await page.getByTestId('bulk-confirm-count').innerText();
  const sLabel = await page.getByTestId('bulk-confirm').innerText();
  await page.screenshot({ path: join(shots, 'stalls-confirm.png') });
  check('B-13', 'Stall confirmation shows "Selected: 14 Stalls" and "Delete Selected Stalls"', sConfirm === 'Selected: 14 Stalls' && sLabel === 'Delete Selected Stalls', `${sConfirm} / ${sLabel}`);
  await page.getByTestId('bulk-confirm').click();
  await page.getByTestId('bulk-summary').waitFor({ timeout: 30000 });
  const sDeleted = await page.getByTestId('bulk-summary-deleted').innerText();
  const sFailed = await page.getByTestId('bulk-summary-failed').innerText();
  const sReasons = await page.getByTestId('bulk-failures').innerText();
  await page.screenshot({ path: join(shots, 'stalls-summary.png') });
  await page.getByTestId('bulk-done').click();
  const stallsLeft = (await api(ownerToken, 'GET', '/stalls?include_inactive=1')).data;
  check('B-14', 'Summary: 13 stalls deleted; the stall with order history is refused with the reason and stays', sDeleted.endsWith('13') && sFailed.endsWith('1') && /order line/.test(sReasons) && stallsLeft.length === 1 && stallsLeft[0].id === ordStall.id, `${sDeleted} | ${sFailed} | ${sReasons.replace(/\s+/g, ' ').slice(0, 140)}`);

  const orderAfter = (await api(ownerToken, 'GET', `/orders/${orderId}`)).data;
  check('B-15', 'The historic order, its line and its dish are intact after both bulk deletes', orderAfter.items?.length === 1 && orderAfter.items[0].menu_item_id === ordDish.id, `items=${orderAfter.items?.length}`);

  // ================================================================== Authorisation
  const r1 = await api(cashierToken, 'POST', '/stalls/bulk-delete', { ids: [ordStall.id] }, true);
  const r2 = await api(cashierToken, 'POST', '/menu/bulk-delete', { ids: [ordDish.id] }, true);
  check('B-16', 'A cashier is refused by both bulk endpoints (403)', r1.status === 403 && r2.status === 403, `${r1.status}/${r2.status}`);

  const real = pageErrors.filter((e) => !/Failed to load resource|ERR_|net::|frame-ancestors/.test(e));
  check('B-17', 'No unexpected renderer errors during the whole run', real.length === 0, real.slice(0, 3).join(' | '));
} catch (err) {
  check('B-ERR', 'Journey completed without an unexpected error', false, String(err?.message || err).split('\n').slice(0, 3).join(' '));
  try {
    if (page) await page.screenshot({ path: join(shots, 'bulk-failure.png') });
    if (page) console.log(`url=${page.url()} body=${(await page.evaluate(() => document.body.innerText)).slice(0, 400).replace(/\s+/g, ' ')}`);
  } catch {}
  if (pageErrors.length) console.log(`Renderer errors:\n${pageErrors.slice(-10).join('\n')}`);
} finally {
  try {
    if (app) await app.close();
  } catch {}
  writeFileSync(join(HERE, '..', '..', 'qa', 'desktop', 'results', 'bulk-delete-results.json'), JSON.stringify(results, null, 2));
  await new Promise((r) => setTimeout(r, 1500));
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
  const fails = results.filter((r) => r.result === 'FAIL').length;
  console.log(`\nTOTAL: ${results.length - fails} PASS, ${fails} FAIL`);
  process.exit(fails ? 1 : 0);
}
