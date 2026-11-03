import { useSyncExternalStore } from 'react';
import { createClock } from '../lib/clock';

/** The single app-wide one-second clock (D11). */
const clock = createClock(1000);

/** Current time in ms, ticking once a second; pass the server offset to get server-corrected time. */
export function useNow(offsetMs = 0): number {
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot) + offsetMs;
}
