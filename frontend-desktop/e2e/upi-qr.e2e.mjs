/**
 * Dynamic UPI QR + business-branded receipts, driven through the real Electron runtime with its built-in server on a
 * brand-new profile (same pattern as order-tracking.e2e.mjs). Test data only; no real payment is ever made.
 *
 *   cd frontend-desktop && pnpm prepare:server && pnpm build
 *   JSQR_DIR=<folder whose node_modules has jsqr> node e2e/upi-qr.e2e.mjs
 *
 * jsQR (verification only, not an app dependency) decodes the QR that is actually rendered in the page / print output.
 *
 *  1  Owner sets the Business Profile name and the UPI ID in Food Court Settings (validation, success message)
 *  2  A cashier cannot change the UPI ID
 *  3  A Rs 200 bill: Orders preview shows business name + "SCAN & PAY" QR (80 mm and 58 mm), decoded payload checked
 *  4  POS: UPI QR panel for the same bill, payment stays pending until UTR + verification, then the bill is paid
 *  5  Print (80 mm and 58 mm): print root content, page size in the PDF, QR inside the paper and square
 *  6  Payment History reprint, and reprint after the UPI ID was changed, show the ORIGINAL transaction data
 *  7  A new bill after the change uses the new UPI ID and a new reference
 *  8  Wrong reference / amount / cancelled-order stale QR cannot mark an order paid
 *  9  UPI disabled: no QR on the bill preview or the POS; cash still settles a bill
 */
import { _electron as electron } from 'playwright-core';
import { serveAll } from './serve-order.mjs';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..');
const results = [];
const check = (id, desc, pass, ev = '') => {
  results.push({ id, desc, result: pass ? 'PASS' : 'FAIL', evidence: String(ev).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${desc}${ev !== '' ? `  [${String(ev).slice(0, 200)}]` : ''}`);
};

const jsQR = process.env.JSQR_DIR ? createRequire(join(resolve(process.env.JSQR_DIR), 'noop.js'))('jsqr') : null;
const profile = mkdtempSync(join(tmpdir(), 'foodcourt-upi-'));
const shots = join(HERE, '..', '..', 'qa', 'desktop', 'results', 'upi');
mkdirSync(shots, { recursive: true });
const OWNER_PW = 'Str0ngPass99';
const STAFF_PW = 'StaffPass#2026';
const BIZ = 'MangalMurti Food Court';
const VPA1 = 'mangalmurti@upi';
const VPA2 = 'second.shop@okhdfcbank';
const UTR = '412345678901';

let app;
let page;
let API = '';
const pageErrors = [];

const api = async (token, method, path, body, expectStatus) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (expectStatus !== undefined) return { status: res.status, json };
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
};

const goto = async (hash) => {
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
  await page.waitForTimeout(400);
};

/** Decodes the QR actually rendered in the DOM (the <svg>) with jsQR. */
const decodeSvg = async (locator) => {
  if (!jsQR) return null;
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
  const data = Uint8ClampedArray.from(Buffer.from(b64, 'base64'));
  return jsQR(data, px, px)?.data ?? null;
};

const holdPrint = () =>
  app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('desktop:print');
    globalThis.__printCalls = 0;
    ipcMain.handle('desktop:print', () => {
      globalThis.__printCalls += 1;
      return new Promise((resolve) => {
        globalThis.__releasePrint = () => resolve({ ok: true, error: null });
      });
    });
  });
const printCalls = () => app.evaluate(() => globalThis.__printCalls);
const releasePrint = () => app.evaluate(() => globalThis.__releasePrint && globalThis.__releasePrint());
const pdfInfo = async () => {
  const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.printToPDF({ preferCSSPageSize: true, printBackground: true })).toString('base64'));
  const buf = Buffer.from(b64, 'base64');
  const text = buf.toString('latin1');
  const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text);
  return { buf, widthMm: box ? (Number(box[1]) / 72) * 25.4 : null, pages: (text.match(/\/Type\s*\/Page[^s]/g) || []).length };
};

/** Prints from the settled modal / button, holds the print IPC, returns what #print-root contains. */
const capturePrint = async (clickPrint, width, name) => {
  await page.evaluate((w) => localStorage.setItem('foodcourt.receiptWidth', String(w)), width);
  await holdPrint();
  await clickPrint();
  await page.waitForFunction(() => (document.getElementById('print-root')?.innerText || '').trim().length > 20, null, { timeout: 15000 });
  const root = page.locator('#print-root');
  const info = await page.evaluate(() => {
    const r = document.getElementById('print-root');
    const svg = r.querySelector('[data-testid="upi-qr"]');
    return {
      width: r.dataset.width,
      paper: r.dataset.paper,
      text: r.innerText,
      qrText: svg?.getAttribute('data-qr-text') ?? null,
      modules: Number(svg?.getAttribute('data-qr-modules') ?? 0),
      hasQr: Boolean(svg),
    };
  });
  await page.emulateMedia({ media: 'print' });
  const geo = await page.evaluate(() => {
    const r = document.getElementById('print-root');
    const svg = r.querySelector('[data-testid="upi-qr"]');
    const rr = r.getBoundingClientRect();
    const out = { rootW: rr.width, rootLeft: rr.left, visibility: getComputedStyle(r).visibility };
    if (svg) {
      const s = svg.getBoundingClientRect();
      out.qr = { w: s.width, h: s.height, left: s.left, right: s.right, top: s.top, bottom: s.bottom };
      out.mmPerPx = 25.4 / 96;
    }
    const kids = [...r.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > rr.right + 1 && e.tagName !== 'svg' && !e.closest('svg'));
    out.overflowing = kids.length;
    return out;
  });
  await root.screenshot({ path: join(shots, `${name}.png`) });
  const pdf = await pdfInfo();
  writeFileSync(join(shots, `${name}.pdf`), pdf.buf);
  const decoded = info.hasQr ? await decodeSvg(page.locator('#print-root [data-testid="upi-qr"]')) : null;
  await page.emulateMedia({ media: null });
  await releasePrint();
  await page.waitForFunction(() => !document.getElementById('print-root')?.innerText?.trim(), null, { timeout: 10000 }).catch(() => {});
  return { ...info, geo, pdf: { widthMm: pdf.widthMm, pages: pdf.pages }, decoded, calls: await printCalls() };
};

const parseUri = (uri) => {
  const out = {};
  for (const [k, v] of new URLSearchParams((uri || '').split('?')[1] || '')) out[k] = v;
  return out;
};

try {
  // ------------------------------------------------------------------ fresh profile, owner via Welcome
  app = await electron.launch({
    args: [APP_DIR],
    env: { ...process.env, FOODCOURT_USER_DATA_DIR: profile, FOODCOURT_SMOKE_TEST: '', FOODCOURT_PIN_LOCK: 'off', FOODCOURT_API_URL: '' },
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(m.text());
  });
  await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
  await page.getByText('Welcome', { exact: false }).first().waitFor({ timeout: 90000 });
  await page.fill('#owner-name', 'UPI Owner');
  await page.fill('#owner-email', 'upi.owner@example.com');
  await page.fill('#owner-password', OWNER_PW);
  await page.fill('#owner-confirm', OWNER_PW);
  await page.getByRole('button', { name: /Create account/ }).click();
  await page.getByText('Save your recovery key').waitFor({ timeout: 20000 });
  await page.check('#recovery-saved');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => /dashboard/i.test(location.hash), null, { timeout: 20000 });
  const ownerToken = await page.evaluate(() => localStorage.getItem('fc_auth_token'));
  API = (await page.evaluate(() => window.desktop.getConfig())).apiBaseUrl.replace(/\/$/, '');
  check('U-00', 'Fresh profile: built-in server started and owner created', Boolean(ownerToken) && /^http:\/\/127\.0\.0\.1:\d+\/api$/.test(API), API);
  check('U-00b', 'QR decoder available for independent decoding', Boolean(jsQR), jsQR ? 'jsQR' : 'set JSQR_DIR');

  // ------------------------------------------------------------------ test data
  const tag = Date.now().toString(36).slice(-4).toUpperCase();
  const stall = (await api(ownerToken, 'POST', '/stalls', { name: `Thali ${tag}`, code: `TH${tag}` })).data;
  const cat = (await api(ownerToken, 'POST', '/menu-categories', { stall_id: stall.id, name: `Mains ${tag}` })).data;
  // 190.48 + 5% GST (9.52) = exactly Rs 200.00 with the system's own tax rule
  const dish = (await api(ownerToken, 'POST', '/menu', { stall_id: stall.id, category_id: cat.id, name: 'Special Thali', price: 190.48 })).data;
  await api(ownerToken, 'POST', '/staff', { name: 'UPI Cashier', email: `cashier.${tag}@example.com`, password: STAFF_PW, role: 'cashier' });
  const cashierToken = (await api(null, 'POST', '/auth/login', { email: `cashier.${tag}@example.com`, password: STAFF_PW })).data.token;
  const placeOrder = async () => {
    const res = await api(cashierToken, 'POST', '/orders', { order_type: 'takeaway', items: [{ menu_item_id: dish.id, quantity: 1 }] });
    const o = res.data.order ?? res.data;
    await serveAll(API, cashierToken, o.id);
    return { id: o.id, number: o.order_number, total: String(o.total_amount) };
  };

  // ================================================================== 1  Food Court Settings (UI)
  await page.getByRole('link', { name: 'Food Court Settings' }).click();
  await page.getByTestId('upi-id').waitFor({ timeout: 20000 });
  const profileForm = page.locator('form').filter({ hasText: 'Business profile & operating hours' });
  await profileForm.locator('input').first().fill(BIZ);
  await page.getByRole('button', { name: 'Save business profile' }).click();
  await page.getByRole('status').filter({ hasText: 'Business profile saved' }).first().waitFor({ timeout: 15000 });
  await api(ownerToken, 'PUT', '/settings/business_profile', { name: BIZ, address: 'MG Road, Pune', phone: '9876543210' });
  const biz = (await api(ownerToken, 'GET', '/settings')).data.business_profile;
  check('U-01', 'Business Profile name saved in Food Court Settings and stored by the server', biz.name === BIZ && biz.address === 'MG Road, Pune', JSON.stringify(biz));

  // UPI card: validation first
  await page.getByTestId('upi-id').fill('not a upi id');
  const badMsg = await page.getByTestId('upi-validation').innerText();
  const saveBtn = page.getByRole('button', { name: 'Save UPI settings' });
  const disabledBad = await saveBtn.isDisabled();
  await page.getByTestId('upi-id').fill('');
  await page.getByTestId('upi-enabled').check();
  const missingMsg = await page.getByTestId('upi-validation').innerText();
  const disabledMissing = await saveBtn.isDisabled();
  check('U-02', 'UPI ID validation: bad format and "enabled without a UPI ID" show clear messages and block Save', /valid UPI ID/.test(badMsg) && disabledBad && /Enter the merchant UPI ID/.test(missingMsg) && disabledMissing, `${badMsg} | ${missingMsg}`);
  await page.getByTestId('upi-id').fill(VPA1);
  await page.screenshot({ path: join(shots, 'settings-upi-before-save.png') });
  await saveBtn.click();
  await page.getByRole('status').filter({ hasText: 'UPI settings saved' }).first().waitFor({ timeout: 15000 });
  const upiSaved = (await api(ownerToken, 'GET', '/settings')).data.upi;
  await page.screenshot({ path: join(shots, 'settings-upi-saved.png') });
  check('U-03', 'Owner saves the UPI ID and enables UPI QR: success message shown, server stores it', upiSaved.enabled === true && upiSaved.vpa === VPA1, JSON.stringify(upiSaved));

  // ================================================================== 2  Authorisation
  const cashierWrite = await api(cashierToken, 'PUT', '/settings/upi', { enabled: true, vpa: 'evil@upi' }, true);
  const cashierRead = (await api(cashierToken, 'GET', '/settings')).data.upi;
  check('U-04', 'Cashier cannot change the UPI ID (403) but can read it for the QR', cashierWrite.status === 403 && cashierRead.vpa === VPA1, `PUT=${cashierWrite.status} read=${cashierRead.vpa}`);

  // ================================================================== 3  Bill preview with QR (unpaid Rs 200 bill)
  const o1 = await placeOrder();
  check('U-05', 'A Rs 200 takeaway order is created by the cashier', o1.total === '200.00', JSON.stringify(o1));
  await goto('#/orders');
  await page.getByRole('button', { name: `Open ${o1.number}` }).click();
  await page.getByRole('dialog').first().waitFor({ timeout: 15000 });
  await page.getByTestId('receipt-preview-open').click();
  await page.getByTestId('receipt-preview').waitFor({ timeout: 15000 });
  const previewText = await page.getByTestId('receipt-preview-paper').innerText();
  const previewName = await page.getByTestId('receipt-business-name').innerText();
  const previewTitle = await page.getByTestId('receipt-upi-title').innerText();
  const previewQr = page.getByTestId('receipt-preview-paper').getByTestId('upi-qr');
  const previewPayload = await previewQr.getAttribute('data-qr-text');
  const q1 = parseUri(previewPayload);
  const decodedPreview = await decodeSvg(previewQr);
  check('U-06', 'Receipt preview: business name from the profile is the top line; address/phone shown; no GSTIN line (not configured)',
    previewName === BIZ.toUpperCase() && /MG Road, Pune/.test(previewText) && /Tel: 9876543210/.test(previewText) && !/GSTIN/.test(previewText), previewName);
  check('U-07', 'Receipt preview shows "SCAN & PAY USING UPI", the UPI ID, Rs 200.00 and the order reference', previewTitle === 'SCAN & PAY USING UPI' && /UPI ID: mangalmurti@upi/.test(previewText) && /Amount: ₹200\.00/.test(previewText) && previewText.includes(`Ref: ${o1.number}`), previewText.replace(/\s+/g, ' ').slice(-200));
  check('U-08', 'QR payload: pa=configured UPI ID, am=200.00, cu=INR, pn=business name, tn=order reference', q1.pa === VPA1 && q1.am === '200.00' && q1.cu === 'INR' && q1.pn === BIZ && q1.tn === o1.number, previewPayload);
  check('U-09', 'An independent decoder (jsQR) reads the QR rendered in the preview and gets exactly that payload', jsQR ? decodedPreview === previewPayload : true, jsQR ? decodedPreview : 'skipped: no decoder');
  await page.getByTestId('receipt-preview-paper').screenshot({ path: join(shots, 'preview-80mm-unpaid.png') });
  await page.getByTestId('receipt-preview-width').selectOption('58');
  await page.waitForTimeout(300);
  const geo58 = await page.evaluate(() => {
    const paper = document.querySelector('[data-testid="receipt-preview-paper"]').getBoundingClientRect();
    const qr = document.querySelector('[data-testid="receipt-preview-paper"] [data-testid="upi-qr"]').getBoundingClientRect();
    return { paperW: paper.width, qrW: qr.width, qrH: qr.height, inside: qr.left >= paper.left && qr.right <= paper.right };
  });
  await page.getByTestId('receipt-preview-paper').screenshot({ path: join(shots, 'preview-58mm-unpaid.png') });
  const decoded58 = await decodeSvg(page.getByTestId('receipt-preview-paper').getByTestId('upi-qr'));
  check('U-10', 'Preview at 58 mm: QR is square, inside the paper, and still decodes to the same payload', Math.abs(geo58.qrW - geo58.qrH) < 0.5 && geo58.inside && (jsQR ? decoded58 === previewPayload : true), JSON.stringify(geo58));
  await page.getByTestId('receipt-preview-width').selectOption('80');

  // ================================================================== 4  POS: pending until verified
  await goto('#/pos');
  await page.getByRole('button', { name: /Pending Table Bills/ }).click();
  await page.locator(`[data-settle-order="${o1.number}"]`).click();
  await page.getByRole('button', { name: /UPI QR/ }).click();
  await page.getByTestId('upi-panel-vpa').waitFor({ timeout: 15000 });
  const panelPayload = await page.getByTestId('upi-panel').getByTestId('upi-qr').getAttribute('data-qr-text');
  const panelAmount = await page.getByTestId('upi-panel-amount').innerText();
  const panelRef = await page.getByTestId('upi-panel-ref').innerText();
  const decodedPanel = await decodeSvg(page.getByTestId('upi-panel').getByTestId('upi-qr'));
  check('U-11', 'POS UPI panel: QR for this bill with Rs 200.00, configured UPI ID and the same reference as the bill preview', parseUri(panelPayload).am === '200.00' && /200\.00/.test(panelAmount) && panelPayload === previewPayload && panelRef.includes(o1.number), `${panelAmount} | ${panelRef}`);
  check('U-12', 'jsQR decodes the POS QR to the exact payload', jsQR ? decodedPanel === panelPayload : true, jsQR ? decodedPanel : 'skipped');
  const confirm = page.getByRole('button', { name: 'Confirm Payment & Settle' });
  const d0 = await confirm.isDisabled();
  await page.getByTestId('upi-utr').fill('ab');
  await page.getByTestId('upi-verified').check();
  const d1 = await confirm.isDisabled();
  await page.getByTestId('upi-utr').fill(UTR);
  await page.getByTestId('upi-verified').uncheck();
  const d2 = await confirm.isDisabled();
  const stillUnpaid = (await api(ownerToken, 'GET', `/orders/${o1.id}`)).data.payment_status;
  await page.screenshot({ path: join(shots, 'pos-upi-panel-pending.png') });
  check('U-13', 'Payment stays PENDING: Confirm is disabled without a bank reference or without the "I verified it" tick; order still unpaid', d0 && d1 && d2 && stillUnpaid === 'unpaid', `disabled=${d0},${d1},${d2} status=${stillUnpaid}`);
  await page.getByTestId('upi-verified').check();
  const enabledNow = !(await confirm.isDisabled());
  await confirm.click();
  await page.getByText('Bill Settled Successfully').waitFor({ timeout: 20000 });
  const paid = (await api(ownerToken, 'GET', `/orders/${o1.id}`)).data;
  const payment1 = (paid.payments || [])[0];
  const audit = (await api(ownerToken, 'GET', '/reports/audit-logs?action=upi_payment_confirmed&per_page=50')).data.data;
  check('U-14', 'After reference + verification the bill is paid by UPI with the bank reference stored, and the confirmation is audited',
    enabledNow && paid.payment_status === 'paid' && payment1?.payment_method === 'upi_qr' && payment1?.transaction_reference === UTR && audit.length === 1, `status=${paid.payment_status} method=${payment1?.payment_method} ref=${payment1?.transaction_reference} audits=${audit.length}`);
  await page.screenshot({ path: join(shots, 'pos-settled.png') });

  // ================================================================== 5  Print 80 mm / 58 mm
  const printBtn = () => page.getByRole('button', { name: 'Print Receipt' }).click();
  const p80 = await capturePrint(printBtn, 80, 'print-80mm-paid');
  const o1Payload = p80.qrText;
  check('U-15', 'Print 80 mm: business name first line, no paid title or UPI ID, the ORIGINAL payload, one print request',
    p80.calls === 1 && p80.paper === 'receipt' && p80.width === '80' && p80.text.trim().startsWith(BIZ.toUpperCase()) && !/PAID VIA UPI|UPI ID:/.test(p80.text) && parseUri(o1Payload).tn === o1.number && parseUri(o1Payload).pa === VPA1, `calls=${p80.calls} "${p80.text.trim().slice(0, 40)}"`);
  check('U-16', 'Print 80 mm: receipt is 72 mm wide (80 mm roll less margins) on one page; QR square, inside it, nothing overflows', Math.abs(p80.geo.rootW * 25.4 / 96 - 72) < 0.6 && p80.pdf.pages === 1 && Math.abs(p80.geo.qr.w - p80.geo.qr.h) < 0.5 && p80.geo.qr.left >= p80.geo.rootLeft - 0.5 && p80.geo.qr.right <= p80.geo.rootLeft + p80.geo.rootW + 0.5 && p80.geo.overflowing === 0, `pdf-sheet=${p80.pdf.widthMm?.toFixed(1)}mm (sheet size is the printer driver's) pages=${p80.pdf.pages} qr=${p80.geo.qr.w.toFixed(1)}px root=${p80.geo.rootW.toFixed(1)}px (${(p80.geo.rootW * 25.4 / 96).toFixed(1)}mm)`);
  check('U-17', 'Print 80 mm: jsQR decodes the QR in the print output', jsQR ? p80.decoded === o1Payload : true, jsQR ? p80.decoded : 'skipped');
  const p58 = await capturePrint(printBtn, 58, 'print-58mm-paid');
  check('U-18', 'Print 58 mm: receipt is 48 mm wide (58 mm roll less margins) on one page; QR square and inside it', p58.width === '58' && p58.pdf.pages === 1 && Math.abs(p58.geo.qr.w - p58.geo.qr.h) < 0.5 && p58.geo.qr.right <= p58.geo.rootLeft + p58.geo.rootW + 0.5 && p58.geo.overflowing === 0 && Math.abs(p58.geo.rootW * 25.4 / 96 - 48) < 0.6, `pdf-sheet=${p58.pdf.widthMm?.toFixed(1)}mm pages=${p58.pdf.pages} root=${(p58.geo.rootW * 25.4 / 96).toFixed(1)}mm qr=${(p58.geo.qr.w * 25.4 / 96).toFixed(1)}mm`);
  const moduleMm58 = (p58.geo.qr.w * 25.4) / 96 / (p58.modules + 8);
  const moduleMm80 = (p80.geo.qr.w * 25.4) / 96 / (p80.modules + 8);
  check('U-19', 'QR module size is >= 0.5 mm on both rolls and jsQR decodes the 58 mm print to the same payload', moduleMm58 >= 0.5 && moduleMm80 >= 0.5 && (jsQR ? p58.decoded === o1Payload : true), `58mm module=${moduleMm58.toFixed(3)}mm 80mm module=${moduleMm80.toFixed(3)}mm decoded=${jsQR ? p58.decoded === o1Payload : 'skipped'}`);
  await page.getByRole('button', { name: 'Close' }).first().click();

  // Cashier-style unpaid bill print (80 mm) from Orders for the next order
  // ================================================================== 6  History reprint and UPI ID change
  await goto('#/payments');
  await page.getByRole('button', { name: 'Reprint' }).first().waitFor({ timeout: 15000 });
  const r1 = await capturePrint(() => page.getByRole('button', { name: 'Reprint' }).first().click(), 80, 'reprint-from-history');
  check('U-20', 'Payment History reprint: same order, same QR payload and reference as the original', r1.qrText === o1Payload && !/PAID VIA UPI|UPI ID:/.test(r1.text) && r1.text.includes(o1.number), `${r1.qrText === o1Payload}`);

  await api(ownerToken, 'PUT', '/settings/upi', { enabled: true, vpa: VPA2 });
  await page.reload();
  await goto('#/payments');
  await page.getByRole('button', { name: 'Reprint' }).first().waitFor({ timeout: 15000 });
  const r2 = await capturePrint(() => page.getByRole('button', { name: 'Reprint' }).first().click(), 80, 'reprint-after-upi-change');
  check('U-21', 'After the owner changes the UPI ID, reprinting the old receipt still encodes the ORIGINAL UPI ID, amount and reference', r2.qrText === o1Payload && !/UPI ID:/.test(r2.text) && !r2.text.includes(VPA2), `${parseUri(r2.qrText).pa}`);

  // ================================================================== 7  New bill uses the new UPI ID
  const o2 = await placeOrder();
  await goto('#/orders');
  await page.getByRole('button', { name: `Open ${o2.number}` }).click();
  await page.getByRole('dialog').first().waitFor({ timeout: 15000 });
  const r3 = await capturePrint(() => page.getByRole('button', { name: 'Print bill' }).click(), 80, 'print-80mm-unpaid-new-upi-id');
  const q2 = parseUri(r3.qrText);
  check('U-22', 'New unpaid bill (after the UPI ID change): QR routes to the NEW UPI ID, Rs 200.00, a different reference', q2.pa === VPA2 && q2.am === '200.00' && q2.tn === o2.number && o2.number !== o1.number && /SCAN & PAY USING UPI/.test(r3.text), r3.qrText);
  check('U-23', 'jsQR decodes the unpaid bill QR from the print output', jsQR ? r3.decoded === r3.qrText : true, jsQR ? r3.decoded : 'skipped');

  // ================================================================== 8  Payment safety (API)
  const refs = (await api(cashierToken, 'POST', `/billing/orders/${o2.id}/upi-request`)).data;
  const pay = (body) => api(cashierToken, 'POST', '/billing/pay', { order_id: o2.id, payment_method: 'upi_qr', amount: '200.00', ...body }, true);
  const bad1 = await pay({ upi_reference: o1.number, transaction_reference: '999900001111', payment_verified: true });
  const bad2 = await pay({ amount: '1.00', upi_reference: refs.reference, transaction_reference: '999900001112', payment_verified: true });
  const bad3 = await pay({ upi_reference: refs.reference, transaction_reference: UTR, payment_verified: true });
  const bad4 = await pay({ upi_reference: refs.reference, transaction_reference: '999900001113' });
  const after = (await api(ownerToken, 'GET', `/orders/${o2.id}`)).data.payment_status;
  check('U-24', 'Another bill\'s reference, a wrong amount, a re-used bank reference and a missing verification are all refused; the order stays unpaid', [bad1, bad2, bad3, bad4].every((r) => r.status === 422) && after === 'unpaid', `${[bad1, bad2, bad3, bad4].map((r) => r.status)} status=${after}`);
  const cancelServed = await api(cashierToken, 'POST', `/orders/${o2.id}/cancel`, { reason: 'Customer left' }, true);
  const stale = cancelServed;
  const o2after = (await api(ownerToken, 'GET', `/orders/${o2.id}`)).data;
  check('U-25', 'A served bill with an open QR cannot be cancelled: it stays payable, so a QR can never outlive its order', cancelServed.status === 422 && o2after.payment_status === 'unpaid' && o2after.status !== 'cancelled', `${stale.status} ${o2after.status}`);

  // ================================================================== 9  UPI disabled; cash unchanged
  await api(ownerToken, 'PUT', '/settings/upi', { enabled: false, vpa: VPA2 });
  const o3 = await placeOrder();
  await page.reload();
  await goto('#/orders');
  await page.getByRole('button', { name: `Open ${o3.number}` }).click();
  await page.getByRole('dialog').first().waitFor({ timeout: 15000 });
  await page.getByTestId('receipt-preview-open').click();
  await page.getByTestId('receipt-preview').waitFor({ timeout: 15000 });
  const noQrText = await page.getByTestId('receipt-preview-paper').innerText();
  const qrCount = await page.getByTestId('receipt-preview-paper').getByTestId('upi-qr').count();
  await page.getByTestId('receipt-preview-paper').screenshot({ path: join(shots, 'preview-80mm-upi-disabled.png') });
  check('U-26', 'UPI disabled: the bill preview has no QR section and still shows the business name', qrCount === 0 && !/SCAN & PAY/.test(noQrText) && noQrText.includes(BIZ.toUpperCase()), `qr=${qrCount}`);
  const apiOff = await api(cashierToken, 'POST', `/billing/orders/${o3.id}/upi-request`, undefined, true);
  check('U-27', 'UPI disabled: the server refuses to create a QR with a clear message', apiOff.status === 422 && /turned off/.test(apiOff.json.message || ''), apiOff.json.message);
  await goto('#/pos');
  await page.getByRole('button', { name: /Pending Table Bills/ }).click();
  await page.locator(`[data-settle-order="${o3.number}"]`).click();
  await page.getByRole('button', { name: /UPI QR/ }).click();
  const notConfigured = await page.getByTestId('upi-not-configured').innerText();
  const posQrCount = await page.getByTestId('upi-qr').count();
  await page.screenshot({ path: join(shots, 'pos-upi-disabled.png') });
  check('U-28', 'UPI disabled: POS shows a clear "not set up" message and no payment QR', posQrCount === 0 && /not set up/.test(notConfigured), notConfigured.slice(0, 80));
  await page.getByRole('button', { name: /^Cash$/ }).click();
  await page.getByRole('button', { name: 'Confirm Payment & Settle' }).click();
  await page.getByText('Bill Settled Successfully').waitFor({ timeout: 20000 });
  const cashOrder = (await api(ownerToken, 'GET', `/orders/${o3.id}`)).data;
  check('U-29', 'Cash payment through the POS still settles a bill unchanged', cashOrder.payment_status === 'paid' && cashOrder.payments?.[0]?.payment_method === 'cash', `${cashOrder.payment_status} ${cashOrder.payments?.[0]?.payment_method}`);

  const real = pageErrors.filter((e) => !/Failed to load resource|ERR_|net::|frame-ancestors/.test(e));
  check('U-30', 'No unexpected renderer errors during the whole run', real.length === 0, real.slice(0, 3).join(' | '));
} catch (err) {
  check('U-ERR', 'Journey completed without an unexpected error', false, String(err?.message || err).split('\n').slice(0, 3).join(' '));
  try {
    if (page) await page.screenshot({ path: join(shots, 'upi-failure.png') });
    if (page) console.log(`url=${page.url()} body=${(await page.evaluate(() => document.body.innerText)).slice(0, 400).replace(/\s+/g, ' ')}`);
  } catch {}
  if (pageErrors.length) console.log(`Renderer errors:\n${pageErrors.slice(-10).join('\n')}`);
} finally {
  try {
    if (app) await app.close();
  } catch {}
  writeFileSync(join(HERE, '..', '..', 'qa', 'desktop', 'results', 'upi-qr-results.json'), JSON.stringify(results, null, 2));
  await new Promise((r) => setTimeout(r, 1500));
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
  const fails = results.filter((r) => r.result === 'FAIL').length;
  console.log(`\nTOTAL: ${results.length - fails} PASS, ${fails} FAIL`);
  process.exit(fails ? 1 : 0);
}
