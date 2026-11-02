import axios, { AxiosInstance } from 'axios';
import { offlineStore, DEFAULT_SERVER_URL } from '../storage/offlineStore';
import { OfflineQueuedOrder } from '../types';

let cachedBaseUrl = DEFAULT_SERVER_URL;

offlineStore.getServerUrl().then((url) => {
  cachedBaseUrl = url;
});

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

export const syncOfflineOrders = async (
  onProgress?: (syncedCount: number, total: number) => void
): Promise<{ successCount: number; failureCount: number }> => {
  const queue = await offlineStore.getQueue();
  if (queue.length === 0) return { successCount: 0, failureCount: 0 };

  const client = await getApiClient();
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < queue.length; i++) {
    const item: OfflineQueuedOrder = queue[i];
    if (item.sync_status === 'synced') continue;

    try {
      await offlineStore.updateQueueItem(item.id, { sync_status: 'syncing' });

      const payload = {
        order_type: item.order_type,
        table_id: item.table_id,
        customer_name: item.customer_name || 'Walk-in Customer',
        customer_phone: item.customer_phone,
        notes: item.notes,
        items: item.items.map((it) => ({
          menu_item_id: it.menu_item_id,
          quantity: it.quantity,
          special_instructions: it.special_instructions,
        })),
        idempotency_key: item.id, // prevents double order creation on edge server
      };

      const res = await client.post('/orders', payload);
      if (res.data.success) {
        await offlineStore.removeQueueItem(item.id);
        successCount++;
      } else {
        await offlineStore.updateQueueItem(item.id, {
          sync_status: 'failed',
          error_message: res.data.message || 'Server rejected order',
        });
        failureCount++;
      }
    } catch (err: any) {
      await offlineStore.updateQueueItem(item.id, {
        sync_status: 'failed',
        error_message: err.response?.data?.message || err.message || 'Network unreachable',
      });
      failureCount++;
    }

    if (onProgress) {
      onProgress(successCount, queue.length);
    }
  }

  return { successCount, failureCount };
};

