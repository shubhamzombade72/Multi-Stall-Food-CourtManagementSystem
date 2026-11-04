/**
 * Sound system tests. The audio backend is replaced by a fake player, so these prove the DECISIONS (what plays,
 * what is suppressed) and not the speakers; real playback in the Electron build is covered by
 * e2e/sound-printer.e2e.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { SOUND_EVENTS, SOUND_EVENT_IDS, SOUND_CATEGORIES, soundLength, type SoundEventDef } from '../src/lib/sound/events.ts';
import { SoundGate } from '../src/lib/sound/gate.ts';
import { FreshTracker } from '../src/lib/sound/tracker.ts';
import { SoundService, type PlayerResult, type SoundPlayer } from '../src/lib/sound/service.ts';
import { SOUND_SETTINGS_KEY, clampVolume, defaultSoundSettings, loadSoundSettings, normalizeSoundSettings, type KeyValueStore } from '../src/lib/sound/settings.ts';
import { NOTICE_MAX_AGE_MS, soundForNotice } from '../src/lib/sound/notifications.ts';

class FakePlayer implements SoundPlayer {
  played: { id: string; volume: number }[] = [];
  result: PlayerResult = 'asset';
  throwOnPlay = false;
  async play(def: SoundEventDef, volume: number): Promise<PlayerResult> {
    if (this.throwOnPlay) throw new Error('audio device gone');
    if (this.result === 'asset' || this.result === 'synth') this.played.push({ id: def.id, volume });
    return this.result;
  }
  async unlock() {
    return true;
  }
}

const memoryStore = (initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } => {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
};

/** A service with a controllable clock so cooldown/TTL behaviour is deterministic. */
const make = (store = memoryStore()) => {
  const clock = { t: 1_000_000 };
  const player = new FakePlayer();
  const svc = new SoundService(player, store, new SoundGate(undefined, () => clock.t));
  return { svc, player, clock, store };
};

// ------------------------------------------------------------------ the event table
test('every sound event has a category, a cooldown, tones, and a shipped WAV asset', () => {
  assert.equal(SOUND_EVENT_IDS.length, 6);
  const categories = new Set(SOUND_CATEGORIES.map((c) => c.id));
  for (const def of Object.values(SOUND_EVENTS)) {
    assert.ok(categories.has(def.category), `${def.id} category`);
    assert.ok(def.cooldownMs >= 500, `${def.id} cooldown`);
    assert.ok(def.tones.length > 0 && soundLength(def) < 1.5, `${def.id} is a short sound`);
    const file = new URL(`../public/sounds/${def.file}`, import.meta.url);
    assert.ok(existsSync(file), `${def.file} exists in public/sounds`);
    const wav = readFileSync(file);
    assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
    assert.equal(wav.subarray(8, 12).toString(), 'WAVE');
    assert.equal(wav.readUInt32LE(40), wav.length - 44, `${def.file} data length is consistent`);
    assert.ok(statSync(file).size < 100_000, `${def.file} stays small`);
    assert.ok(wav.subarray(44).some((b) => b !== 0), `${def.file} is not silence`);
  }
});

// ------------------------------------------------------------------ settings
test('volume is clamped and garbage storage falls back to defaults', () => {
  assert.equal(clampVolume(5), 1);
  assert.equal(clampVolume(-1), 0);
  assert.equal(clampVolume('0.456'), 0.46);
  assert.equal(clampVolume(NaN), defaultSoundSettings().volume);
  assert.deepEqual(loadSoundSettings(memoryStore({ [SOUND_SETTINGS_KEY]: '{not json' })), defaultSoundSettings());
  assert.deepEqual(normalizeSoundSettings({ enabled: 'yes', volume: 'loud', categories: { kitchen: 1, orders: false } }).categories, {
    orders: false,
    kitchen: true,
    payments: true,
    alerts: true,
  });
  assert.deepEqual(loadSoundSettings(null), defaultSoundSettings(), 'no storage at all still works');
});

test('settings persist and are reloaded by a new service (restart)', () => {
  const store = memoryStore();
  const a = make(store);
  a.svc.update({ enabled: false, volume: 0.25 });
  a.svc.setCategory('alerts', false);
  const b = make(store);
  assert.equal(b.svc.getSettings().enabled, false);
  assert.equal(b.svc.getSettings().volume, 0.25);
  assert.equal(b.svc.getSettings().categories.alerts, false);
  assert.equal(b.svc.getSettings().categories.orders, true);
});

test('subscribers are notified and see a new settings object each time', () => {
  const { svc } = make();
  let calls = 0;
  const before = svc.getSettings();
  const off = svc.subscribe(() => calls++);
  svc.update({ volume: 0.3 });
  assert.equal(calls, 1);
  assert.notEqual(svc.getSettings(), before);
  off();
  svc.update({ volume: 0.4 });
  assert.equal(calls, 1);
});

// ------------------------------------------------------------------ playing
test('a genuinely new event plays once at the configured volume', async () => {
  const { svc, player } = make();
  svc.update({ volume: 0.4 });
  assert.equal(await svc.play('kitchen_ticket', { key: 'ticket:1' }), 'played');
  assert.deepEqual(player.played, [{ id: 'kitchen_ticket', volume: 0.4 }]);
});

test('volume changes reach the player', async () => {
  const { svc, player, clock } = make();
  svc.update({ volume: 1 });
  await svc.play('payment_success', { key: 'a' });
  clock.t += 5000;
  svc.update({ volume: 0.1 });
  await svc.play('payment_success', { key: 'b' });
  assert.deepEqual(player.played.map((p) => p.volume), [1, 0.1]);
});

test('disabled sound, a switched-off category, and zero volume produce no audio', async () => {
  const { svc, player, clock } = make();
  svc.update({ enabled: false });
  assert.equal(await svc.play('new_order', { key: 'o1' }), 'disabled');
  svc.update({ enabled: true });
  svc.setCategory('orders', false);
  assert.equal(await svc.play('new_order', { key: 'o2' }), 'category-off');
  assert.equal(await svc.play('order_ready', { key: 'r1' }), 'category-off', 'order_ready shares the orders category');
  assert.equal(await svc.play('kitchen_ticket', { key: 't1' }), 'played', 'other categories are unaffected');
  clock.t += 5000;
  svc.update({ volume: 0 });
  assert.equal(await svc.play('payment_success', { key: 'p1' }), 'silent');
  assert.equal(player.played.length, 1);
});

test('re-delivery of the same record (polling, re-render, repeated API response) never plays twice', async () => {
  const { svc, player, clock } = make();
  assert.equal(await svc.play('kitchen_ticket', { key: 'ticket:7' }), 'played');
  for (let poll = 0; poll < 20; poll++) {
    clock.t += 4000; // 20 more polls, 80 s: well past the cooldown
    assert.equal(await svc.play('kitchen_ticket', { key: 'ticket:7' }), 'duplicate');
  }
  assert.equal(player.played.length, 1);
});

test('the same record seen through two paths (board + bell) sounds once', async () => {
  const { svc, player, clock } = make();
  const viaBoard = await svc.play('kitchen_ticket', { key: 'ticket:9' });
  clock.t += 3000;
  const notice = soundForNotice({ id: 'ticket:9', type: 'kitchen_ticket', at: new Date(clock.t).toISOString() })!;
  const viaBell = await svc.play(notice.event, { key: notice.key });
  assert.equal(viaBoard, 'played');
  assert.equal(viaBell, 'duplicate');
  assert.equal(player.played.length, 1);
});

test('a burst of different records is one sound (cooldown), not a siren', async () => {
  const { svc, player } = make();
  const outcomes = [];
  for (let i = 0; i < 10; i++) outcomes.push(await svc.play('new_order', { key: `order:${i}` })); // same instant
  assert.deepEqual(outcomes.slice(0, 2), ['played', 'cooldown']);
  assert.equal(player.played.length, 1);
});

test('rapid mixed events are capped across events (burst limit)', async () => {
  const { svc, player, clock } = make();
  const ids = ['new_order', 'kitchen_ticket', 'order_ready', 'payment_success', 'alert', 'payment_failed'] as const;
  let n = 0;
  for (const id of ids) {
    clock.t += 100;
    await svc.play(id, { key: `k${n++}` });
  }
  assert.equal(player.played.length, 4, 'at most 4 sounds per 10 s window');
  clock.t += 11_000;
  assert.equal(await svc.play('alert', { key: 'later' }), 'played', 'the window slides');
});

test('a record that was swallowed by the cooldown does not ring a moment later', async () => {
  const { svc, player, clock } = make();
  await svc.play('new_order', { key: 'order:1' });
  assert.equal(await svc.play('new_order', { key: 'order:2' }), 'cooldown');
  clock.t += 2000;
  assert.equal(await svc.play('new_order', { key: 'order:2' }), 'duplicate', 'order:2 was already announced');
  assert.equal(player.played.length, 1);
});

test('audio being locked by the OS is reported and not counted as played', async () => {
  const { svc, player } = make();
  player.result = 'locked';
  assert.equal(await svc.play('payment_success', { key: 'x' }), 'locked');
  assert.equal(svc.counts.payment_success, undefined);
});

test('a missing asset that falls back to synthesis still counts as played', async () => {
  const { svc, player } = make();
  player.result = 'synth';
  assert.equal(await svc.play('alert', { key: 'x' }), 'played-fallback');
  assert.equal(svc.counts.alert, 1);
});

test('an audio backend that throws never breaks the caller', async () => {
  const { svc, player } = make();
  player.throwOnPlay = true;
  assert.equal(await svc.play('new_order', { key: 'x' }), 'error');
  assert.equal(await svc.preview('new_order'), 'error');
});

test('an unknown event id is ignored safely', async () => {
  const { svc } = make();
  assert.equal(await svc.play('nope' as never), 'error');
});

test('preview works while sounds are switched off (so it can be tested) but respects volume', async () => {
  const { svc, player } = make();
  svc.update({ enabled: false, volume: 0.6 });
  assert.equal(await svc.preview('order_ready'), 'played');
  assert.equal(await svc.preview('order_ready'), 'played', 'preview bypasses the gate');
  assert.equal(player.played.length, 2);
  svc.update({ volume: 0 });
  assert.equal(await svc.preview('order_ready'), 'silent');
});

// ------------------------------------------------------------------ stale records / opening a screen
test('opening a screen never replays what is already there; only later arrivals are new', () => {
  const t = new FreshTracker<{ id: number }>({ idOf: (x) => String(x.id) });
  assert.deepEqual(t.observe([{ id: 1 }, { id: 2 }]), [], 'first list is the baseline');
  assert.deepEqual(t.observe([{ id: 1 }, { id: 2 }]), []);
  assert.deepEqual(t.observe([{ id: 1 }, { id: 2 }, { id: 3 }]).map((x) => x.id), [3]);
  assert.deepEqual(t.observe([{ id: 3 }]), [], 'a record that left and the list shrinking is not news');
  assert.deepEqual(t.observe([{ id: 1 }, { id: 3 }]), [], 'a record that reappears is not re-announced');
});

test('a record older than the freshness window is history even if it first appears later', () => {
  const now = Date.parse('2026-11-04T10:00:00Z');
  const t = new FreshTracker<{ id: string; at: string }>({ idOf: (x) => x.id, timeOf: (x) => Date.parse(x.at), maxAgeMs: NOTICE_MAX_AGE_MS, now: () => now });
  t.observe([]);
  const fresh = t.observe([
    { id: 'old', at: '2026-11-04T08:00:00Z' },
    { id: 'new', at: '2026-11-04T09:58:00Z' },
  ]);
  assert.deepEqual(fresh.map((x) => x.id), ['new']);
});

test('reset makes the next list a fresh baseline (user or stall switched)', () => {
  const t = new FreshTracker<{ id: number }>({ idOf: (x) => String(x.id) });
  t.observe([{ id: 1 }]);
  t.reset();
  assert.equal(t.isBaselined, false);
  assert.deepEqual(t.observe([{ id: 1 }, { id: 2 }]), []);
});

test('end to end: poll loop -> tracker -> service plays once per genuine arrival', async () => {
  const { svc, player, clock } = make();
  const tracker = new FreshTracker<{ id: string; type: string; at: string }>({
    idOf: (n) => n.id,
    timeOf: (n) => Date.parse(n.at),
    maxAgeMs: NOTICE_MAX_AGE_MS,
    now: () => clock.t,
  });
  const at = () => new Date(clock.t - 1000).toISOString();
  const poll = async (list: { id: string; type: string; at: string }[]) => {
    for (const n of tracker.observe(list)) {
      const s = soundForNotice(n);
      if (s) await svc.play(s.event, { key: s.key });
    }
  };
  const history = [{ id: 'order:1', type: 'new_order', at: new Date(clock.t - 3_600_000).toISOString() }];
  await poll(history); // screen opened with an old order: silent
  assert.equal(player.played.length, 0);
  const t1 = { id: 'ticket:5', type: 'kitchen_ticket', at: at() };
  for (let i = 0; i < 6; i++) {
    clock.t += 15_000;
    await poll([t1, ...history]); // repeated polls returning the same list
  }
  assert.deepEqual(player.played.map((p) => p.id), ['kitchen_ticket']);
  clock.t += 15_000;
  await poll([{ id: 'ready:5', type: 'ticket_ready', at: at() }, t1, ...history]);
  assert.deepEqual(player.played.map((p) => p.id), ['kitchen_ticket', 'order_ready']);
});

// ------------------------------------------------------------------ notification mapping
test('only real business notifications make sounds', () => {
  const n = (id: string, type: string) => soundForNotice({ id, type, at: '2026-11-04T10:00:00Z' });
  assert.deepEqual(n('order:12', 'new_order'), { event: 'new_order', key: 'order:12' });
  assert.deepEqual(n('ticket:7', 'kitchen_ticket'), { event: 'kitchen_ticket', key: 'ticket:7' });
  assert.deepEqual(n('ready:7', 'ticket_ready'), { event: 'order_ready', key: 'ready:7' });
  assert.deepEqual(n('payment:5', 'payment'), { event: 'payment_success', key: 'payment:5' });
  assert.deepEqual(n('cancel:3', 'order_cancelled'), { event: 'alert', key: 'cancel:3' });
  assert.equal(n('low:4:2', 'low_stock'), null, 'low stock ids change on every sale: visual only');
  assert.equal(n('received:1', 'purchase_received'), null);
  assert.equal(n('x:1', 'something_new'), null);
});
