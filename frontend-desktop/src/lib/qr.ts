/**
 * Minimal, dependency-free QR Code encoder (ISO/IEC 18004): byte mode, error-correction level M, versions 1-14
 * (up to 365 data bytes - ample for a UPI payment URI). Written for the receipt/POS UPI QR so the desktop app needs
 * no extra package. Level M recovers ~15% damage, the usual choice for thermal-printed payment codes.
 *
 * The algorithm follows the standard's structure (function patterns, Reed-Solomon over GF(256)/0x11D, zig-zag data
 * placement, eight masks scored with the four penalty rules); tests/qr.test.ts verifies it by reading codes back.
 */

/** Error-correction codewords per block and number of blocks, level M, indexed by version (1-14). */
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24];
const NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9];
const MAX_VERSION = 14;

export interface QrCode {
  version: number;
  size: number;
  /** modules[y][x] === true is a dark module (the quiet zone is not included). */
  modules: boolean[][];
}

const bit = (x: number, i: number): boolean => ((x >>> i) & 1) !== 0;

// ---------- Reed-Solomon over GF(256), primitive polynomial 0x11D ----------

const EXP = new Array<number>(512);
const LOG = new Array<number>(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const gfMul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function generator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly; // highest-degree coefficient first (always 1)
}

/** Error-correction codewords for a data block. */
export function reedSolomonRemainder(data: number[], eccLen: number): number[] {
  const gen = generator(eccLen);
  const rem = new Array<number>(eccLen).fill(0);
  for (const d of data) {
    const factor = d ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < eccLen; i++) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
}

// ---------- Capacity ----------

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

const dataCodewords = (version: number): number =>
  Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[version] * NUM_BLOCKS[version];

// ---------- Encoding ----------

function toDataCodewords(text: string): { version: number; codewords: number[] } {
  const bytes = Array.from(new TextEncoder().encode(text));
  let version = 1;
  for (; version <= MAX_VERSION; version++) {
    const countBits = version >= 10 ? 16 : 8;
    if (4 + countBits + bytes.length * 8 <= dataCodewords(version) * 8) break;
  }
  if (version > MAX_VERSION) throw new Error('QR payload is too long');

  const bits: number[] = [];
  const push = (value: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) push(b, 8);
  const capacityBits = dataCodewords(version) * 8;
  push(0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; codewords.length < dataCodewords(version); pad ^= 0xec ^ 0x11) codewords.push(pad);
  return { version, codewords };
}

function addEccAndInterleave(data: number[], version: number): number[] {
  const numBlocks = NUM_BLOCKS[version];
  const eccLen = ECC_PER_BLOCK[version];
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks);

  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = reedSolomonRemainder(dat, eccLen);
    if (i < numShort) dat.push(0); // placeholder so all blocks line up; skipped when interleaving
    blocks.push(dat.concat(ecc));
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++)
    for (let j = 0; j < blocks.length; j++) if (i !== shortLen - eccLen || j >= numShort) result.push(blocks[j][i]);
  return result;
}

// ---------- Matrix construction ----------

class Builder {
  readonly size: number;
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];
  readonly version: number;

  constructor(version: number) {
    this.version = version;
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.drawFunctionPatterns();
  }

  private setFunction(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }

  private drawFunctionPatterns() {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(n - 4, 3);
    this.drawFinder(3, n - 4);
    const pos = this.alignmentPositions();
    for (let a = 0; a < pos.length; a++)
      for (let b = 0; b < pos.length; b++) {
        if ((a === 0 && b === 0) || (a === 0 && b === pos.length - 1) || (a === pos.length - 1 && b === 0)) continue;
        this.drawAlignment(pos[a], pos[b]);
      }
    this.drawFormat(0); // reserves the format areas; rewritten once the mask is chosen
    this.drawVersion();
  }

  private alignmentPositions(): number[] {
    if (this.version === 1) return [];
    const count = Math.floor(this.version / 7) + 2;
    const step = Math.ceil((this.version * 4 + 4) / (count * 2 - 2)) * 2;
    const result = [6];
    for (let p = this.size - 7; result.length < count; p -= step) result.splice(1, 0, p);
    return result;
  }

  private drawFinder(cx: number, cy: number) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) this.setFunction(x, y, dist !== 2 && dist !== 4);
      }
  }

  private drawAlignment(cx: number, cy: number) {
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) this.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }

  /** Level M has format bits 00; BCH(15,5) with generator 0x537, XOR mask 0x5412. */
  drawFormat(mask: number) {
    const data = (0 << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const n = this.size;
    for (let i = 0; i <= 5; i++) this.setFunction(8, i, bit(bits, i));
    this.setFunction(8, 7, bit(bits, 6));
    this.setFunction(8, 8, bit(bits, 7));
    this.setFunction(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) this.setFunction(n - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) this.setFunction(8, n - 15 + i, bit(bits, i));
    this.setFunction(8, n - 8, true); // always-dark module
  }

  private drawVersion() {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = bit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, dark);
      this.setFunction(b, a, dark);
    }
  }

  drawCodewords(data: number[]) {
    const n = this.size;
    let i = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++)
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? n - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = bit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
    }
  }

  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++) {
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        if (!this.isFunction[y][x] && invert) this.modules[y][x] = !this.modules[y][x];
      }
  }

  /** Standard penalty score: long runs, 2x2 blocks, finder-like patterns, dark/light imbalance. */
  penalty(): number {
    const n = this.size;
    const m = this.modules;
    let score = 0;
    const line = (get: (k: number) => boolean) => {
      let run = 1;
      for (let k = 1; k < n; k++) {
        if (get(k) === get(k - 1)) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
      for (let k = 0; k + 11 <= n; k++) {
        const w = Array.from({ length: 11 }, (_, i) => (get(k + i) ? 1 : 0)).join('');
        if (w === '10111010000' || w === '00001011101') score += 40;
      }
    };
    for (let i = 0; i < n; i++) {
      line((k) => m[i][k]);
      line((k) => m[k][i]);
    }
    for (let y = 0; y < n - 1; y++)
      for (let x = 0; x < n - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
    const dark = m.reduce((acc, row) => acc + row.filter(Boolean).length, 0);
    const total = n * n;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
  }
}

/** Encodes text (UTF-8) as a QR Code, level M. Throws when the payload does not fit versions 1-14. */
export function encodeQr(text: string): QrCode {
  const { version, codewords } = toDataCodewords(text);
  const all = addEccAndInterleave(codewords, version);
  const b = new Builder(version);
  b.drawCodewords(all);

  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    b.applyMask(mask);
    b.drawFormat(mask);
    const score = b.penalty();
    if (score < bestScore) {
      best = mask;
      bestScore = score;
    }
    b.applyMask(mask); // undo
  }
  b.applyMask(best);
  b.drawFormat(best);
  return { version, size: b.size, modules: b.modules };
}

/**
 * Print geometry for a QR of `size` modules: 4-module quiet zone on every side and a module that is a whole number of
 * dots on a 203 dpi thermal printer (1/8 mm), so edges stay sharp. Never exceeds `maxMm` square.
 */
export function qrLayout(size: number, maxMm: number): { units: number; moduleMm: number; sizeMm: number } {
  const units = size + 8;
  const moduleMm = Math.floor((maxMm / units) * 8) / 8;
  return { units, moduleMm, sizeMm: moduleMm * units };
}
