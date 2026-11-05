import { apiClient } from './client';
import { parseItemStatusBody, type BoardItem, type BoardOrder, type BoardPage } from '../lib/fulfillment';

export async function fetchBoard(cursor?: string | null): Promise<BoardPage> {
  const res = await apiClient.get('/orders/board', { params: cursor ? { cursor } : {} });
  return res.data.data as BoardPage;
}

/** Errors (including HTTP 409) are rethrown untouched so callers can inspect them. */
export async function setItemStatus(
  id: number,
  to: 'ready' | 'served',
  expectedVersion: number,
): Promise<{ changed: boolean; item: BoardItem }> {
  const res = await apiClient.patch(`/ticket-items/${id}/status`, { status: to, expected_version: expectedVersion });
  return parseItemStatusBody(res.data);
}

export async function updateItemQuantity(
  ticketItemId: number,
  delta: 1 | -1,
): Promise<{ order: BoardOrder }> {
  const res = await apiClient.patch(`/ticket-items/${ticketItemId}/quantity`, { delta });
  return res.data.data;
}

export async function addOrderItem(
  orderId: number,
  menuItemId: number,
  quantity = 1,
  specialInstructions?: string,
): Promise<{ order: BoardOrder }> {
  const res = await apiClient.post(`/orders/${orderId}/items`, {
    menu_item_id: menuItemId,
    quantity,
    special_instructions: specialInstructions,
  });
  return res.data.data;
}

export async function serveRemaining(
  orderId: number,
  idempotencyKey: string,
  itemIds: number[],
): Promise<{ replayed: boolean; served_item_ids: number[]; order: BoardOrder }> {
  const res = await apiClient.post(`/orders/${orderId}/serve-remaining`, {
    idempotency_key: idempotencyKey,
    item_ids: itemIds,
  });
  return res.data.data;
}
