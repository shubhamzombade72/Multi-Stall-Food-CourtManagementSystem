/**
 * Turns a repeatedly fetched list (notifications, kitchen tickets) into "what is genuinely new".
 *
 *  - The first list a tracker sees is only a baseline: opening a screen never replays what was already there.
 *  - Afterwards a record is announced once, the first time its id appears.
 *  - A record older than `maxAgeMs` (by its own timestamp) is never announced, even if it only just became visible
 *    to this screen (a filter change, a role switch, a slow first poll) - that is history, not news.
 */
export interface TrackerOptions<T> {
  idOf: (item: T) => string;
  /** epoch ms of the record's own creation/change time, or null when unknown */
  timeOf?: (item: T) => number | null;
  maxAgeMs?: number;
  now?: () => number;
  maxRemembered?: number;
}

export class FreshTracker<T> {
  private seen = new Set<string>();
  private baselined = false;

  private readonly opts: TrackerOptions<T>;

  constructor(opts: TrackerOptions<T>) {
    this.opts = opts;
  }

  /** Returns the items that are new since the previous call (always empty on the first call). */
  observe(items: readonly T[]): T[] {
    const fresh: T[] = [];
    const now = (this.opts.now ?? Date.now)();
    for (const item of items) {
      const id = this.opts.idOf(item);
      if (this.seen.has(id)) continue;
      this.seen.add(id);
      if (!this.baselined) continue;
      const at = this.opts.timeOf?.(item);
      if (this.opts.maxAgeMs !== undefined && at !== null && at !== undefined && Number.isFinite(at) && now - at > this.opts.maxAgeMs) continue;
      fresh.push(item);
    }
    this.baselined = true;
    const cap = this.opts.maxRemembered ?? 2000;
    while (this.seen.size > cap) this.seen.delete(this.seen.values().next().value as string);
    return fresh;
  }

  /** Forget everything: the next list becomes a new baseline (screen/stall/user changed). */
  reset(): void {
    this.seen.clear();
    this.baselined = false;
  }

  get isBaselined(): boolean {
    return this.baselined;
  }
}
