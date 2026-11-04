/**
 * Dynamic GST, driven through the real Electron runtime with its built-in server on a brand-new profile.
 * Test data only; no real payment is made.
 *
 *   cd frontend-desktop && pnpm prepare:server && pnpm build
 *   node e2e/gst-config.e2e.mjs
 *
 *  G1  Food Court Settings -> Tax & GST: defaults, validation, live example, owner saves 12% exclusive
 *  G2  POS cart, payment amount, cash payment and 80/58 mm receipt all show 12% (never 5%)
 *  G3  Rate raised to 18%: UPI QR amount is the GST-inclusive payable amount; UPI payment settles it
 *  G4  GST inclusive 5%: cart/receipt show "including GST" / "GST Included (5%)"; paid by Card POS
 *  G5  GST disabled: no GST anywhere; paid by Split
 *  G6  Old bills keep their own rate after the changes (Orders detail + reprint), daily closing and reports reconcile
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
  results.push({ id, desc, result: pass ? 'PASS' : 'FAIL', evidence: String(ev).slice(0, 500) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 220)}]` : ''}`);
};

const profile = mkdtempSync(join(tmpdir(), 'foodcourt-gst-'));
const shots = join(HERE, '..', '..', 'qa', 'desktop', 'results', 'gst');
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
const norm = (s) => s.replace(/\s+/g, ' ').trim();

const holdPrint = () =>
  app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('desktop:print');
    ipcMain.handle('desktop:print', () => new Promise((resolve) => (globalThis.__releasePrint = () => resolve({ ok: true, error: null }))));
  });
/** Prints at the given roll width, returns the printed text and the QR-free geometry, then releases the dialog. */
const capturePrint = async (clickPrint, width, name) => {
  await page.evaluate((w) => localStorage.setItem('foodcourt.receiptWidth', String(w)), width);
  await holdPrint();
  await clickPrint();
  await page.waitForFunction(() => (document.getElementById('print-root')?.innerText || '').trim().length > 20, null, { timeout: 15000 });
  const text = await page.evaluate(() => document.getElementById('print-root').innerText);
  const widthAttr = await page.evaluate(() => document.getElementById('print-root').dataset.width);
  await page.emulateMedia({ media: 'print' });
  const geo = await page.evaluate(() => {
    const r = document.getElementById('print-root');
    const rr = r.getBoundingClientRect();
    const over = [...r.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > rr.right + 1).length;
    return { mm: (rr.width * 25.4) / 96, overflowing: over };
  });
  await page.locator('#print-root').screenshot({ path: join(shots, `${name}.png`) });
  await page.emulateMedia({ media: null });
  await app.evaluate(() => globalThis.__releasePrint && globalThis.__releasePrint());
  await page.waitForFunction(() => !document.getElementById('print-root')?.innerText?.trim(), null, { timeout: 10000 }).catch(() => {});
  return { text: norm(text), widthAttr, geo };
};
const row = (text, label) => {
  const m = new RegExp(`${label.replace(/[()]/g, '\\$&')}\\s*(-?\\d[\\d.]*)`).exec(text);
  return m ? m[1] : null;
};

/** Adds an item in the POS, reads the cart's GST lines, sends & pays with `method`, returns what the screens showed. */
const posSale = async (itemName, method, extra = async () => {}) => {
  await page.reload();
  await goto('#/pos');
  await page.locator(`[data-menu-item="${itemName}"]`).first().waitFor({ timeout: 20000 });
  await page.locator(`[data-menu-item="${itemName}"]`).first().click();
  await page.getByRole('button', { name: 'Takeaway' }).click();
  await page.getByTestId('cart-tax-line').first().waitFor({ timeout: 10000 });
  const cartLines = (await page.getByTestId('cart-tax-line').allInnerTexts()).map(norm);
  const grand = norm(await page.getByText('Grand Total:').locator('..').innerText());
  await page.getByRole('button', { name: /Send & Pay/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Consolidated bill settlement' });
  await dialog.waitFor({ timeout: 15000 });
  const modalText = norm(await dialog.innerText());
  const modalTotal = /Total Bill Amount:?\s*₹([\d.]+)/i.exec(modalText)?.[1];
  const orderNumber = /Order #(\S+)/.exec(modalText)?.[1];
  await dialog.getByRole('button', { name: method.label }).click();
  await extra(dialog);
  return { cartLines, grand, modalTotal, modalText, orderNumber, dialog };
};
const settle = async (dialog) => {
  await dialog.getByRole('button', { name: 'Confirm Payment & Settle' }).click();
  await page.getByText('Bill Settled Successfully').waitFor({ timeout: 20000 });
};
const closeSettled = () => page.getByRole('button', { name: 'Close' }).first().click();

try {
  // ------------------------------------------------------------------ fresh profile, owner via Welcome
  app = await electron.launch({ args: [APP_DIR], env: { ...process.env, FOODCOURT_USER_DATA_DIR: profile, FOODCOURT_SMOKE_TEST: '', FOODCOURT_API_URL: '' }, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
  page.on('console', (m) => m.type() === 'error' && pageErrors.push(m.text()));
  await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
  await page.getByText('Welcome', { exact: false }).first().waitFor({ timeout: 90000 });
  await page.fill('#owner-name', 'GST Owner');
  await page.fill('#owner-email', 'gst.owner@example.com');
  await page.fill('#owner-password', OWNER_PW);
  await page.fill('#owner-confirm', OWNER_PW);
  await page.getByRole('button', { name: /Create account/ }).click();
  await page.getByText('Save your recovery key').waitFor({ timeout: 20000 });
  await page.check('#recovery-saved');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => /dashboard/i.test(location.hash), null, { timeout: 20000 });
  const ownerToken = await page.evaluate(() => localStorage.getItem('fc_auth_token'));
  API = (await page.evaluate(() => window.desktop.getConfig())).apiBaseUrl.replace(/\/$/, '');
  check('G-00', 'Fresh profile: built-in server started and owner created', Boolean(ownerToken), API);

  // ------------------------------------------------------------------ data
  const tag = Date.now().toString(36).slice(-4).toUpperCase();
  const stall = (await api(ownerToken, 'POST', '/stalls', { name: `Kitchen ${tag}`, code: `KT${tag}` })).data;
  const cat = (await api(ownerToken, 'POST', '/menu-categories', { stall_id: stall.id, name: `Mains ${tag}` })).data;
  await api(ownerToken, 'POST', '/menu', { stall_id: stall.id, category_id: cat.id, name: 'Thali', price: 100 });
  await api(ownerToken, 'POST', '/menu', { stall_id: stall.id, category_id: cat.id, name: 'Combo', price: 105 });
  await api(ownerToken, 'POST', '/staff', { name: 'GST Cashier', email: `cashier.${tag}@example.com`, password: STAFF_PW, role: 'cashier' });
  const cashierToken = (await api(null, 'POST', '/auth/login', { email: `cashier.${tag}@example.com`, password: STAFF_PW })).data.token;

  // ================================================================== G1  settings UI
  await page.getByRole('link', { name: 'Food Court Settings' }).click();
  await page.getByTestId('gst-rate').waitFor({ timeout: 20000 });
  const def = {
    enabled: await page.getByTestId('gst-enabled').isChecked(),
    rate: await page.getByTestId('gst-rate').inputValue(),
    excl: await page.getByTestId('gst-mode-exclusive').isChecked(),
    applyTo: await page.getByTestId('gst-apply-to').inputValue(),
    individualDisabled: await page.getByTestId('gst-apply-to').locator('option[value="individual"]').evaluate((o) => o.disabled),
  };
  check('G-01', 'Tax & GST Settings opens with the saved configuration (default: GST on, 5, exclusive, all items; individual items unavailable)', def.enabled && def.rate === '5.00' && def.excl && def.applyTo === 'all' && def.individualDisabled, JSON.stringify(def));
  const saveGst = page.getByRole('button', { name: 'Save GST settings' });
  const bad = [];
  for (const v of ['abc', '-1', '41', '5.123', '']) {
    await page.getByTestId('gst-rate').fill(v);
    bad.push(`${v}:${(await page.getByTestId('gst-validation').isVisible()) && (await saveGst.isDisabled())}`);
  }
  check('G-02', 'Invalid GST rates (text, negative, > 40, 3 decimals, empty) show a message and cannot be saved', bad.every((b) => b.endsWith(':true')), bad.join(' '));
  await page.getByTestId('gst-rate').fill('12');
  const exExcl = norm(await page.getByTestId('gst-example').innerText());
  await page.getByTestId('gst-mode-inclusive').check();
  const exIncl = norm(await page.getByTestId('gst-example').innerText());
  await page.getByTestId('gst-mode-exclusive').check();
  check('G-03', 'Live example follows the form: exclusive 12% adds Rs 12.00; inclusive 12% extracts Rs 10.71 and keeps the total', /GST \(12%\) is ₹12\.00, total ₹112\.00/.test(exExcl) && /GST included \(12%\) is ₹10\.71, total stays ₹100\.00/.test(exIncl), `${exExcl} | ${exIncl}`);
  await page.screenshot({ path: join(shots, 'settings-gst.png') });
  await saveGst.click();
  await page.getByRole('status').filter({ hasText: 'GST settings saved' }).first().waitFor({ timeout: 15000 });
  const saved = (await api(ownerToken, 'GET', '/settings')).data.tax;
  check('G-04', 'Owner saves GST 12% exclusive: success message, server stores it', saved.enabled && saved.rate_percent === '12.00' && saved.mode === 'exclusive', JSON.stringify(saved));
  const cashierPut = await api(cashierToken, 'PUT', '/settings/tax', { enabled: false, rate_percent: '0', mode: 'exclusive', apply_to: 'all' }, true);
  const rateTooBig = await api(ownerToken, 'PUT', '/settings/tax', { enabled: true, rate_percent: '1000', mode: 'exclusive', apply_to: 'all' }, true);
  check('G-05', 'Server rules: a cashier cannot change GST (403); an absurd rate is refused by the backend (422)', cashierPut.status === 403 && rateTooBig.status === 422, `${cashierPut.status} ${rateTooBig.status}`);

  // ================================================================== G2  12% exclusive, cash, receipts
  const s1 = await posSale('Thali', { label: 'Cash' }, (d) => d.getByRole('button', { name: 'Confirm Payment & Settle' }).waitFor());
  check('G-06', 'POS cart at 12% exclusive: "Subtotal 100.00", "GST (12%) 12.00", Grand Total 112.00', s1.cartLines[0] === 'Subtotal: ₹100.00' && s1.cartLines[1] === 'GST (12%): ₹12.00' && /₹112\.00/.test(s1.grand), `${s1.cartLines.join(' | ')} | ${s1.grand}`);
  check('G-07', 'Payment modal total equals the cart total (Rs 112.00)', s1.modalTotal === '112.00', `${s1.modalTotal} ${s1.modalText.slice(0, 160)}`);
  await page.screenshot({ path: join(shots, 'pos-payment-12pct.png') });
  await settle(s1.dialog);
  const order1 = (await api(ownerToken, 'GET', `/orders?search=${s1.orderNumber}`)).data.data?.[0] ?? (await api(ownerToken, 'GET', '/orders')).data.data.find((o) => o.order_number === s1.orderNumber);
  const o1 = (await api(ownerToken, 'GET', `/orders/${order1.id}`)).data;
  check('G-08', 'Stored bill: subtotal 100.00, GST 12.00 @ 12.00 exclusive, total 112.00, cash payment 112.00', o1.subtotal === '100.00' && o1.tax_amount === '12.00' && o1.tax_rate_percent === '12.00' && o1.tax_mode === 'exclusive' && o1.total_amount === '112.00' && o1.payments?.[0]?.payment_method === 'cash' && o1.payments?.[0]?.amount === '112.00', `${o1.subtotal}/${o1.tax_amount}/${o1.total_amount} ${o1.payments?.[0]?.payment_method} ${o1.payments?.[0]?.amount}`);
  const p80 = await capturePrint(() => page.getByRole('button', { name: 'Print Receipt' }).click(), 80, 'receipt-80mm-12pct-exclusive');
  const p58 = await capturePrint(() => page.getByRole('button', { name: 'Print Receipt' }).click(), 58, 'receipt-58mm-12pct-exclusive');
  const okExcl = (t) => row(t, 'Subtotal') === '100.00' && row(t, 'GST (12%)') === '12.00' && row(t, 'TOTAL') === '112.00' && !/5%/.test(t) && !/Tax\s/.test(t);
  check('G-09', 'Receipt 80 mm: Subtotal 100.00, GST (12%) 12.00, TOTAL 112.00 - no fixed 5%', p80.widthAttr === '80' && okExcl(p80.text) && Math.abs(p80.geo.mm - 72) < 0.6 && p80.geo.overflowing === 0, p80.text.slice(0, 260));
  check('G-10', 'Receipt 58 mm: same GST lines, 48 mm wide, nothing overflows', p58.widthAttr === '58' && okExcl(p58.text) && Math.abs(p58.geo.mm - 48) < 0.6 && p58.geo.overflowing === 0, `${p58.geo.mm.toFixed(1)}mm over=${p58.geo.overflowing}`);
  const credit = 'Powered by MangalMurti Tech Solution';
  check('G-10b', 'Both receipts end with the fixed "Powered by MangalMurti Tech Solution" line, after the footer', [p80.text, p58.text].every((t) => t.endsWith(credit) && t.indexOf('Thank you') < t.indexOf(credit)), `${p80.text.slice(-70)} || ${p58.text.slice(-70)}`);
  await closeSettled();

  // ================================================================== G3  18% exclusive + UPI QR amount
  await api(ownerToken, 'PUT', '/settings/upi', { enabled: true, vpa: 'gst.shop@upi' });
  await api(ownerToken, 'PUT', '/settings/tax', { enabled: true, rate_percent: '18', mode: 'exclusive', apply_to: 'all' });
  const s2 = await posSale('Thali', { label: /UPI QR/ }, (d) => d.getByTestId('upi-panel-amount').waitFor({ timeout: 15000 }));
  const upiAmount = norm(await s2.dialog.getByTestId('upi-panel-amount').innerText());
  const payload = await s2.dialog.getByTestId('upi-qr').getAttribute('data-qr-text');
  const q = Object.fromEntries(new URLSearchParams(payload.split('?')[1]));
  check('G-11', 'After the owner changes GST to 18%, the new bill uses 18%: cart GST (18%) 18.00 / total 118.00', s2.cartLines[1] === 'GST (18%): ₹18.00' && /₹118\.00/.test(s2.grand) && s2.modalTotal === '118.00', `${s2.cartLines.join(' | ')} | ${s2.grand}`);
  check('G-12', 'UPI QR amount is the GST-inclusive payable amount: panel Pay Rs 118.00 and QR am=118.00', /118\.00/.test(upiAmount) && q.am === '118.00' && q.pa === 'gst.shop@upi', `${upiAmount} ${payload}`);
  const stale = await api(cashierToken, 'POST', '/billing/pay', { order_id: (await api(ownerToken, 'GET', '/orders')).data.data.find((o) => o.order_number === s2.orderNumber).id, payment_method: 'cash', amount: '105.00', cash_tendered: 200 }, true);
  check('G-13', 'A client still using the old 5% total (105.00) is refused by the server', stale.status === 422, `${stale.status} ${stale.json.message}`);
  await s2.dialog.getByTestId('upi-utr').fill('412345678901');
  await s2.dialog.getByTestId('upi-verified').check();
  await settle(s2.dialog);
  const p2 = await capturePrint(() => page.getByRole('button', { name: 'Print Receipt' }).click(), 80, 'receipt-80mm-18pct-upi');
  check('G-14', 'UPI payment settles Rs 118.00; receipt shows GST (18%) 18.00 and TOTAL 118.00', row(p2.text, 'GST (18%)') === '18.00' && row(p2.text, 'TOTAL') === '118.00' && !/12%/.test(p2.text) && /Amount: ₹118\.00/.test(p2.text), p2.text.slice(0, 200));
  await closeSettled();
  await api(ownerToken, 'PUT', '/settings/upi', { enabled: false, vpa: 'gst.shop@upi' });

  // ================================================================== G4  inclusive 5%, card
  await api(ownerToken, 'PUT', '/settings/tax', { enabled: true, rate_percent: '5', mode: 'inclusive', apply_to: 'all' });
  const s3 = await posSale('Combo', { label: 'Card POS' });
  check('G-15', 'POS cart inclusive 5%: "Subtotal (including GST) 105.00", "GST Included (5%) 5.00", Grand Total 105.00 (GST not added again)', s3.cartLines[0] === 'Subtotal (including GST): ₹105.00' && s3.cartLines[1] === 'GST Included (5%): ₹5.00' && /₹105\.00/.test(s3.grand) && s3.modalTotal === '105.00', `${s3.cartLines.join(' | ')} | ${s3.grand}`);
  await settle(s3.dialog);
  const p3a = await capturePrint(() => page.getByRole('button', { name: 'Print Receipt' }).click(), 80, 'receipt-80mm-5pct-inclusive');
  const p3b = await capturePrint(() => page.getByRole('button', { name: 'Print Receipt' }).click(), 58, 'receipt-58mm-5pct-inclusive');
  const okIncl = (t) => row(t, 'Subtotal (including GST)') === '105.00' && row(t, 'GST Included (5%)') === '5.00' && row(t, 'TOTAL') === '105.00';
  check('G-16', 'Inclusive receipts (80 mm and 58 mm): Subtotal (including GST) 105.00, GST Included (5%) 5.00, TOTAL 105.00', okIncl(p3a.text) && okIncl(p3b.text), `${p3a.text.slice(80, 240)}`);
  await closeSettled();

  // ================================================================== G5  GST disabled, split
  await api(ownerToken, 'PUT', '/settings/tax', { enabled: false, rate_percent: '5', mode: 'exclusive', apply_to: 'all' });
  const s4 = await posSale('Thali', { label: 'Split' });
  check('G-17', 'GST disabled: the cart shows only Subtotal 100.00 and Grand Total 100.00; payment modal 100.00', s4.cartLines.length === 1 && s4.cartLines[0] === 'Subtotal: ₹100.00' && /₹100\.00/.test(s4.grand) && s4.modalTotal === '100.00', `${s4.cartLines.join(' | ')} | ${s4.grand}`);
  await settle(s4.dialog);
  const p4 = await capturePrint(() => page.getByRole('button', { name: 'Print Receipt' }).click(), 80, 'receipt-80mm-gst-disabled');
  check('G-18', 'GST-disabled receipt: no GST line, no percentage, TOTAL 100.00', row(p4.text, 'Subtotal') === '100.00' && row(p4.text, 'TOTAL') === '100.00' && !/GST \(|GST Included|Tax/.test(p4.text) && !/%/.test(p4.text), p4.text.slice(0, 200));
  await closeSettled();

  // ================================================================== G6  old bills unchanged; closing and reports
  await goto('#/orders');
  await page.getByRole('button', { name: `Open ${s1.orderNumber}` }).click();
  await page.getByRole('dialog').first().waitFor({ timeout: 15000 });
  const detailLines = (await page.getByTestId('order-tax-line').allInnerTexts()).map(norm);
  await page.screenshot({ path: join(shots, 'orders-detail-old-bill.png') });
  const reprint = await capturePrint(() => page.getByRole('button', { name: /Print receipt/ }).click(), 80, 'reprint-old-12pct-bill');
  check('G-19', 'GST is now disabled, but the first bill still shows its own GST (12%) 12.00 and total 112.00 in Orders and on a reprint',
    detailLines[1]?.startsWith('GST (12%)') && row(reprint.text, 'GST (12%)') === '12.00' && row(reprint.text, 'TOTAL') === '112.00', `${detailLines.join(' | ')} || ${reprint.text.slice(60, 220)}`);

  const today = new Date().toLocaleDateString('en-CA');
  const sum = (await api(ownerToken, 'GET', `/settlements/daily-summary?date=${today}`)).data.summary;
  const rep = (await api(ownerToken, 'GET', `/reports/sales-summary?start_date=${today}&end_date=${today}`)).data.days[0];
  check('G-20', 'Daily closing figures: GST as billed 35.00 (12 + 18 + 5 + 0), net sales 435.00, taxable gross 400.00', sum.tax_collected === '35.00' && sum.net_sales === '435.00' && sum.gross_sales === '400.00', JSON.stringify(sum));
  check('G-21', 'Sales report agrees: paid GST 35.00, paid subtotal 400.00, paid total 435.00', Number(rep.paid_tax) === 35 && Number(rep.paid_subtotal) === 400 && Number(rep.paid_total) === 435, JSON.stringify(rep));
  await page.reload();
  await goto('#/settlements');
  await page.getByTestId('closing-gst').waitFor({ timeout: 15000 });
  const gstText = norm(await page.getByTestId('closing-gst').innerText());
  await page.screenshot({ path: join(shots, 'daily-closing.png') });
  check('G-22', 'Daily Closing screen shows "Includes GST ₹35.00 as billed" (no fixed 5% text)', gstText === 'Includes GST ₹35.00 as billed' && !/5%/.test(await page.locator('body').innerText()), gstText);

  const bills = (await api(ownerToken, 'GET', '/orders?per_page=50')).data.data.filter((o) => o.payment_status === 'paid');
  const snapshot = bills.map((o) => `${o.total_amount}:${o.tax_mode}:${o.tax_rate_percent}:${o.tax_amount}`).sort();
  check('G-23', 'All four bills kept their own mode/rate/GST after every configuration change', JSON.stringify(snapshot) === JSON.stringify(['100.00:none:0.00:0.00', '105.00:inclusive:5.00:5.00', '112.00:exclusive:12.00:12.00', '118.00:exclusive:18.00:18.00'].sort()), snapshot.join(' '));
  const audit = (await api(ownerToken, 'GET', '/reports/audit-logs?action=settings_updated&per_page=100')).data.data.filter((r) => r.entity_id === 'tax');
  const vals = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
  check('G-24', 'Every successful GST change (4) is in the audit log with old and new values; refused changes are not', audit.length === 4 && audit.every((r) => vals(r.new_values)?.rate_percent !== undefined && vals(r.old_values)?.rate_percent !== undefined), `${audit.length} entries`);
  const real = pageErrors.filter((e) => !/Failed to load resource|ERR_|net::|frame-ancestors/.test(e));
  check('G-25', 'No unexpected renderer errors', real.length === 0, real.slice(0, 3).join(' | '));
} catch (err) {
  check('G-ERR', 'Journey completed without an unexpected error', false, String(err?.message || err).split('\n').slice(0, 4).join(' '));
  try {
    if (page) await page.screenshot({ path: join(shots, 'gst-failure.png') });
    if (page) console.log(`url=${page.url()} body=${(await page.evaluate(() => document.body.innerText)).slice(0, 400).replace(/\s+/g, ' ')}`);
  } catch {}
  if (pageErrors.length) console.log(`Renderer errors:\n${pageErrors.slice(-8).join('\n')}`);
} finally {
  try {
    if (app) await app.close();
  } catch {}
  writeFileSync(join(HERE, '..', '..', 'qa', 'desktop', 'results', 'gst-config-results.json'), JSON.stringify(results, null, 2));
  await new Promise((r) => setTimeout(r, 1500));
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
  const fails = results.filter((r) => r.result === 'FAIL').length;
  console.log(`\nTOTAL: ${results.length - fails} PASS, ${fails} FAIL`);
  process.exit(fails ? 1 : 0);
}
