import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '../types';
import { offlineStore } from '../storage/offlineStore';
import { getApiClient, syncOfflineOrders } from '../api/client';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isOnline: boolean;
  offlineQueueCount: number;
  login: (email: string, password: string) => Promise<{ success: boolean; message?: string }>;
  logout: () => Promise<void>;
  refreshCatalog: () => Promise<void>;
  checkOfflineQueue: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);

  useEffect(() => {
    initAuth();
  }, []);

  // Background auto-sync for waiters: retries queued orders (with per-order backoff) every 20s
  useEffect(() => {
    if (!token || user?.role !== 'waiter') return;
    const tick = async () => {
      const queue = await offlineStore.getQueue();
      if (queue.length === 0) return;
      try {
        const result = await syncOfflineOrders(undefined, false);
        setIsOnline(result.failed === 0);
      } finally {
        await checkOfflineQueue();
      }
    };
    tick();
    const interval = setInterval(tick, 20000);
    return () => clearInterval(interval);
  }, [token, user?.role]);

  const initAuth = async () => {
    try {
      const auth = await offlineStore.getAuth();
      if (auth.token && auth.user) {
        setToken(auth.token);
        setUser(auth.user);
      }
      await checkOfflineQueue();
    } catch (e) {
      console.warn('Init auth failed', e);
    } finally {
      setIsLoading(false);
    }
  };

  const checkOfflineQueue = async () => {
    const queue = await offlineStore.getQueue();
    setOfflineQueueCount(queue.length);
  };

  const refreshCatalog = async () => {
    try {
      const client = await getApiClient();
      const [tablesRes, menuRes, stallsRes] = await Promise.all([
        client.get('/tables'),
        client.get('/menu', { params: { available_only: 1 } }),
        client.get('/stalls'),
      ]);

      if (tablesRes.data?.data && menuRes.data?.data && stallsRes.data?.data) {
        await offlineStore.cacheCatalog(
          tablesRes.data.data,
          menuRes.data.data,
          stallsRes.data.data
        );
        setIsOnline(true);
      }
    } catch (e) {
      console.log('Unable to reach edge server for catalog refresh; working in offline mode');
      setIsOnline(false);
    }
  };

  const login = async (email: string, password: string) => {
    try {
      const client = await getApiClient();
      const res = await client.post('/auth/login', { email, password });

      if (res.data.success) {
        const { token: apiToken, user: apiUser } = res.data.data;
        setToken(apiToken);
        setUser(apiUser);
        await offlineStore.saveAuth(apiToken, apiUser);

        // Pre-fetch catalog for offline usage immediately upon login
        refreshCatalog().catch(() => {});
        return { success: true };
      }
      return { success: false, message: res.data.message || 'Login failed' };
    } catch (err: any) {
      return {
        success: false,
        message: err.response?.data?.message || err.message || 'Could not connect to edge server',
      };
    }
  };

  const logout = async () => {
    try {
      const client = await getApiClient();
      await client.post('/auth/logout');
    } catch {
      // Ignore network errors on logout
    }
    await offlineStore.clearAuth();
    setUser(null);
    setToken(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isOnline,
        offlineQueueCount,
        login,
        logout,
        refreshCatalog,
        checkOfflineQueue,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

