import { getApiClient } from './client';
import type { BoardOrder } from '../utils/serveBoard';

const MAX_PAGES = 5; // the server pages 100 orders at a time; a phone never needs more than a few hundred

/**
 * The order board, the same list the desktop's Orders & Table Tracking shows. Owner, cashier and waiter get every
 * stall; kitchen staff and stall managers get only their own stall (the server decides the scope).
 */
export const fetchBoard = async (): Promise<BoardOrder[]> => {
  const client = await getApiClient();
  const orders: BoardOrder[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res: { data: { data?: { orders?: BoardOrder[]; next_cursor?: string | null } } } = await client.get('/orders/board', {
      params: cursor ? { cursor } : {},
    });
    const data = res.data?.data;
    orders.push(...(data?.orders ?? []));
    cursor = data?.next_cursor ?? null;
    if (!cursor) break;
  }
  return orders;
};

/** Marks one dish served, straight from any unserved state (owner, cashier and waiter only). */
export const markItemServed = async (itemId: number, version: number): Promise<void> => {
  const client = await getApiClient();
  await client.patch(`/ticket-items/${itemId}/status`, { status: 'served', expected_version: version });
};
