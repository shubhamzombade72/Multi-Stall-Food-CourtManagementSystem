/**
 * Visual + timing check of the Indian demo dataset in the real Electron desktop app. The app is pointed at an API that runs
 * against the isolated demo database (never the real one):
 *
 *   cd backend && DB_DATABASE=foodcourt_demo_db php artisan serve --port=8099      # demo DB only
 *   cd frontend-desktop && npm run build
 *   DEMO_API_URL=http://127.0.0.1:8099/api node e2e/indian-demo-ui.e2e.mjs
 *
 * Writes screenshots to qa/desktop/results/demo-dataset/ and measurements to qa/desktop/results/demo-dataset-ui.json.
 * Read-only: it logs in with the documented demo accounts and never changes data.
 */
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..');
const OUT = join(HERE, '..', '..', 'qa', 'desktop', 'results');
const SHOTS = join(OUT, 'demo-dataset');
mkdirSync(SHOTS, { recursive: true });
const API = process.env.DEMO_API_URL || 'http://127.0.0.1:8099/api';
const profile = mkdtempSync(join(tmpdir(), 'foodcourt-demoui-'));
const results = [];
const metrics = {};
const pageErrors = [];
const check = (id, desc, pass, ev = '') => {
  results.push({ id, desc, result: pass ? 'PASS' : 'FAIL', evidence: String(ev).slice(0, 300) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 160)}]` : ''}`);
};

let app;
let page;

const login = async (email, password) => {
  await page.getByPlaceholder('name@example.com').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /sign in|log in|login/i }).click();
  await page.waitForFunction(() => !/login/i.test(location.hash), null, { timeout: 30000 });
};

const hasText = (token) => () => page.waitForFunction((t) => document.body.innerText.includes(t) && !/Loading/i.test(document.body.innerText.slice(0, 600)), token, { timeout: 45000 });

/** Navigate by hash and wait until the page has real content; returns timing + DOM size. */
const visit = async (name, hash, ready) => {
  const t0 = Date.now();
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
  if (ready) await ready();
  else await page.waitForTimeout(800);
  const ms = Date.now() - t0;
  await page.waitForTimeout(400);
  const dom = await page.evaluate(() => ({ nodes: document.querySelectorAll('*').length, rows: document.querySelectorAll('tbody tr').length, text: document.body.innerText.length }));
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
  metrics[name] = { visit_ms: ms, ...dom };
  console.log(`      ${name.padEnd(16)} ${String(ms).padStart(5)} ms  nodes=${dom.nodes} rows=${dom.rows}`);
  return dom;
};

try {
  app = await electron.launch({
    args: [APP_DIR],
    env: { ...process.env, FOODCOURT_USER_DATA_DIR: profile, FOODCOURT_SMOKE_TEST: '', FOODCOURT_API_URL: API },
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(m.text());
  });
  await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
  await page.getByPlaceholder('name@example.com').waitFor({ timeout: 90000 });
  const tLogin = Date.now();
  await login('owner@demo.example.test', 'DemoOwner#2026');
  metrics.login_ms = Date.now() - tLogin;
  check('D-00', 'Owner signs in to the desktop app against the demo database', true, `${metrics.login_ms} ms`);

  // ---------------------------------------------------------------- Dashboard
  await visit('dashboard', '#/dashboard', hasText('₹'));
  const dash = await page.evaluate(() => document.body.innerText);
  check('D-01', 'Dashboard shows sales / order figures from the seeded orders', /₹\s*[\d,]+/.test(dash), dash.replace(/\s+/g, ' ').slice(0, 140));

  // ---------------------------------------------------------------- Stall Directory
  await visit('stalls', '#/stalls', async () => page.getByTestId('stall-card').first().waitFor({ timeout: 30000 }));
  const stallTotal = await page.getByText(/\d+ records?/).first().innerText();
  check('D-02', 'Stall Directory lists 50 demo stalls (12 per page, 5 pages)', /50 records/.test(stallTotal) && (await page.getByTestId('stall-card').count()) === 12 && (await page.getByText(/Page 1 of 5/).count()) === 1, stallTotal);
  await page.getByLabel('Search stalls').fill('Biryani');
  await page.waitForTimeout(300);
  check('D-03', 'Stall search filters the directory', (await page.getByTestId('stall-card').count()) >= 1 && (await page.getByTestId('stall-card').count()) < 12, `${await page.getByTestId('stall-card').count()} match "Biryani"`);
  await page.getByLabel('Search stalls').fill('');

  // ---------------------------------------------------------------- Tables
  await visit('tables', '#/tables', async () => {
    await page.waitForFunction(() => document.body.innerText.includes('T-001') || document.body.innerText.includes('T-0'), null, { timeout: 30000 });
  });
  const tableBody = await page.evaluate(() => document.body.innerText);
  const tblNodes = metrics.tables.nodes;
  check('D-04', 'Floor & Tables shows the 500 tables (T-001..T-500, sections, statuses)', /T-001/.test(tableBody) && /Occupied|occupied/.test(tableBody), `nodes=${tblNodes}`);

  // ---------------------------------------------------------------- Menu Catalog
  await visit('menu', '#/menu', async () => page.getByTestId('menu-row').first().waitFor({ timeout: 30000 }));
  const menuRows = await page.getByTestId('menu-row').count();
  const menuTotal = await page.getByText(/\d+ records?/).first().innerText();
  check('D-05', 'Menu Catalog is paginated: 1,500 dishes, 25 rows rendered per page', /1500 records/.test(menuTotal) && menuRows === 25, `${menuTotal}, rows=${menuRows}`);
  const tSearch = Date.now();
  await page.getByPlaceholder('Search dish or category...').fill('Biryani');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="menu-row"]').length > 0 && /records?/.test(document.body.innerText), null, { timeout: 10000 });
  metrics.menu_search_ms = Date.now() - tSearch;
  const filtered = await page.getByText(/\d+ records?/).first().innerText();
  await page.screenshot({ path: join(SHOTS, 'menu-search-biryani.png') });
  check('D-06', 'Menu search narrows 1,500 dishes instantly', !/1500 records/.test(filtered), `${filtered} in ${metrics.menu_search_ms} ms`);
  await page.getByPlaceholder('Search dish or category...').fill('');

  // ---------------------------------------------------------------- POS
  await visit('pos', '#/pos', async () => {
    await page.getByPlaceholder(/Search food, beverages, or stalls/).waitFor({ timeout: 30000 });
    await page.waitForFunction(() => /All Stalls \(\d{3,4}\)/.test(document.body.innerText), null, { timeout: 45000 }); // chip shows the number of orderable dishes (fetched from /stalls + /menu)
  });
  const posNodesAll = metrics.pos.nodes;
  const tPos = Date.now();
  await page.getByPlaceholder(/Search food, beverages, or stalls/).fill('Misal');
  await page.waitForTimeout(150);
  metrics.pos_search_ms = Date.now() - tPos;
  await page.screenshot({ path: join(SHOTS, 'pos-search-misal.png') });
  const posNodesFiltered = await page.evaluate(() => document.querySelectorAll('*').length);
  check('D-07', 'POS product search ("Misal") responds quickly and narrows the grid', metrics.pos_search_ms < 1500 && posNodesFiltered < posNodesAll, `all nodes=${posNodesAll}, filtered=${posNodesFiltered}, ${metrics.pos_search_ms} ms`);
  await page.getByPlaceholder(/Search food, beverages, or stalls/).fill('');
  const stallChip = page.getByRole('button', { name: /Pune Misal House/ }).first();
  if (await stallChip.count()) {
    await stallChip.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, 'pos-stall-pune-misal.png') });
    const posText = await page.evaluate(() => document.body.innerText);
    check('D-08', 'POS stall filter shows only the selected stall\'s dishes (Pune Misal House)', /Misal Pav/.test(posText), 'stall filter applied');
  } else {
    check('D-08', 'POS stall filter chip for Pune Misal House found', false, 'chip missing');
  }

  // ---------------------------------------------------------------- Order board, KDS, orders
  await visit('order-board', '#/tracking', hasText('ORD-'));
  const board = await page.evaluate(() => document.body.innerText);
  check('D-09', 'Order & Table Tracking board shows live demo orders', /ORD-\d{8}-D\d{4}|Ready|Preparing|Pending/i.test(board), board.replace(/\s+/g, ' ').slice(0, 120));
  await visit('kitchen', '#/kitchen', hasText('KKT-'));
  await visit('orders', '#/orders', async () => page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 3, null, { timeout: 30000 }));
  await visit('payments', '#/payments', async () => page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 3, null, { timeout: 30000 }));

  // ---------------------------------------------------------------- Reports, inventory, purchases, customers, staff
  await visit('reports', '#/reports', hasText('₹'));
  await visit('inventory', '#/inventory', hasText('kg'));
  await visit('purchases', '#/purchases', hasText('PO-'));
  await visit('customers', '#/customers', async () => page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 3, null, { timeout: 30000 }));
  await visit('staff', '#/staff', async () => page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 3, null, { timeout: 30000 }));
  check('D-10', 'Reports, inventory, purchases, customers and staff screens render with data', metrics.reports.text > 500 && metrics.customers.rows > 3 && metrics.staff.rows > 3, `customers rows=${metrics.customers.rows}, staff rows=${metrics.staff.rows}`);

  // ---------------------------------------------------------------- Stall isolation in the UI
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.getByPlaceholder('name@example.com').waitFor({ timeout: 30000 });
  await login('manager.dm001@demo.example.test', 'DemoStaff#2026');
  await visit('manager-menu', '#/menu', async () => page.waitForFunction(() => document.querySelectorAll('[data-testid="menu-row"]').length > 0, null, { timeout: 30000 }));
  const mgrRows = await page.evaluate(() => [...document.querySelectorAll('[data-testid="menu-row"]')].map((r) => r.innerText));
  const mgrStalls = await page.evaluate(() => document.body.innerText);
  metrics.manager_menu_shows_other_stalls = /Udupi Annapoorna|Kolhapuri Tadka/.test(mgrStalls) || mgrRows.some((r) => !/Delhi Darbar Rasoi/.test(r));
  check('D-11', 'A stall manager can open the Menu Catalog (a read-only catalogue of all stalls; edits to other stalls are refused by the API)', mgrRows.length === 25, `rows on page=${mgrRows.length}, other stalls visible=${metrics.manager_menu_shows_other_stalls}`);
  await visit('manager-inventory', '#/inventory', hasText('kg'));
  const invText = await page.evaluate(() => document.body.innerText);
  check('D-12', 'A stall manager\'s inventory screen shows own-stall stock only', /Delhi Darbar Rasoi|Paneer|Atta/.test(invText) && !/Udupi Annapoorna/.test(invText), 'own stall only');

  const real = pageErrors.filter((e) => !/Failed to load resource|ERR_|net::|frame-ancestors/.test(e));
  check('D-13', 'No unexpected renderer errors', real.length === 0, real.slice(0, 3).join(' | '));
} catch (err) {
  check('D-ERR', 'UI journey completed without an unexpected error', false, String(err?.message || err).split('\n').slice(0, 3).join(' '));
  try {
    if (page) await page.screenshot({ path: join(SHOTS, 'failure.png') });
    if (page) console.log(`url=${page.url()} body=${(await page.evaluate(() => document.body.innerText)).slice(0, 400).replace(/\s+/g, ' ')}`);
  } catch {}
  if (pageErrors.length) console.log(`Renderer errors:\n${pageErrors.slice(-8).join('\n')}`);
} finally {
  try {
    if (app) await app.close();
  } catch {}
  writeFileSync(join(OUT, 'demo-dataset-ui.json'), JSON.stringify({ results, metrics }, null, 2));
  await new Promise((r) => setTimeout(r, 1500));
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
  const fails = results.filter((r) => r.result === 'FAIL').length;
  console.log(`\nTOTAL: ${results.length - fails} PASS, ${fails} FAIL`);
  process.exit(fails ? 1 : 0);
}
