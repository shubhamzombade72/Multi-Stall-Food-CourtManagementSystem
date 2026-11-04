/**
 * Independent verification of the receipt QR encoder: every payload is encoded with frontend-desktop/src/lib/qr.ts,
 * rasterised exactly like the receipt (white paper, 4-module quiet zone, black modules) at the real 58 mm / 80 mm
 * print sizes (203 dpi), and decoded with the open-source jsQR decoder, which shares no code with the encoder.
 *
 *   node qa/desktop/upi-qr-decode.mjs <path to a folder whose node_modules contains jsqr>
 *
 * jsQR is a verification-only tool: it is NOT a dependency of the application.
 */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const jsqrDir = process.argv[2];
if (!jsqrDir) throw new Error('usage: node upi-qr-decode.mjs <folder containing node_modules/jsqr>');
const jsQR = createRequire(join(resolve(jsqrDir), 'noop.js'))('jsqr');
const { encodeQr, qrLayout } = await import(pathToFileURL(join(HERE, '..', '..', 'frontend-desktop', 'src', 'lib', 'qr.ts')).href);

const uri = (vpa, name, amount, ref) =>
  `upi://pay?pa=${vpa}&pn=${encodeURIComponent(name)}&am=${amount}&cu=INR&tn=${encodeURIComponent(ref)}`;

const payloads = [
  uri('mangalmurti@upi', 'MangalMurti Food Court', '200.00', 'ORD-20261104-ABCDE'),
  uri('mangalmurti@upi', 'MangalMurti Food Court', '500.00', 'ORD-20261104-FGHIJ'),
  uri('shop.name-1@okhdfcbank', 'Urban Food Court', '1234567.89', 'ORD-20261104-KLMNO-2'),
  uri('a1@ybl', 'A', '0.01', 'ORD-1'),
  uri('long.merchant_name123@paytm', 'The Very Long Business Name Of A Food Court Pvt', '99999.99', 'ORD-20261104-ZZZZZ-12'),
];

/** Paper pixels: `dots` device dots per module (203 dpi => 8 dots per mm), black on white. */
function raster(qr, dotsPerModule) {
  const quiet = 4;
  const units = qr.size + quiet * 2;
  const px = units * dotsPerModule;
  const data = new Uint8ClampedArray(px * px * 4).fill(255);
  for (let y = 0; y < qr.size; y++)
    for (let x = 0; x < qr.size; x++) {
      if (!qr.modules[y][x]) continue;
      for (let dy = 0; dy < dotsPerModule; dy++)
        for (let dx = 0; dx < dotsPerModule; dx++) {
          const i = (((y + quiet) * dotsPerModule + dy) * px + (x + quiet) * dotsPerModule + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
    }
  return { data, px };
}

const results = [];
let failed = 0;
for (const text of payloads) {
  const qr = encodeQr(text);
  for (const [paper, maxMm] of [
    ['58mm', 36],
    ['80mm', 44],
  ]) {
    const layout = qrLayout(qr.size, maxMm);
    const dots = Math.round(layout.moduleMm * 8);
    const { data, px } = raster(qr, dots);
    const decoded = jsQR(data, px, px);
    const ok = decoded?.data === text;
    if (!ok) failed++;
    results.push({
      paper,
      version: qr.version,
      modules: qr.size,
      moduleMm: layout.moduleMm,
      qrMm: layout.sizeMm,
      dotsPerModule: dots,
      payload: text,
      decoded: decoded?.data ?? null,
      result: ok ? 'PASS' : 'FAIL',
    });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${paper}  v${qr.version}  ${layout.sizeMm.toFixed(2)} mm  ${text}`);
  }
}
const out = join(HERE, 'results', 'upi-qr-decode-results.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ decoder: 'jsQR 1.4.0 (independent)', failed, results }, null, 2));
console.log(failed === 0 ? `ALL ${results.length} DECODED` : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
