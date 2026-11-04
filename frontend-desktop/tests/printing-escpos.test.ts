/**
 * ESC/POS layout and byte tests. These prove the bytes and line layout this software produces; they do NOT prove
 * any physical printer renders them correctly (see docs/engineering/printer-system-implementation-report.md).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const escpos = require('../electron/printing/escpos.cjs');
const { documentToHtml } = require('../electron/printing/html.cjs');
const { validateDocument, validateProfile, validateConfig, validateEnqueue } = require('../electron/printing/validate.cjs');

const doc = (blocks: any[], kind = 'receipt') => ({ kind, blocks });
const text = (buf: Buffer) => buf.toString('latin1');

test('58 mm is 32 columns and 80 mm is 48; a custom column count is honoured only inside 20-64', () => {
  assert.equal(escpos.resolveProfile({ paperWidthMm: 58 }).columns, 32);
  assert.equal(escpos.resolveProfile({ paperWidthMm: 80 }).columns, 48);
  assert.equal(escpos.resolveProfile({ paperWidthMm: 80, columns: 42 }).columns, 42);
  assert.equal(escpos.resolveProfile({ paperWidthMm: 58, columns: 5 }).columns, 32);
  assert.equal(escpos.resolveProfile({ paperWidthMm: 80, columns: 200 }).columns, 48);
  assert.equal(escpos.resolveProfile({ paperWidthMm: 99 }).paperWidthMm, 80, 'unknown width falls back to 80');
});

test('rows fill exactly the paper width on both sizes and never overflow', () => {
  const d = doc([{ t: 'row', left: 'TOTAL', right: '123.45' }, { t: 'rule' }]);
  for (const [mm, cols] of [[58, 32], [80, 48]] as const) {
    const layout = escpos.layoutDocument(d, { paperWidthMm: mm });
    assert.equal(layout.lines[0].text.length, cols, `${mm} mm row is ${cols} wide`);
    assert.match(layout.lines[0].text, /^TOTAL +123\.45$/);
    assert.equal(layout.lines[1].text.length, cols);
  }
});

test('a long item name wraps under the amount instead of pushing it off the paper', () => {
  const layout = escpos.layoutDocument(doc([{ t: 'row', left: '2 x Paneer Butter Masala with extra butter naan', right: '420.00' }]), { paperWidthMm: 58 });
  assert.ok(layout.lines.length >= 2);
  assert.ok(layout.lines.every((l: any) => l.text.length <= 32));
  assert.ok(layout.lines[0].text.endsWith('420.00'), 'amount stays on the first line');
});

test('a word longer than the paper is split, not lost or overflowed', () => {
  const layout = escpos.layoutDocument(doc([{ t: 'text', text: 'X'.repeat(70) }]), { paperWidthMm: 58 });
  assert.deepEqual(layout.lines.map((l: any) => l.text.length), [32, 32, 6]);
});

test('large text wraps at half the columns', () => {
  const layout = escpos.layoutDocument(doc([{ t: 'text', text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', size: 'large' }]), { paperWidthMm: 58 });
  assert.ok(layout.lines.every((l: any) => l.text.length <= 16 && l.large));
});

test('job bytes start with init + code page and end with reset, feed and cut', () => {
  const out = escpos.encodeDocument(doc([{ t: 'text', text: 'Hello' }]), { paperWidthMm: 80, codepage: 'CP858' });
  assert.deepEqual([...out.buffer.subarray(0, 2)], [0x1b, 0x40], 'ESC @');
  assert.deepEqual([...out.buffer.subarray(2, 5)], [0x1b, 0x74, 19], 'ESC t 19 = PC858');
  assert.ok(text(out.buffer).includes('Hello\n'));
  const tail = [...out.buffer.subarray(-3)];
  assert.deepEqual(tail, [0x1d, 0x56, 0x00], 'GS V 0 cut');
  const noCut = escpos.encodeDocument(doc([{ t: 'text', text: 'Hi' }]), { cut: false });
  assert.ok(!text(noCut.buffer).includes('\x1dV'), 'cut can be switched off');
});

test('code page selector follows the chosen character set', () => {
  for (const [name, n] of [['CP437', 0], ['CP850', 2], ['CP858', 19], ['CP1252', 16]] as const) {
    const out = escpos.encodeDocument(doc([{ t: 'text', text: 'a' }]), { codepage: name });
    assert.equal(out.buffer[4], n, name);
  }
});

test('accents are sent as single code-page bytes; the euro uses CP858', () => {
  const out = escpos.encodeDocument(doc([{ t: 'text', text: 'café €' }]), { codepage: 'CP858' });
  const body = out.buffer.subarray(6);
  assert.ok(body.includes(0x82), 'é is 0x82 in CP858');
  assert.ok(body.includes(0xd5), '€ is 0xD5 in CP858');
  assert.deepEqual(out.unsupported, []);
});

test('the rupee sign prints as "Rs." rather than "?"', () => {
  const out = escpos.encodeDocument(doc([{ t: 'text', text: 'Total ₹250' }]), {});
  assert.ok(text(out.buffer).includes('Total Rs.250'));
  assert.deepEqual(out.unsupported, []);
});

test('Marathi/Devanagari cannot be printed in thermal text mode: it becomes "?" and is reported, never silently mangled', () => {
  const out = escpos.encodeDocument(doc([{ t: 'text', text: 'मसाला डोसा' }]), {});
  assert.ok(out.unsupported.length > 0);
  assert.ok(out.unsupported.includes('म'));
  assert.ok(text(out.buffer).includes('?'));
  assert.ok(escpos.findUnsupported(doc([{ t: 'row', left: 'डोसा', right: '10.00' }]), 'CP858').length > 0);
});

test('the same Marathi text is kept intact for the Windows-driver page', () => {
  const html = documentToHtml(doc([{ t: 'text', text: 'मराठी' }]), 58);
  assert.ok(html.includes('मराठी'));
  assert.match(html, /Nirmala UI/);
});

test('native QR carries the exact payload and uses model 2, level M', () => {
  const uri = 'upi://pay?pa=shop@upi&pn=Shop&am=26.25&cu=INR&tn=ORD-1';
  const out = escpos.encodeDocument(doc([{ t: 'qr', data: uri }]), { paperWidthMm: 80 });
  const s = text(out.buffer);
  assert.ok(s.includes(uri), 'payload is sent unchanged');
  assert.ok(out.buffer.includes(Buffer.from([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00])), 'model 2');
  assert.ok(out.buffer.includes(Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31])), 'level M');
  assert.ok(out.buffer.includes(Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 6])), '80 mm module size 6');
  const small = escpos.encodeDocument(doc([{ t: 'qr', data: uri }]), { paperWidthMm: 58 });
  assert.ok(small.buffer.includes(Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 5])), '58 mm module size 5');
  const storeLen = uri.length + 3;
  assert.ok(out.buffer.includes(Buffer.from([0x1d, 0x28, 0x6b, storeLen & 0xff, storeLen >> 8, 0x31, 0x50, 0x30])), 'store-data length matches the payload');
});

test('preview lines come from the same layout as the bytes', () => {
  const d = doc([{ t: 'text', text: 'CENTER', align: 'center' }, { t: 'row', left: 'A', right: '1.00' }]);
  const layout = escpos.layoutDocument(d, { paperWidthMm: 58 });
  const lines = escpos.previewLines(layout);
  assert.equal(lines[0].text, ' '.repeat(13) + 'CENTER');
  assert.equal(lines[1].text, layout.lines[1].text);
  const bytes = text(escpos.encodeDocument(d, { paperWidthMm: 58 }).buffer);
  assert.ok(bytes.includes(layout.lines[1].text + '\n'), 'the row printed is the row previewed');
});

test('attributes are reset before the cut so they cannot leak into the next job', () => {
  const out = escpos.encodeDocument(doc([{ t: 'text', text: 'BIG', bold: true, size: 'large', align: 'right' }]), {});
  const tail = text(out.buffer.subarray(-22));
  assert.ok(tail.includes('\x1bE\x00'), 'bold off');
  assert.ok(tail.includes('\x1d!\x00'), 'normal size');
  assert.ok(tail.includes('\x1ba\x00'), 'left align');
});

// ------------------------------------------------------------------ HTML (driver) page
test('the page for the Windows driver is escaped, script-proof and sized for the paper', () => {
  const hostile = '<script>alert(1)</script>"&';
  const html = documentToHtml(doc([{ t: 'text', text: hostile }, { t: 'row', left: hostile, right: '1.00' }]), 58);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.match(html, /Content-Security-Policy[^>]*default-src 'none'/);
  assert.match(html, /@page \{ size: 58mm auto/);
  assert.match(documentToHtml(doc([{ t: 'text', text: 'x' }]), 80), /@page \{ size: 80mm auto/);
});

test('the page draws the QR from the supplied matrix and falls back to text without one', () => {
  const rows = Array.from({ length: 21 }, (_, y) => Array.from({ length: 21 }, (_, x) => ((x + y) % 2 ? '1' : '0')).join(''));
  const withQr = documentToHtml(doc([{ t: 'qr', data: 'upi://x', modules: rows }]), 80);
  assert.match(withQr, /<svg[^>]*viewBox="0 0 29 29"/);
  assert.ok(documentToHtml(doc([{ t: 'qr', data: 'upi://x' }]), 80).includes('upi://x'));
});

// ------------------------------------------------------------------ validation
test('documents from the renderer are validated: shape, size, enums', () => {
  assert.throws(() => validateDocument(null), /missing/);
  assert.throws(() => validateDocument({ kind: 'nope', blocks: [{ t: 'text', text: 'x' }] }), /kind/);
  assert.throws(() => validateDocument({ kind: 'receipt', blocks: [] }), /no content/);
  assert.throws(() => validateDocument({ kind: 'receipt', blocks: [{ t: 'script', src: 'x' }] }), /unknown type/);
  assert.throws(() => validateDocument({ kind: 'receipt', blocks: [{ t: 'text', text: 'x'.repeat(5000) }] }), /too long/);
  assert.throws(() => validateDocument({ kind: 'receipt', blocks: [{ t: 'text', text: 'x', align: 'diagonal' }] }), /align/);
  assert.throws(() => validateDocument({ kind: 'receipt', blocks: [{ t: 'feed', lines: 500 }] }), /feed/);
  assert.throws(() => validateDocument({ kind: 'receipt', blocks: Array.from({ length: 700 }, () => ({ t: 'rule' })) }), /too long/);
  assert.throws(() => validateDocument({ kind: 'receipt', blocks: [{ t: 'qr', data: 'x', modules: ['101', '010'] }] }), /QR size/);
});

test('validation drops unknown fields and control characters', () => {
  const v = validateDocument({ kind: 'kot', evil: 1, blocks: [{ t: 'text', text: 'a\u0000b\u001bc', cmd: 'rm -rf', bold: true }] });
  assert.deepEqual(v, { kind: 'kot', title: '', blocks: [{ t: 'text', text: 'abc', bold: true }] });
});

test('printer profiles: connection types per role, address and port rules', () => {
  const base = { transport: 'network', host: '192.168.1.50', port: 9100, paperWidthMm: 58 };
  assert.equal(validateProfile('receipt', base).paperWidthMm, 58);
  assert.throws(() => validateProfile('receipt', { ...base, host: '' }), /address/);
  assert.throws(() => validateProfile('receipt', { ...base, host: '999.1.1.1' }), /not valid/);
  assert.throws(() => validateProfile('receipt', { ...base, host: 'a b; calc.exe' }), /not valid/);
  assert.throws(() => validateProfile('receipt', { ...base, port: 70000 }), /port/i);
  assert.throws(() => validateProfile('receipt', { transport: 'driver', printerName: '' }), /Choose a Windows printer/);
  assert.throws(() => validateProfile('kot', { transport: 'dialog' }), /Unsupported connection/);
  assert.throws(() => validateProfile('receipt', { transport: 'none' }), /Unsupported connection/);
  assert.throws(() => validateProfile('spooler', base), /role/);
  assert.equal(validateProfile('kot', { transport: 'none' }).transport, 'none');
  assert.equal(validateProfile('receipt', { transport: 'dialog', codepage: 'EVIL' }).codepage, 'CP858');
});

test('settings validation requires both profiles and keeps auto-print off unless explicitly true', () => {
  const cfg = validateConfig({ receipt: { transport: 'dialog' }, kot: { transport: 'none' }, autoPrint: { kotOnNewTicket: 'yes' } });
  assert.equal(cfg.autoPrint.kotOnNewTicket, false);
  assert.throws(() => validateConfig({ receipt: { transport: 'dialog' } }), /settings are missing/i);
});

test('enqueue requests must match document and role, and keys are restricted', () => {
  const d = { kind: 'kot', blocks: [{ t: 'text', text: 'x' }] };
  assert.throws(() => validateEnqueue({ role: 'receipt', doc: d }), /kitchen ticket/);
  assert.throws(() => validateEnqueue({ role: 'kot', doc: d, dedupeKey: 'bad key!' }), /key/);
  assert.throws(() => validateEnqueue({ role: 'kot', doc: d, reference: { orderId: -1 } }), /whole numbers/);
  const ok = validateEnqueue({ role: 'kot', doc: d, dedupeKey: 'kot:42', reprint: true, reference: { ticketId: 42, stallName: 'Dosa Corner' } });
  assert.equal(ok.dedupeKey, 'kot:42');
  assert.equal(ok.reprint, true);
  assert.equal(ok.reference.stallName, 'Dosa Corner');
});
