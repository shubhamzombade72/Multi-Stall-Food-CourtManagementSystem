/**
 * Pure order-fulfilment logic for the tracking board: statuses, card colour, delay and labels.
 */
export type ItemStatus = 'pending' | 'preparing' | 'ready' | 'served' | 'cancelled';
export type DisplayStatus = 'Cooking' | 'Ready' | 'Served' | 'Cancelled';
export type CardState = 'green' | 'amber' | 'red' | 'empty';

export interface BoardItem {
  id: number;
  order_item_id: number;
  ticket_id: number;
  name: string;
  quantity: number;
  notes: string | null;
  stall: { id: number; name: string; code: string };
  status: ItemStatus;
  version: number;
  ready_at: string | null;
  served_at: string | null;
}

export interface BoardOrder {
  id: number;
  order_number: string;
  order_type: 'dine_in' | 'takeaway';
  table: { id: number; table_number: string } | null;
  guest_count: number | null;
  created_at: string;
  status: string;
  payment_status: string;
  items: BoardItem[];
}

export interface BoardPage {
  server_time: string;
  delay_minutes: number;
  total_active: number;
  next_cursor: string | null;
  orders: BoardOrder[];
}

const MINUTE_MS = 60_000;

export function displayStatus(status: ItemStatus): DisplayStatus {
  if (status === 'ready') return 'Ready';
  if (status === 'served') return 'Served';
  if (status === 'cancelled') return 'Cancelled';
  return 'Cooking';
}

export function progress(items: BoardItem[]): { served: number; total: number } {
  const live = items.filter((i) => i.status !== 'cancelled');
  return { served: live.filter((i) => i.status === 'served').length, total: live.length };
}

/** D9: all served -> green; any ready -> amber; otherwise red. No live items -> empty (never green). */
export function cardState(items: BoardItem[]): CardState {
  const live = items.filter((i) => i.status !== 'cancelled');
  if (live.length === 0) return 'empty';
  if (live.every((i) => i.status === 'served')) return 'green';
  if (live.some((i) => i.status === 'ready')) return 'amber';
  return 'red';
}

export function elapsedMinutes(createdAt: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(createdAt)) / MINUTE_MS));
}

/**
 * A per-card clock that only moves when the order's elapsed minute changes: `created_at + elapsed whole minutes`.
 * Labels and the delay check give exactly the same result as with the live clock (both use whole minutes;
 * delay settings are whole minutes), but memoised cards re-render once a minute instead of every second.
 */
export function cardNow(createdAt: string, nowMs: number): number {
  return Date.parse(createdAt) + elapsedMinutes(createdAt, nowMs) * MINUTE_MS;
}

/** D10: unserved items and age at or past the delay setting. */
export function isDelayed(order: BoardOrder, nowMs: number, delayMinutes: number): boolean {
  const state = cardState(order.items);
  if (state === 'green' || state === 'empty') return false;
  return nowMs - Date.parse(order.created_at) >= delayMinutes * MINUTE_MS;
}

export function nextItemAction(status: ItemStatus, canMarkReady: boolean): 'ready' | 'served' | null {
  if (status === 'ready') return 'served';
  if ((status === 'pending' || status === 'preparing') && canMarkReady) return 'ready';
  return null;
}

export function applyOptimistic(order: BoardOrder, itemId: number, to: ItemStatus): BoardOrder {
  return { ...order, items: order.items.map((i) => (i.id === itemId ? { ...i, status: to } : i)) };
}

export function cardLabel(order: BoardOrder, nowMs: number): string {
  const parts: string[] = [order.table ? order.table.table_number : order.order_number];
  if (order.guest_count !== null && order.guest_count !== undefined) {
    parts.push(`${order.guest_count} ${order.guest_count === 1 ? 'Guest' : 'Guests'}`);
  }
  parts.push(`${elapsedMinutes(order.created_at, nowMs)}m`);
  if (cardState(order.items) === 'empty') {
    parts.push('Cancelled');
  } else {
    const p = progress(order.items);
    parts.push(`${p.served}/${p.total} Served`);
  }
  return parts.join(' · ');
}

/** Server clock minus client clock, in ms; add it to the client time to get server time. */
export function serverOffset(serverTimeIso: string, clientNowMs: number): number {
  return Date.parse(serverTimeIso) - clientNowMs;
}

/** Body of PATCH /ticket-items/{id}/status: `{ success, message, data: { changed, item } }`. */
export function parseItemStatusBody(body: { data?: { changed?: unknown; item?: BoardItem } } | null | undefined): { changed: boolean; item: BoardItem } {
  const data = body?.data;
  if (!data || !data.item) throw new Error('Unexpected response from the item status update.');
  return { changed: Boolean(data.changed), item: data.item };
}
