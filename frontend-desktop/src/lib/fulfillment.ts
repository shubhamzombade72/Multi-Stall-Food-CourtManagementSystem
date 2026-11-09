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
  /** Order notes typed at the counter (may also carry cancellation text; never shown for a cancelled card). */
  notes?: string | null;
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
export function isDelayed(_order: BoardOrder, _nowMs?: number, _delayMinutes?: number): boolean {
  return false;
}

/**
 * The one action on an item: Mark Served, straight from any unserved state. There is no Mark Ready step on the board any
 * more; the server accepts pending/preparing/ready -> served for the owner, cashier and waiter.
 */
export function nextItemAction(status: ItemStatus, canServe: boolean): 'served' | null {
  if (!canServe) return null;
  return status === 'pending' || status === 'preparing' || status === 'ready' ? 'served' : null;
}

export function applyOptimistic(order: BoardOrder, itemId: number, to: ItemStatus): BoardOrder {
  return { ...order, items: order.items.map((i) => (i.id === itemId ? { ...i, status: to } : i)) };
}

/**
 * Detail lines under the card title: "Table : T-04" (or "Order : Takeaway"), "Stall : Pizza" (several stalls become
 * "Stalls : Pizza, Burger", cancelled items ignored) and the order notes. A cancelled card shows only the table line.
 */
export function cardDetails(order: BoardOrder): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [
    order.table ? { label: 'Table', value: order.table.table_number } : { label: 'Order', value: 'Takeaway' },
  ];
  if (cardState(order.items) === 'empty') return lines;
  const stalls: string[] = [];
  for (const i of order.items) {
    if (i.status !== 'cancelled' && i.stall?.name && !stalls.includes(i.stall.name)) stalls.push(i.stall.name);
  }
  if (stalls.length > 0) lines.push({ label: stalls.length === 1 ? 'Stall' : 'Stalls', value: stalls.join(', ') });
  const notes = (order.notes ?? '').trim();
  if (notes) lines.push({ label: 'Notes', value: notes });
  return lines;
}

export function cardLabel(order: BoardOrder, _nowMs?: number): string {
  const parts: string[] = [order.table ? order.table.table_number : order.order_number];
  if (order.guest_count !== null && order.guest_count !== undefined) {
    parts.push(`${order.guest_count} ${order.guest_count === 1 ? 'Guest' : 'Guests'}`);
  }

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
