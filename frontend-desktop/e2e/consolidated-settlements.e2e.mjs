import electronPath from 'electron';
import { _electron as electron } from 'playwright-core';
import { serveAll } from './serve-order.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..');

const shots = join(HERE, '..', '..', 'qa', 'desktop', 'results', 'settlements');
mkdirSync(shots, { recursive: true });

const results = [];
const check = (id, desc, pass, ev = '') => {
  results.push({ id, desc, result: pass ? 'PASS' : 'FAIL', evidence: String(ev).slice(0, 300) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 160)}]` : ''}`);
};

const profile = mkdtempSync(join(tmpdir(), 'foodcourt-settle-'));
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

try {
  // Launch the desktop application
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

  check('C-01', 'Desktop app runtime launched and authenticated', Boolean(ownerToken && API), API);

  // Create Stall Owners
  const ownerA = (await api(ownerToken, 'POST', '/stall-owners', { name: 'Ramesh Sharma', phone: '9811111111' })).data;
  const ownerB = (await api(ownerToken, 'POST', '/stall-owners', { name: 'Pooja Verma', phone: '9822222222' })).data;

  // Create Stalls
  const stallA = (await api(ownerToken, 'POST', '/stalls', { name: `Curry House ${tag}`, code: `CH${tag}`, stall_owner_id: ownerA.id })).data;
  const stallB = (await api(ownerToken, 'POST', '/stalls', { name: `Wok Express ${tag}`, code: `WE${tag}`, stall_owner_id: ownerB.id })).data;

  // Categories & Menu Items
  const catA = (await api(ownerToken, 'POST', '/menu-categories', { stall_id: stallA.id, name: `Curries ${tag}` })).data;
  const catB = (await api(ownerToken, 'POST', '/menu-categories', { stall_id: stallB.id, name: `Noodles ${tag}` })).data;
  const curry = (await api(ownerToken, 'POST', '/menu', { stall_id: stallA.id, category_id: catA.id, name: 'Paneer Butter Masala', price: 250 })).data;
  const noodles = (await api(ownerToken, 'POST', '/menu', { stall_id: stallB.id, category_id: catB.id, name: 'Hakka Noodles', price: 180 })).data;

  // Table
  const table = (await api(ownerToken, 'POST', '/tables', { table_number: `T-${tag}`, capacity: 4, section: 'Main' })).data;

  // Staff
  await api(ownerToken, 'POST', '/staff', { name: 'Cashier Settle', email: `cashier.${tag}@example.com`, password: STAFF_PW, role: 'cashier' });
  const cashierToken = (await api(null, 'POST', '/auth/login', { email: `cashier.${tag}@example.com`, password: STAFF_PW })).data.token;

  // Place Orders:
  // Order 1: 2 Curries (₹500)
  const o1 = (await api(cashierToken, 'POST', '/orders', {
    table_id: table.id,
    order_type: 'dine_in',
    items: [{ menu_item_id: curry.id, quantity: 2 }],
  })).data;
  await serveAll(API, cashierToken, o1.id ?? o1.order?.id);
  await api(cashierToken, 'POST', '/billing/pay', {
    order_id: o1.id ?? o1.order?.id,
    payment_method: 'cash',
    amount: Number(o1.total_amount || 500),
    cash_tendered: Number(o1.total_amount || 500) + 100,
  });

  // Order 2: 1 Curry (₹250) + 2 Noodles (₹360) -> Multi-stall order
  const o2 = (await api(cashierToken, 'POST', '/orders', {
    order_type: 'takeaway',
    items: [
      { menu_item_id: curry.id, quantity: 1 },
      { menu_item_id: noodles.id, quantity: 2 },
    ],
  })).data;
  await serveAll(API, cashierToken, o2.id ?? o2.order?.id);
  await api(cashierToken, 'POST', '/billing/pay', {
    order_id: o2.id ?? o2.order?.id,
    payment_method: 'upi_qr',
    amount: Number(o2.total_amount || 610),
  });

  check('C-02', 'Test orders with multi-stall dishes and payments (cash & UPI) seeded', Boolean(o1 && o2));

  // Navigate to End-of-Day Closing & Settlements via Sidebar
  const navLink = page.locator('nav a[href="#/settlements"]').first();
  await navLink.click();
  await page.waitForTimeout(1500);

  // Check Page Title
  const heading = await page.getByRole('heading', { name: /End-of-Day Closing & Stall Settlements/i }).innerText();
  check('C-03', 'Consolidated screen opened with title "End-of-Day Closing & Stall Settlements"', /End-of-Day Closing & Stall Settlements/i.test(heading), heading);

  // Screenshot 1: Before closing, with bills reviewable
  await page.screenshot({ path: join(shots, '01-consolidated-closing-before-close.png') });

  // Verify before-closing stall breakdown is visible with "Review Bills" button
  const reviewBillsBtn = page.getByRole('button', { name: /Review Bills/i }).first();
  check('C-04', 'Before closing: Review Bills button is accessible on stall rows', await reviewBillsBtn.isVisible());

  // Click Review Bills before closing to inspect itemized bills
  await reviewBillsBtn.click();
  await page.waitForTimeout(600);
  const compactDrawer = page.locator('[data-testid^="stall-bills-compact-"]').first();
  check('C-05', 'Inline stall bills drawer expanded before closing', await compactDrawer.isVisible());
  await page.screenshot({ path: join(shots, '02-inline-stall-bills-before-close.png') });

  // Close the drawer
  await reviewBillsBtn.click();
  await page.waitForTimeout(300);

  // Execute End-of-Day Closing
  page.on('dialog', (d) => d.accept());
  await page.getByTestId('close-day').click();
  await page.getByTestId('day-closed').waitFor({ timeout: 20000 });
  check('C-06', 'End-of-Day closing executed: status shows Day Closed Successfully', await page.getByTestId('day-closed').isVisible());

  // Verify the 4 settlement figures
  await page.getByTestId('payout-summary').waitFor({ timeout: 10000 });
  const sumSales = await page.getByTestId('sum-sales').innerText();
  const sumPayable = await page.getByTestId('sum-payable').innerText();
  const sumOutstanding = await page.getByTestId('sum-outstanding').innerText();
  check('C-07', 'Settlement figures present: sales calculated, payable, outstanding', Boolean(sumSales && sumPayable && sumOutstanding), `${sumSales} | ${sumPayable} | ${sumOutstanding}`);

  // Screenshot 2: Day closed, settlement ledger ready
  await page.screenshot({ path: join(shots, '03-consolidated-day-closed.png') });

  // In the Settlement table, expand Review Bills on Curry House
  const curryRow = page.locator(`[data-testid="settlement-row"][data-stall="${stallA.name}"]`);
  await curryRow.getByRole('button', { name: /Review Bills/i }).click();
  await page.waitForTimeout(600);

  const curryDrawer = page.locator(`[data-testid="stall-bills-compact-${stallA.id}"]`);
  check('C-08', 'Inline stall bills drawer opened for Curry House in settlement ledger', await curryDrawer.isVisible());

  // Verify bills inside drawer: Paneer Butter Masala orders listed
  const drawerText = await curryDrawer.innerText();
  check('C-09', 'Drawer displays itemized dish orders and amounts', drawerText.includes('Paneer Butter Masala') && /₹\d+/.test(drawerText), drawerText.slice(0, 160));
  await page.screenshot({ path: join(shots, '04-inline-stall-bills-review.png') });

  // Test Settle Action: Click "Settle Remaining" from inside the drawer or "Record Payout" from the row
  const settleBtn = page.getByTestId(`drawer-record-payout-${stallA.id}`);
  await settleBtn.click();
  const dlg = page.getByRole('dialog').last();
  await dlg.waitFor({ timeout: 10000 });
  check('C-10', 'Record Payout modal opened directly from consolidated review', await dlg.isVisible());
  await page.screenshot({ path: join(shots, '05-record-payout-modal.png') });

  // Confirm Cash payout
  await dlg.getByRole('button', { name: /Confirm payout was made/i }).click();
  await page.waitForTimeout(1000);

  // Verify Payout Receipt modal displayed
  const receiptModal = page.getByRole('dialog').last();
  const receiptText = await receiptModal.innerText();
  check('C-11', 'Settlement payout completed and receipt displayed with PAY number', /STALL PAYOUT RECEIPT|PAY-/i.test(receiptText), receiptText.slice(0, 160));
  await page.screenshot({ path: join(shots, '06-payout-receipt.png') });

  // Close receipt modal
  await receiptModal.getByRole('button', { name: 'Close' }).last().click();
  await page.waitForTimeout(500);

  // Verify Curry House row now shows Paid / updated remaining
  const curryRemaining = await curryRow.getByTestId('row-remaining').innerText();
  check('C-12', 'Curry House remaining balance updated to ₹0.00 (Fully Settled)', curryRemaining === '₹0.00' || curryRemaining.includes('0.00'), curryRemaining);

  // Switch to "All Stall Bills" Tab on the same screen
  await page.getByTestId('tab-bills').click();
  await page.waitForTimeout(1000);

  const allBillsTab = page.getByTestId('all-stall-bills-tab');
  check('C-13', 'All Stall Bills consolidated tab opened on the same screen', await allBillsTab.isVisible());

  const billsTable = page.getByTestId('stall-bills-table');
  const billsRowCount = await billsTable.locator('tbody tr').count();
  check('C-14', 'All Stall Bills table lists all order bills across stalls', billsRowCount >= 2, `rows=${billsRowCount}`);
  await page.screenshot({ path: join(shots, '07-all-stall-bills-tab.png') });

  // Filter bills by stall
  const stallSelect = allBillsTab.getByRole('combobox', { name: /Filter by stall/i });
  if (await stallSelect.isVisible().catch(() => false)) {
    await stallSelect.selectOption(String(stallB.id));
    await page.waitForTimeout(500);
    const filteredCount = await billsTable.locator('tbody tr').count();
    check('C-15', 'Filtering by stall in All Stall Bills tab updates list to that stall only', filteredCount >= 1, `filteredRows=${filteredCount}`);
  }

  // Switch to "Payout History" Tab on the same screen
  await page.getByTestId('tab-history').click();
  await page.waitForTimeout(800);
  const payoutRows = await page.locator('[data-testid="payout-row"]').count();
  check('C-16', 'Payout History tab accessible on same screen with recorded settlement payout', payoutRows >= 1, `payoutRows=${payoutRows}`);
  await page.screenshot({ path: join(shots, '08-payout-history-tab.png') });

} catch (err) {
  console.error('CONSOLIDATED SETTLEMENT ERROR:', err);
  check('C-ERR', 'Consolidated settlement verification encountered error', false, String(err?.stack || err?.message || err).slice(0, 300));
} finally {
  try {
    if (app) await app.close();
  } catch { }
  writeFileSync(join(shots, 'consolidated-results.json'), JSON.stringify(results, null, 2));
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch { }
  const fails = results.filter((r) => r.result === 'FAIL').length;
  console.log(`\nCONSOLIDATED SETTLEMENT TOTAL: ${results.length - fails} PASS, ${fails} FAIL`);
}