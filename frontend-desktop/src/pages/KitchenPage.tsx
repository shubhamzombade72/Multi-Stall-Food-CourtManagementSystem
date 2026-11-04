import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { onPrivate, realtimeConfigured } from '../realtime/echo';
import { columnFor, elapsed, nextKitchenAction, urgency, type TicketStatus } from '../lib/kds';
import { sound as soundService } from '../lib/sound/index';
import { autoPrintKot } from '../lib/print/autoPrint';
import { PrintTicketButton } from '../components/PrintKotButtons';
import { FreshTracker } from '../lib/sound/tracker';
import { useSoundSettings } from '../hooks/useSoundSettings';
import { isoDate, humanize, timeOnly } from '../lib/format';
import { statusChip, statusClasses, statusKind } from '../lib/status';
import { LateBadge } from '../components/ui';
import { ChefHat, Maximize2, Minimize2, Volume2, VolumeX, RefreshCw, AlertTriangle, History } from 'lucide-react';

interface Ticket {
  id: number;
  ticket_number: string;
  stall_id: number;
  status: TicketStatus;
  created_at: string;
  order?: { order_number: string; order_type?: string; table?: { table_number: string } | null };
  ticket_items?: { id: number; quantity: number; order_item?: { item_name: string; special_instructions?: string | null } }[];
}

const POLL_MS = 4000;

/** A ticket only counts as news if it was created recently (a slow first load must not announce yesterday's tickets). */
const TICKET_FRESH_MS = 15 * 60_000;

export const KitchenPage: React.FC = () => {
  const { user, isOwner } = useAuth();
  const [stalls, setStalls] = useState<any[]>([]);
  const [stallId, setStallId] = useState<number | null>(isOwner ? null : user?.stall_id ?? null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [served, setServed] = useState<Ticket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  // New-ticket sound goes through the shared sound service (volume, mute, de-duplication live there)
  const { settings: soundSettings, setCategory, update: updateSound } = useSoundSettings();
  const sound = soundSettings.enabled && soundSettings.categories.kitchen;
  const [fullscreen, setFullscreen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const tracker = useRef(new FreshTracker<Ticket>({ idOf: (t) => String(t.id), timeOf: (t) => Date.parse(t.created_at), maxAgeMs: TICKET_FRESH_MS }));
  const [view, setView] = useState<'board' | 'history'>('board');
  const [historyDate, setHistoryDate] = useState(isoDate());
  const [history, setHistory] = useState<any[] | null>(null);

  useEffect(() => {
    if (view !== 'history' || !stallId) return;
    setHistory(null);
    apiClient
      .get('/kitchen/tickets', { params: { ...(isOwner ? { stall_id: stallId } : {}), date: historyDate } })
      .then((r) => setHistory(r.data.data))
      .catch((err) => setError(err.response?.data?.message || 'Could not load ticket history'));
  }, [view, historyDate, stallId, isOwner]);

  useEffect(() => {
    if (!isOwner) return;
    apiClient.get('/stalls').then((r) => {
      setStalls(r.data.data);
      if (!stallId && r.data.data.length) setStallId(r.data.data[0].id);
    });
  }, [isOwner]);

  const load = useCallback(async () => {
    if (!stallId) return;
    try {
      const params = isOwner ? { stall_id: stallId } : {};
      const [active, done] = await Promise.all([
        apiClient.get('/kitchen/tickets', { params }),
        // today's served tickets only (newest first, server-capped)
        apiClient.get('/kitchen/tickets', { params: { ...params, status: 'picked_up', date: isoDate() } }),
      ]);
      const list: Ticket[] = active.data.data;
      // First list after opening the board / switching stall is only a baseline; later arrivals ring once per ticket
      for (const t of tracker.current.observe(list)) {
        void soundService.play('kitchen_ticket', { key: `ticket:${t.id}` });
        void autoPrintKot(t as any); // only when the operator enabled automatic KOT printing on this PC
      }
      setTickets(list);
      setServed((done.data.data as Ticket[]).slice(0, 12));
      setError(null);
      setLastSync(new Date());
    } catch (err: any) {
      setError(err.response?.data?.message || 'Cannot reach the server. Retrying…');
    }
  }, [stallId, isOwner]);

  useEffect(() => {
    tracker.current.reset();
    load();
    const t = setInterval(load, POLL_MS);
    const unsubscribe = stallId
      ? onPrivate(`stall.${stallId}`, ['OrderCreated', 'TicketStatusUpdated', 'TicketReady'], () => load())
      : () => undefined;
    return () => {
      clearInterval(t);
      unsubscribe();
    };
  }, [load, stallId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      clearInterval(t);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, []);

  const advance = async (ticket: Ticket) => {
    const action = nextKitchenAction(ticket.status);
    if (!action) return;
    setBusyId(ticket.id);
    try {
      await apiClient.put(`/kitchen/tickets/${ticket.id}/status`, { status: action.to });
      await load();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Status update failed');
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => undefined);
  };

  if (!isOwner && !user?.stall_id) {
    return <div className="p-4 text-muted">Your account is not assigned to a stall. Ask the owner to assign one.</div>;
  }

  const columns: { key: 'new' | 'preparing' | 'ready'; title: string; tone: string; count: string }[] = [
    { key: 'new', title: 'New', tone: 'border-l-st-running', count: 'bg-st-running-soft text-st-running-fg' },
    { key: 'preparing', title: 'Preparing', tone: 'border-l-st-cooking', count: 'bg-st-cooking-soft text-st-cooking-fg' },
    { key: 'ready', title: 'Ready for pickup', tone: 'border-l-st-ready', count: 'bg-st-ready-soft text-st-ready-fg' },
  ];
  const stallName = isOwner ? stalls.find((s) => s.id === stallId)?.name : user?.stall?.name;

  return (
    <div className="min-h-full bg-canvas text-fg p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <ChefHat className="w-7 h-7 text-warning-fg" />
          <div>
            <h2 className="text-xl font-extrabold">Kitchen Display {stallName ? `· ${stallName}` : ''}</h2>
            <p className="text-xs text-muted">
              {realtimeConfigured() ? 'Realtime + ' : ''}auto-refresh every {POLL_MS / 1000}s
              {lastSync ? ` · last sync ${lastSync.toLocaleTimeString()}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {isOwner && (
            <select
              aria-label="Stall"
              value={stallId ?? ''}
              onChange={(e) => setStallId(Number(e.target.value))}
              className="bg-surface text-fg border border-line rounded-lg px-3 py-2 text-sm"
            >
              {stalls.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => setView((v) => (v === 'board' ? 'history' : 'board'))}
            className="px-3 py-2 rounded-lg bg-surface-2 border border-line hover:bg-line text-sm font-semibold flex items-center"
          >
            <History className="w-4 h-4 mr-1" />
            {view === 'board' ? 'Ticket history' : 'Live board'}
          </button>
          <button onClick={() => load()} className="p-2 rounded-lg bg-surface-2 border border-line hover:bg-line" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => (soundSettings.enabled ? setCategory('kitchen', !soundSettings.categories.kitchen) : updateSound({ enabled: true, categories: { kitchen: true } }))}
            className="p-2 rounded-lg bg-surface-2 border border-line hover:bg-line"
            title={sound ? 'New-ticket sound is on (volume and other sounds: Settings â†’ Sound)' : 'New-ticket sound is off'}
            aria-pressed={sound}
            data-testid="kitchen-sound-toggle"
          >
            {sound ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <button onClick={toggleFullscreen} className="p-2 rounded-lg bg-surface-2 border border-line hover:bg-line" title="Full screen">
            {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center space-x-2 bg-danger/10 border border-danger/30 text-danger-fg text-sm rounded-lg px-4 py-2">
          <AlertTriangle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {view === 'history' ? (
        <section className="bg-surface border border-line rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-sm text-muted">Date</label>
            <input type="date" max={isoDate()} value={historyDate} onChange={(e) => setHistoryDate(e.target.value)} className="bg-surface text-fg border border-line rounded-lg px-3 py-1.5 text-sm" />
            {history && <span className="text-xs text-muted">{history.length} ticket(s)</span>}
          </div>
          {history === null ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted py-6 text-center">No tickets for this stall on that date.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted">
                <tr>
                  <th className="text-left py-2">Ticket</th>
                  <th className="text-left py-2">Table</th>
                  <th className="text-left py-2">Items</th>
                  <th className="text-left py-2">Received</th>
                  <th className="text-left py-2">Ready</th>
                  <th className="text-left py-2">Served</th>
                  <th className="text-left py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {history.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2 font-mono text-xs">
                      {t.ticket_number}
                      <span className="block text-muted">{t.order?.order_number}</span>
                    </td>
                    <td className="py-2">{t.order?.table ? t.order.table.table_number : 'Takeaway'}</td>
                    <td className="py-2 text-xs">{(t.ticket_items || []).map((ti: any) => `${ti.quantity}× ${ti.order_item?.item_name}`).join(', ')}</td>
                    <td className="py-2 text-xs tabular-nums whitespace-nowrap">{timeOnly(t.created_at)}</td>
                    <td className="py-2 text-xs tabular-nums whitespace-nowrap">{timeOnly(t.ready_at)}</td>
                    <td className="py-2 text-xs tabular-nums whitespace-nowrap">{timeOnly(t.picked_up_at)}</td>
                    <td className="py-2 text-xs">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${statusChip(t.status)}`}>{humanize(t.status)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : (
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {columns.map((col) => {
          const list = tickets.filter((t) => columnFor(t.status) === col.key);
          return (
            <section key={col.key} className="bg-surface border border-line rounded-lg p-3 space-y-3 min-h-[60vh]">
              <h3 className="font-bold text-sm uppercase tracking-wider text-muted flex justify-between">
                <span>{col.title}</span>
                <span className={`${col.count} rounded-full px-2 tabular-nums`}>{list.length}</span>
              </h3>
              {list.map((t) => {
                const u = urgency(t.created_at, now);
                const action = nextKitchenAction(t.status);
                return (
                  <article
                    key={t.id}
                    data-ticket={t.ticket_number}
                    className={`rounded-lg bg-surface-2 border border-line border-l-4 ${col.tone} p-3 space-y-2 ${u === 'late' ? 'ring-4 ring-danger' : u === 'warning' ? 'ring-2 ring-offset-2 ring-offset-surface ring-warning' : ''}`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-extrabold">{t.order?.table ? `Table ${t.order.table.table_number}` : 'Takeaway'}</div>
                        <div className="text-[11px] text-muted font-mono">
                          {t.ticket_number} · {t.order?.order_number}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {u === 'late' && <LateBadge />}
                        <span className={`text-xs font-mono font-bold tabular-nums ${u === 'late' ? 'text-danger-fg' : u === 'warning' ? 'text-warning-fg' : 'text-muted'}`}>
                          {elapsed(t.created_at, now)}
                        </span>
                      </div>
                    </div>
                    <ul className="text-sm space-y-1">
                      {(t.ticket_items || []).map((ti) => (
                        <li key={ti.id}>
                          <span className="font-bold">{ti.quantity}×</span> {ti.order_item?.item_name}
                          {ti.order_item?.special_instructions && (
                            <div className="text-xs text-warning-fg italic">Note: {ti.order_item.special_instructions}</div>
                          )}
                        </li>
                      ))}
                    </ul>
                    <PrintTicketButton ticket={t as any} className="text-[11px] font-bold px-2 py-1 border border-line rounded-lg hover:bg-line" />
                    {action ? (
                      <button
                        onClick={() => advance(t)}
                        disabled={busyId === t.id}
                        className={`w-full py-2 rounded-lg border hover:opacity-90 font-extrabold text-sm disabled:opacity-50 ${statusClasses(statusKind(action.to)).soft} ${statusClasses(statusKind(action.to)).border} ${statusClasses(statusKind(action.to)).text}`}
                      >
                        {busyId === t.id ? 'Updating…' : action.label}
                      </button>
                    ) : (
                      <div className="text-center text-xs text-success-fg font-semibold">Waiting for pickup</div>
                    )}
                  </article>
                );
              })}
            </section>
          );
        })}
        <section className="bg-surface border border-line rounded-lg p-3 space-y-2 min-h-[60vh]">
          <h3 className="font-bold text-sm uppercase tracking-wider text-muted">Served (recent)</h3>
          {served.map((t) => (
            <div key={t.id} className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
              <span className="font-mono">{t.ticket_number}</span> · {t.order?.table ? `Table ${t.order.table.table_number}` : 'Takeaway'}
            </div>
          ))}
        </section>
      </div>
      )}
    </div>
  );
};
