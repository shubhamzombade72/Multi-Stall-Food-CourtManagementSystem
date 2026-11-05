/**
 * UPI QR diagnostic. Reads (read-only) a COPY of a food court database, takes every stored UPI payment request,
 * re-encodes its exact `upi_uri` with the app's QR encoder, rasterises it like the printed receipt (203 dpi, quiet
 * zone) and decodes it with the independent jsQR decoder. It then checks every URI parameter and the merchant UPI ID.
 *
 *   node qa/desktop/upi-diagnose.mjs <copy-of-foodcourt.sqlite>
 *
 * Output: qa/desktop/results/upi/diagnostic.json. The UPI ID local part is masked in the output; the provider handle
 * (the part after @) is kept because it is the part that decides whether a UPI app accepts the ID.
 */
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const jsQR = createRequire(import.meta.url)(join(ROOT, 'frontend-desktop', 'tests', 'vendor', 'jsqr', 'jsQR.cjs'));
const { encodeQr } = await import(pathToFileURL(join(ROOT, 'frontend-desktop', 'src', 'lib', 'qr.ts')).href);

const dbPath = process.argv[2];
if (!dbPath) throw new Error('usage: node upi-diagnose.mjs <copy of foodcourt.sqlite>');
const db = new DatabaseSync(dbPath, { readOnly: true });

// Provider handles published by NPCI for the large UPI apps (informational; the list changes over time).
const KNOWN_HANDLES = ['okaxis', 'okhdfcbank', 'okicici', 'oksbi', 'ybl', 'ibl', 'axl', 'paytm', 'pthdfc', 'ptaxis', 'ptsbi', 'ptyes', 'upi', 'apl', 'sbi', 'axisbank', 'hdfcbank', 'icici', 'yesbank', 'kotak', 'barodampay', 'pnb', 'cnrb', 'unionbank', 'aubank', 'idfcbank', 'indus', 'fbl', 'rbl', 'jupiteraxis', 'freecharge', 'waicici', 'wahdfcbank', 'waaxis', 'wasbi', 'postbank'];
const edit = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
const mask = (vpa) => {
  const [l, h] = String(vpa).split('@');
  return `${l.slice(0, 2)}${'*'.repeat(Math.max(1, l.length - 3))}${l.slice(-1)}@${h ?? ''}`;
};
const vpaCheck = (vpa) => {
  const m = /^([a-z0-9][a-z0-9._-]{1,255})@([a-z][a-z0-9]{1,63})$/i.exec(vpa);
  if (!m) return { syntaxValid: false };
  const handle = m[2].toLowerCase();
  const known = KNOWN_HANDLES.includes(handle);
  const near = known ? null : KNOWN_HANDLES.map((h) => [h, edit(handle, h)]).sort((a, b) => a[1] - b[1])[0];
  return { syntaxValid: true, handle, handleKnown: known, closestKnownHandle: near && near[1] <= 2 ? near[0] : null };
};

const raster = (qr, dots) => {
  const quiet = 4;
  const units = qr.size + quiet * 2;
  const px = units * dots;
  const data = new Uint8ClampedArray(px * px * 4).fill(255);
  for (let y = 0; y < qr.size; y++)
    for (let x = 0; x < qr.size; x++) {
      if (!qr.modules[y][x]) continue;
      for (let dy = 0; dy < dots; dy++)
        for (let dx = 0; dx < dots; dx++) {
          const i = (((y + quiet) * dots + dy) * px + (x + quiet) * dots + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
    }
  return { data, px };
};

const parseUri = (uri) => {
  const [scheme, query = ''] = uri.split('?');
  const pairs = query.split('&').map((p) => p.split('='));
  const keys = pairs.map((p) => p[0]);
  const params = Object.fromEntries(pairs.map(([k, v]) => [k, decodeURIComponent(v ?? '')]));
  return { scheme, keys, duplicates: keys.filter((k, i) => keys.indexOf(k) !== i), params, rawHasSpace: /\s/.test(uri), doubleEncoded: /%25[0-9A-F]{2}/i.test(uri) };
};

const settings = {};
for (const r of db.prepare("select key, value from settings where key in ('upi','business_profile','payment_methods')").all()) settings[r.key] = JSON.parse(r.value);
const requests = db
  .prepare('select r.id, r.order_id, r.reference, r.vpa, r.payee_name, r.amount, r.upi_uri, r.status, r.payment_id, r.created_at, o.total_amount, o.payment_status, o.order_number from upi_payment_requests r join orders o on o.id = r.order_id order by r.id')
  .all();
const payments = db.prepare("select id, order_id, payment_method, amount, transaction_reference, status, cashier_id, created_at from payments where payment_method = 'upi_qr' order by id").all();

const report = {
  decoder: 'jsQR 1.4.0 (independent of the app encoder)',
  generatedAt: new Date().toISOString(),
  configuredUpi: { enabled: settings.upi?.enabled, vpa: settings.upi?.vpa ? mask(settings.upi.vpa) : null, ...vpaCheck(settings.upi?.vpa ?? '') },
  businessProfileRowStored: Boolean(settings.business_profile),
  requests: [],
};
for (const r of requests) {
  const qr = encodeQr(r.upi_uri);
  const { data, px } = raster(qr, 8);
  const decoded = jsQR(data, px, px)?.data ?? null;
  const p = parseUri(decoded ?? '');
  const money = Number(r.amount).toFixed(2);
  const checks = {
    decodedEqualsStoredUri: decoded === r.upi_uri,
    schemeIsUpiPay: p.scheme === 'upi://pay',
    noDuplicateParams: p.duplicates.length === 0,
    noSpacesInRawUri: !p.rawHasSpace,
    notDoubleEncoded: !p.doubleEncoded,
    paEqualsStoredVpa: p.params.pa === r.vpa,
    paEqualsCurrentSetting: p.params.pa === (settings.upi?.vpa ?? '').toLowerCase(),
    // No business_profile row is stored (defaults are used), so compare with the payee name saved on the request
    pnEqualsSavedPayeeName: p.params.pn === r.payee_name,
    amEqualsBillTotal: p.params.am === Number(r.total_amount).toFixed(2) && p.params.am === money,
    amFormat2dp: /^\d+\.\d{2}$/.test(p.params.am ?? ''),
    cuIsINR: p.params.cu === 'INR',
    tnEqualsReference: p.params.tn === r.reference,
  };
  report.requests.push({
    id: r.id,
    order: r.order_number,
    status: r.status,
    orderPaymentStatus: r.payment_status,
    linkedPaymentId: r.payment_id,
    decodedPayload: decoded && decoded.replace(r.vpa, mask(r.vpa)),
    qrVersion: qr.version,
    qrModules: qr.size,
    checks,
    allChecksPass: Object.values(checks).every(Boolean),
  });
}
report.upiPayments = payments.map((p) => ({ ...p, transaction_reference: p.transaction_reference ? '(set)' : null }));
mkdirSync(join(HERE, 'results', 'upi'), { recursive: true });
writeFileSync(join(HERE, 'results', 'upi', 'diagnostic.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
