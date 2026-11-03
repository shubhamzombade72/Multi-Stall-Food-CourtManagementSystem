/**
 * A tiny shared clock: one interval no matter how many subscribers, started on the first and cleared on the last.
 */
export interface ClockTimers {
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
}

export function createClock(
  intervalMs: number,
  now: () => number = Date.now,
  timers: ClockTimers = { setInterval, clearInterval },
) {
  // Called without a receiver: browser timers throw "Illegal invocation" when `this` is the timers object.
  const { setInterval: startTimer, clearInterval: stopTimer } = timers;
  const listeners = new Set<() => void>();
  let handle: ReturnType<typeof setInterval> | null = null;
  let snapshot = now();

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    if (handle === null) {
      snapshot = now();
      handle = startTimer(() => {
        snapshot = now();
        listeners.forEach((l) => l());
      }, intervalMs);
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && handle !== null) {
        stopTimer(handle);
        handle = null;
      }
    };
  };

  return { subscribe, getSnapshot: () => snapshot };
}
