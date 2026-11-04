import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chunk, clampPage, deleteInChunks, mergeSummary, emptySummary, pageCount, pageSlice, pageState, pruneSelection,
  selectAllFiltered, summaryFromResponse, toggleId, togglePage, BULK_CHUNK_SIZE,
} from '../src/lib/bulkSelection.ts';

const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => from + i);

test('pagination slices and clamps', () => {
  const rows = ids(1000);
  assert.equal(pageCount(1000, 25), 40);
  assert.equal(pageCount(0, 25), 1);
  assert.equal(pageSlice(rows, 1, 25)[0], 1);
  assert.equal(pageSlice(rows, 40, 25).at(-1), 1000);
  assert.deepEqual(pageSlice(rows, 99, 25), pageSlice(rows, 40, 25), 'out-of-range page is clamped');
  assert.equal(clampPage(0, 10, 25), 1);
});

test('per-row checkbox toggles one id and never mutates the previous set', () => {
  const a = new Set<number>();
  const b = toggleId(a, 5);
  assert.deepEqual([...a], []);
  assert.deepEqual([...b], [5]);
  assert.deepEqual([...toggleId(b, 5)], []);
});

test('select-all checkbox selects the whole page, and a second click unselects only that page', () => {
  const page1 = ids(25, 1);
  const page2 = ids(25, 26);
  let sel = togglePage(new Set(), page1);
  assert.equal(sel.size, 25);
  assert.equal(pageState(sel, page1), 'all');
  assert.equal(pageState(sel, page2), 'none');
  sel = togglePage(sel, page1);
  assert.equal(sel.size, 0);
});

test('selection persists across pagination', () => {
  const rows = ids(100);
  const p1 = pageSlice(rows, 1, 25);
  const p2 = pageSlice(rows, 2, 25);
  let sel = togglePage(new Set(), p1);
  sel = toggleId(sel, p2[3]);
  // "navigate" to page 2 and back: nothing is lost
  assert.equal(sel.size, 26);
  assert.equal(pageState(sel, p2), 'some');
  assert.equal(pageState(sel, p1), 'all');
  // select-all on page 2 while page 1 stays selected
  sel = togglePage(sel, p2);
  assert.equal(sel.size, 50);
  // from 'some' the header checkbox completes the page rather than clearing it
  assert.equal(pageState(togglePage(toggleId(new Set(), p1[0]), p1), p1), 'all');
});

test('delete-all-filtered selects every filtered id across all pages', () => {
  const filtered = ids(1000);
  assert.equal(selectAllFiltered(filtered).size, 1000);
});

test('pruneSelection drops ids that no longer exist', () => {
  assert.deepEqual([...pruneSelection(new Set([1, 2, 3]), [2, 3, 4])].sort(), [2, 3]);
});

test('chunking keeps every request within the cap', () => {
  const parts = chunk(ids(1000));
  assert.equal(parts.length, 10);
  assert.ok(parts.every((p) => p.length <= BULK_CHUNK_SIZE));
  assert.deepEqual(parts.flat(), ids(1000));
  assert.deepEqual(chunk([], 100), []);
  assert.equal(chunk(ids(101), 100).length, 2);
});

test('deleteInChunks sends sequential requests, reports progress and merges successes and failures with reasons', async () => {
  const calls: number[][] = [];
  const progress: Array<[number, number]> = [];
  const summary = await deleteInChunks(
    ids(250),
    async (part) => {
      calls.push(part);
      // every id divisible by 50 is blocked
      return {
        deleted: part.filter((i) => i % 50 !== 0).map((id) => ({ id })),
        failed: part.filter((i) => i % 50 === 0).map((id) => ({ id, name: `n${id}`, code: null, reason: 'Used on 2 past order line(s)' })),
      };
    },
    (d, t) => progress.push([d, t]),
  );
  assert.deepEqual(calls.map((c) => c.length), [100, 100, 50]);
  assert.deepEqual(progress, [[100, 250], [200, 250], [250, 250]]);
  assert.equal(summary.requested, 250);
  assert.equal(summary.deleted, 245);
  assert.equal(summary.failed, 5);
  assert.equal(summary.failures[0].reason, 'Used on 2 past order line(s)');
  assert.equal(summary.deletedIds.length, 245);
});

test('a failing chunk marks only its own ids failed and later chunks still run', async () => {
  let n = 0;
  const summary = await deleteInChunks(
    ids(30),
    async (part) => {
      n += 1;
      if (n === 2) throw new Error('Server unreachable');
      return { deleted: part.map((id) => ({ id })), failed: [] };
    },
    undefined,
    (e) => (e as Error).message,
    10,
  );
  assert.equal(summary.deleted, 20);
  assert.equal(summary.failed, 10);
  assert.deepEqual(summary.failures.map((f) => f.id), ids(10, 11));
  assert.ok(summary.failures.every((f) => f.reason === 'Server unreachable'));
});

test('summary helpers', () => {
  const s = summaryFromResponse({ deleted: [{ id: 1 }], failed: [{ id: 2, name: 'x', code: 'C', reason: 'r' }] });
  assert.deepEqual([s.requested, s.deleted, s.failed], [2, 1, 1]);
  const m = mergeSummary(emptySummary(), s);
  assert.deepEqual(m, s);
});
