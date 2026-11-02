/**
 * Formatting helpers shared by every management screen: rupee amounts, local dates and API error messages.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiError, humanize, isoDate, money } from '../src/lib/format.ts';

test('money formats rupees with two decimals and tolerates bad input', () => {
  assert.equal(money('1234.5'), '₹1,234.50');
  assert.equal(money(100000), '₹1,00,000.00');
  assert.equal(money(null), '₹0.00');
  assert.equal(money('not-a-number'), '₹0.00');
  assert.equal(money(-10), '-₹10.00');
});

test('isoDate uses the local calendar date, not UTC', () => {
  const d = new Date(2026, 10, 2, 23, 45); // 2 Nov 2026, 23:45 local
  assert.equal(isoDate(d), '2026-11-02');
});

test('humanize turns snake_case statuses into labels', () => {
  assert.equal(humanize('partially_ready'), 'Partially Ready');
  assert.equal(humanize(null), '—');
});

test('apiError prefers validation messages, then the server message, then network wording', () => {
  assert.equal(apiError({ response: { data: { errors: { phone: ['Phone taken.'], name: ['Name required.'] } } } }), 'Phone taken. Name required.');
  assert.equal(apiError({ response: { data: { message: 'Unauthorized' } } }), 'Unauthorized');
  assert.match(apiError({ code: 'ERR_NETWORK' }), /Server unreachable/);
  assert.equal(apiError({ response: { data: {} } }, 'Fallback'), 'Fallback');
});
