/**
 * The serving list, built from the server's order board (GET /orders/board), the same data the desktop's
 * Orders & Table Tracking uses. There is no "ready" step any more: every dish is either still to serve or Served.
 */
export type BoardItemStatus = 'pending' | 'preparing' | 'ready' | 'served' | 'cancelled';

export interface BoardItem {
  id: number;
  name: string | null;
  quantity: number;
  notes: string | null;
  stall: { id: number; name: string; code?: string | null } | null;
  status: BoardItemStatus;
  version: number;
}

export interface BoardOrder {
  id: number;
  order_number: string;
  order_type: string;
  table: { id: number; table_number: string } | null;
  notes: string | null;
  created_at: string | null;
  items: BoardItem[];
}

/** Still to serve: anything not served and not cancelled ("ready" from older data counts as still to serve). */
export const isToServe = (item: BoardItem): boolean => item.status !== 'served' && item.status !== 'cancelled';

/** Dishes (lines) still to serve across the board. */
export const toServeCount = (orders: BoardOrder[]): number =>
  orders.reduce((sum, o) => sum + o.items.filter(isToServe).length, 0);

/**
 * Orders for the serving list: orders with something left to serve first, oldest first (served the longest wait first),
 * then fully served orders (they stay on the server's board for a few minutes), newest first. Cancelled lines are hidden.
 */
export const serveCards = (orders: BoardOrder[]): BoardOrder[] => {
  const withItems = orders
    .map((o) => ({ ...o, items: o.items.filter((i) => i.status !== 'cancelled') }))
    .filter((o) => o.items.length > 0);
  const time = (o: BoardOrder) => (o.created_at ? Date.parse(o.created_at) : 0);
  const open = withItems.filter((o) => o.items.some(isToServe)).sort((a, b) => time(a) - time(b) || a.id - b.id);
  const done = withItems.filter((o) => !o.items.some(isToServe)).sort((a, b) => time(b) - time(a) || b.id - a.id);
  return [...open, ...done];
};

/** After a successful Mark Served: the same board with that one dish served, without waiting for the next poll. */
export const withServed = (orders: BoardOrder[], itemId: number): BoardOrder[] =>
  orders.map((o) => (o.items.some((i) => i.id === itemId) ? { ...o, items: o.items.map((i) => (i.id === itemId ? { ...i, status: 'served' as const } : i)) } : o));

/** Minutes since the order was placed (0 if unknown or in the future). */
export const waitingMinutes = (createdAt: string | null, nowMs: number = Date.now()): number => {
  const t = createdAt ? Date.parse(createdAt) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 60000)) : 0;
};
