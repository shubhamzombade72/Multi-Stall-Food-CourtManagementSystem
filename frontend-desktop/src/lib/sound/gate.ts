/**
 * Decides whether a sound request may actually play. Three independent protections:
 *  - duplicate: the same business record (key) never sounds twice (polling + realtime + re-render delivering it again)
 *  - cooldown: the same event cannot sound again within its cooldown (a burst of 10 orders is one chime, not ten)
 *  - burst: across all events, at most `burstMax` sounds per `burstWindowMs`, so nothing can turn into a siren
 */
export type GateVerdict = 'ok' | 'duplicate' | 'cooldown' | 'burst';

export interface GateOptions {
  dedupeTtlMs: number;
  maxKeys: number;
  burstWindowMs: number;
  burstMax: number;
}

export const DEFAULT_GATE: GateOptions = { dedupeTtlMs: 30 * 60_000, maxKeys: 1000, burstWindowMs: 10_000, burstMax: 4 };

export class SoundGate {
  private keys = new Map<string, number>();
  private lastByEvent = new Map<string, number>();
  private recent: number[] = [];

  private readonly opts: GateOptions;
  private readonly now: () => number;

  constructor(opts: GateOptions = DEFAULT_GATE, now: () => number = Date.now) {
    this.opts = opts;
    this.now = now;
  }

  /** Records the request when it returns 'ok'; every other verdict leaves the state untouched. */
  admit(eventId: string, cooldownMs: number, key?: string): GateVerdict {
    const t = this.now();
    this.prune(t);

    if (key !== undefined && this.keys.has(`${eventId}|${key}`)) return 'duplicate';

    const last = this.lastByEvent.get(eventId);
    if (last !== undefined && t - last < cooldownMs) {
      // A request swallowed by the cooldown is still "announced": the record must not ring again a moment later.
      if (key !== undefined) this.remember(eventId, key, t);
      return 'cooldown';
    }
    if (this.recent.length >= this.opts.burstMax) {
      if (key !== undefined) this.remember(eventId, key, t);
      return 'burst';
    }

    this.lastByEvent.set(eventId, t);
    this.recent.push(t);
    if (key !== undefined) this.remember(eventId, key, t);
    return 'ok';
  }

  private remember(eventId: string, key: string, t: number): void {
    this.keys.set(`${eventId}|${key}`, t);
    while (this.keys.size > this.opts.maxKeys) {
      const oldest = this.keys.keys().next().value as string;
      this.keys.delete(oldest);
    }
  }

  private prune(t: number): void {
    this.recent = this.recent.filter((x) => t - x < this.opts.burstWindowMs);
    for (const [k, at] of this.keys) {
      if (t - at > this.opts.dedupeTtlMs) this.keys.delete(k);
      else break; // insertion order == age order
    }
  }

  reset(): void {
    this.keys.clear();
    this.lastByEvent.clear();
    this.recent = [];
  }
}
