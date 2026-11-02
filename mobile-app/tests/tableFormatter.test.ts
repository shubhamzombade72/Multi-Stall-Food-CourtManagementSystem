import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTableLabel } from '../src/utils/tableFormatter.ts';

test('Table label formatting avoids duplicate T- prefix', () => {
  // Database format: already has 'T-'
  assert.equal(formatTableLabel('T-01'), 'T-01');
  assert.equal(formatTableLabel('T-04'), 'T-04');
  assert.equal(formatTableLabel('T-10'), 'T-10');

  // Defect case: double prefix 'T-T-01' should normalize to 'T-01'
  assert.equal(formatTableLabel('T-T-01'), 'T-01');
  assert.equal(formatTableLabel('T-T-T-05'), 'T-05');

  // Bare numbers: should be given 'T-' prefix
  assert.equal(formatTableLabel('01'), 'T-01');
  assert.equal(formatTableLabel('5'), 'T-5');
  assert.equal(formatTableLabel('12'), 'T-12');

  // Custom section prefixes should be preserved
  assert.equal(formatTableLabel('VIP-01'), 'VIP-01');
  assert.equal(formatTableLabel('PATIO-3'), 'PATIO-3');

  // Whitespace and casing tolerance
  assert.equal(formatTableLabel('  t-02  '), 'T-02');

  // Empty / null tolerance
  assert.equal(formatTableLabel(null), '');
  assert.equal(formatTableLabel(undefined), '');
  assert.equal(formatTableLabel(''), '');

  // Idempotency: multiple passes yield the identical string
  const sample = 'T-01';
  assert.equal(formatTableLabel(formatTableLabel(sample)), sample);
});

