import type { BoardOrder, BoardPage, ItemStatus } from './fulfillment';

/**
 * Pure poll/merge decisions for the tracking board.
 */
export interface ApplyCheck {
  /** Sequence number given to this fetch when it started. */
  fetchSeq: number;
  /** Highest fetch sequence already applied. */
  lastAppliedSeq: number;
  /** Mutation counter captured when the fetch started. */
  mutationSeqAtStart: number;
  /** Mutation counter now. */
  mutationSeqNow: number;
  /** Error-path refresh: ignore the mutation check (it was started after the mutation finished). */
  force?: boolean;
}

/** A page is dropped if an older fetch arrives after a newer one, or (unless forced) a mutation finished meanwhile. */
export function shouldApplyPage(c: ApplyCheck): boolean {
  if (c.fetchSeq <= c.lastAppliedSeq) return false;
  if (!c.force && c.mutationSeqAtStart !== c.mutationSeqNow) return false;
  return true;
}

export interface MergedBoard {
  orders: BoardOrder[];
  totalActive: number;
  nextCursor: string | null;
  /** Pages actually fetched (fewer than wanted when the board shrank). */
  pagesLoaded: number;
}

/**
 * Which page to fetch next while refreshing the board: page 1 first, then each fresh next_cursor, until as many
 * pages as were loaded before (Load more raises `wanted`) or the board has no more pages. Cursors are always taken
 * from this refresh, never from an older one, so they cannot go stale.
 */
export function nextPageCursor(fetched: BoardPage[], wanted: number): { done: true } | { done: false; cursor: string | null } {
  if (fetched.length === 0) return { done: false, cursor: null };
  const last = fetched[fetched.length - 1];
  if (fetched.length >= wanted || !last.next_cursor) return { done: true };
  return { done: false, cursor: last.next_cursor };
}

/**
 * The board after a refresh of every loaded page: the union of the fresh pages in order (deduped by id), so orders
 * the server no longer returns disappear and load-more orders carry fresh versions. Orders with a request in flight
 * keep their local (optimistic) copy, also when a fresh page no longer contains them.
 */
export function mergePages(current: BoardOrder[], pages: BoardPage[], inFlightIds: ReadonlySet<number>): MergedBoard {
  const local = new Map(current.map((o) => [o.id, o]));
  const seen = new Set<number>();
  const orders: BoardOrder[] = [];
  for (const p of pages) {
    for (const o of p.orders) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      orders.push(inFlightIds.has(o.id) && local.has(o.id) ? (local.get(o.id) as BoardOrder) : o);
    }
  }
  for (const o of current) {
    if (inFlightIds.has(o.id) && !seen.has(o.id)) orders.push(o);
  }
  const last = pages[pages.length - 1];
  return {
    orders,
    totalActive: last ? last.total_active : 0,
    nextCursor: last ? last.next_cursor : null,
    pagesLoaded: pages.length,
  };
}

/** "Showing X of N": X = shown orders that still have food to serve (what total_active counts), never above N. */
export function showingCounts(orders: BoardOrder[], totalActive: number): { shown: number; total: number } {
  const withUnserved = orders.filter((o) => o.items.some((i) => i.status !== 'served' && i.status !== 'cancelled')).length;
  return { shown: Math.min(withUnserved, totalActive), total: totalActive };
}

/** Sets one item back to a prior status (failed optimistic update). */
export function revertItem(order: BoardOrder, itemId: number, status: ItemStatus): BoardOrder {
  return { ...order, items: order.items.map((i) => (i.id === itemId ? { ...i, status } : i)) };
}
