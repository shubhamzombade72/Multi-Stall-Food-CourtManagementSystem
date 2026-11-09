import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockerSentence, deactivateAll, outcomeLines, splitPreview, type StallPreview } from '../src/lib/stallDeletion.ts';

const stall = (over: Partial<StallPreview> & { id: number }): StallPreview => ({
  name: `Stall ${over.id}`, code: `S-${over.id}`, is_active: true, eligible: true, can_deactivate: true,
  menu_items: 0, categories: 0, blockers: [], reason: null, ...over,
});
const history = (key: string, label: string, count: number) => ({ key, label, count, kind: 'history' as const });
const setup = (key: string, label: string, count: number) => ({ key, label, count, kind: 'setup' as const });

test('splitPreview separates deletable from blocked stalls, keeps the server order and reports missing ids', () => {
  const r = splitPreview({
    stalls: [stall({ id: 1 }), stall({ id: 2, eligible: false, blockers: [history('order_items', 'order line(s)', 3)] }), stall({ id: 3 })],
    missing: [9],
  });
  assert.deepEqual(r.deletable.map((s) => s.id), [1, 3]);
  assert.deepEqual(r.blocked.map((s) => s.id), [2]);
  assert.deepEqual(r.missing, [9]);
});

test('splitPreview on an empty selection is empty, never throws', () => {
  assert.deepEqual(splitPreview({ stalls: [], missing: [] }), { deletable: [], blocked: [], missing: [] });
});

test('history blockers explain why permanent deletion is unavailable and recommend Deactivate', () => {
  const s = blockerSentence(stall({ id: 2, eligible: false, blockers: [history('order_items', 'order line(s)', 1), history('kitchen_tickets', 'kitchen ticket(s)', 1)] }));
  assert.match(s, /1 order line\(s\), 1 kitchen ticket\(s\)/);
  assert.match(s, /sales|history/i);
  assert.match(s, /Deactivate/);
  assert.doesNotMatch(s, /reassign/i);
});

test('setup-only blockers tell the owner to reassign or remove first, or deactivate', () => {
  const s = blockerSentence(stall({ id: 3, eligible: false, blockers: [setup('staff', 'assigned staff account(s)', 2)] }));
  assert.match(s, /2 assigned staff account\(s\)/);
  assert.match(s, /reassign or remove/i);
  assert.match(s, /deactivate/i);
});

test('mixed history and setup blockers are treated as history (the stronger reason)', () => {
  const s = blockerSentence(stall({ id: 4, eligible: false, blockers: [setup('suppliers', 'supplier(s)', 1), history('settlement_payouts', 'settlement payout(s)', 2)] }));
  assert.match(s, /settlement payout\(s\)/);
  assert.match(s, /supplier\(s\)/);
  assert.match(s, /history/i);
});

test('an already inactive blocked stall is not told to deactivate again', () => {
  const s = blockerSentence(stall({ id: 5, is_active: false, can_deactivate: false, eligible: false, blockers: [history('order_items', 'order line(s)', 1)] }));
  assert.match(s, /already inactive/i);
  assert.doesNotMatch(s, /Deactivate it/);
});

test('deactivateAll reports every outcome and keeps going after a failure', async () => {
  const calls: number[] = [];
  const out = await deactivateAll([1, 2, 3], async (id) => {
    calls.push(id);
    if (id === 2) throw new Error('Only the owner can activate or deactivate a stall');
  });
  assert.deepEqual(calls, [1, 2, 3], 'one request per stall, in order, none skipped');
  assert.deepEqual(out.done, [1, 3]);
  assert.deepEqual(out.failed, [{ id: 2, reason: 'Only the owner can activate or deactivate a stall' }]);
});

test('deactivateAll on nothing does nothing', async () => {
  assert.deepEqual(await deactivateAll([], async () => assert.fail('no request expected')), { done: [], failed: [] });
});

test('outcomeLines names every stall once, in a distinct line per outcome kind', () => {
  const names = new Map([[1, 'Pizza'], [2, 'Urban Cafe'], [3, 'Wok'], [4, 'Dosa']]);
  const lines = outcomeLines({ deleted: [1], deactivated: [3], blocked: [{ id: 2, reason: 'Linked to business records' }], deactivateFailed: [{ id: 4, reason: 'Forbidden' }] }, (id) => names.get(id) ?? `#${id}`);
  assert.equal(lines.length, 4);
  assert.deepEqual(lines.map((l) => l.kind), ['deleted', 'deactivated', 'blocked', 'failed']);
  assert.match(lines[0].text, /Pizza.*permanently deleted/);
  assert.match(lines[1].text, /Wok.*deactivated.*history kept/i);
  assert.match(lines[2].text, /Urban Cafe.*Linked to business records/);
  assert.match(lines[3].text, /Dosa.*could not be deactivated.*Forbidden/);
});
