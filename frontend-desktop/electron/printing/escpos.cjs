'use strict';
/**
 * Print document -> fixed-width text layout -> ESC/POS bytes.
 *
 * The same `layoutDocument()` result feeds both the bytes sent to the printer and the on-screen "thermal preview", so
 * the preview cannot drift from the paper. Text is printed natively with the printer's own font in a single-byte code
 * page. Characters the page lacks are reduced to a base letter or replaced by '?', and reported back (`unsupported`);
 * nothing is rasterised, so Devanagari/Marathi cannot be printed this way and is rejected loudly instead of silently
 * mangled (the Windows-driver transport renders it correctly).
 *
 * ESC/POS command bytes follow the public Epson reference; they are not tied to any printer brand.
 */
const { CODEPAGES, CODEPAGE_NAMES } = require('./codepages.cjs');

const ESC = 0x1b;
const GS = 0x1d;

/** 58 mm heads print 384 dots and 80 mm heads 576; Font A is 12 dots wide -> 32 / 48 columns. */
const PAPER = { 58: { columns: 32, dots: 384, qrModule: 5 }, 80: { columns: 48, dots: 576, qrModule: 6 } };

function resolveProfile(input = {}) {
  const paperWidthMm = Number(input.paperWidthMm) === 58 ? 58 : 80;
  const wanted = Number(input.columns);
  const columns = Number.isInteger(wanted) && wanted >= 20 && wanted <= 64 ? wanted : PAPER[paperWidthMm].columns;
  const codepage = CODEPAGE_NAMES.includes(input.codepage) ? input.codepage : 'CP858';
  return { paperWidthMm, columns, codepage, cut: input.cut !== false };
}

// ------------------------------------------------------------------ character mapping
const LOOKALIKES = {
  '‘': "'", '’': "'", '‚': "'", '“': '"', '”': '"', '„': '"',
  '–': '-', '—': '-', '−': '-', '•': '*', '…': '...', ' ': ' ',
  '₹': 'Rs.', // Indian rupee sign: in no thermal code page
  '×': 'x',
};

const reverseCache = new Map();
function reverseTable(codepage) {
  let map = reverseCache.get(codepage);
  if (!map) {
    map = new Map();
    const high = Array.from(CODEPAGES[codepage].high);
    high.forEach((ch, i) => {
      if (ch !== '�' && !map.has(ch)) map.set(ch, 0x80 + i);
    });
    reverseCache.set(codepage, map);
  }
  return map;
}

/** Text -> printable characters of the page (1 char = 1 byte). Returns the characters that had to become '?'. */
function prepareText(text, codepage) {
  const rev = reverseTable(codepage);
  const has = (ch) => {
    const cp = ch.codePointAt(0);
    return (cp >= 0x20 && cp <= 0x7e) || rev.has(ch);
  };
  const unsupported = new Set();
  let out = '';
  for (const ch of String(text ?? '')) {
    if (ch === '\t') out += ' ';
    else if (ch === '\n' || ch === '\r') out += ' ';
    else if (has(ch)) out += ch;
    else if (LOOKALIKES[ch] !== undefined) out += LOOKALIKES[ch];
    else {
      const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
      if (base && base !== ch && Array.from(base).every(has)) out += base;
      else if (/\p{C}/u.test(ch)) {
        // control / format characters: nothing to print
      } else {
        out += '?';
        unsupported.add(ch);
      }
    }
  }
  return { text: out, unsupported: Array.from(unsupported) };
}

/** True if any character cannot be printed natively (used to warn / route to the driver transport). */
function findUnsupported(doc, codepage) {
  const found = new Set();
  for (const text of documentStrings(doc)) for (const ch of prepareText(text, codepage).unsupported) found.add(ch);
  return Array.from(found);
}

function documentStrings(doc) {
  const out = [];
  for (const b of doc.blocks) {
    if (b.t === 'text') out.push(b.text);
    else if (b.t === 'row') out.push(b.left, b.right);
  }
  return out;
}

// ------------------------------------------------------------------ layout
function wrap(text, width) {
  const lines = [];
  for (const raw of String(text).split('\n')) {
    let line = '';
    for (const word of raw.split(/\s+/).filter(Boolean)) {
      let w = Array.from(word);
      while (w.length > width) {
        // a word longer than the paper is split hard
        if (line) {
          lines.push(line);
          line = '';
        }
        lines.push(w.slice(0, width).join(''));
        w = w.slice(width);
      }
      const piece = w.join('');
      if (!line) line = piece;
      else if (Array.from(line).length + 1 + w.length <= width) line += ' ' + piece;
      else {
        lines.push(line);
        line = piece;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

const len = (s) => Array.from(s).length;

/**
 * Fixed-width lines for the profile. Each line: { text, align, bold, large, qr? }. `text` is already padded for rows;
 * alignment of other lines is applied by the printer (ESC a) and by `previewLines` for the screen.
 */
function layoutDocument(doc, profileInput) {
  const profile = resolveProfile(profileInput);
  const cols = profile.columns;
  const lines = [];
  for (const b of doc.blocks) {
    switch (b.t) {
      case 'text': {
        const large = b.size === 'large';
        const width = large ? Math.floor(cols / 2) : cols;
        for (const text of wrap(prepareText(b.text, profile.codepage).text, width)) {
          lines.push({ text, align: b.align || 'left', bold: !!b.bold, large });
        }
        break;
      }
      case 'row': {
        const left = prepareText(b.left, profile.codepage).text;
        const right = prepareText(b.right, profile.codepage).text.trim();
        const rightW = len(right);
        if (rightW === 0) {
          for (const text of wrap(left, cols)) lines.push({ text, align: 'left', bold: !!b.bold, large: false });
          break;
        }
        const room = cols - rightW - 1;
        if (room < 6) {
          // value too wide to share a line: label lines, then the value right-aligned
          for (const text of wrap(left, cols)) lines.push({ text, align: 'left', bold: !!b.bold, large: false });
          lines.push({ text: right, align: 'right', bold: !!b.bold, large: false });
          break;
        }
        const parts = wrap(left, room);
        parts.forEach((part, i) => {
          const text = i === 0 ? part + ' '.repeat(Math.max(1, cols - len(part) - rightW)) + right : part;
          lines.push({ text, align: 'left', bold: !!b.bold, large: false });
        });
        break;
      }
      case 'rule':
        lines.push({ text: (b.style === 'double' ? '=' : '-').repeat(cols), align: 'left', bold: false, large: false });
        break;
      case 'qr':
        lines.push({ text: '', align: 'center', bold: false, large: false, qr: b.data });
        break;
      case 'feed':
        for (let i = 0; i < b.lines; i++) lines.push({ text: '', align: 'left', bold: false, large: false });
        break;
      default:
        break;
    }
  }
  return { profile, lines };
}

/** What the screen shows for a thermal job: each line aligned inside the paper width. */
function previewLines(layout) {
  const cols = layout.profile.columns;
  return layout.lines.map((l) => {
    if (l.qr !== undefined) return { text: `[ QR code: ${l.qr.length > 60 ? l.qr.slice(0, 57) + '...' : l.qr} ]`, bold: false, large: false, qr: true };
    const width = l.large ? Math.floor(cols / 2) : cols;
    const n = len(l.text);
    const pad = l.align === 'center' ? Math.floor((width - n) / 2) : l.align === 'right' ? width - n : 0;
    return { text: ' '.repeat(Math.max(0, pad)) + l.text, bold: l.bold, large: l.large, qr: false };
  });
}

// ------------------------------------------------------------------ bytes
const CMD = {
  init: Buffer.from([ESC, 0x40]),
  fontA: Buffer.from([ESC, 0x4d, 0x00]),
  boldOn: Buffer.from([ESC, 0x45, 0x01]),
  boldOff: Buffer.from([ESC, 0x45, 0x00]),
  underlineOff: Buffer.from([ESC, 0x2d, 0x00]),
  sizeNormal: Buffer.from([GS, 0x21, 0x00]),
  sizeLarge: Buffer.from([GS, 0x21, 0x11]),
  invertOff: Buffer.from([GS, 0x42, 0x00]),
  align: { left: Buffer.from([ESC, 0x61, 0]), center: Buffer.from([ESC, 0x61, 1]), right: Buffer.from([ESC, 0x61, 2]) },
  cut: Buffer.from([GS, 0x56, 0x00]),
  lf: Buffer.from([0x0a]),
};

function encodeText(text, codepage) {
  const rev = reverseTable(codepage);
  const bytes = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x20 && cp <= 0x7e) bytes.push(cp);
    else if (rev.has(ch)) bytes.push(rev.get(ch));
    else bytes.push(0x3f);
  }
  return Buffer.from(bytes);
}

/** Native QR (GS ( k): model 2, error-correction M, centred. The printer draws it; nothing is rasterised. */
function qrBytes(data, moduleSize) {
  const payload = Buffer.from(String(data), 'utf8');
  const store = payload.length + 3;
  return Buffer.concat([
    CMD.align.center,
    Buffer.from([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]), // model 2
    Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, moduleSize]), // module size
    Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]), // error correction M
    Buffer.from([GS, 0x28, 0x6b, store & 0xff, (store >> 8) & 0xff, 0x31, 0x50, 0x30]),
    payload,
    Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]), // print
    CMD.lf,
    CMD.align.left,
  ]);
}

/**
 * Whole job: init, code page, lines, explicit reset of every attribute (so nothing leaks into the next job), feed, cut.
 * Returns { buffer, unsupported: [chars printed as '?'] }.
 */
function encodeDocument(doc, profileInput) {
  const layout = layoutDocument(doc, profileInput);
  const { profile } = layout;
  const chunks = [CMD.init, Buffer.from([ESC, 0x74, CODEPAGES[profile.codepage].escposTable]), CMD.fontA];
  let align = 'left';
  let bold = false;
  let large = false;
  for (const l of layout.lines) {
    if (l.qr !== undefined) {
      chunks.push(qrBytes(l.qr, PAPER[profile.paperWidthMm].qrModule));
      align = 'left';
      continue;
    }
    if (l.align !== align) chunks.push(CMD.align[l.align]), (align = l.align);
    if (l.bold !== bold) chunks.push(l.bold ? CMD.boldOn : CMD.boldOff), (bold = l.bold);
    if (l.large !== large) chunks.push(l.large ? CMD.sizeLarge : CMD.sizeNormal), (large = l.large);
    chunks.push(encodeText(l.text, profile.codepage), CMD.lf);
  }
  chunks.push(CMD.boldOff, CMD.underlineOff, CMD.sizeNormal, CMD.invertOff, CMD.align.left, Buffer.from([0x0a, 0x0a, 0x0a]));
  if (profile.cut) chunks.push(CMD.cut);
  return { buffer: Buffer.concat(chunks), unsupported: findUnsupported(doc, profile.codepage), layout };
}

module.exports = { PAPER, CMD, resolveProfile, prepareText, findUnsupported, layoutDocument, previewLines, encodeDocument, encodeText, qrBytes, documentStrings };
