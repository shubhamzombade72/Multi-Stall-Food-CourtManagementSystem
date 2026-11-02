import axios, { AxiosInstance } from 'axios';
import { offlineStore } from '../storage/offlineStore';
import { OfflineQueuedOrder } from '../types';
import { HttpResult, SyncSummary, syncQueue } from '../offline/syncEngine';

export const getApiClient = async (): Promise<AxiosInstance> => {
  const url = await offlineStore.getServerUrl();
  const { token } = await offlineStore.getAuth();

  const instance = axios.create({
    baseURL: url,
    timeout: 10000,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  return instance;
};

export const toOrderPayload = (item: OfflineQueuedOrder) => ({
  order_type: item.order_type,
  order_channel: 'waiter_app',
  table_id: item.table_id,
  customer_name: item.customer_name || 'Walk-in Customer',
  customer_phone: item.customer_phone,
  notes: item.notes,
  items: item.items.map((it) => ({
    menu_item_id: it.menu_item_id,
    quantity: it.quantity,
    special_instructions: it.special_instructions,
  })),
  idempotency_key: item.id, // same key as the original attempt: prevents double orders
});

/**
 * POST an order and report the HTTP status for any server response.
 * Rejects only when no response was received (offline, timeout, connection reset).
 */
export const postOrder = async (item: OfflineQueuedOrder): Promise<HttpResult> => {
  const client = await getApiClient();
  try {
    const res = await client.post('/orders', toOrderPayload(item));
    return { status: res.status, data: res.data };
  } catch (err: any) {
    if (err.response) {
      return { status: err.response.status, data: err.response.data };
    }
    throw err;
  }
};

export const syncOfflineOrders = async (
  onProgress?: (syncedCount: number, total: number) => void,
  force = true
): Promise<SyncSummary> => syncQueue(offlineStore, postOrder, { force, onProgress });
