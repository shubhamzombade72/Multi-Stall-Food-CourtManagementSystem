import Echo from 'laravel-echo';
import Pusher from 'pusher-js';
import { API_BASE_URL } from '../api/client';
import { logError } from '../desktop/bridge';

/**
 * Optional Reverb connection for private channels (private-stall.{id}, private-cashier, private-waiters).
 * Enabled only when VITE_REVERB_APP_KEY is set at build time; every screen also polls, so realtime is an
 * accelerator, never a dependency. Channel authorization uses the same Sanctum token as the API.
 */
let echo: Echo<'reverb'> | null = null;

export const realtimeConfigured = (): boolean => Boolean(import.meta.env.VITE_REVERB_APP_KEY);

export const getEcho = (): Echo<'reverb'> | null => {
  if (!realtimeConfigured()) return null;
  if (echo) return echo;
  try {
    (window as any).Pusher = Pusher;
    const apiHost = (() => {
      try {
        return new URL(API_BASE_URL, window.location.href).hostname;
      } catch {
        return '127.0.0.1';
      }
    })();
    echo = new Echo({
      broadcaster: 'reverb',
      key: import.meta.env.VITE_REVERB_APP_KEY,
      wsHost: import.meta.env.VITE_REVERB_HOST || apiHost,
      wsPort: Number(import.meta.env.VITE_REVERB_PORT || 8080),
      wssPort: Number(import.meta.env.VITE_REVERB_PORT || 443),
      forceTLS: (import.meta.env.VITE_REVERB_SCHEME || 'http') === 'https',
      enabledTransports: ['ws', 'wss'],
      authEndpoint: `${API_BASE_URL}/broadcasting/auth`,
      auth: { headers: { Authorization: `Bearer ${localStorage.getItem('fc_auth_token') || ''}`, Accept: 'application/json' } },
    });
  } catch (err: any) {
    logError(`Realtime init failed: ${err?.message || err}`);
    echo = null;
  }
  return echo;
};

/** Subscribe to a private channel; returns an unsubscribe function (no-op when realtime is off). */
export const onPrivate = (channel: string, events: string[], handler: (event: string, payload: any) => void): (() => void) => {
  const e = getEcho();
  if (!e) return () => undefined;
  const ch = e.private(channel);
  events.forEach((name) => ch.listen(`.${name}`, (payload: any) => handler(name, payload)));
  return () => e.leave(channel);
};
