import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { onPrivate, realtimeConfigured } from '../realtime/echo';
import { columnFor, elapsed, newTicketIds, nextKitchenAction, urgency, type TicketStatus } from '../lib/kds';
import { isoDate, humanize, timeOnly } from '../lib/format';
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

/** Short two-tone chime via Web Audio (no sound file needed). */
const chime = () => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.15);
    });
    setTimeout(() => ctx.close(), 800);
  } catch {
    // audio unavailable
  }
};

export const KitchenPage: React.FC = () => {
  const { user, isOwner } = useAuth();
  const [stalls, setStalls] = useState<any[]>([]);
  const [stallId, setStallId] = useState<number | null>(isOwner ? null : user?.stall_id ?? null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [served, setServed] = useState<Ticket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [sound, setSound] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const seen = useRef<Set<number> | null>(null);
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
      const ids = list.map((t) => t.id);
      if (seen.current && sound && newTicketIds(seen.current, ids).length > 0) chime();
      seen.current = new Set(ids);
      setTickets(list);
      setServed((done.data.data as Ticket[]).slice(0, 12));
      setError(null);
      setLastSync(new Date());
    } catch (err: any) {
      setError(err.response?.data?.message || 'Cannot reach the server. Retrying…');
    }
  }, [stallId, isOwner, sound]);

  useEffect(() => {
    seen.current = null;
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
    return <div className="p-8 text-slate-600">Your account is not assigned to a stall. Ask the owner to assign one.</div>;
  }

  const columns: { key: 'new' | 'preparing' | 'ready'; title: string; tone: string }[] = [
    { key: 'new', title: 'New', tone: 'border-amber-400' },
    { key: 'preparing', title: 'Preparing', tone: 'border-sky-400' },
    { key: 'ready', title: 'Ready for pickup', tone: 'border-emerald-400' },
  ];
  const stallName = isOwner ? stalls.find((s) => s.id === stallId)?.name : user?.stall?.name;

  return (
    <div className="min-h-full bg-slate-950 text-slate-100 p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <ChefHat className="w-7 h-7 text-amber-400" />
          <div>
            <h2 className="text-xl font-extrabold">Kitchen Display {stallName ? `· ${stallName}` : ''}</h2>
            <p className="text-xs text-slate-400">
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
              className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm"
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
            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm font-semibold flex items-center"
          >
            <History className="w-4 h-4 mr-1" />
            {view === 'board' ? 'Ticket history' : 'Live board'}
          </button>
          <button onClick={() => load()} className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setSound((s) => !s)} className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700" title="New-ticket sound">
            {sound ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <button onClick={toggleFullscreen} className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700" title="Full screen">
            {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center space-x-2 bg-rose-900/60 border border-rose-700 text-rose-100 text-sm rounded-xl px-4 py-2">
          <AlertTriangle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {view === 'history' ? (
        <section className="bg-slate-900 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-sm text-slate-300">Date</label>
            <input type="date" max={isoDate()} value={historyDate} onChange={(e) => setHistoryDate(e.target.value)} className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-sm" />
            {history && <span className="text-xs text-slate-400">{history.length} ticket(s)</span>}
          </div>
          {history === null ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">No tickets for this stall on that date.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-400">
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
              <tbody className="divide-y divide-slate-800">
                {history.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2 font-mono text-xs">
                      {t.ticket_number}
                      <span className="block text-slate-500">{t.order?.order_number}</span>
                    </td>
                    <td className="py-2">{t.order?.table ? t.order.table.table_number : 'Takeaway'}</td>
                    <td className="py-2 text-xs">{(t.ticket_items || []).map((ti: any) => `${ti.quantity}× ${ti.order_item?.item_name}`).join(', ')}</td>
                    <td className="py-2 text-xs">{timeOnly(t.created_at)}</td>
                    <td className="py-2 text-xs">{timeOnly(t.ready_at)}</td>
                    <td className="py-2 text-xs">{timeOnly(t.picked_up_at)}</td>
                    <td className="py-2 text-xs font-semibold">{humanize(t.status)}</td>
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
            <section key={col.key} className="bg-slate-900 rounded-2xl p-3 space-y-3 min-h-[60vh]">
              <h3 className="font-bold text-sm uppercase tracking-wider text-slate-300 flex justify-between">
                <span>{col.title}</span>
                <span className="bg-slate-800 rounded-full px-2">{list.length}</span>
              </h3>
              {list.map((t) => {
                const u = urgency(t.created_at, now);
                const action = nextKitchenAction(t.status);
                return (
                  <article
                    key={t.id}
                    data-ticket={t.ticket_number}
                    className={`rounded-xl bg-slate-800 border-l-4 ${col.tone} p-3 space-y-2 ${u === 'late' ? 'ring-2 ring-rose-500' : u === 'warning' ? 'ring-1 ring-amber-500' : ''}`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-extrabold">{t.order?.table ? `Table ${t.order.table.table_number}` : 'Takeaway'}</div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          {t.ticket_number} · {t.order?.order_number}
                        </div>
                      </div>
                      <span className={`text-xs font-mono font-bold ${u === 'late' ? 'text-rose-400' : u === 'warning' ? 'text-amber-300' : 'text-slate-300'}`}>
                        {elapsed(t.created_at, now)}
                      </span>
                    </div>
                    <ul className="text-sm space-y-1">
                      {(t.ticket_items || []).map((ti) => (
                        <li key={ti.id}>
                          <span className="font-bold">{ti.quantity}×</span> {ti.order_item?.item_name}
                          {ti.order_item?.special_instructions && (
                            <div className="text-xs text-amber-300 italic">Note: {ti.order_item.special_instructions}</div>
                          )}
                        </li>
                      ))}
                    </ul>
                    {action ? (
                      <button
                        onClick={() => advance(t)}
                        disabled={busyId === t.id}
                        className="w-full py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm disabled:opacity-50"
                      >
                        {busyId === t.id ? 'Updating…' : action.label}
                      </button>
                    ) : (
                      <div className="text-center text-xs text-emerald-300 font-semibold">Waiting for pickup</div>
                    )}
                  </article>
                );
              })}
            </section>
          );
        })}
        <section className="bg-slate-900 rounded-2xl p-3 space-y-2 min-h-[60vh]">
          <h3 className="font-bold text-sm uppercase tracking-wider text-slate-300">Served (recent)</h3>
          {served.map((t) => (
            <div key={t.id} className="rounded-lg bg-slate-800/60 px-3 py-2 text-xs text-slate-400">
              <span className="font-mono">{t.ticket_number}</span> · {t.order?.table ? `Table ${t.order.table.table_number}` : 'Takeaway'}
            </div>
          ))}
        </section>
      </div>
      )}
    </div>
  );
};
