/**
 * UPI QR lifecycle and merchant-UPI-ID checks, driven through the real Electron UI on a brand-new profile (test data only;
 * no real payment is ever made, nothing is sent to any UPI provider).
 *
 *   cd frontend-desktop && node scripts/prepare-embedded-server.mjs && npx vite build
 *   node e2e/upi-lifecycle.e2e.mjs
 *
 *  L-01  fresh profile + owner
 *  L-02  an unrecognised provider handle (@oksb) is saved unchanged but flagged, with a "did you mean", and reported untested
 *  L-03  the controlled test QR: Rs 1.00 to the saved UPI ID, decoded from the rendered SVG; no order or payment is created
 *  L-04  the owner's test confirmation is recorded as an owner statement; a failed test stays untested
 *  L-05  changing the UPI ID drops the confirmation and the handle warning follows the new ID
 *  L-06  POS: a generated QR is Pending (bill unpaid); "customer started paying" is Initiated (bill still unpaid)
 *  L-07  "payment failed" closes that QR and shows a new one with a new reference; the bill is still unpaid
 *  L-08  only the cashier's manual verification pays the bill; the verifier and time are stored on the server; the paid receipt prints no paid title and no UPI ID
 */
import { _electron as electron } from 'playwright-core';
import { serveAll } from './serve-order.mjs';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..');
const jsQR = createRequire(import.meta.url)(join(APP_DIR, 'tests', 'vendor', 'jsqr', 'jsQR.cjs'));
const results = [];
const check = (id, desc, pass, ev = '') => {
  results.push({ id, desc, result: pass ? 'PASS' : 'FAIL', evidence: String(ev).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 200)}]` : ''}`);
};

const profile = mkdtempSync(join(tmpdir(), 'foodcourt-upilife-'));
const shots = join(HERE, '..', '..', 'qa', 'desktop', 'results', 'upi');
mkdirSync(shots, { recursive: true });
const OWNER_PW = 'Str0ngPass99';
const STAFF_PW = 'StaffPass#2026';
const BIZ = 'Urban Food Court';
const BAD_VPA = 'shubh.test@oksb';
const GOOD_VPA = 'shubh.test@oksbi';

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
  await page.waitForTimeout(400);
};
const parseUri = (uri) => {
  const out = {};
  for (const [k, v] of new URLSearchParams((uri || '').split('?')[1] || '')) out[k] = v;
  return out;
};
/** Decodes the QR actually rendered in the DOM (the <svg>) with jsQR. */
const decodeSvg = async (locator) => {
  const { px, b64 } = await locator.evaluate(async (svg) => {
    const xml = new XMLSerializer().serializeToString(svg);
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
    const img = new Image();
    img.src = url;
    await img.decode();
    const size = 480;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    const d = ctx.getImageData(0, 0, size, size).data;
    let s = '';
    for (let i = 0; i < d.length; i += 8192) s += String.fromCharCode.apply(null, d.subarray(i, i + 8192));
    return { px: size, b64: btoa(s) };
  });
  return jsQR(Uint8ClampedArray.from(Buffer.from(b64, 'base64')), px, px)?.data ?? null;
};

try {
  app = await electron.launch({ args: [APP_DIR], env: { ...process.env, FOODCOURT_USER_DATA_DIR: profile, FOODCOURT_SMOKE_TEST: '', FOODCOURT_PIN_LOCK: 'off', FOODCOURT_API_URL: '' }, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
  page.on('console', (m) => m.type() === 'error' && pageErrors.push(m.text()));
  await page.setViewportSize({ width: 1400, height: 1000 }).catch(() => {});
  await page.getByText('Welcome', { exact: false }).first().waitFor({ timeout: 90000 });
  await page.fill('#owner-name', 'UPI Owner');
  await page.fill('#owner-email', 'upi.life@example.com');
  await page.fill('#owner-password', OWNER_PW);
  await page.fill('#owner-confirm', OWNER_PW);
  await page.getByRole('button', { name: /Create account/ }).click();
  await page.getByText('Save your recovery key').waitFor({ timeout: 20000 });
  await page.check('#recovery-saved');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => /dashboard/i.test(location.hash), null, { timeout: 20000 });
  const ownerToken = await page.evaluate(() => localStorage.getItem('fc_auth_token'));
  API = (await page.evaluate(() => window.desktop.getConfig())).apiBaseUrl.replace(/\/$/, '');
  check('L-01', 'Fresh profile: built-in server started and owner created', Boolean(ownerToken), API);

  const tag = Date.now().toString(36).slice(-4).toUpperCase();
  const stall = (await api(ownerToken, 'POST', '/stalls', { name: `Thali ${tag}`, code: `TH${tag}` })).data;
  const cat = (await api(ownerToken, 'POST', '/menu-categories', { stall_id: stall.id, name: `Mains ${tag}` })).data;
  const dish = (await api(ownerToken, 'POST', '/menu', { stall_id: stall.id, category_id: cat.id, name: 'Special Thali', price: 25 })).data; // 25 + 5% GST = 26.25
  await api(ownerToken, 'PUT', '/settings/business_profile', { name: BIZ });
  await api(ownerToken, 'POST', '/staff', { name: 'UPI Cashier', email: `cashier.${tag}@example.com`, password: STAFF_PW, role: 'cashier' });
  const cashierToken = (await api(null, 'POST', '/auth/login', { email: `cashier.${tag}@example.com`, password: STAFF_PW })).data.token;
  const placeOrder = async () => {
    const res = await api(cashierToken, 'POST', '/orders', { order_type: 'takeaway', items: [{ menu_item_id: dish.id, quantity: 1 }] });
    const o = res.data.order ?? res.data;
    await serveAll(API, cashierToken, o.id);
    return { id: o.id, number: o.order_number, total: String(o.total_amount) };
  };

  // ================================================================== L-02 settings: unrecognised handle
  await page.getByRole('link', { name: 'Food Court Settings' }).click();
  await page.getByTestId('upi-id').waitFor({ timeout: 20000 });
  await page.getByTestId('upi-id').fill(BAD_VPA);
  await page.getByTestId('upi-enabled').check();
  await page.getByRole('button', { name: 'Save UPI settings' }).click();
  await page.getByRole('status').filter({ hasText: 'UPI settings saved' }).first().waitFor({ timeout: 15000 });
  await page.getByTestId('upi-warning-handle_unknown').waitFor({ timeout: 10000 });
  const warnText = await page.getByTestId('upi-warning-handle_unknown').innerText();
  const untestedShown = await page.getByTestId('upi-warning-untested').isVisible();
  const saved = (await api(ownerToken, 'GET', '/settings')).data.upi;
  await page.screenshot({ path: join(shots, 'settings-upi-unknown-handle.png') });
  check('L-02', 'Unrecognised handle "@oksb": saved UNCHANGED, warned with "did you mean @oksbi", reported untested, never reported provider-verified',
    saved.vpa === BAD_VPA && /@oksb/.test(warnText) && /Did you mean @oksbi\?/.test(warnText) && /invalid UPI ID/i.test(warnText) && untestedShown && saved.check.provider_verified === false && saved.check.test_confirmed === false,
    warnText.replace(/\s+/g, ' '));

  // ================================================================== L-03 controlled test QR
  const ordersBefore = (await api(ownerToken, 'GET', '/orders')).data.length;
  const paymentsBefore = (await api(ownerToken, 'GET', '/billing/payments')).data.total;
  await page.getByTestId('upi-test-start').click();
  await page.getByTestId('upi-test-panel').waitFor({ timeout: 10000 });
  const testQr = page.getByTestId('upi-test-panel').getByTestId('upi-qr');
  const testPayload = await testQr.getAttribute('data-qr-text');
  const decodedTest = await decodeSvg(testQr);
  const tq = parseUri(decodedTest);
  const ordersAfter = (await api(ownerToken, 'GET', '/orders')).data.length;
  const paymentsAfter = (await api(ownerToken, 'GET', '/billing/payments')).data.total;
  await page.screenshot({ path: join(shots, 'settings-upi-test-qr.png') });
  check('L-03', 'Test QR decodes (from the rendered SVG) to Rs 1.00 for the saved UPI ID with a TEST reference, and creates no order or payment',
    decodedTest === testPayload && tq.pa === BAD_VPA && tq.am === '1.00' && tq.cu === 'INR' && /^TEST-[0-9A-F]{8}$/.test(tq.tn) && tq.pn === BIZ && ordersBefore === ordersAfter && paymentsBefore === paymentsAfter,
    decodedTest);

  // ================================================================== L-04 owner confirmation vs failed test
  await page.getByTestId('upi-test-bad').click();
  const afterBad = await api(ownerToken, 'GET', '/settings');
  const stillUntested = afterBad.data.upi.check.test_confirmed === false && (await page.getByTestId('upi-warning-untested').isVisible());
  await page.getByTestId('upi-test-start').click();
  await page.getByTestId('upi-test-ok').click();
  await page.getByTestId('upi-test-confirmed').waitFor({ timeout: 10000 });
  const confirmedText = await page.getByTestId('upi-test-confirmed').innerText();
  const afterOk = (await api(ownerToken, 'GET', '/settings')).data.upi;
  const untestedGone = !(await page.getByTestId('upi-warning-untested').isVisible().catch(() => false));
  check('L-04', 'A failed test stays untested; "correct payee" is recorded as the OWNER\'s confirmation (not a bank verification) and the handle warning remains',
    stillUntested && afterOk.check.test_confirmed === true && afterOk.check.provider_verified === false && /not a bank verification/.test(confirmedText) && untestedGone && (await page.getByTestId('upi-warning-handle_unknown').isVisible()),
    confirmedText.replace(/\s+/g, ' '));

  // ================================================================== L-05 changing the UPI ID
  await page.getByTestId('upi-id').fill(GOOD_VPA);
  await page.getByRole('button', { name: 'Save UPI settings' }).click();
  await page.getByRole('status').filter({ hasText: 'UPI settings saved' }).first().waitFor({ timeout: 15000 });
  await page.getByTestId('upi-warning-untested').waitFor({ timeout: 10000 });
  const afterChange = (await api(ownerToken, 'GET', '/settings')).data.upi;
  const handleGone = !(await page.getByTestId('upi-warning-handle_unknown').isVisible().catch(() => false));
  check('L-05', 'Changing the UPI ID drops the test confirmation; the unknown-handle warning goes away for the known handle @oksbi but "untested" returns',
    afterChange.vpa === GOOD_VPA && afterChange.check.test_confirmed === false && afterChange.check.handle_known === true && handleGone, JSON.stringify(afterChange.check));

  // ================================================================== L-06 POS: pending -> initiated
  const o1 = await placeOrder();
  await goto('#/pos');
  await page.getByRole('button', { name: /Pending Table Bills/ }).click();
  await page.locator(`[data-settle-order="${o1.number}"]`).click();
  await page.getByRole('button', { name: /UPI QR/ }).click();
  await page.getByTestId('upi-panel-vpa').waitFor({ timeout: 15000 });
  const ref1 = (await page.getByTestId('upi-panel-ref').innerText()).trim();
  const status1 = await page.getByTestId('upi-panel-status').getAttribute('data-status');
  const posWarn = await page.getByTestId('upi-pos-warning-untested').isVisible();
  const unpaid1 = (await api(ownerToken, 'GET', `/orders/${o1.id}`)).data.payment_status;
  const decodedPos = await decodeSvg(page.getByTestId('upi-panel').getByTestId('upi-qr'));
  const pq = parseUri(decodedPos);
  check('L-06a', 'POS: QR generated = Pending, bill unpaid, amount 26.25 and reference in the decoded QR, untested-UPI-ID warning shown',
    status1 === 'pending' && unpaid1 === 'unpaid' && pq.am === '26.25' && pq.tn === ref1 && pq.pa === GOOD_VPA && posWarn, `${status1} ${decodedPos}`);
  await page.getByTestId('upi-mark-initiated').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="upi-panel-status"]')?.getAttribute('data-status') === 'initiated', null, { timeout: 10000 });
  const initiatedLabel = await page.getByTestId('upi-panel-status').innerText();
  const unpaid2 = (await api(ownerToken, 'GET', `/orders/${o1.id}`)).data.payment_status;
  const confirmDisabled = await page.getByRole('button', { name: 'Confirm Payment & Settle' }).isDisabled();
  await page.screenshot({ path: join(shots, 'pos-upi-initiated.png') });
  check('L-06b', 'Initiated is shown as "not yet verified"; the bill is still unpaid and cannot be settled without the verification tick',
    /Initiated/.test(initiatedLabel) && /not yet verified/.test(initiatedLabel) && unpaid2 === 'unpaid' && confirmDisabled, initiatedLabel);

  // ================================================================== L-07 failed -> new QR, new reference
  await page.getByTestId('upi-mark-failed').click();
  await page.waitForFunction((old) => {
    const el = document.querySelector('[data-testid="upi-panel-ref"]');
    return el && el.textContent.trim() !== old;
  }, ref1, { timeout: 15000 });
  const ref2 = (await page.getByTestId('upi-panel-ref').innerText()).trim();
  const status2 = await page.getByTestId('upi-panel-status').getAttribute('data-status');
  const unpaid3 = (await api(ownerToken, 'GET', `/orders/${o1.id}`)).data.payment_status;
  const oldRefPay = await api(cashierToken, 'POST', '/billing/pay', { order_id: o1.id, payment_method: 'upi_qr', amount: o1.total, upi_reference: ref1, payment_verified: true }, true);
  check('L-07', 'Payment failed: that QR is closed (cannot settle), a NEW QR with a new reference is Pending, and the bill is still unpaid',
    ref2 !== ref1 && ref2.startsWith(o1.number) && status2 === 'pending' && unpaid3 === 'unpaid' && oldRefPay.status === 422, `${ref1} -> ${ref2}; old reference pay=${oldRefPay.status}`);

  // ================================================================== L-08 manual verification
  await page.getByTestId('upi-utr').fill('412345678901');
  await page.getByTestId('upi-verified').check();
  await page.getByRole('button', { name: 'Confirm Payment & Settle' }).click();
  await page.getByText('Invoice #', { exact: false }).first().waitFor({ timeout: 15000 });
  const receipt = (await api(ownerToken, 'GET', `/billing/receipt/${o1.id}`)).data;
  const v = receipt.upi.verification;
  await goto('#/orders');
  await page.getByRole('button', { name: `Open ${o1.number}` }).click();
  await page.getByRole('dialog').first().waitFor({ timeout: 15000 });
  await page.getByTestId('receipt-preview-open').click();
  await page.getByTestId('receipt-preview').waitFor({ timeout: 15000 });
  const title = await page.getByTestId('receipt-upi-title').count();
  const extraNotes = await page.getByTestId('receipt-upi-instruction').count();
  const paperText = await page.getByTestId('receipt-preview-paper').innerText();
  await page.getByTestId('receipt-preview-paper').screenshot({ path: join(shots, 'preview-80mm-manually-verified.png') });
  check('L-08', 'Only the cashier\'s manual verification pays the bill; the receipt prints no paid title, UPI ID or extra note (verifier and time are recorded on the server) and makes no automatic-receipt claim',
    receipt.order.payment_status === 'paid' && receipt.upi.status === 'paid' && v.method === 'manual' && v.verified_by === 'UPI Owner' && !!v.verified_at &&
      title === 0 && extraNotes === 0 && !/PAID VIA UPI|MANUALLY VERIFIED|UPI ID:|Verified manually by|Checked by the cashier|Keep this receipt|payment received/i.test(paperText),
    title);

  // Same filter as upi-qr.e2e.mjs: the production CSP meta tag's frame-ancestors notice and failed resource loads are known/pre-existing
  const real = pageErrors.filter((e) => !/Failed to load resource|ERR_|net::|frame-ancestors/.test(e));
  if (real.length) console.log(`Renderer errors:\n${real.slice(-10).join('\n')}`);
  check('L-09', 'No unexpected renderer errors during the run', real.length === 0, real.slice(-3).join(' | '));
} catch (err) {
  check('L-ERR', 'Run completed without an exception', false, err?.stack || err);
  try {
    if (page) await page.screenshot({ path: join(shots, 'upi-lifecycle-failure.png') });
    if (page) console.log(`url=${page.url()} body=${(await page.evaluate(() => document.body.innerText)).slice(0, 500).replace(/\s+/g, ' ')}`);
  } catch {}
} finally {
  try {
    if (app) await app.close();
  } catch {}
  writeFileSync(join(HERE, '..', '..', 'qa', 'desktop', 'results', 'upi-lifecycle-results.json'), JSON.stringify(results, null, 2));
  await new Promise((r) => setTimeout(r, 1500));
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
  const fails = results.filter((r) => r.result === 'FAIL').length;
  console.log(`\nTOTAL: ${results.length - fails} PASS, ${fails} FAIL`);
  process.exit(fails ? 1 : 0);
}
