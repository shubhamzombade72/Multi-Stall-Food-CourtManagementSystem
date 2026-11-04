import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateTax, taxLines, formatRate, billTotals } from '../src/lib/tax.ts';
import { receiptTaxLines } from '../src/lib/receiptModel.ts';

// The same vectors the backend test (GstConfigurationTest) checks TaxService against: the POS estimate, the payment
// amount and the receipt can only disagree if one of the two implementations drifts, and this fails when that happens.
const vectors = JSON.parse(readFileSync(new URL('../../qa/tax-vectors.json', import.meta.url), 'utf8')).cases as {
  name: string;
  config: { enabled: boolean; rate_percent: string; mode: 'exclusive' | 'inclusive' };
  items_total: string;
  expect: { subtotal: string; tax_amount: string; total_amount: string; tax_mode: string; tax_rate_percent: string };
}[];

test('calculateTax matches every shared vector (same results as the server TaxService)', () => {
  assert.ok(vectors.length >= 20);
  for (const c of vectors) assert.deepEqual(calculateTax(c.items_total, c.config), c.expect, c.name);
});

test('calculateTax accepts numbers, e.g. a cart total computed on screen', () => {
  assert.equal(calculateTax(190.48, { enabled: true, rate_percent: '5.00', mode: 'exclusive' }).total_amount, '200.00');
  assert.equal(calculateTax(0.1 + 0.2, { enabled: true, rate_percent: '12.00', mode: 'exclusive' }).tax_amount, '0.04');
});

test('subtotal + GST equals the total in every vector, in both modes', () => {
  for (const c of vectors) {
    const r = calculateTax(c.items_total, c.config);
    assert.equal(Math.round(Number(r.subtotal) * 100) + Math.round(Number(r.tax_amount) * 100), Math.round(Number(r.total_amount) * 100), c.name);
  }
});

test('formatRate drops trailing zeros: 5.00 -> 5, 12.50 -> 12.5, 18 -> 18', () => {
  assert.equal(formatRate('5.00'), '5');
  assert.equal(formatRate('12.50'), '12.5');
  assert.equal(formatRate(18), '18');
  assert.equal(formatRate(null), '0');
});

const bill = (over: object) => ({ subtotal: '1000.00', tax_amount: '50.00', tax_rate_percent: '5.00', tax_mode: 'exclusive', discount_amount: '0.00', total_amount: '1050.00', ...over });

test('exclusive bill lines: Subtotal then "GST (5%)" with the rate the bill was priced with', () => {
  assert.deepEqual(taxLines(bill({})), [
    { label: 'Subtotal', value: '1000.00' },
    { label: 'GST (5%)', value: '50.00' },
  ]);
  assert.deepEqual(taxLines(bill({ tax_rate_percent: '12.00', tax_amount: '120.00', total_amount: '1120.00' })).at(-1), { label: 'GST (12%)', value: '120.00' });
});

test('inclusive bill lines: gross subtotal "including GST", "GST Included (5%)", nothing added', () => {
  const lines = taxLines(bill({ subtotal: '1000.00', tax_amount: '50.00', tax_mode: 'inclusive', total_amount: '1050.00' }));
  assert.deepEqual(lines, [
    { label: 'Subtotal (including GST)', value: '1050.00' },
    { label: 'GST Included (5%)', value: '50.00' },
  ]);
});

test('a bill priced with GST off has no GST line and never mentions 5%', () => {
  const lines = taxLines(bill({ tax_mode: 'none', tax_amount: '0.00', tax_rate_percent: '0.00', total_amount: '1000.00' }));
  assert.deepEqual(lines, [{ label: 'Subtotal', value: '1000.00' }]);
});

test('an old bill keeps its own rate: the lines come from the bill, not from today\'s settings', () => {
  const old = bill({ tax_rate_percent: '5.00' });
  const today = { enabled: true, rate_percent: '18.00', mode: 'inclusive' as const };
  assert.equal(taxLines(old)[1].label, 'GST (5%)');
  assert.notEqual(calculateTax('1000.00', today).tax_amount, old.tax_amount);
});

test('a bill without a snapshot (very old payload) shows a plain GST line without inventing a rate', () => {
  const lines = taxLines({ subtotal: '100.00', tax_amount: '5.00', total_amount: '105.00' });
  assert.deepEqual(lines, [
    { label: 'Subtotal', value: '100.00' },
    { label: 'GST', value: '5.00' },
  ]);
});

test('receiptTaxLines is what the receipt prints (same lines, bold TOTAL is added by the receipt)', () => {
  assert.deepEqual(receiptTaxLines(bill({})), taxLines(bill({})));
});

test('billTotals gives subtotal, GST and total as numbers for display and reconciliation', () => {
  assert.deepEqual(billTotals(bill({ tax_mode: 'inclusive' })), { subtotal: 1000, tax: 50, total: 1050 });
});
