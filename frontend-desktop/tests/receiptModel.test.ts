import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { RECEIPT_CREDIT, receiptHeader, upiSection, paperProfile, upiQrFor, parseUpiUri, isValidVpa } from '../src/lib/receiptModel.ts';

const profile = (over: object = {}) => ({
  name: 'MangalMurti Food Court',
  legal_name: null,
  address: 'MG Road, Pune',
  phone: '9876543210',
  email: null,
  gstin: '27ABCDE1234F1Z5',
  opening_time: null,
  closing_time: null,
  ...over,
});
const settings = (p: object = {}, receipt: object = {}) => ({
  business_profile: profile(p),
  receipt: { header: null, footer: null, show_gstin: true, ...receipt },
  upi: { enabled: true, vpa: 'mangalmurti@upi' },
});

const UPI = {
  reference: 'ORD-00125',
  vpa: 'mangalmurti@upi',
  payee_name: 'MangalMurti Food Court',
  amount: '200.00',
  upi_uri: 'upi://pay?pa=mangalmurti@upi&pn=MangalMurti%20Food%20Court&am=200.00&cu=INR&tn=ORD-00125',
  status: 'pending',
};

test('header shows the configured business name first, then only the configured details', () => {
  const h = receiptHeader(settings());
  assert.deepEqual(h, ['MANGALMURTI FOOD COURT', 'MG Road, Pune', 'Tel: 9876543210', 'GSTIN: 27ABCDE1234F1Z5']);
});

test('the business name is read from the saved profile, never hardcoded', () => {
  assert.equal(receiptHeader(settings({ name: 'Spice Hub' }))[0], 'SPICE HUB');
  assert.equal(receiptHeader(settings({ name: 'Spice Hub' })).join('|').includes('MANGALMURTI'), false);
});

test('empty and unconfigured header fields are omitted, and a missing name falls back gracefully', () => {
  assert.deepEqual(receiptHeader(settings({ address: '  ', phone: null, gstin: null })), ['MANGALMURTI FOOD COURT']);
  assert.equal(receiptHeader(settings({ name: '   ' }))[0], 'FOOD COURT');
  assert.equal(receiptHeader(null)[0], 'FOOD COURT');
  assert.equal(receiptHeader(undefined).length, 1);
});

test('GSTIN is printed only when configured and the owner has switched it on', () => {
  assert.equal(receiptHeader(settings({}, { show_gstin: false })).some((l) => l.startsWith('GSTIN')), false);
});

test('the receipt header line configured by the owner is kept below the address block', () => {
  assert.equal(receiptHeader(settings({}, { header: 'Baner Branch' })).at(-1), 'Baner Branch');
});

test('UPI section shows scan-to-pay QR data for an unpaid bill when UPI is on', () => {
  const s = upiSection({ upi_enabled: true, upi: UPI, order: { payment_status: 'unpaid' } });
  assert.ok(s);
  assert.equal(s.title, 'SCAN & PAY USING UPI');
  assert.match(s.instructionLine, /pay exactly ₹200\.00/);
  assert.equal(s.qrText, UPI.upi_uri);
  assert.equal(s.vpaLine, 'UPI ID: mangalmurti@upi');
  assert.equal(s.amountLine, 'Amount: ₹200.00');
  assert.equal(s.referenceLine, 'Ref: ORD-00125');
  assert.equal(s.paid, false);
});

test('no UPI section when UPI is disabled or the bill has no request', () => {
  assert.equal(upiSection({ upi_enabled: false, upi: UPI, order: { payment_status: 'unpaid' } }), null);
  assert.equal(upiSection({ upi_enabled: true, upi: null, order: { payment_status: 'unpaid' } }), null);
  assert.equal(upiSection({ upi_enabled: true, order: { payment_status: 'unpaid' } }), null);
});

test('a paid UPI bill reprints its ORIGINAL QR and amount, without the UPI ID or a paid title, even if UPI was switched off since', () => {
  const s = upiSection({ upi_enabled: false, upi: { ...UPI, status: 'paid', vpa: 'old@upi', amount: '200.00' }, order: { payment_status: 'paid' } });
  assert.ok(s);
  assert.equal(s.paid, true);
  assert.equal(s.title, '');
  assert.equal(s.vpaLine, '');
  assert.match(s.qrText, /pa=old@upi/);
  assert.match(s.amountLine, /200\.00/);
});

test('the QR text is rebuilt from the request, so a tampered stored URI cannot show another amount', () => {
  const tampered = { ...UPI, upi_uri: 'upi://pay?pa=thief@upi&am=1.00' };
  const s = upiSection({ upi_enabled: true, upi: tampered, order: { payment_status: 'unpaid' } });
  const q = parseUpiUri(s!.qrText);
  assert.equal(q.pa, 'mangalmurti@upi');
  assert.equal(q.am, '200.00');
  assert.equal(q.tn, 'ORD-00125');
  assert.equal(q.cu, 'INR');
  assert.equal(q.pn, 'MangalMurti Food Court');
});

test('upiQrFor generates a scannable code whose payload is the request URI', () => {
  for (const width of [58, 80] as const) {
    const { qr, layout } = upiQrFor(UPI.upi_uri, width);
    assert.equal(qr.size, qr.version * 4 + 17);
    assert.equal(layout.units, qr.size + 8);
    assert.ok(layout.moduleMm >= 0.5);
    assert.ok(layout.sizeMm <= paperProfile(width).qrMaxMm);
  }
});

test('58 mm and 80 mm paper profiles fit the printable width and leave the QR inside it', () => {
  const p58 = paperProfile(58);
  const p80 = paperProfile(80);
  assert.ok(p58.contentMm < 58 && p80.contentMm < 80);
  assert.ok(p58.qrMaxMm <= p58.contentMm && p80.qrMaxMm <= p80.contentMm);
  assert.ok(p80.contentMm > p58.contentMm);
  assert.equal(paperProfile(undefined).pageMm, 80);
  assert.equal(paperProfile(42 as any).pageMm, 80);
});

test('UPI id validation matches the server and refuses injection characters', () => {
  for (const ok of ['mangalmurti@upi', 'Shop.Name-1@okhdfcbank', 'a1@ybl', '98765_43210@paytm']) assert.equal(isValidVpa(ok), true, ok);
  for (const bad of ['', 'mangalmurti', '@upi', 'a b@upi', 'a@upi&am=1', 'a@upi?x', 'a@b@c', 'upi://pay?pa=x@y']) assert.equal(isValidVpa(bad), false, bad);
});

test('the "Powered by" credit is a fixed line: not part of any setting and rendered unconditionally by the receipt', () => {
  assert.equal(RECEIPT_CREDIT, 'Powered by MangalMurti Tech Solution');
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const lines = read('../src/components/Receipt.tsx').split('\n');
  const idx = lines.findIndex((l) => l.includes('receipt-powered-by'));
  assert.ok(idx > 0, 'receipt renders the credit');
  assert.ok(lines[idx].includes('{RECEIPT_CREDIT}'), 'it prints the constant, not a setting');
  assert.ok(!/(&&|\?)\s*$/.test(lines[idx - 1]), 'no conditional guard right before it');
  for (const f of ['../src/context/SettingsContext.tsx', '../src/pages/FoodCourtSettingsPage.tsx']) {
    assert.ok(!read(f).includes('RECEIPT_CREDIT'), `${f} cannot change it`);
  }
});
