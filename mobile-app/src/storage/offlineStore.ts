import AsyncStorage from '@react-native-async-storage/async-storage';
import { DiningTable, MenuItem, OfflineQueuedOrder, Stall, ReadyItemAlert } from '../types';

const STORAGE_KEYS = {
  AUTH_TOKEN: '@foodcourt_auth_token',
  USER_DATA: '@foodcourt_user_data',
  CACHED_TABLES: '@foodcourt_cached_tables',
  CACHED_MENU: '@foodcourt_cached_menu',
  CACHED_STALLS: '@foodcourt_cached_stalls',
  OFFLINE_QUEUE: '@foodcourt_offline_orders_queue',
  READY_ALERTS: '@foodcourt_ready_alerts',
  SERVER_URL: '@foodcourt_server_url',
};

export const DEFAULT_SERVER_URL = 'http://10.0.2.2:8000/api'; // Android Emulator default; LAN IP configurable

export const offlineStore = {
  // Server URL Configuration (for local foodcourt LAN edge server)
  async getServerUrl(): Promise<string> {
    try {
      const url = await AsyncStorage.getItem(STORAGE_KEYS.SERVER_URL);
      return url || DEFAULT_SERVER_URL;
    } catch {
      return DEFAULT_SERVER_URL;
    }
  },

  async setServerUrl(url: string): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.SERVER_URL, url);
  },

  // Auth Storage
  async saveAuth(token: string, user: any): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
    await AsyncStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(user));
  },

  async getAuth(): Promise<{ token: string | null; user: any | null }> {
    try {
      const token = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      const userStr = await AsyncStorage.getItem(STORAGE_KEYS.USER_DATA);
      return {
        token,
        user: userStr ? JSON.parse(userStr) : null,
      };
    } catch {
      return { token: null, user: null };
    }
  },

  async clearAuth(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
    await AsyncStorage.removeItem(STORAGE_KEYS.USER_DATA);
  },

  // Local Metadata Caching
  async cacheCatalog(tables: DiningTable[], menu: MenuItem[], stalls: Stall[]): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.CACHED_TABLES, JSON.stringify(tables));
      await AsyncStorage.setItem(STORAGE_KEYS.CACHED_MENU, JSON.stringify(menu));
      await AsyncStorage.setItem(STORAGE_KEYS.CACHED_STALLS, JSON.stringify(stalls));
    } catch (e) {
      console.warn('Failed to cache catalog locally', e);
    }
  },

  async getCachedCatalog(): Promise<{ tables: DiningTable[]; menu: MenuItem[]; stalls: Stall[] }> {
    try {
      const tablesStr = await AsyncStorage.getItem(STORAGE_KEYS.CACHED_TABLES);
      const menuStr = await AsyncStorage.getItem(STORAGE_KEYS.CACHED_MENU);
      const stallsStr = await AsyncStorage.getItem(STORAGE_KEYS.CACHED_STALLS);
      return {
        tables: tablesStr ? JSON.parse(tablesStr) : [],
        menu: menuStr ? JSON.parse(menuStr) : [],
        stalls: stallsStr ? JSON.parse(stallsStr) : [],
      };
    } catch {
      return { tables: [], menu: [], stalls: [] };
    }
  },

  // Offline Order Queue
  async enqueueOrder(order: Omit<OfflineQueuedOrder, 'id' | 'client_timestamp' | 'sync_status'>): Promise<OfflineQueuedOrder> {
    const queue = await this.getQueue();
    const queuedOrder: OfflineQueuedOrder = {
      ...order,
      id: 'local_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      client_timestamp: Date.now(),
      sync_status: 'pending',
    };
    queue.push(queuedOrder);
    await AsyncStorage.setItem(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(queue));
    return queuedOrder;
  },

  async getQueue(): Promise<OfflineQueuedOrder[]> {
    try {
      const str = await AsyncStorage.getItem(STORAGE_KEYS.OFFLINE_QUEUE);
      return str ? JSON.parse(str) : [];
    } catch {
      return [];
    }
  },

  async updateQueueItem(id: string, updates: Partial<OfflineQueuedOrder>): Promise<void> {
    const queue = await this.getQueue();
    const index = queue.findIndex((item) => item.id === id);
    if (index !== -1) {
      queue[index] = { ...queue[index], ...updates };
      await AsyncStorage.setItem(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(queue));
    }
  },

  async removeQueueItem(id: string): Promise<void> {
    const queue = await this.getQueue();
    const filtered = queue.filter((item) => item.id !== id);
    await AsyncStorage.setItem(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(filtered));
  },

  async clearQueue(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEYS.OFFLINE_QUEUE);
  },

  // Waiter Ready Dish Alerts Cache
  async saveReadyAlerts(alerts: ReadyItemAlert[]): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.READY_ALERTS, JSON.stringify(alerts));
  },

  async getReadyAlerts(): Promise<ReadyItemAlert[]> {
    try {
      const str = await AsyncStorage.getItem(STORAGE_KEYS.READY_ALERTS);
      return str ? JSON.parse(str) : [];
    } catch {
      return [];
    }
  },
};

