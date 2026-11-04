import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { timeOnly } from '../lib/format';
import { sound } from '../lib/sound/index';
import { FreshTracker } from '../lib/sound/tracker';
import { NOTICE_MAX_AGE_MS, soundForNotice } from '../lib/sound/notifications';

interface Notice {
  id: string;
  type: string;
  level: 'info' | 'success' | 'warning';
  title: string;
  message: string;
  at: string;
  link: string;
}

const POLL_MS = 15000;
const levelDot: Record<string, string> = { info: 'bg-st-running', success: 'bg-st-served', warning: 'bg-st-ready' };

const seenKey = (userId?: number) => `foodcourt.notifications.seen.${userId ?? 'anon'}`;
const readSeen = (userId?: number): number => {
  try {
    return Number(localStorage.getItem(seenKey(userId)) || 0);
  } catch {
    return 0;
  }
};

/**
 * Operational notifications for the signed-in role (new orders, kitchen tickets, ready dishes, payments,
 * low stock, goods received). Polled every 15 s; "read" is remembered per user on this computer.
 */
export const NotificationBell: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState(() => readSeen(user?.id));
  const [failed, setFailed] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  // Decides which polled notifications are genuinely new. The bell lives in the navbar, so it is mounted on every
  // screen: sounds keep working while the user is elsewhere, and opening a page never replays old items.
  const fresh = useRef(new FreshTracker<Notice>({ idOf: (n) => n.id, timeOf: (n) => Date.parse(n.at), maxAgeMs: NOTICE_MAX_AGE_MS }));

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/notifications');
      const list: Notice[] = res.data.data.items;
      for (const n of fresh.current.observe(list)) {
        const s = soundForNotice(n);
        if (s) void sound.play(s.event, { key: s.key });
      }
      setItems(list);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    setSeenAt(readSeen(user?.id));
    fresh.current.reset(); // another user (or role) sees a different feed: start from a new baseline
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load, user?.id]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const unread = items.filter((n) => new Date(n.at).getTime() > seenAt).length;

  const markAllRead = () => {
    const now = Date.now();
    setSeenAt(now);
    try {
      localStorage.setItem(seenKey(user?.id), String(now));
    } catch {
      // per-device convenience only
    }
  };

  return (
    <div className="relative" ref={panel}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        className="relative p-2 rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span data-testid="notification-count" className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger-fg text-surface text-[10px] font-bold flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-96 bg-surface border border-line rounded-lg shadow-2xl z-50 overflow-hidden" role="dialog" aria-label="Notifications">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <span className="font-bold text-sm text-fg">Notifications</span>
            <button onClick={markAllRead} className="text-xs font-bold text-primary">
              Mark all read
            </button>
          </div>
          <div className="max-h-[420px] overflow-y-auto divide-y divide-line">
            {failed && <p className="p-4 text-xs text-danger-fg">Could not load notifications (server unreachable).</p>}
            {!failed && items.length === 0 && <p className="p-6 text-center text-xs text-muted">Nothing new in the last 12 hours.</p>}
            {items.map((n) => {
              const isNew = new Date(n.at).getTime() > seenAt;
              return (
                <button
                  key={n.id}
                  onClick={() => {
                    setOpen(false);
                    navigate(n.link);
                  }}
                  className={`w-full text-left px-4 py-3 hover:bg-surface-2 flex items-start space-x-3 ${isNew ? 'bg-st-running-soft' : ''}`}
                >
                  <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${levelDot[n.level] || levelDot.info}`} />
                  <span className="flex-1 min-w-0">
                    <span className={`block text-sm ${isNew ? 'font-bold text-fg' : 'font-medium text-fg'}`}>{n.title}</span>
                    <span className="block text-xs text-muted truncate">{n.message}</span>
                  </span>
                  <span className="text-[10px] text-muted shrink-0">{timeOnly(n.at)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
