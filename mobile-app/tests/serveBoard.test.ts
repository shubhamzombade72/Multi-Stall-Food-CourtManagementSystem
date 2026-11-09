import test from 'node:test';
import assert from 'node:assert/strict';
import { isToServe, serveCards, toServeCount, waitingMinutes, withServed, type BoardItem, type BoardOrder } from '../src/utils/serveBoard.ts';

const item = (id: number, status: BoardItem['status']): BoardItem => ({ id, name: `Dish ${id}`, quantity: 1, notes: null, stall: { id: 1, name: 'Stall' }, status, version: 0 });
const order = (id: number, minutesAgo: number, items: BoardItem[]): BoardOrder => ({
  id, order_number: `ORD-${id}`, order_type: 'dine_in', table: null, notes: null,
  created_at: new Date(Date.UTC(2026, 10, 8, 12, 0) - minutesAgo * 60000).toISOString(), items,
});

test('every unserved state is still to serve; there is no separate ready step', () => {
  for (const s of ['pending', 'preparing', 'ready'] as const) assert.equal(isToServe(item(1, s)), true);
  assert.equal(isToServe(item(1, 'served')), false);
  assert.equal(isToServe(item(1, 'cancelled')), false);
});

test('the count is dishes still to serve across all orders', () => {
  const board = [order(1, 5, [item(1, 'pending'), item(2, 'served')]), order(2, 3, [item(3, 'preparing'), item(4, 'ready'), item(5, 'cancelled')])];
  assert.equal(toServeCount(board), 3);
  assert.equal(toServeCount([]), 0);
});

test('cards: open orders oldest first, then fully served ones newest first; cancelled lines and empty orders hidden', () => {
  const board = [
    order(1, 2, [item(1, 'pending')]),
    order(2, 20, [item(2, 'served'), item(3, 'preparing')]),
    order(3, 1, [item(4, 'served')]),
    order(4, 30, [item(5, 'served')]),
    order(5, 10, [item(6, 'cancelled')]),
  ];
  const cards = serveCards(board);
  assert.deepEqual(cards.map((o) => o.id), [2, 1, 3, 4]);
  assert.equal(cards.find((o) => o.id === 5), undefined);
});

test('marking one dish served changes only that dish and never the original board', () => {
  const board = [order(1, 5, [item(1, 'pending'), item(2, 'pending')]), order(2, 5, [item(3, 'pending')])];
  const next = withServed(board, 2);
  assert.deepEqual(next[0].items.map((i) => i.status), ['pending', 'served']);
  assert.equal(next[1], board[1]);
  assert.equal(board[0].items[1].status, 'pending');
  assert.equal(toServeCount(next), 2);
});

test('waiting minutes floor and never go negative', () => {
  const now = Date.UTC(2026, 10, 8, 12, 0);
  assert.equal(waitingMinutes(new Date(now - 7.9 * 60000).toISOString(), now), 7);
  assert.equal(waitingMinutes(new Date(now + 60000).toISOString(), now), 0);
  assert.equal(waitingMinutes(null, now), 0);
});
