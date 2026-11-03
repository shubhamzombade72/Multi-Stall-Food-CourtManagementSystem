import { useEffect, useState } from 'react';
import axios from 'axios';
import { healthUrl } from '../api/client';

export type ConnectionState = 'checking' | 'online' | 'offline';

/**
 * Real backend reachability (GET /up every 15 s, immediately again when the browser regains network).
 * Replaces the old hard-coded "PostgreSQL 17 Online" label.
 */
export const useConnection = (intervalMs = 15000) => {
  const [state, setState] = useState<ConnectionState>('checking');
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const target = healthUrl();
      if (!target) {
        if (alive) setState('offline');
        return;
      }
      try {
        await axios.get(target, { timeout: 5000 });
        if (alive) setState('online');
      } catch {
        if (alive) setState('offline');
      } finally {
        if (alive) setLastChecked(new Date());
      }
    };
    check();
    const t = setInterval(check, intervalMs);
    window.addEventListener('online', check);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener('online', check);
    };
  }, [intervalMs]);

  return { state, lastChecked };
};
