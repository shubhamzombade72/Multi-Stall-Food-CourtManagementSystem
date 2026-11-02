/**
 * Desktop unit tests: kitchen display logic, CSV export safety and the Electron API-URL validator.
 * Run with `pnpm test` (Node's built-in runner with TypeScript type stripping).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { columnFor, elapsed, newTicketIds, nextKitchenAction, urgency } from '../src/lib/kds.ts';
import { csvCell, toCsv } from '../src/lib/csv.ts';

const require = createRequire(import.meta.url);
const { normalizeApiUrl } = require('../electron/config.cjs');

// ---------------------------------------------------------------- kitchen display
test('KDS actions follow the backend forward-only state machine', () => {
  assert.deepEqual(nextKitchenAction('pending'), { label: 'Accept', to: 'accepted' });
  assert.deepEqual(nextKitchenAction('accepted'), { label: 'Start Preparing', to: 'preparing' });
  assert.deepEqual(nextKitchenAction('preparing'), { label: 'Mark Ready', to: 'ready' });
  assert.equal(nextKitchenAction('ready'), null, 'serving is not a kitchen action');
  assert.equal(nextKitchenAction('picked_up'), null);
  assert.equal(nextKitchenAction('cancelled'), null);
});

test('KDS columns group statuses', () => {
  assert.equal(columnFor('pending'), 'new');
  assert.equal(columnFor('accepted'), 'new');
  assert.equal(columnFor('preparing'), 'preparing');
  assert.equal(columnFor('ready'), 'ready');
  assert.equal(columnFor('picked_up'), 'served');
  assert.equal(columnFor('cancelled'), null);
});

test('KDS urgency and timers', () => {
  const now = Date.parse('2026-11-02T12:00:00Z');
  assert.equal(urgency('2026-11-02T11:50:00Z', now), 'normal');
  assert.equal(urgency('2026-11-02T11:45:00Z', now), 'warning');
  assert.equal(urgency('2026-11-02T11:30:00Z', now), 'late');
  assert.equal(elapsed('2026-11-02T11:58:05Z', now), '1:55');
  assert.equal(elapsed('2026-11-02T10:30:00Z', now), '1h 30m');
  assert.deepEqual(newTicketIds(new Set([1, 2]), [1, 2, 3, 4]), [3, 4]);
  assert.deepEqual(newTicketIds(new Set([1, 2]), [2]), []);
});

// ---------------------------------------------------------------- CSV export
test('CSV quotes separators and neutralises spreadsheet formulas', () => {
  assert.equal(csvCell('Pizza, Large'), '"Pizza, Large"');
  assert.equal(csvCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(csvCell('=HYPERLINK("http://evil")'), `"'=HYPERLINK(""http://evil"")"`);
  assert.equal(csvCell('+1+1'), "'+1+1");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('-12.50'), '-12.50', 'negative numbers stay numeric');
  assert.equal(csvCell(null), '');
  const csv = toCsv([{ a: 'x', b: 2 }], [{ header: 'A', value: (r) => r.a }, { header: 'B', value: (r) => r.b }]);
  assert.equal(csv, 'A,B\r\nx,2');
});

// ---------------------------------------------------------------- Electron config validation
test('API base URL must be a plain http(s) URL ending in /api', () => {
  assert.equal(normalizeApiUrl('http://192.168.1.50:8000/api'), 'http://192.168.1.50:8000/api');
  assert.equal(normalizeApiUrl('  https://pos.local/api/  '), 'https://pos.local/api');
  assert.equal(normalizeApiUrl('http://192.168.1.50:8000'), null, 'must end in /api');
  assert.equal(normalizeApiUrl('file:///C:/Windows/api'), null);
  assert.equal(normalizeApiUrl('javascript:alert(1)//api'), null);
  assert.equal(normalizeApiUrl('http://user:pass@host/api'), null, 'no embedded credentials');
  assert.equal(normalizeApiUrl('http://host/api?x=1'), null);
  assert.equal(normalizeApiUrl(42), null);
  assert.equal(normalizeApiUrl('x'.repeat(400)), null);
});
