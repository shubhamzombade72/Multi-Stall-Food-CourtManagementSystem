import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';

/**
 * Hook to keep the count of pending (unpaid table/takeaway) bills synchronized
 * across the desktop application (e.g. for the Sidebar badge).
 * Polls periodically and listens to 'pending-bills-updated' custom events for instant updates.
 */
export const usePendingBillsCount = (intervalMs = 10000): number => {
  const { user, isOwner, isCashier } = useAuth();
  const [count, setCount] = useState<number>(0);

  const fetchCount = useCallback(async () => {
    if (!user || (!isOwner && !isCashier)) {
      setCount(0);
      return;
    }
    try {
      const res = await apiClient.get('/billing/pending');
      if (res.data?.success && Array.isArray(res.data?.data)) {
        setCount(res.data.data.length);
      }
    } catch {
      // Silently ignore background badge errors
    }
  }, [user, isOwner, isCashier]);

  useEffect(() => {
    fetchCount();
    const interval = setInterval(fetchCount, intervalMs);

    const onCustomEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ count: number }>;
      if (customEvent.detail && typeof customEvent.detail.count === 'number') {
        setCount(customEvent.detail.count);
      } else {
        fetchCount();
      }
    };

    window.addEventListener('pending-bills-updated', onCustomEvent);

    return () => {
      clearInterval(interval);
      window.removeEventListener('pending-bills-updated', onCustomEvent);
    };
  }, [fetchCount, intervalMs]);

  return count;
};

