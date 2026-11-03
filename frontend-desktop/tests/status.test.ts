import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStruck, statusChip, statusClasses, statusKind, STATUS_KINDS, type StatusKind } from '../src/lib/status.ts';

const MAP: Record<string, StatusKind> = {
  // order
  pending: 'pending', confirmed: 'running', in_preparation: 'cooking', partially_ready: 'ready', ready: 'ready',
  served: 'served', completed: 'settled', cancelled: 'cancelled',
  // ticket
  accepted: 'running', preparing: 'cooking', picked_up: 'served',
  // payment
  success: 'settled', failed: 'cancelled', refunded: 'void',
  // table
  available: 'served', occupied: 'running', reserved: 'kitchen',
  // closing / settlement
  closed: 'settled', paid: 'settled', unpaid: 'pending',
  // purchases / active flags
  received: 'served', ordered: 'running', active: 'served', inactive: 'void',
};

test('every documented raw status maps to its kind', () => {
  for (const [raw, kind] of Object.entries(MAP)) assert.equal(statusKind(raw), kind, raw);
});

test('unknown, empty, null and undefined fall back to pending', () => {
  for (const raw of ['nope', '', null, undefined]) assert.equal(statusKind(raw), 'pending');
});

test('statusKind is case/space tolerant', () => {
  assert.equal(statusKind(' Ready '), 'ready');
  assert.equal(statusKind('IN_PREPARATION'), 'cooking');
});

test('every kind is reachable and has token-only classes', () => {
  assert.deepEqual([...STATUS_KINDS].sort(), ['cancelled', 'cooking', 'kitchen', 'pending', 'ready', 'running', 'served', 'settled', 'void']);
  for (const kind of STATUS_KINDS) {
    const c = statusClasses(kind);
    assert.equal(c.solid, `bg-st-${kind}`);
    assert.equal(c.soft, `bg-st-${kind}-soft`);
    assert.equal(c.text, `text-st-${kind}-fg`);
    assert.equal(c.border, `border-st-${kind}`);
    for (const cls of Object.values(c).join(' ').split(/\s+/)) {
      assert.doesNotMatch(cls, /(slate|rose|emerald|amber|sky|purple|white|gray|zinc|red|green|blue|orange)-\d|bg-white/, cls);
    }
  }
});

test('statusChip gives the soft background + text of the raw status kind', () => {
  assert.equal(statusChip('in_preparation'), 'bg-st-cooking-soft text-st-cooking-fg');
  assert.equal(statusChip('received'), 'bg-st-served-soft text-st-served-fg');
  assert.equal(statusChip(null), 'bg-st-pending-soft text-st-pending-fg');
});

test('strike-through only for cancelled (raw cancelled/failed); refunded, inactive and void-kind statuses are not struck', () => {
  assert.equal(statusChip('cancelled'), 'bg-st-cancelled-soft text-st-cancelled-fg line-through');
  for (const raw of ['refunded', 'inactive', 'pending', 'ready', 'in_preparation']) assert.doesNotMatch(statusChip(raw), /line-through/, raw);
  assert.equal(isStruck('cancelled'), true);
  for (const k of STATUS_KINDS.filter((k) => k !== 'cancelled')) assert.equal(isStruck(k), false, k);
});
