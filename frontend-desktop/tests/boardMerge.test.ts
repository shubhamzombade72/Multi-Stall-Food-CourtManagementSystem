import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePages, nextPageCursor, revertItem, shouldApplyPage, showingCounts } from '../src/lib/boardMerge.ts';
import type { BoardOrder, BoardPage, ItemStatus } from '../src/lib/fulfillment.ts';

const order = (id: number, status: ItemStatus): BoardOrder => ({
  id, order_number: `O${id}`, order_type: 'dine_in', table: null, guest_count: null, created_at: '2026-11-03T10:00:00Z',
  status: 'confirmed', payment_status: 'unpaid',
  items: [{ id: id * 10, order_item_id: 1, ticket_id: 1, name: 'x', quantity: 1, notes: null, stall: { id: 1, name: 'S', code: 'S1' }, status, version: 1, ready_at: null, served_at: null }],
});

test('a poll that started before a finished mutation is dropped', () => {
  assert.equal(shouldApplyPage({ fetchSeq: 2, lastAppliedSeq: 1, mutationSeqAtStart: 0, mutationSeqNow: 1 }), false);
});

test('a poll with no mutation in between is applied', () => {
  assert.equal(shouldApplyPage({ fetchSeq: 2, lastAppliedSeq: 1, mutationSeqAtStart: 1, mutationSeqNow: 1 }), true);
});

test('an older fetch arriving after a newer one is dropped', () => {
  assert.equal(shouldApplyPage({ fetchSeq: 3, lastAppliedSeq: 4, mutationSeqAtStart: 0, mutationSeqNow: 0 }), false);
});

test('the error-path refresh is applied even after the mutation counter moved, but not out of order', () => {
  assert.equal(shouldApplyPage({ fetchSeq: 5, lastAppliedSeq: 4, mutationSeqAtStart: 0, mutationSeqNow: 2, force: true }), true);
  assert.equal(shouldApplyPage({ fetchSeq: 3, lastAppliedSeq: 4, mutationSeqAtStart: 0, mutationSeqNow: 2, force: true }), false);
});

const page = (orders: BoardOrder[], next: string | null, total = 999): BoardPage => ({
  server_time: '2026-11-03T10:00:00Z', delay_minutes: 15, total_active: total, next_cursor: next, orders,
});

test('an in-flight order keeps its local copy; others take server data', () => {
  const current = [order(1, 'served'), order(2, 'ready')];
  const merged = mergePages(current, [page([order(1, 'ready'), order(2, 'served')], null)], new Set([1]));
  assert.equal(merged.orders[0].items[0].status, 'served');
  assert.equal(merged.orders[1].items[0].status, 'served');
});

test('a refresh replaces load-more (page 2) orders with fresh data, so their versions are never stale', () => {
  const stale = { ...order(9, 'ready') };
  const current = [order(1, 'ready'), stale];
  const fresh9 = order(9, 'served');
  fresh9.items[0].version = 4;
  const merged = mergePages(current, [page([order(1, 'ready')], 'c1'), page([fresh9], null)], new Set());
  assert.deepEqual(merged.orders.map((o) => o.id), [1, 9]);
  assert.equal(merged.orders[1].items[0].version, 4);
  assert.equal(merged.orders[1].items[0].status, 'served');
  assert.equal(merged.nextCursor, null);
  assert.equal(merged.pagesLoaded, 2);
});

test('orders a fresh fetch no longer returns disappear (from any page)', () => {
  const current = [order(1, 'ready'), order(2, 'ready'), order(9, 'ready')];
  const merged = mergePages(current, [page([order(1, 'ready')], 'c1'), page([], null)], new Set());
  assert.deepEqual(merged.orders.map((o) => o.id), [1]);
});

test('an order that moved between pages appears once (deduped by id)', () => {
  const merged = mergePages([], [page([order(1, 'ready'), order(2, 'ready')], 'c1'), page([order(2, 'ready'), order(3, 'ready')], null)], new Set());
  assert.deepEqual(merged.orders.map((o) => o.id), [1, 2, 3]);
});

test('nextCursor and totalActive come from the deepest / latest page fetched', () => {
  const merged = mergePages([], [page([order(1, 'ready')], 'c1', 7), page([order(2, 'ready')], 'c2', 8)], new Set());
  assert.equal(merged.nextCursor, 'c2');
  assert.equal(merged.totalActive, 8);
});

test('nextPageCursor walks from page 1 to the number of pages wanted, sequentially', () => {
  assert.deepEqual(nextPageCursor([], 2), { done: false, cursor: null });
  assert.deepEqual(nextPageCursor([page([], 'c1')], 2), { done: false, cursor: 'c1' });
  assert.deepEqual(nextPageCursor([page([], 'c1'), page([], 'c2')], 2), { done: true });
  assert.deepEqual(nextPageCursor([page([], null)], 3), { done: true });
  assert.deepEqual(nextPageCursor([], 0), { done: false, cursor: null }); // page 1 is always fetched
});

test('"Showing X of N" counts only orders with unserved items and never exceeds N', () => {
  const orders = [order(1, 'ready'), order(2, 'served'), order(3, 'cancelled'), order(4, 'pending')];
  assert.deepEqual(showingCounts(orders, 10), { shown: 2, total: 10 });
  assert.deepEqual(showingCounts(orders, 1), { shown: 1, total: 1 });
});

test('an in-flight order missing from the fresh pages keeps its local copy until its request settles', () => {
  const merged = mergePages([order(1, 'ready'), order(5, 'served')], [page([order(1, 'ready')], null)], new Set([5]));
  assert.deepEqual(merged.orders.map((o) => o.id), [1, 5]);
});

test('revertItem restores the prior status', () => {
  assert.equal(revertItem(order(1, 'served'), 10, 'ready').items[0].status, 'ready');
});
