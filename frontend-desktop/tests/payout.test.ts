import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autoAllocate,
  formatBusinessDate,
  formatRupees,
  fromPaise,
  referenceRequired,
  statusLabel,
  toPaise,
  validateAllocations,
  validatePayout,
} from '../src/lib/payout.ts';

test('toPaise parses whole-paise amounts and rejects everything else', () => {
  assert.equal(toPaise('5000'), 500000);
  assert.equal(toPaise('5000.5'), 500050);
  assert.equal(toPaise('0.01'), 1);
  assert.equal(toPaise(' 12.34 '), 1234);
  assert.equal(toPaise('1.234'), null);
  assert.equal(toPaise('abc'), null);
  assert.equal(toPaise(''), null);
  assert.equal(toPaise('1e3'), null);
  assert.equal(toPaise(null), null);
});

test('fromPaise and formatRupees use Indian grouping', () => {
  assert.equal(fromPaise(500000), '5000.00');
  assert.equal(fromPaise(5), '0.05');
  assert.equal(fromPaise(-1250), '-12.50');
  assert.equal(formatRupees('5000'), '₹5,000.00');
  assert.equal(formatRupees('125000.5'), '₹1,25,000.50');
  assert.equal(formatRupees('-50'), '-₹50.00');
  assert.equal(formatRupees(0), '₹0.00');
});

test('0.1 + 0.2 style float errors cannot occur when amounts are added in paise', () => {
  const sum = ['0.10', '0.20'].reduce((s, v) => s + (toPaise(v) as number), 0);
  assert.equal(fromPaise(sum), '0.30');
});

test('reference is required for UPI and bank transfer only', () => {
  assert.equal(referenceRequired('upi'), true);
  assert.equal(referenceRequired('bank_transfer'), true);
  assert.equal(referenceRequired('cash'), false);
  assert.equal(referenceRequired('other'), false);
});

test('validatePayout: amount, balance cap, method and reference', () => {
  assert.equal(validatePayout({ amount: '3000', method: 'cash', reference: '' }, '5000.00'), null);
  assert.equal(validatePayout({ amount: '5000', method: 'upi', reference: 'UPI1' }, '5000.00'), null);
  assert.match(validatePayout({ amount: '5000.01', method: 'cash', reference: '' }, '5000.00') as string, /exceeds the outstanding balance of ₹5,000.00/);
  assert.match(validatePayout({ amount: '0', method: 'cash', reference: '' }, '5000.00') as string, /greater than zero/);
  assert.match(validatePayout({ amount: '-1', method: 'cash', reference: '' }, '5000.00') as string, /greater than zero|at most two decimals/);
  assert.match(validatePayout({ amount: '10', method: 'upi', reference: '  ' }, '5000.00') as string, /reference is required/);
  assert.match(validatePayout({ amount: '10', method: 'cheque', reference: '' }, '5000.00') as string, /payment method/);
  assert.match(validatePayout({ amount: '10.555', method: 'cash', reference: '' }, '5000.00') as string, /two decimals/);
});

test('validateAllocations: must add up exactly and stay within each balance', () => {
  const balances = { 1: '1000.00', 2: '2000.00', 3: '3000.00' };
  assert.equal(validateAllocations('3000', [{ settlement_id: 1, amount: '1000' }, { settlement_id: 2, amount: '2000' }], balances), null);
  assert.match(validateAllocations('3000', [{ settlement_id: 1, amount: '1000' }], balances) as string, /must match exactly/);
  assert.match(validateAllocations('1500', [{ settlement_id: 1, amount: '1500' }], balances) as string, /exceeds that stall/);
  assert.match(validateAllocations('', [], balances) as string, /total amount/);
});

test('autoAllocate fills the oldest balances first and never over-allocates', () => {
  const rows = [
    { settlement_id: 1, remaining: '1000.00' },
    { settlement_id: 2, remaining: '1000.00' },
    { settlement_id: 3, remaining: '1000.00' },
  ];
  assert.deepEqual(autoAllocate('1500', rows), [
    { settlement_id: 1, amount: '1000.00' },
    { settlement_id: 2, amount: '500.00' },
  ]);
  assert.deepEqual(autoAllocate('0', rows), []);
  assert.equal(autoAllocate('5000', rows).reduce((s, a) => s + (toPaise(a.amount) as number), 0), 300000);
});

test('labels and dates', () => {
  assert.equal(statusLabel('partially_paid'), 'Partially Paid');
  assert.equal(statusLabel(null), '—');
  assert.equal(formatBusinessDate('2026-11-04'), '04-11-2026');
  assert.equal(formatBusinessDate('2026-11-04T00:00:00.000000Z'), '04-11-2026');
});
