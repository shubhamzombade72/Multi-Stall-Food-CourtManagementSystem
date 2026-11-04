import type { SoundEventId } from './events.ts';

/** The fields of an /api/notifications item the sound layer needs. */
export interface NoticeLike {
  id: string;
  type: string;
  at: string;
}

/**
 * Which sound (if any) a server notification should make, and the key that identifies its business record.
 * Notification ids look like "order:12", "ticket:7", "ready:7", "payment:5", "cancel:3". The key is built from the
 * record, not the notification, so the same ticket seen by the Kitchen board and by the bell is one sound.
 *
 * Deliberately silent: low_stock (its id changes with every stock movement, so it would re-ring on each sale) and
 * purchase_received (informational).
 */
export const soundForNotice = (n: NoticeLike): { event: SoundEventId; key: string } | null => {
  const recordId = n.id.includes(':') ? n.id.slice(n.id.indexOf(':') + 1) : n.id;
  switch (n.type) {
    case 'new_order':
      return { event: 'new_order', key: `order:${recordId}` };
    case 'kitchen_ticket':
      return { event: 'kitchen_ticket', key: `ticket:${recordId}` };
    case 'ticket_ready':
      return { event: 'order_ready', key: `ready:${recordId}` };
    case 'payment':
      return { event: 'payment_success', key: `payment:${recordId}` };
    case 'order_cancelled':
      return { event: 'alert', key: `cancel:${recordId}` };
    default:
      return null;
  }
};

/** Notifications older than this are history, not news (see FreshTracker). */
export const NOTICE_MAX_AGE_MS = 15 * 60_000;
