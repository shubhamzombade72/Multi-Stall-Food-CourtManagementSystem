/**
 * Receipt and kitchen-ticket documents: the data that reaches paper. Covers stall isolation of KOTs, consistency
 * between the on-screen receipt model and the printed document, the UPI QR payload, and that bridge/preload/main agree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildReceiptDocument, qrRows, receiptDedupeKey } from '../src/lib/print/receiptDocument.ts';
import { buildKotDocument, buildKotDocuments } from '../src/lib/print/kotDocument.ts';
import { RECEIPT_CREDIT, buildUpiUri, parseUpiUri, receiptHeader, receiptTaxLines, upiSection } from '../src/lib/receiptModel.ts';
import { encodeQr } from '../src/lib/qr.ts';

const require = createRequire(import.meta.url);
const escpos = require('../electron/printing/escpos.cjs');
const { validateDocument } = require('../electron/printing/validate.cjs');
const { documentToHtml } = require('../electron/printing/html.cjs');

const settings = {
  business_profile: { name: 'Urban Food Court', address: 'MG Road, Pune', phone: '9876543210', gstin: '27ABCDE1234F1Z5' },
  receipt: { header: 'Open 9 to 9', footer: 'Visit again!', show_gstin: true },
};
const UPI = { reference: 'ORD-20261104-SOSMI', vpa: 'shop@oksbi', payee_name: 'Urban Food Court', amount: '26.25', status: 'pending' };
const receipt = (over: any = {}) => ({
  upi_enabled: true,
  upi: UPI,
  order: {
    id: 77,
    order_number: 'ORD-77',
    created_at: '2026-11-04T10:15:00Z',
    table: { table_number: 'T4' },
    customer_name: 'Asha',
    subtotal: '25.00',
    tax_amount: '1.25',
    tax_mode: 'exclusive',
    tax_rate_percent: '5.00',
    discount_amount: '0',
    total_amount: '26.25',
    payment_status: 'unpaid',
    payments: [],
    ...over,
  },
  stall_breakdown: {
    'Dosa Corner': [{ id: 1, quantity: 2, item_name: 'Masala Dosa', subtotal: '16.00' }],
    'Juice Bar': [{ id: 2, quantity: 1, item_name: 'Mosambi Juice', subtotal: '9.00' }],
  },
});
const lines = (doc: any) => escpos.layoutDocument(doc, { paperWidthMm: 80 }).lines.map((l: any) => l.text);

// ------------------------------------------------------------------ receipt
test('receipt header comes from the Business Profile (nothing hardcoded) and matches the on-screen header', () => {
  const doc = buildReceiptDocument(receipt(), settings);
  const header = receiptHeader(settings as any);
  const top = doc.blocks.slice(0, header.length).map((b: any) => b.text);
  assert.deepEqual(top, header);
  assert.equal(top[0], 'URBAN FOOD COURT');
  assert.ok(top.includes('GSTIN: 27ABCDE1234F1Z5'));
  const other = buildReceiptDocument(receipt(), { business_profile: { name: 'Mangal Foods' }, receipt: {} });
  assert.equal((other.blocks[0] as any).text, 'MANGAL FOODS');
  assert.ok(!JSON.stringify(other.blocks.slice(0, 3)).includes('Urban'), 'no stale business name in the header');
});

test('tax lines, discount, total and credit line equal what the on-screen receipt shows', () => {
  const r = receipt({ discount_amount: '2.00' });
  const doc = buildReceiptDocument(r, settings);
  const rows = doc.blocks.filter((b: any) => b.t === 'row') as any[];
  for (const l of receiptTaxLines(r.order)) assert.ok(rows.some((x) => x.left === l.label && x.right === Number(l.value).toFixed(2)), l.label);
  assert.ok(rows.some((x) => x.left === 'Discount' && x.right === '-2.00'));
  assert.deepEqual(rows.find((x) => x.left === 'TOTAL'), { t: 'row', left: 'TOTAL', right: '26.25', bold: true });
  const texts = doc.blocks.filter((b: any) => b.t === 'text').map((b: any) => b.text);
  assert.equal(texts[texts.length - 1], RECEIPT_CREDIT);
  assert.ok(texts.includes('Visit again!'));
});

test('GST is read from the bill, not assumed: a bill with no tax prints no GST line', () => {
  const doc = buildReceiptDocument(receipt({ tax_mode: 'none', tax_amount: '0.00', tax_rate_percent: '0.00', subtotal: '26.25' }), settings);
  assert.ok(!doc.blocks.some((b: any) => b.t === 'row' && /GST/.test(b.left)));
  const inc = buildReceiptDocument(receipt({ tax_mode: 'inclusive', tax_rate_percent: '18.00', tax_amount: '4.00', subtotal: '22.25', total_amount: '26.25' }), settings);
  assert.ok(inc.blocks.some((b: any) => b.t === 'row' && b.left === 'GST Included (18%)' && b.right === '4.00'));
});

test('items are grouped per stall but the stall name is not printed on the customer bill', () => {
  const doc = buildReceiptDocument(receipt(), settings);
  const all = JSON.stringify(doc);
  assert.ok(all.includes('2 x Masala Dosa') && all.includes('1 x Mosambi Juice'));
  assert.ok(!all.includes('Dosa Corner') && !all.includes('Juice Bar'));
});

test('paid vs unpaid: the unpaid marker appears only on a bill, and the payment lines only on a paid receipt', () => {
  const unpaid = JSON.stringify(buildReceiptDocument(receipt(), settings));
  assert.ok(unpaid.includes('UNPAID - NOT A RECEIPT'));
  const paid = buildReceiptDocument(
    receipt({ payment_status: 'paid', payments: [{ payment_method: 'cash', amount: '30.00', cash_tendered: '30.00', change_returned: '3.75', payment_number: 'PAY-9', cashier: { name: 'Ravi' } }] }),
    settings,
  );
  const s = JSON.stringify(paid);
  assert.ok(!s.includes('UNPAID'));
  assert.ok(s.includes('Paid (CASH)') && s.includes('Tendered') && s.includes('3.75') && s.includes('Receipt: PAY-9') && s.includes('Cashier: Ravi'));
});

test('UPI: the printed QR payload is exactly the on-screen payload, with the configured VPA, name, amount and reference', () => {
  const r = receipt();
  const section = upiSection(r)!;
  const doc = buildReceiptDocument(r, settings);
  const qr = doc.blocks.find((b: any) => b.t === 'qr') as any;
  assert.equal(qr.data, section.qrText, 'print == screen');
  const q = parseUpiUri(qr.data);
  assert.deepEqual(q, { pa: 'shop@oksbi', pn: 'Urban Food Court', am: '26.25', cu: 'INR', tn: 'ORD-20261104-SOSMI' });
  assert.equal(q.am, Number(r.order.total_amount).toFixed(2), 'QR amount == receipt total');
  assert.equal(qr.data, buildUpiUri(UPI.vpa, UPI.payee_name, UPI.amount, UPI.reference));
});

test('UPI: the QR matrix in the document is the QR of that exact payload', () => {
  const r = receipt();
  const qr = buildReceiptDocument(r, settings).blocks.find((b: any) => b.t === 'qr') as any;
  assert.deepEqual(qr.modules, qrRows(qr.data));
  const m = encodeQr(qr.data);
  assert.equal(qr.modules.length, m.size);
  assert.ok(qr.modules.every((row: string) => row.length === m.size && /^[01]+$/.test(row)));
});

test('UPI: thermal text mode sends the same payload to the printer, and the page mode draws the same matrix', () => {
  const doc = validateDocument(buildReceiptDocument(receipt(), settings));
  const bytes = escpos.encodeDocument(doc, { paperWidthMm: 58 }).buffer.toString('latin1');
  assert.ok(bytes.includes(upiSection(receipt())!.qrText));
  assert.match(documentToHtml(doc, 58), /<svg/);
});

test('no UPI block when UPI is off and the bill has no paid request; a paid request reprints its original values', () => {
  assert.ok(buildReceiptDocument(receipt({}), settings).blocks.some((b: any) => b.t === 'qr'), 'a pending request prints while UPI is on');
  const off = { ...receipt(), upi_enabled: false };
  assert.ok(!buildReceiptDocument(off, settings).blocks.some((b: any) => b.t === 'qr'));
  const paid = { ...receipt({ payment_status: 'paid' }), upi_enabled: false, upi: { ...UPI, vpa: 'old@okaxis', amount: '20.00', status: 'paid' } };
  const qr = buildReceiptDocument(paid, settings).blocks.find((b: any) => b.t === 'qr') as any;
  assert.equal(parseUpiUri(qr.data).pa, 'old@okaxis');
  assert.equal(parseUpiUri(qr.data).am, '20.00');
});

test('reprint of the same receipt is identical (same document, same QR)', () => {
  const a = JSON.stringify(buildReceiptDocument(receipt(), settings));
  const b = JSON.stringify(buildReceiptDocument(receipt(), settings));
  assert.equal(a, b);
  assert.equal(receiptDedupeKey(77, 'unpaid'), 'receipt:77:bill');
  assert.equal(receiptDedupeKey(77, 'paid'), 'receipt:77:paid');
});

test('a full receipt fits both paper widths and never exceeds the column count', () => {
  const doc = buildReceiptDocument(receipt(), settings);
  for (const [mm, cols] of [[58, 32], [80, 48]] as const) {
    const l = escpos.layoutDocument(doc, { paperWidthMm: mm }).lines.filter((x: any) => x.qr === undefined);
    assert.ok(l.every((x: any) => x.text.length <= cols), `${mm} mm`);
  }
});

test('the receipt document passes the main-process validation that real prints go through', () => {
  const paid = receipt({ payment_status: 'paid', payments: [{ payment_method: 'upi_qr', amount: '26.25', transaction_reference: 'UTR123', payment_number: 'PAY-1', cashier: { name: 'Ravi' } }] });
  assert.doesNotThrow(() => validateDocument(buildReceiptDocument(paid, settings)));
  assert.ok(lines(buildReceiptDocument(paid, settings)).some((l: string) => l.includes('UPI Ref: UTR123')));
});

// ------------------------------------------------------------------ KOT
const item = (id: number, name: string, qty: number, stall: number, note: string | null = null, status: string | null = null) => ({ id, quantity: qty, status, order_item: { item_name: name, special_instructions: note, stall_id: stall } });
const order = {
  id: 77,
  order_number: 'ORD-77',
  order_type: 'takeaway',
  notes: 'Birthday table - bring together',
  created_at: '2026-11-04T10:15:00Z',
  table: { table_number: 'T4' },
  customer_name: 'Asha',
  kitchen_tickets: [
    { id: 11, ticket_number: 'KKT-1', stall_id: 1, status: 'pending', stall: { id: 1, name: 'Dosa Corner' }, ticket_items: [item(1, 'Masala Dosa', 2, 1, 'less oil'), item(2, 'Idli', 3, 1)] },
    { id: 12, ticket_number: 'KKT-2', stall_id: 2, status: 'pending', stall: { id: 2, name: 'Juice Bar' }, ticket_items: [item(3, 'Mosambi Juice', 1, 2)] },
    { id: 13, ticket_number: 'KKT-3', stall_id: 3, status: 'cancelled', stall: { id: 3, name: 'Cancelled Stall' }, ticket_items: [item(4, 'Ghost Item', 9, 3)] },
  ],
};

test('one KOT per stall ticket; cancelled tickets are skipped', () => {
  const kots = buildKotDocuments(order);
  assert.deepEqual(kots.map((k) => k.stallName), ['Dosa Corner', 'Juice Bar']);
  assert.deepEqual(kots.map((k) => k.dedupeKey), ['kot:11', 'kot:12']);
});

test('stall isolation: a stall\'s KOT lists only that stall\'s items, never another stall\'s', () => {
  const [dosa, juice] = buildKotDocuments(order);
  const d = JSON.stringify(dosa.doc);
  const j = JSON.stringify(juice.doc);
  assert.ok(d.includes('Masala Dosa') && d.includes('Idli'));
  assert.ok(!d.includes('Mosambi Juice') && !d.includes('Juice Bar'));
  assert.ok(j.includes('Mosambi Juice'));
  assert.ok(!j.includes('Masala Dosa') && !j.includes('Idli') && !j.includes('Dosa Corner'));
  assert.ok(!d.includes('Ghost Item') && !j.includes('Ghost Item'));
});

test('second safeguard: an item whose order line belongs to another stall is dropped even if it appears on a ticket', () => {
  const bad = { id: 20, ticket_number: 'KKT-9', stall_id: 1, stall: { name: 'Dosa Corner' }, ticket_items: [item(1, 'Masala Dosa', 1, 1), item(9, 'Juice From Elsewhere', 4, 2)] };
  const s = JSON.stringify(buildKotDocument(bad as any, order as any).doc);
  assert.ok(s.includes('Masala Dosa'));
  assert.ok(!s.includes('Juice From Elsewhere'));
});

test('KOT content: quantity, order and ticket numbers, table or takeaway, item instruction, order note, no prices', () => {
  const [dosa] = buildKotDocuments(order);
  const text = lines(dosa.doc).join('\n');
  assert.match(text, /Order: ORD-77/);
  assert.match(text, /Ticket: KKT-1/);
  assert.match(text, /Table: T4/);
  assert.match(text, /Customer: Asha/);
  assert.ok(JSON.stringify(dosa.doc).includes('2 x Masala Dosa'));
  assert.ok(JSON.stringify(dosa.doc).includes('3 x Idli'));
  assert.match(text, />> less oil/);
  assert.match(text, /ORDER NOTE: Birthday table/);
  assert.ok(!/\d+\.\d{2}/.test(text.replace(/\d{1,2}\/\d{1,2}\/\d{2,4}.*|\d{1,2}:\d{2}.*/g, '')), 'no prices on a kitchen ticket');
});

test('a takeaway order is labelled instead of showing a table; cancelled lines are left off', () => {
  const t = { id: 30, ticket_number: 'KKT-30', stall_id: 1, stall: { name: 'Dosa Corner' }, ticket_items: [item(1, 'Dosa', 1, 1), item(2, 'Cancelled Vada', 5, 1, null, 'cancelled')] };
  const k = buildKotDocument(t as any, { order_number: 'ORD-5', order_type: 'takeaway' });
  const s = JSON.stringify(k.doc);
  assert.ok(s.includes('Takeaway (takeaway)'));
  assert.ok(!s.includes('Cancelled Vada'));
});

test('KOT documents pass validation, fit 58 mm, and keep Marathi item names intact for the driver page', () => {
  const marathi = { id: 40, ticket_number: 'KKT-40', stall_id: 1, stall: { name: 'Dosa Corner' }, ticket_items: [item(1, 'मसाला डोसा', 2, 1)] };
  const k = buildKotDocument(marathi as any, order as any);
  assert.doesNotThrow(() => validateDocument(k.doc));
  assert.ok(documentToHtml(k.doc, 58).includes('मसाला डोसा'));
  assert.ok(escpos.encodeDocument(k.doc, { paperWidthMm: 58 }).unsupported.length > 0, 'thermal text mode reports it cannot print this');
  assert.ok(escpos.layoutDocument(k.doc, { paperWidthMm: 58 }).lines.every((l: any) => l.text.length <= 32));
});

test('a ticket from the Kitchen board (its own order object) builds the same KOT as from the order screen', () => {
  const fromOrder = buildKotDocuments(order)[0];
  const board = buildKotDocument({ ...order.kitchen_tickets[0], order: { ...order, kitchen_tickets: undefined } } as any);
  assert.equal(JSON.stringify(board.doc), JSON.stringify(fromOrder.doc));
  assert.equal(board.dedupeKey, fromOrder.dedupeKey, 'both paths share one duplicate-protection key');
});

// ------------------------------------------------------------------ bridge consistency
test('preload, main allow-list and bridge types expose exactly the same printing API', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const preload = read('../electron/preload.cjs');
  const main = read('../electron/main.cjs');
  const bridge = read('../src/desktop/bridge.ts');
  const preloadKeys = [...preload.matchAll(/^  ([a-zA-Z]+): /gm)].map((m) => m[1]).sort();
  const allow = /const BRIDGE_KEYS = \[([\s\S]*?)\]\.sort\(\)/.exec(main)![1];
  const mainKeys = [...allow.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(preloadKeys, mainKeys, 'preload keys == BRIDGE_KEYS');
  const iface = /interface DesktopBridge \{([\s\S]*?)\n\}/.exec(bridge)![1];
  const ifaceKeys = [...iface.matchAll(/^  ([a-zA-Z]+)\(/gm)].map((m) => m[1]).sort();
  assert.deepEqual(ifaceKeys, mainKeys, 'bridge.ts interface == BRIDGE_KEYS');
  for (const k of ['enqueuePrintJob', 'retryPrintJob', 'reprintPrintJob', 'previewPrintDocument', 'sendTestPrint', 'getPrintConfig', 'setPrintConfig', 'getPrinterStatus', 'listPrintJobs', 'onPrintJobsChanged']) assert.ok(mainKeys.includes(k), k);
});

test('every printing channel the preload calls is registered in the main process, and nothing exposes Node', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const preload = read('../electron/preload.cjs');
  const idx = read('../electron/printing/index.cjs');
  const channels = [...preload.matchAll(/'(printing:[a-z-]+)'/g)].map((m) => m[1]);
  for (const c of new Set(channels)) assert.ok(idx.includes(`'${c}'`), `${c} registered`);
  assert.ok(!/require\((?!'electron')/.test(preload.replace(/\/\*[\s\S]*?\*\//g, '')), 'preload requires only electron');
  assert.ok(!/exposeInMainWorld\([^)]*(ipcRenderer|fs|child_process)/.test(preload), 'no raw ipcRenderer/fs exposed');
  const main = read('../electron/main.cjs');
  assert.ok(/sandbox: true/.test(main) && /contextIsolation: true/.test(main) && /nodeIntegration: false/.test(main), 'renderer security unchanged');
  assert.ok(/autoplayPolicy: 'no-user-gesture-required'/.test(main));
});
