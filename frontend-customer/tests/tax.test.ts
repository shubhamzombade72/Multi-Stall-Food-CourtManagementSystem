/**
 * The QR menu shows a GST estimate with the same rules as the server (backend TaxService). Its src/lib/tax.ts is a
 * verbatim copy of frontend-desktop/src/lib/tax.ts (two separate packages); this fails if the copies drift, and runs
 * the shared vectors (qa/tax-vectors.json) that the server's tests use too.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateTax, taxLines } from '../src/lib/tax.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('src/lib/tax.ts is identical to the desktop app\'s copy (one rule set, two packages)', () => {
  assert.equal(read('../src/lib/tax.ts'), read('../../frontend-desktop/src/lib/tax.ts'));
});

test('calculateTax matches every shared vector', () => {
  const vectors = JSON.parse(read('../../qa/tax-vectors.json')).cases;
  assert.ok(vectors.length >= 20);
  for (const c of vectors) assert.deepEqual(calculateTax(c.items_total, c.config), c.expect, c.name);
});

test('the bill lines use the rate the order was priced with', () => {
  const lines = taxLines({ subtotal: '100.00', tax_amount: '12.00', tax_rate_percent: '12.00', tax_mode: 'exclusive', total_amount: '112.00' });
  assert.deepEqual(lines, [
    { label: 'Subtotal', value: '100.00' },
    { label: 'GST (12%)', value: '12.00' },
  ]);
});
