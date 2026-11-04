import type { SoundEventDef, SoundEventId } from './events.ts';
import type { PlayerResult, SoundPlayer } from './service.ts';

/**
 * Browser/Electron audio backend.
 *
 * Primary path: one reusable <audio> element per sound (so replaying a sound restarts it instead of stacking a
 * second instance) loaded from public/sounds. Fallback: the same tone sequence synthesised with Web Audio on one
 * shared AudioContext, used when the file is missing, undecodable, or blocked. Electron additionally runs with
 * autoplayPolicy "no-user-gesture-required" (main.cjs); in a plain browser, a rejected play() is reported as
 * 'locked' and a one-time pointer/keyboard listener unlocks audio.
 */
const assetUrl = (file: string): string => new URL(`sounds/${file}`, document.baseURI).href;

export class BrowserPlayer implements SoundPlayer {
  private elements = new Map<SoundEventId, HTMLAudioElement>();
  private brokenAssets = new Set<SoundEventId>();
  private ctx: AudioContext | null = null;

  async play(def: SoundEventDef, volume: number): Promise<PlayerResult> {
    if (!this.brokenAssets.has(def.id)) {
      try {
        const el = this.element(def);
        el.volume = Math.min(1, Math.max(0, volume));
        el.currentTime = 0;
        await el.play();
        return 'asset';
      } catch (err) {
        const name = (err as { name?: string })?.name;
        if (name === 'NotAllowedError') return 'locked';
        // NotSupportedError / load error: the file is missing or unreadable. Remember, and use the synth from now on.
        this.brokenAssets.add(def.id);
      }
    }
    return this.synth(def, volume);
  }

  async unlock(): Promise<boolean> {
    try {
      const ctx = this.context();
      if (!ctx) return false;
      if (ctx.state !== 'running') await ctx.resume();
      return ctx.state === 'running';
    } catch {
      return false;
    }
  }

  private element(def: SoundEventDef): HTMLAudioElement {
    let el = this.elements.get(def.id);
    if (!el) {
      el = new Audio(assetUrl(def.file));
      el.preload = 'auto';
      el.addEventListener('error', () => this.brokenAssets.add(def.id));
      this.elements.set(def.id, el);
    }
    return el;
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    return this.ctx;
  }

  private async synth(def: SoundEventDef, volume: number): Promise<PlayerResult> {
    const ctx = this.context();
    if (!ctx) return 'failed';
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch {
        return 'locked';
      }
      if ((ctx.state as AudioContextState) !== 'running') return 'locked'; // resume() can leave it suspended
    }
    const t0 = ctx.currentTime + 0.02;
    for (const tone of def.tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = tone.wave;
      osc.frequency.value = tone.freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const a = t0 + tone.start;
      const peak = Math.max(0.0002, tone.gain * volume);
      gain.gain.setValueAtTime(0, a);
      gain.gain.linearRampToValueAtTime(peak, a + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, a + tone.dur);
      osc.start(a);
      osc.stop(a + tone.dur + 0.02);
    }
    return 'synth';
  }
}

/** Browsers refuse audio until the page is touched. Unlock once on the first pointer/key event. */
export const installAudioUnlock = (unlock: () => Promise<boolean>): void => {
  if (typeof window === 'undefined') return;
  const once = () => {
    void unlock().then((ok) => {
      if (ok) {
        window.removeEventListener('pointerdown', once);
        window.removeEventListener('keydown', once);
      }
    });
  };
  window.addEventListener('pointerdown', once);
  window.addEventListener('keydown', once);
};
