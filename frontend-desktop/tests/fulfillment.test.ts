/**
 * Pure fulfilment logic: colour matrix, delay, labels, optimistic updates, server offset and the shared clock.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOptimistic, cardLabel, cardNow, cardState, displayStatus, elapsedMinutes, isDelayed, nextItemAction, progress, serverOffset,
} from '../src/lib/fulfillment.ts';
import type { BoardItem, BoardOrder, ItemStatus } from '../src/lib/fulfillment.ts';
import { createClock } from '../src/lib/clock.ts';
import { parseItemStatusBody } from '../src/lib/fulfillment.ts';

const item = (id: number, status: ItemStatus): BoardItem => ({
  id, order_item_id: id, ticket_id: 1, name: `Item ${id}`, quantity: 1, notes: null,
  stall: { id: 1, name: 'Pizza', code: 'PZ' }, status, version: 1, ready_at: null, served_at: null,
});
const order = (statuses: ItemStatus[], over: Partial<BoardOrder> = {}): BoardOrder => ({
  id: 9, order_number: 'ORD-0009', order_type: 'dine_in', table: { id: 4, table_number: 'T-04' }, guest_count: 4,
  created_at: '2026-11-03T10:00:00Z', status: 'confirmed', payment_status: 'unpaid',
  items: statuses.map((s, i) => item(i + 1, s)), ...over,
});
const T0 = Date.parse('2026-11-03T10:00:00Z');
const MIN = 60_000;

test('displayStatus maps to Cooking / Ready / Served', () => {
  assert.equal(displayStatus('pending'), 'Cooking');
  assert.equal(displayStatus('preparing'), 'Cooking');
  assert.equal(displayStatus('ready'), 'Ready');
  assert.equal(displayStatus('served'), 'Served');
  assert.equal(displayStatus('cancelled'), 'Cancelled');
});

test('progress excludes cancelled items', () => {
  assert.deepEqual(progress(order(['served', 'served', 'preparing', 'cancelled']).items), { served: 2, total: 3 });
  assert.deepEqual(progress([]), { served: 0, total: 0 });
});

test('cardState colour matrix', () => {
  assert.equal(cardState(order(['served', 'served']).items), 'green');
  assert.equal(cardState(order(['served', 'cancelled']).items), 'green');
  assert.equal(cardState(order(['served', 'ready', 'preparing']).items), 'amber');
  assert.equal(cardState(order(['pending', 'preparing']).items), 'red');
  assert.equal(cardState(order(['served', 'served', 'preparing', 'pending']).items), 'red');
  assert.equal(cardState(order(['cancelled', 'cancelled']).items), 'empty');
  assert.equal(cardState([]), 'empty');
});

test('isDelayed boundary at the delay minutes; green and empty are never delayed', () => {
  const o = order(['preparing']);
  assert.equal(isDelayed(o, T0 + 14 * MIN + 59_000, 15), false);
  assert.equal(isDelayed(o, T0 + 15 * MIN, 15), true);
  assert.equal(isDelayed(order(['served']), T0 + 60 * MIN, 15), false);
  assert.equal(isDelayed(order(['cancelled']), T0 + 60 * MIN, 15), false);
  assert.equal(isDelayed(order(['ready']), T0 + 20 * MIN, 15), true);
});

test('elapsedMinutes floors and never goes negative', () => {
  assert.equal(elapsedMinutes('2026-11-03T10:00:00Z', T0 + 11 * MIN + 59_000), 11);
  assert.equal(elapsedMinutes('2026-11-03T10:00:00Z', T0 - 5000), 0);
});

test('nextItemAction', () => {
  assert.equal(nextItemAction('pending', true), 'ready');
  assert.equal(nextItemAction('preparing', true), 'ready');
  assert.equal(nextItemAction('pending', false), null);
  assert.equal(nextItemAction('ready', false), 'served');
  assert.equal(nextItemAction('ready', true), 'served');
  assert.equal(nextItemAction('served', true), null);
  assert.equal(nextItemAction('cancelled', true), null);
});

test('applyOptimistic returns a new order and leaves the original untouched', () => {
  const o = order(['preparing', 'ready']);
  const next = applyOptimistic(o, 2, 'served');
  assert.notEqual(next, o);
  assert.equal(next.items[1].status, 'served');
  assert.equal(o.items[1].status, 'ready');
  assert.equal(next.items[0], o.items[0]);
  assert.equal(applyOptimistic(o, 999, 'served').items.length, 2);
});

test('cardLabel exact formats', () => {
  const o = order(['served', 'served', 'preparing', 'pending']);
  assert.equal(cardLabel(o, T0 + 11 * MIN + 5000), 'T-04 · 4 Guests · 11m · 2/4 Served');
  assert.equal(cardLabel({ ...o, guest_count: null }, T0 + 11 * MIN), 'T-04 · 11m · 2/4 Served');
  assert.equal(
    cardLabel({ ...o, order_type: 'takeaway', table: null, guest_count: null }, T0 + 3 * MIN),
    'ORD-0009 · 3m · 2/4 Served',
  );
  assert.equal(cardLabel({ ...o, guest_count: 1 }, T0), 'T-04 · 1 Guest · 0m · 2/4 Served');
});

test('cardLabel for an all-cancelled order says Cancelled, not 0/0 Served', () => {
  const label = cardLabel(order(['cancelled', 'cancelled']), T0 + 2 * MIN);
  assert.equal(label, 'T-04 · 4 Guests · 2m · Cancelled');
  assert.ok(!label.includes('0/0'));
});

test('serverOffset is server minus client and corrects elapsed time', () => {
  const offset = serverOffset('2026-11-03T10:05:00Z', T0); // client clock 5 min behind
  assert.equal(offset, 5 * MIN);
  assert.equal(elapsedMinutes('2026-11-03T10:00:00Z', T0 + offset), 5);
});

test('createClock runs one timer for many subscribers and clears after the last', () => {
  let started = 0, cleared = 0, tick: (() => void) | null = null, nowMs = 1000;
  const clock = createClock(1000, () => nowMs, {
    setInterval: ((fn: () => void) => { started++; tick = fn; return 7; }) as never,
    clearInterval: (() => { cleared++; }) as never,
  });
  let calls = 0;
  const u1 = clock.subscribe(() => calls++);
  const u2 = clock.subscribe(() => calls++);
  const u3 = clock.subscribe(() => calls++);
  assert.equal(started, 1);
  assert.equal(clock.getSnapshot(), 1000);
  nowMs = 2000; tick!();
  assert.equal(clock.getSnapshot(), 2000);
  assert.equal(calls, 3);
  u1(); u2();
  assert.equal(cleared, 0);
  u3();
  assert.equal(cleared, 1);
  clock.subscribe(() => {});
  assert.equal(started, 2);
});

test('createClock calls the timer functions with no receiver (browser setInterval throws "Illegal invocation" otherwise)', () => {
  // Chromium's window.setInterval/clearInterval reject any `this` other than the window or undefined. Node's do not,
  // so this fake reproduces the browser rule: a method call like timers.setInterval(...) would pass `timers` as this.
  let tick: (() => void) | null = null;
  const strict = (name: string) =>
    function (this: unknown, fn?: () => void) {
      if (this !== undefined && this !== globalThis) throw new TypeError(`Illegal invocation (${name})`);
      if (fn) tick = fn;
      return 3;
    };
  const clock = createClock(1000, () => 5000, { setInterval: strict('setInterval') as never, clearInterval: strict('clearInterval') as never });
  const unsubscribe = clock.subscribe(() => {});
  assert.ok(tick);
  unsubscribe();
});

test('parseItemStatusBody reads PATCH /ticket-items/{id}/status ({success, message, data: {changed, item}})', () => {
  // Exact body shape of FulfillmentController::updateItemStatus
  const body = { success: true, message: 'Item updated', data: { changed: true, item: item(5, 'served') } };
  const parsed = parseItemStatusBody(body);
  assert.equal(parsed.changed, true);
  assert.equal(parsed.item.id, 5);
  assert.equal(parsed.item.status, 'served');
  assert.equal(parsed.item.stall.code, 'PZ');
  const unchanged = parseItemStatusBody({ success: true, message: 'Item already has this status', data: { changed: false, item: item(5, 'served') } });
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.item.id, 5);
});

test('cardNow changes only when the elapsed minute changes and keeps label/delay identical to the live clock', () => {
  const created = '2026-11-03T10:00:30Z';
  const base = Date.parse(created);
  const o = { id: 1, order_number: 'O1', order_type: 'takeaway' as const, table: null, guest_count: null, created_at: created, status: 'confirmed', payment_status: 'pending',
    items: [{ id: 1, order_item_id: 1, ticket_id: 1, name: 'x', quantity: 1, notes: null, stall: { id: 1, name: 'S', code: 'S1' }, status: 'pending' as const, version: 0, ready_at: null, served_at: null }] };
  assert.equal(cardNow(created, base + 61_000), cardNow(created, base + 119_999));
  assert.notEqual(cardNow(created, base + 119_999), cardNow(created, base + 120_000));
  for (const t of [base - 5_000, base, base + 59_999, base + 60_000, base + 899_999, base + 900_000, base + 3_600_123]) {
    assert.equal(cardLabel(o, cardNow(created, t)), cardLabel(o, t));
    assert.equal(isDelayed(o, cardNow(created, t), 15), isDelayed(o, t, 15));
  }
});
