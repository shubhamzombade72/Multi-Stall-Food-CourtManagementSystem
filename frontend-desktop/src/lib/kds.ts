/**
 * Pure helpers for the kitchen display (unit-tested in tests/kds.test.ts).
 */
export type TicketStatus = 'pending' | 'accepted' | 'preparing' | 'ready' | 'picked_up' | 'cancelled';

/** The one forward action a kitchen can take from each status (mirrors KitchenController's state machine). */
export const nextKitchenAction = (status: TicketStatus): { label: string; to: TicketStatus } | null => {
  switch (status) {
    case 'pending':
      return { label: 'Accept', to: 'accepted' };
    case 'accepted':
      return { label: 'Start Preparing', to: 'preparing' };
    case 'preparing':
      return { label: 'Mark Ready', to: 'ready' };
    default:
      return null; // ready -> picked_up is the waiter's / counter's job
  }
};

export const columnFor = (status: TicketStatus): 'new' | 'preparing' | 'ready' | 'served' | null => {
  if (status === 'pending' || status === 'accepted') return 'new';
  if (status === 'preparing') return 'preparing';
  if (status === 'ready') return 'ready';
  if (status === 'picked_up') return 'served';
  return null;
};

/** Visual urgency from waiting time only (display aid; not a business rule). */
export const urgency = (createdAt: string, now: number = Date.now()): 'normal' | 'warning' | 'late' => {
  const minutes = (now - new Date(createdAt).getTime()) / 60000;
  if (minutes >= 25) return 'late';
  if (minutes >= 15) return 'warning';
  return 'normal';
};

export const elapsed = (createdAt: string, now: number = Date.now()): string => {
  const secs = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}:${String(s).padStart(2, '0')}`;
};

/** Ticket ids present now that were not present before (drives the new-ticket sound). */
export const newTicketIds = (previous: Set<number>, current: number[]): number[] =>
  current.filter((id) => !previous.has(id));
