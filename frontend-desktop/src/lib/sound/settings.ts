import { SOUND_CATEGORIES, type SoundCategory } from './events.ts';

/**
 * Sound preferences are per computer (a loud kitchen screen and a quiet back-office PC differ), so they live in
 * localStorage on that PC, not in the shared database.
 */
export interface SoundSettings {
  /** master switch */
  enabled: boolean;
  /** 0..1 */
  volume: number;
  categories: Record<SoundCategory, boolean>;
}

export const SOUND_SETTINGS_KEY = 'foodcourt.sound.v1';

export const defaultSoundSettings = (): SoundSettings => ({
  enabled: true,
  volume: 0.7,
  categories: { orders: true, kitchen: true, payments: true, alerts: true },
});

export const clampVolume = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return defaultSoundSettings().volume;
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
};

/** Accepts anything (corrupt storage, an older shape) and returns valid settings. */
export const normalizeSoundSettings = (raw: unknown): SoundSettings => {
  const base = defaultSoundSettings();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const cats = (r.categories && typeof r.categories === 'object' ? r.categories : {}) as Record<string, unknown>;
  for (const c of SOUND_CATEGORIES) {
    if (typeof cats[c.id] === 'boolean') base.categories[c.id] = cats[c.id] as boolean;
  }
  if (typeof r.enabled === 'boolean') base.enabled = r.enabled;
  if (r.volume !== undefined) base.volume = clampVolume(r.volume);
  return base;
};

/** Minimal storage contract so tests can use a plain object instead of the browser. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const browserStore = (): KeyValueStore | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export const loadSoundSettings = (store: KeyValueStore | null): SoundSettings => {
  try {
    const text = store?.getItem(SOUND_SETTINGS_KEY);
    return normalizeSoundSettings(text ? JSON.parse(text) : null);
  } catch {
    return defaultSoundSettings();
  }
};

export const saveSoundSettings = (store: KeyValueStore | null, settings: SoundSettings): void => {
  try {
    store?.setItem(SOUND_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // storage blocked: the settings still apply until the app closes
  }
};
