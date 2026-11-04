import { SOUND_EVENTS, type SoundCategory, type SoundEventDef, type SoundEventId } from './events.ts';
import { SoundGate, type GateVerdict } from './gate.ts';
import { browserStore, clampVolume, loadSoundSettings, saveSoundSettings, type KeyValueStore, type SoundSettings } from './settings.ts';

/** What the audio backend reports back. 'locked' = the OS/browser refused (no user gesture yet). */
export type PlayerResult = 'asset' | 'synth' | 'locked' | 'failed';

export interface SoundPlayer {
  play(def: SoundEventDef, volume: number): Promise<PlayerResult>;
  /** Try to allow audio (call from a user gesture). */
  unlock(): Promise<boolean>;
}

export type PlayOutcome = 'played' | 'played-fallback' | 'disabled' | 'category-off' | 'silent' | GateVerdict | 'locked' | 'error';

/**
 * The single place sounds are decided and played. Everything else in the app calls `sound.play(event, {key})`.
 * Order of checks: master switch -> category -> volume -> gate (duplicate/cooldown/burst) -> audio backend.
 */
export class SoundService {
  private settings: SoundSettings;
  private listeners = new Set<() => void>();
  readonly counts: Partial<Record<SoundEventId, number>> = {};

  private readonly player: SoundPlayer;
  private readonly store: KeyValueStore | null;
  private readonly gate: SoundGate;

  constructor(player: SoundPlayer, store: KeyValueStore | null = browserStore(), gate: SoundGate = new SoundGate()) {
    this.player = player;
    this.store = store;
    this.gate = gate;
    this.settings = loadSoundSettings(store);
  }

  getSettings = (): SoundSettings => this.settings;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  update(patch: Partial<Omit<SoundSettings, 'categories'>> & { categories?: Partial<SoundSettings['categories']> }): SoundSettings {
    const next: SoundSettings = {
      enabled: patch.enabled ?? this.settings.enabled,
      volume: patch.volume === undefined ? this.settings.volume : clampVolume(patch.volume),
      categories: { ...this.settings.categories, ...(patch.categories ?? {}) },
    };
    this.settings = next; // new object so useSyncExternalStore sees the change
    saveSoundSettings(this.store, next);
    this.listeners.forEach((l) => l());
    return next;
  }

  setCategory(category: SoundCategory, on: boolean): SoundSettings {
    return this.update({ categories: { [category]: on } });
  }

  /**
   * Play the sound for a real business event. `key` identifies the record (e.g. the ticket id) so the same record can
   * never sound twice, whichever screen, poll or socket delivers it.
   */
  async play(id: SoundEventId, opts: { key?: string } = {}): Promise<PlayOutcome> {
    const def = SOUND_EVENTS[id];
    if (!def) return 'error';
    const s = this.settings;
    if (!s.enabled) return 'disabled';
    if (!s.categories[def.category]) return 'category-off';
    if (s.volume <= 0) return 'silent';

    const verdict = this.gate.admit(id, def.cooldownMs, opts.key);
    if (verdict !== 'ok') return verdict;
    return this.emit(def, s.volume);
  }

  /** Settings-screen test button: ignores the switches and the gate, still honours the volume. */
  async preview(id: SoundEventId): Promise<PlayOutcome> {
    const def = SOUND_EVENTS[id];
    if (!def) return 'error';
    if (this.settings.volume <= 0) return 'silent';
    return this.emit(def, this.settings.volume);
  }

  unlock(): Promise<boolean> {
    return this.player.unlock().catch(() => false);
  }

  private async emit(def: SoundEventDef, volume: number): Promise<PlayOutcome> {
    try {
      const r = await this.player.play(def, volume);
      if (r === 'locked') return 'locked';
      if (r === 'failed') return 'error';
      this.counts[def.id] = (this.counts[def.id] ?? 0) + 1;
      return r === 'asset' ? 'played' : 'played-fallback';
    } catch {
      return 'error'; // a sound must never break the screen that asked for it
    }
  }
}
