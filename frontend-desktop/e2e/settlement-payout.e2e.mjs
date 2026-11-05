/**
 * Stall settlement payout ledger, driven through the real Electron runtime with its built-in PHP + SQLite server on a
 * brand-new profile (same pattern as order-tracking.e2e.mjs). Test data only.
 *
 *   cd frontend-desktop && node scripts/prepare-embedded-server.mjs && pnpm build
 *   node e2e/settlement-payout.e2e.mjs
 *
 * P-01..P-04  day closing creates payables (Pending) and marks nothing paid; the four numbers are separate
 * P-05..P-12  full cash payout + receipt, partial UPI (reference required), over-payment refused, three transactions to PAID
 * P-13        duplicate submission creates one payout (API, same idempotency key)
 * P-14..P-15  reversal keeps the original + adds a reversal; the balance is restored and can be paid again
 * P-16..P-18  payout history filters, payout detail with audit history
 * P-19..P-22  owner with five stalls: owner-wise totals; one consolidated payout allocated across stalls, counted once
 * P-23        reconciliation proves payable = paid + outstanding
 * P-24..P-26  application restart: history, balances and payout numbers identical afterwards
 */
import electronPath from 'electron';
import { _electron as electron } from 'playwright-core';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..');
const OUT = join(HERE, '..', '..', 'qa', 'desktop', 'results', 'payouts');
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (id, desc, pass, ev = '') => {
  results.push({ id, desc, result: pass ? 'PASS' : 'FAIL', evidence: String(ev).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 200)}]` : ''}`);
};

const profile = mkdtempSync(join(tmpdir(), 'foodcourt-payout-'));
const OWNER_EMAIL = 'payout.owner@example.com';
const OWNER_PW = 'Str0ngPass99';
const STAFF_PW = 'StaffPass#2026';
let app;
let page;
let API = '';
let ownerToken = '';
const pageErrors = [];

const api = async (token, method, path, body, allowFail = false) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok && !allowFail) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return allowFail ? { status: res.status, json } : json;
};

const launch = async () => {
  const launchEnv = { ...process.env, FOODCOURT_USER_DATA_DIR: profile, FOODCOURT_SMOKE_TEST: '', FOODCOURT_API_URL: '' };
  delete launchEnv.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: electronPath, args: [APP_DIR], env: launchEnv, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
  page.on('console', (m) => m.type() === 'error' && pageErrors.push(m.text()));
  page.on('dialog', (d) => d.accept());
};

const money = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const row = (stall) => page.locator(`[data-testid="settlement-row"][data-stall="${stall}"]`);
const rowText = async (stall) => (await row(stall).innerText()).replace(/\s+/g, ' ');
const rowFigures = async (stall) => ({
  payable: (await row(stall).getByTestId('row-payable').innerText()).split('\n')[0].trim(),
  paid: (await row(stall).getByTestId('row-paid').innerText()).trim(),
  remaining: (await row(stall).getByTestId('row-remaining').innerText()).trim(),
  status: await row(stall).getByTestId('payout-status').getAttribute('data-status'),
});
const waitStatus = async (stall, status, timeout = 15000) => {
  const end = Date.now() + timeout;
  let last = null;
  while (Date.now() < end) {
    last = await row(stall).getByTestId('payout-status').getAttribute('data-status').catch(() => null);
    if (last === status) return last;
    await page.waitForTimeout(150);
  }
  return last;
};
const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) });
const closeTopModal = async () => {
  await page.getByRole('dialog').last().getByRole('button', { name: 'Close', exact: true }).last().click();
};

/** Open Record Payout for a stall, fill, submit. Returns the submit button locator state info. */
const recordPayout = async (stall, { amount, method = 'cash', reference = '', submit = true }) => {
  await row(stall).getByTestId('record-payout').click();
  const dlg = page.getByRole('dialog').last();
  await dlg.getByLabel('Payout amount').fill(String(amount));
  await dlg.getByLabel('Payment method').selectOption(method);
  if (reference) await dlg.getByLabel('Transaction reference').fill(reference);
  if (submit) await dlg.getByRole('button', { name: 'Confirm payout was made' }).click();
  return dlg;
};

try {
  // ------------------------------------------------------------------ fresh profile, owner via Welcome
  await launch();
  await page.getByText('Welcome', { exact: false }).first().waitFor({ timeout: 90000 });
  await page.fill('#owner-name', 'Payout Owner');
  await page.fill('#owner-email', OWNER_EMAIL);
  await page.fill('#owner-password', OWNER_PW);
  await page.fill('#owner-confirm', OWNER_PW);
  await page.getByRole('button', { name: /Create account/ }).click();
  await page.getByText('Save your recovery key').waitFor({ timeout: 20000 });
  await page.check('#recovery-saved');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => /dashboard/i.test(location.hash), null, { timeout: 20000 });
  ownerToken = await page.evaluate(() => localStorage.getItem('fc_auth_token'));
  API = (await page.evaluate(() => window.desktop.getConfig())).apiBaseUrl.replace(/\/$/, '');
  check('P-00', 'Fresh profile: built-in server (SQLite) started and the owner created', Boolean(ownerToken) && /^http:\/\/127\.0\.0\.1:\d+\/api$/.test(API), API);

  // ------------------------------------------------------------------ test data: owners, stalls, one paid bill per stall
  const tag = Date.now().toString(36).slice(-4).toUpperCase();
  await api(ownerToken, 'POST', '/staff', { name: 'Payout Cashier', email: `cashier.${tag}@example.com`, password: STAFF_PW, role: 'cashier' });
  const cashierToken = (await api(null, 'POST', '/auth/login', { email: `cashier.${tag}@example.com`, password: STAFF_PW })).data.token;

  const mkOwner = async (name) => (await api(ownerToken, 'POST', '/stall-owners', { name, phone: '9800000000' })).data;
  const rajesh = await mkOwner('Rajesh Patil');
  const sunita = await mkOwner('Sunita Joshi');
  const anand = await mkOwner('Anand Kulkarni');

  const plan = [
    ['Pizza Corner', rajesh, 5000],
    ['Misal House', sunita, 8000],
    ['Biryani Point', sunita, 6000],
    ['Dosa Dhaba', anand, 1000],
    ['Chaat Chowk', anand, 1200],
    ['Kebab Kingdom', anand, 1400],
    ['Juice Junction', anand, 1600],
    ['Sweet Tooth', anand, 1800],
  ];
  const stalls = {};
  for (const [i, [name, owner, sales]] of plan.entries()) {
    const stall = (await api(ownerToken, 'POST', '/stalls', { name, code: `P${tag}${i}`, stall_owner_id: owner.id })).data;
    const cat = (await api(ownerToken, 'POST', '/menu-categories', { stall_id: stall.id, name: `Main ${i}` })).data;
    const item = (await api(ownerToken, 'POST', '/menu', { stall_id: stall.id, category_id: cat.id, name: `${name} special`, price: sales })).data;
    const order = (await api(cashierToken, 'POST', '/orders', { order_type: 'takeaway', items: [{ menu_item_id: item.id, quantity: 1 }], idempotency_key: `payout-e2e-${tag}-${i}` })).data;
    await api(cashierToken, 'POST', '/billing/pay', { order_id: order.id, payment_method: 'cash', amount: order.total_amount, cash_tendered: Number(order.total_amount) + 10 });
    stalls[name] = { ...stall, owner, sales };
  }
  const total = plan.reduce((s, p) => s + p[2], 0);
  check('P-01', '8 stalls under 3 owners (one owner holds 5 stalls), each with one paid bill', Object.keys(stalls).length === 8 && total === 26000, `total sales ${total}`);

  // ------------------------------------------------------------------ day closing creates payables, marks nothing paid
  await page.locator('a[href="#/settlements"]').first().click();
  await page.getByTestId('close-day').waitFor({ timeout: 20000 });
  await page.getByText('Not closed yet').first().waitFor({ timeout: 15000 });
  const notClosedRows = await page.getByText('Not closed yet').count();
  check('P-02', 'Before closing: stalls show their sales but no payable and no payout action', notClosedRows === 8 && (await page.getByTestId('record-payout').count()) === 0, `${notClosedRows} rows`);
  await shot('01-before-closing');

  await page.getByTestId('close-day').click();
  await page.getByTestId('day-closed').waitFor({ timeout: 20000 });
  await page.getByTestId('settlement-row').first().waitFor({ timeout: 15000 });
  const figs = {};
  for (const name of Object.keys(stalls)) figs[name] = await rowFigures(name);
  const allPending = Object.entries(stalls).every(([n, s]) => figs[n].status === 'pending' && figs[n].paid === money(0) && figs[n].remaining === money(s.sales) && figs[n].payable === money(s.sales));
  check('P-03', 'Day closing: every stall is Pending with Net Payable = sales, Paid ₹0.00, Remaining = payable (closing does not mark anything paid)', allPending, JSON.stringify(figs['Pizza Corner']));
  const sums = async () => ({
    sales: await page.getByTestId('sum-sales').innerText(),
    payable: await page.getByTestId('sum-payable').innerText(),
    paid: await page.getByTestId('sum-paid').innerText(),
    outstanding: await page.getByTestId('sum-outstanding').innerText(),
  });
  let s = await sums();
  check('P-04', 'The four numbers are shown separately: Sales calculated, Settlement payable, Payout actually made (₹0.00), Outstanding', s.sales === money(total) && s.payable === money(total) && s.paid === money(0) && s.outstanding === money(total), JSON.stringify(s));
  await shot('02-day-closed-all-pending');

  // ------------------------------------------------------------------ Pizza: full cash payout + receipt
  const dlg1 = await recordPayout('Pizza Corner', { amount: '5000.00', method: 'cash', submit: false });
  const breakdown = (await dlg1.getByTestId('payout-breakdown').innerText()).replace(/\s+/g, ' ');
  check('P-05', 'Record Payout shows the settlement breakdown (sales, net payable, already paid, outstanding)', /Stall sales/.test(breakdown) && /Net payable ₹5,000.00/.test(breakdown) && /Outstanding ₹5,000.00/.test(breakdown), breakdown);
  await shot('03-record-payout-modal');
  await dlg1.getByRole('button', { name: 'Confirm payout was made' }).click();
  await page.getByTestId('payout-receipt').waitFor({ timeout: 15000 });
  const receipt1 = (await page.getByTestId('payout-receipt').innerText()).replace(/\s+/g, ' ');
  check('P-06', 'Payout receipt generated: PAY-000001, ₹5,000.00 cash, balance ₹0.00, manual-record disclaimer', /PAY-000001/.test(receipt1) && /Amount paid now ₹5,000.00/.test(receipt1) && /Balance remaining ₹0.00/.test(receipt1) && /not proof of an electronic transfer/.test(receipt1), receipt1.slice(0, 250));
  await shot('04-payout-receipt');
  await closeTopModal();
  const pizza = await rowFigures('Pizza Corner');
  check('P-07', 'Pizza Corner is Paid: paid ₹5,000.00, remaining ₹0.00, no Record Payout button', pizza.status === 'paid' && pizza.paid === money(5000) && pizza.remaining === money(0) && (await row('Pizza Corner').getByTestId('record-payout').count()) === 0, JSON.stringify(pizza));

  // ------------------------------------------------------------------ Misal: UPI needs a reference; partial
  let dlg = await recordPayout('Misal House', { amount: '3000.00', method: 'upi', reference: '' });
  const refError = await dlg.getByRole('alert').innerText();
  check('P-08', 'UPI payout without a transaction reference is refused with a clear message (nothing saved)', /reference is required/i.test(refError), refError);
  await dlg.getByLabel('Transaction reference').fill('UPI123456789');
  await dlg.getByRole('button', { name: 'Confirm payout was made' }).click();
  await page.getByTestId('payout-receipt').waitFor({ timeout: 15000 });
  await closeTopModal();
  const misal = await rowFigures('Misal House');
  check('P-09', 'Misal House ₹8,000 payable, ₹3,000 UPI paid -> Partially Paid, remaining ₹5,000.00', misal.status === 'partially_paid' && misal.paid === money(3000) && misal.remaining === money(5000), JSON.stringify(misal));
  const biryani = await rowFigures('Biryani Point');
  check('P-10', 'One stall paid, one partial, one untouched: Biryani Point stays Pending ₹6,000.00', biryani.status === 'pending' && biryani.remaining === money(6000), JSON.stringify(biryani));
  s = await sums();
  check('P-10b', 'Summary after payouts: paid ₹8,000.00, outstanding ₹18,000.00 (payable unchanged ₹26,000.00)', s.paid === money(8000) && s.outstanding === money(18000) && s.payable === money(26000), JSON.stringify(s));
  await shot('05-paid-partial-pending');

  // ------------------------------------------------------------------ over-payment
  dlg = await recordPayout('Biryani Point', { amount: '6000.01', method: 'cash' });
  const overUi = await dlg.getByRole('alert').innerText();
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  const biryaniRow = (await api(ownerToken, 'GET', `/settlements/daily-summary`)).data.closing.settlements.find((r) => r.stall.name === 'Biryani Point');
  const overApi = await api(ownerToken, 'POST', `/settlements/${biryaniRow.id}/payouts`, { amount: '6000.01', payment_method: 'cash', idempotency_key: `over-${tag}-0001` }, true);
  check('P-11', 'Over-payment refused in the form AND by the server (422); balance unchanged', /exceeds the outstanding balance/.test(overUi) && overApi.status === 422 && /exceeds the outstanding balance/.test(overApi.json.message) && (await rowFigures('Biryani Point')).remaining === money(6000), `${overUi} | ${overApi.status}`);

  // ------------------------------------------------------------------ Misal: two more transactions -> PAID
  await recordPayout('Misal House', { amount: '2000.00', method: 'bank_transfer', reference: 'NEFT-SBIN-1122334455' });
  await page.getByTestId('payout-receipt').waitFor({ timeout: 15000 });
  await closeTopModal();
  check('P-12a', 'Second payout (₹2,000 bank transfer) -> still Partially Paid, remaining ₹3,000.00', (await waitStatus('Misal House', 'partially_paid')) === 'partially_paid' && (await rowFigures('Misal House')).remaining === money(3000));
  await recordPayout('Misal House', { amount: '3000.00', method: 'cash' });
  await page.getByTestId('payout-receipt').waitFor({ timeout: 15000 });
  await closeTopModal();
  const misalPaid = await rowFigures('Misal House');
  check('P-12', 'Third payout (₹3,000 cash) completes it: three transactions, PAID, remaining ₹0.00', (await waitStatus('Misal House', 'paid')) === 'paid' && misalPaid.paid === money(8000), JSON.stringify(misalPaid));
  await row('Misal House').getByTestId('view-payout-history').click();
  await page.getByTestId('settlement-ledger').waitFor({ timeout: 15000 });
  const ledgerRows = await page.getByTestId('ledger-row').allInnerTexts();
  const ledgerOk = ledgerRows.length === 3 && /UPI/.test(ledgerRows[0]) && /Bank Transfer/.test(ledgerRows[1]) && /Cash/.test(ledgerRows[2]) && /UPI123456789/.test(ledgerRows[0]);
  const trail = (await page.getByTestId('audit-trail').innerText()).replace(/\s+/g, ' ');
  check('P-12b', 'Stall payout history lists the 3 transactions in order with methods/references, plus the audit trail', ledgerOk && (trail.match(/Payout recorded/g) || []).length === 3, `${ledgerRows.length} rows | ${trail.slice(0, 160)}`);
  await shot('06-stall-payout-history');
  await closeTopModal();

  // ------------------------------------------------------------------ duplicate submission (same idempotency key)
  const dupBody = { amount: '1000.00', payment_method: 'cash', idempotency_key: `dup-${tag}-key-0001`, received_by: 'Dup test' };
  const dup1 = await api(ownerToken, 'POST', `/settlements/${biryaniRow.id}/payouts`, dupBody, true);
  const dup2 = await api(ownerToken, 'POST', `/settlements/${biryaniRow.id}/payouts`, dupBody, true);
  const biryaniLedger = (await api(ownerToken, 'GET', `/settlements/${biryaniRow.id}/payouts`)).data.settlement;
  check('P-13', 'Duplicate submission (same idempotency key): second call returns the first payout, exactly one ledger row, balance reduced once', dup1.status === 201 && dup2.status === 200 && dup2.json.duplicate === true && dup1.json.data.payout.id === dup2.json.data.payout.id && biryaniLedger.payouts.length === 1 && biryaniLedger.paid_amount === '1000.00', `${dup1.status}/${dup2.status} paid=${biryaniLedger.paid_amount}`);

  // ------------------------------------------------------------------ reversal
  await page.reload();
  await page.getByTestId('settlement-row').first().waitFor({ timeout: 20000 });
  await row('Pizza Corner').getByTestId('view-payout-history').click();
  await page.getByTestId('settlement-ledger').waitFor({ timeout: 15000 });
  await page.getByTestId('reverse-payout').click();
  await page.getByLabel('Reversal reason').fill('Cash was counted short; payout re-done');
  await page.getByRole('button', { name: 'Confirm reversal' }).click();
  await page.getByTestId('ledger-row').nth(1).waitFor({ timeout: 15000 });
  const pizzaLedger = await page.getByTestId('ledger-row').allInnerTexts();
  const pizzaApi = (await api(ownerToken, 'GET', `/settlements/${(await api(ownerToken, 'GET', '/settlements/daily-summary')).data.closing.settlements.find((r) => r.stall.name === 'Pizza Corner').id}/payouts`)).data.settlement;
  check('P-14', 'Reversal keeps the original payout (marked Reversed) and adds a reversal entry; both stay in the ledger', pizzaLedger.length === 2 && /Reversed/.test(pizzaLedger[0]) && /Reversal/.test(pizzaLedger[1]) && pizzaApi.payouts.length === 2 && pizzaApi.payouts[0].amount === '5000.00', pizzaLedger.map((t) => t.replace(/\s+/g, ' ').slice(0, 90)).join(' || '));
  await shot('07-reversal-ledger');
  await closeTopModal();
  const pizzaAfter = await rowFigures('Pizza Corner');
  check('P-15', 'After the reversal Pizza Corner is Pending again (paid ₹0.00, remaining ₹5,000.00)', (await waitStatus('Pizza Corner', 'pending')) === 'pending' && pizzaAfter.remaining === money(5000), JSON.stringify(pizzaAfter));
  await recordPayout('Pizza Corner', { amount: '5000.00', method: 'upi', reference: 'UPI-REPAID-0001' });
  await page.getByTestId('payout-receipt').waitFor({ timeout: 15000 });
  await closeTopModal();
  check('P-15b', 'The balance can be paid again correctly (UPI with reference) -> Paid', (await waitStatus('Pizza Corner', 'paid')) === 'paid');

  // ------------------------------------------------------------------ payout history tab
  await page.getByTestId('tab-history').click();
  await page.getByTestId('payout-history-table').waitFor({ timeout: 15000 });
  const histAll = await page.getByTestId('history-row').count();
  await page.getByLabel('Filter by method').selectOption('upi');
  await page.waitForFunction(() => { const r = [...document.querySelectorAll('[data-testid="history-row"]')]; return r.length > 0 && r.every((x) => /UPI/.test(x.innerText)); }, null, { timeout: 10000 }).catch(() => undefined);
  const upiRows = await page.getByTestId('history-row').allInnerTexts();
  check('P-16', 'Payout History filters by payment method (UPI only)', upiRows.length > 0 && upiRows.every((t) => /UPI/.test(t)), `${upiRows.length}/${histAll} rows`);
  await page.getByLabel('Filter by method').selectOption('');
  await page.getByLabel('Filter by status').selectOption('reversed');
  await page.waitForTimeout(600);
  const revRows = await page.getByTestId('history-row').allInnerTexts();
  check('P-17', 'Payout History filters by status (Reversed shows only the reversed payout)', revRows.length === 1 && /Pizza Corner/.test(revRows[0]) && /Reversed/.test(revRows[0]), revRows.map((t) => t.replace(/\s+/g, ' ').slice(0, 100)).join(' | '));
  await page.getByLabel('Filter by status').selectOption('');
  await page.getByLabel('Filter by stall').selectOption({ label: 'Misal House' });
  await page.waitForTimeout(600);
  const misalRows = await page.getByTestId('history-row').count();
  const histTotal = await page.getByTestId('history-total').innerText();
  check('P-17b', 'Filter by stall: Misal House shows its 3 payouts totalling ₹8,000.00', misalRows === 3 && histTotal === money(8000), `${misalRows} rows, total ${histTotal}`);
  await shot('08-payout-history-filtered');
  await page.getByLabel('Filter by stall').selectOption('');
  await page.getByTestId('history-row').first().getByRole('button', { name: 'Open' }).click();
  await page.getByTestId('payout-detail').waitFor({ timeout: 15000 });
  const detail = (await page.getByTestId('payout-detail').innerText()).replace(/\s+/g, ' ');
  const auditText = (await page.getByTestId('audit-trail').innerText()).replace(/\s+/g, ' ');
  check('P-18', 'Opening a payout shows every field and its complete audit history', /business date/i.test(detail) && /paid by/i.test(detail) && /Payout recorded/.test(auditText), auditText.slice(0, 160));
  await shot('09-payout-detail-audit');
  await closeTopModal();

  // ------------------------------------------------------------------ owner-wise + consolidated payout
  await page.getByTestId('tab-owners').click();
  await page.getByTestId('owner-card').first().waitFor({ timeout: 15000 });
  const anandCard = page.getByTestId('owner-card').filter({ hasText: 'Anand Kulkarni' });
  const before = {
    payable: await anandCard.getByTestId('owner-payable').innerText(),
    paid: await anandCard.getByTestId('owner-paid').innerText(),
    outstanding: await anandCard.getByTestId('owner-outstanding').innerText(),
  };
  const anandRowsText = (await anandCard.innerText()).replace(/\s+/g, ' ');
  check('P-19', 'Owner-wise view: Anand Kulkarni, 5 stalls, payable ₹7,000.00, paid ₹0.00, outstanding ₹7,000.00 with per-stall breakdown', before.payable === money(7000) && before.paid === money(0) && before.outstanding === money(7000) && /5 stalls/.test(anandRowsText) && /Dosa Dhaba/.test(anandRowsText) && /Sweet Tooth/.test(anandRowsText), JSON.stringify(before));
  await shot('10-owner-wise-before');

  await anandCard.getByTestId('consolidated-payout-btn').click();
  const cdlg = page.getByRole('dialog').last();
  await cdlg.getByTestId('allocation-table').waitFor({ timeout: 15000 });
  await cdlg.getByLabel('Total amount paid').fill('3500');
  await cdlg.getByLabel('Payment method').selectOption('bank_transfer');
  await cdlg.getByLabel('Transaction reference').fill('NEFT-ANAND-CONS-001');
  // allocations that do not add up are refused
  await cdlg.getByLabel(/^Allocation for Dosa Dhaba/).fill('1000');
  await cdlg.getByRole('button', { name: 'Confirm payout was made' }).click();
  const mismatch = await cdlg.getByRole('alert').innerText();
  check('P-20', 'Consolidated payout: allocations that do not add up to the payment are refused', /must match exactly/.test(mismatch), mismatch);
  await cdlg.getByTestId('auto-allocate').click();
  await shot('11-consolidated-allocation');
  await cdlg.getByRole('button', { name: 'Confirm payout was made' }).click();
  await page.getByText(/Consolidated payout CPAY-\d+ recorded/).waitFor({ timeout: 15000 });
  const afterCard = {
    payable: await anandCard.getByTestId('owner-payable').innerText(),
    paid: await anandCard.getByTestId('owner-paid').innerText(),
    outstanding: await anandCard.getByTestId('owner-outstanding').innerText(),
  };
  const owners = (await api(ownerToken, 'GET', '/settlements/owners')).data;
  const anandData = owners.owners.find((o) => o.owner.name === 'Anand Kulkarni');
  const allocByStall = Object.fromEntries(anandData.stalls.map((st) => [st.stall_name, st.paid]));
  check('P-21', 'One ₹3,500 bank transfer allocated oldest-first across stalls; owner paid ₹3,500.00 (counted once), outstanding ₹3,500.00', afterCard.paid === money(3500) && afterCard.outstanding === money(3500) && afterCard.payable === money(7000), JSON.stringify(afterCard));
  const sumAlloc = Object.values(allocByStall).reduce((a, b) => a + Number(b), 0);
  check('P-22', 'Allocations equal the payment exactly (Dosa 1000 + Chaat 1200 + Kebab 1300 = 3500); grand total paid counts it once (₹17,500.00: Pizza 5,000 + Misal 8,000 + Biryani 1,000 + Anand 3,500)', sumAlloc === 3500 && allocByStall['Dosa Dhaba'] === '1000.00' && allocByStall['Chaat Chowk'] === '1200.00' && allocByStall['Kebab Kingdom'] === '1300.00' && owners.grand_total.paid === '17500.00', JSON.stringify(allocByStall) + ` grand paid ${owners.grand_total.paid}`);
  await shot('12-owner-wise-after-consolidated');

  // ------------------------------------------------------------------ reconciliation
  await page.getByTestId('tab-reconcile').click();
  await page.getByTestId('run-reconciliation').click();
  await page.getByTestId('reconciliation-result').waitFor({ timeout: 15000 });
  const recon = await page.getByTestId('reconciliation-result').getAttribute('data-ok');
  const reconApi = (await api(ownerToken, 'GET', '/settlements/reconciliation')).data;
  check('P-23', 'Reconciliation: payable = paid + outstanding; every settlement matches its ledger (0 discrepancies)', recon === 'true' && reconApi.ok && reconApi.totals.net_payable === '26000.00' && reconApi.totals.paid === '17500.00' && reconApi.totals.outstanding === '8500.00', JSON.stringify(reconApi.totals));
  await shot('13-reconciliation');

  // ------------------------------------------------------------------ restart
  const snapshotBefore = (await api(ownerToken, 'GET', '/settlements/payouts?per_page=200')).data.data.map((p) => `${p.payout_number}|${p.stall.name}|${p.amount}|${p.status}|${p.entry_type}`);
  const settlementsBefore = (await api(ownerToken, 'GET', '/settlements/daily-summary')).data.closing.settlements.map((r) => `${r.stall.name}|${r.net_payable}|${r.paid_amount}|${r.remaining_amount}|${r.payout_status}`).sort();
  await app.close();
  await launch();
  await page.waitForFunction(() => /dashboard|settlements|login|welcome/i.test(location.hash) || document.querySelector('input[type=email]'), null, { timeout: 90000 });
  if (await page.locator('input[type=email]').count()) {
    await page.fill('input[type=email]', OWNER_EMAIL);
    await page.fill('input[type=password]', OWNER_PW);
    await page.getByRole('button', { name: /sign in|log in|login/i }).first().click();
    await page.waitForFunction(() => /dashboard/i.test(location.hash), null, { timeout: 30000 });
  }
  API = (await page.evaluate(() => window.desktop.getConfig())).apiBaseUrl.replace(/\/$/, '');
  ownerToken = await page.evaluate(() => localStorage.getItem('fc_auth_token'));
  const snapshotAfter = (await api(ownerToken, 'GET', '/settlements/payouts?per_page=200')).data.data.map((p) => `${p.payout_number}|${p.stall.name}|${p.amount}|${p.status}|${p.entry_type}`);
  const settlementsAfter = (await api(ownerToken, 'GET', '/settlements/daily-summary')).data.closing.settlements.map((r) => `${r.stall.name}|${r.net_payable}|${r.paid_amount}|${r.remaining_amount}|${r.payout_status}`).sort();
  check('P-24', 'After an application restart the payout history is identical (same payout numbers, amounts, statuses)', snapshotBefore.length > 8 && JSON.stringify(snapshotBefore) === JSON.stringify(snapshotAfter), `${snapshotBefore.length} rows`);
  check('P-25', 'After the restart every stall shows the same payable / paid / remaining / status', JSON.stringify(settlementsBefore) === JSON.stringify(settlementsAfter), `${settlementsAfter.length} stalls`);
  await page.locator('a[href="#/settlements"]').first().click();
  await page.getByTestId('settlement-row').first().waitFor({ timeout: 20000 });
  await page.getByTestId('tab-history').click();
  await page.getByTestId('history-row').first().waitFor({ timeout: 15000 });
  check('P-26', 'Day closing history unchanged after later payouts: the closed day is still closed, payables fixed, history screen shows the ledger', (await page.getByTestId('history-row').count()) > 0 && (await api(ownerToken, 'GET', '/settlements/reconciliation')).data.ok === true);
  await shot('14-after-restart-history');

  check('P-99', 'No uncaught page errors during the run', pageErrors.filter((e) => !/Failed to load resource.*4\d\d|status of 4\d\d|Content Security Policy/.test(e)).length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (err) {
  check('P-ERR', 'Run completed without an exception', false, err?.stack || err);
  try {
    await page?.screenshot({ path: join(OUT, 'zz-failure.png') });
  } catch {
    /* page may be gone */
  }
} finally {
  const failed = results.filter((r) => r.result === 'FAIL').length;
  writeFileSync(join(OUT, '..', 'settlement-payout-results.json'), JSON.stringify({ ranAt: new Date().toISOString(), total: results.length, passed: results.length - failed, failed, results }, null, 2));
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await app?.close().catch(() => undefined);
  process.exit(failed ? 1 : 0);
}
