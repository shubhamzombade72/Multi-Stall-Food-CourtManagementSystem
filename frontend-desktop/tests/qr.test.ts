import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeQr, reedSolomonRemainder, qrLayout } from '../src/lib/qr.ts';
import { buildUpiUri, parseUpiUri } from '../src/lib/receiptModel.ts';

const UPI = 'upi://pay?pa=mangalmurti@upi&pn=MangalMurti%20Food%20Court&am=200.00&cu=INR&tn=ORD-20261104-ABCDE';

test('Reed-Solomon matches the published QR version 1-M example (HELLO WORLD)', () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(reedSolomonRemainder(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('matrix is square, has the right size for its version and three finder patterns', () => {
  const qr = encodeQr(UPI);
  const n = qr.size;
  assert.equal(n, qr.version * 4 + 17);
  assert.ok(qr.version >= 5 && qr.version <= 9, `version ${qr.version}`);
  const finder = (ox: number, oy: number) => {
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 7; x++) {
        const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        assert.equal(qr.modules[oy + y][ox + x], ring !== 2, `finder at ${ox},${oy} module ${x},${y}`);
      }
  };
  finder(0, 0);
  finder(n - 7, 0);
  finder(0, n - 7);
  // dark module and timing pattern
  assert.equal(qr.modules[n - 8][8], true);
  for (let i = 8; i < n - 8; i++) {
    assert.equal(qr.modules[6][i], i % 2 === 0);
    assert.equal(qr.modules[i][6], i % 2 === 0);
  }
});

/** Reads the matrix back the way a scanner does: format info -> mask -> zig-zag bits -> de-interleave -> bytes. */
function decodeByteMode(modules: boolean[][], version: number): { text: string; eccOk: boolean } {
  const n = modules.length;
  let fmt = 0;
  for (let i = 0; i <= 5; i++) fmt |= (modules[i][8] ? 1 : 0) << i;
  fmt |= (modules[7][8] ? 1 : 0) << 6;
  fmt |= (modules[8][8] ? 1 : 0) << 7;
  fmt |= (modules[8][7] ? 1 : 0) << 8;
  for (let i = 9; i < 15; i++) fmt |= (modules[8][14 - i] ? 1 : 0) << i;
  const bits = fmt ^ 0x5412;
  assert.equal(bits >> 13, 0, 'error-correction level M');
  const mask = (bits >> 10) & 7;
  // format info is a BCH(15,5) codeword: remainder must be zero
  let rem = bits;
  for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  assert.equal(rem, 0, 'format bits are a valid BCH codeword');

  const fn = functionMask(n, version);
  const maskFn = [
    (x: number, y: number) => (x + y) % 2 === 0,
    (_x: number, y: number) => y % 2 === 0,
    (x: number) => x % 3 === 0,
    (x: number, y: number) => (x + y) % 3 === 0,
    (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ][mask];
  const stream: number[] = [];
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? n - 1 - vert : vert;
        if (!fn[y][x]) stream.push((modules[y][x] !== maskFn(x, y) ? 1 : 0) as number);
      }
  }
  const codewords: number[] = [];
  for (let i = 0; i + 8 <= stream.length; i += 8) codewords.push(parseInt(stream.slice(i, i + 8).join(''), 2));

  const ECC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24];
  const BLK = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9];
  const eccLen = ECC[version];
  const nb = BLK[version];
  const raw = codewords.length;
  const numShort = nb - (raw % nb);
  const shortLen = Math.floor(raw / nb);
  const blocks: number[][] = Array.from({ length: nb }, () => []);
  let k = 0;
  // Codewords are interleaved column by column; short blocks have one data codeword fewer, so they skip that column
  for (let i = 0; i < shortLen + 1; i++)
    for (let j = 0; j < nb; j++) {
      if (i === shortLen - eccLen && j < numShort) continue;
      blocks[j].push(codewords[k++]);
    }
  let eccOk = true;
  const data: number[] = [];
  for (const b of blocks) {
    const d = b.slice(0, b.length - eccLen);
    const e = b.slice(b.length - eccLen);
    if (JSON.stringify(reedSolomonRemainder(d, eccLen)) !== JSON.stringify(e)) eccOk = false;
    data.push(...d);
  }
  const bitsStr = data.map((c) => c.toString(2).padStart(8, '0')).join('');
  assert.equal(bitsStr.slice(0, 4), '0100', 'byte mode');
  const lenBits = version >= 10 ? 16 : 8;
  const len = parseInt(bitsStr.slice(4, 4 + lenBits), 2);
  const bytes: number[] = [];
  for (let i = 0; i < len; i++) bytes.push(parseInt(bitsStr.slice(4 + lenBits + i * 8, 4 + lenBits + i * 8 + 8), 2));
  return { text: new TextDecoder().decode(Uint8Array.from(bytes)), eccOk };
}

/** Independent function-pattern map (finders, timing, alignment, format/version areas) for the reader above. */
function functionMask(n: number, version: number): boolean[][] {
  const f = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const rect = (x0: number, y0: number, w: number, h: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < n && y < n) f[y][x] = true;
  };
  rect(0, 0, 9, 9);
  rect(n - 8, 0, 8, 9);
  rect(0, n - 8, 9, 8);
  for (let i = 0; i < n; i++) f[6][i] = f[i][6] = true;
  if (version >= 2) {
    const count = Math.floor(version / 7) + 2;
    const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
    const pos = [6];
    for (let p = n - 7; pos.length < count; p -= step) pos.splice(1, 0, p);
    for (let a = 0; a < count; a++)
      for (let b = 0; b < count; b++) {
        if ((a === 0 && b === 0) || (a === 0 && b === count - 1) || (a === count - 1 && b === 0)) continue;
        rect(pos[a] - 2, pos[b] - 2, 5, 5);
      }
  }
  if (version >= 7) {
    rect(n - 11, 0, 3, 6);
    rect(0, n - 11, 6, 3);
  }
  return f;
}

test('round trip: a scanner reading the matrix gets the exact UPI payload and valid error correction', () => {
  const qr = encodeQr(UPI);
  const out = decodeByteMode(qr.modules, qr.version);
  assert.equal(out.text, UPI);
  assert.equal(out.eccOk, true);
});

test('round trip for short, long and non-ASCII payloads across versions', () => {
  for (const text of ['a', 'upi://pay?pa=a@b&am=1.00&cu=INR', UPI + '&x=' + 'z'.repeat(60), 'upi://pay?pn=' + encodeURIComponent('रेस्टोरेंट') + '&' + 'q'.repeat(150), 'é€'.repeat(40)]) {
    const qr = encodeQr(text);
    const out = decodeByteMode(qr.modules, qr.version);
    assert.equal(out.text, text, `version ${qr.version}`);
    assert.equal(out.eccOk, true, `ecc v${qr.version}`);
  }
});

test('different amounts produce different matrices', () => {
  const a = encodeQr(UPI).modules.flat().join('');
  const b = encodeQr(UPI.replace('am=200.00', 'am=500.00')).modules.flat().join('');
  assert.notEqual(a, b);
});

test('payloads beyond the supported size are rejected instead of producing a bad code', () => {
  assert.throws(() => encodeQr('x'.repeat(400)), /too long/i);
});

test('layout keeps a 4-module quiet zone, square aspect and a scannable module size on 58 mm and 80 mm paper', () => {
  const qr = encodeQr(UPI);
  for (const [paperMm, maxMm] of [
    [58, 36],
    [80, 44],
  ] as const) {
    const l = qrLayout(qr.size, maxMm);
    assert.equal(l.units, qr.size + 8, 'quiet zone of 4 modules on every side');
    assert.ok(l.moduleMm >= 0.5, `${paperMm} mm paper: module ${l.moduleMm} mm is below the 0.5 mm scan minimum`);
    assert.ok(l.sizeMm <= maxMm, `${paperMm} mm paper: QR ${l.sizeMm} mm fits in ${maxMm} mm`);
    assert.ok(l.sizeMm < paperMm);
    assert.equal(Math.round(l.moduleMm * 8), l.moduleMm * 8, 'module is a whole number of dots on a 203 dpi printer');
    assert.equal(l.sizeMm, l.moduleMm * l.units);
  }
});

test('scenario: the scanned QR carries the exact bill amount, UPI ID, payee and reference (100, 500, 1587.60, other UPI IDs)', () => {
  const cases = [
    ['100', 'shop@oksbi', 'Spice Hub', 'ORD-20261104-AAAAA', '100.00'],
    ['500.00', 'mangalmurti@upi', 'MangalMurti Food Court', 'ORD-20261104-BBBBB', '500.00'],
    ['1587.6', 'shubhamzombade63@oksbi', 'Urban Food Court', 'ORD-20261104-QGE41', '1587.60'],
    [1587.6, 'Shop.Name-1@okhdfcbank', 'Cafe & Grill', 'ORD-20261104-CCCCC', '1587.60'],
  ] as const;
  for (const [amount, vpa, name, ref, expected] of cases) {
    const uri = buildUpiUri(vpa, name, amount, ref);
    const qr = encodeQr(uri);
    const out = decodeByteMode(qr.modules, qr.version);
    assert.equal(out.eccOk, true);
    const q = parseUpiUri(out.text);
    assert.equal(q.pa, vpa);
    assert.equal(q.pn, name);
    assert.equal(q.am, expected);
    assert.equal(q.cu, 'INR');
    assert.equal(q.tn, ref);
    for (const mm of [36, 44]) assert.ok(qrLayout(qr.size, mm).moduleMm >= 0.5, `${vpa}: scannable with a ${mm} mm QR width`);
  }
});
