import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, CheckCircle2, ConciergeBell, Minus, Plus, Search, ShoppingBag, Trash2 } from 'lucide-react';
import { apiClient } from '../api/client';
import { apiError, humanize, money, timeOnly } from '../lib/format';
import { Badge, buttonClass, Card, EmptyState, ErrorBanner, inputClass, Loading, PageHeader, statusTone, SuccessBanner } from '../components/ui';

interface MenuItem {
  id: number;
  name: string;
  price: string;
  is_available: boolean;
  stall: { id: number; name: string };
  category?: { id: number; name: string } | null;
}

interface TableRow {
  id: number;
  table_number: string;
  section: string;
  capacity: number;
  status: string;
  orders: { id: number; order_number: string; status: string; total_amount: string; payment_status: string }[];
}

type Tab = 'tables' | 'order' | 'ready';

const newKey = () => `waiter_desk_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

/**
 * Desktop waiter station: floor view, multi-stall order entry and the ready-for-pickup list with serve
 * confirmation. Works without the Android app; the server assigns the waiter and the waiter_app channel.
 */
export const WaiterPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('tables');
  const [tables, setTables] = useState<TableRow[] | null>(null);
  const [ready, setReady] = useState<any[] | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // order builder
  const [tableId, setTableId] = useState<number | ''>('');
  const [orderType, setOrderType] = useState<'dine_in' | 'takeaway'>('dine_in');
  const [cart, setCart] = useState<Record<number, number>>({});
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKey = useRef(newKey());
  const [serving, setServing] = useState<number | null>(null);

  const loadFloor = useCallback(async () => {
    try {
      const [t, r] = await Promise.all([apiClient.get('/waiter/tables'), apiClient.get('/waiter/ready-tickets')]);
      setTables(t.data.data);
      setReady(r.data.data);
      setError(null);
    } catch (err) {
      setError(apiError(err, 'Could not load tables'));
    }
  }, []);

  useEffect(() => {
    loadFloor();
    const t = setInterval(loadFloor, 5000);
    return () => clearInterval(t);
  }, [loadFloor]);

  useEffect(() => {
    apiClient
      .get('/menu', { params: { available_only: 1 } })
      .then((r) => setMenu(r.data.data))
      .catch((err) => setError(apiError(err, 'Could not load the menu')));
  }, []);

  const filteredMenu = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = menu.filter((m) => !q || m.name.toLowerCase().includes(q) || m.stall.name.toLowerCase().includes(q) || (m.category?.name || '').toLowerCase().includes(q));
    const byStall: Record<string, MenuItem[]> = {};
    items.forEach((m) => (byStall[m.stall.name] ||= []).push(m));
    return byStall;
  }, [menu, search]);

  const cartLines = Object.entries(cart)
    .map(([id, qty]) => ({ item: menu.find((m) => m.id === Number(id)), qty }))
    .filter((l): l is { item: MenuItem; qty: number } => !!l.item && l.qty > 0);
  // Display estimate only; the server prices the order and adds tax
  const estimate = cartLines.reduce((sum, l) => sum + Number(l.item.price) * l.qty, 0);

  const changeQty = (id: number, delta: number) =>
    setCart((c) => {
      const next = Math.max(0, (c[id] || 0) + delta);
      const copy = { ...c };
      if (next === 0) delete copy[id];
      else copy[id] = next;
      return copy;
    });

  const startOrderFor = (t: TableRow) => {
    setOrderType('dine_in');
    setTableId(t.id);
    setTab('order');
  };

  const submit = async () => {
    if (cartLines.length === 0 || submitting) return;
    if (orderType === 'dine_in' && !tableId) {
      setError('Select a table for a dine-in order.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiClient.post('/orders', {
        order_type: orderType,
        table_id: orderType === 'dine_in' ? tableId : null,
        notes: notes.trim() || null,
        idempotency_key: idempotencyKey.current,
        items: cartLines.map((l) => ({ menu_item_id: l.item.id, quantity: l.qty })),
      });
      const o = res.data.data;
      setSuccess(`Order ${o.order_number} sent to ${o.kitchen_tickets?.length ?? 0} kitchen(s). Total ${money(o.total_amount)}.`);
      setCart({});
      setNotes('');
      idempotencyKey.current = newKey();
      setTab('tables');
      loadFloor();
    } catch (err) {
      // Same idempotency key is kept so a retry cannot create a second order
      setError(apiError(err, 'Order could not be sent. Retry is safe.'));
    } finally {
      setSubmitting(false);
    }
  };

  const serve = async (ticketId: number) => {
    setServing(ticketId);
    try {
      await apiClient.post(`/waiter/tickets/${ticketId}/served`);
      await loadFloor();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setServing(null);
    }
  };

  const tabBtn = (t: Tab, label: React.ReactNode) => (
    <button
      onClick={() => setTab(t)}
      className={`px-4 py-2 rounded-lg text-sm font-semibold ${tab === t ? 'bg-primary text-primary-fg' : 'bg-surface border border-line text-muted'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <PageHeader title="Waiter Station" icon={ConciergeBell} subtitle="Take table orders, watch kitchen progress and confirm serving." />
      <div className="flex gap-2">
        {tabBtn('tables', 'Tables')}
        {tabBtn('order', `New Order${cartLines.length ? ` (${cartLines.length})` : ''}`)}
        {tabBtn(
          'ready',
          <span className="flex items-center">
            <BellRing className="w-4 h-4 mr-1" /> Ready to Serve {ready && ready.length > 0 && <span className="ml-1 px-1.5 rounded-full bg-success-fg text-surface text-xs">{ready.length}</span>}
          </span>,
        )}
      </div>
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      {tab === 'tables' &&
        (tables === null ? (
          <Loading />
        ) : tables.length === 0 ? (
          <Card>
            <EmptyState title="No active tables" />
          </Card>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
            {tables.map((t) => (
              <Card key={t.id} className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-lg">{t.table_number}</span>
                  <Badge tone={statusTone(t.status)}>{humanize(t.status)}</Badge>
                </div>
                <p className="text-xs text-muted">
                  {t.section} · seats {t.capacity}
                </p>
                {t.orders.map((o) => (
                  <div key={o.id} className="text-xs bg-canvas rounded-lg p-2">
                    <p className="font-mono font-semibold">{o.order_number}</p>
                    <p className="text-muted">
                      {humanize(o.status)} · {money(o.total_amount)}
                    </p>
                  </div>
                ))}
                <button onClick={() => startOrderFor(t)} className="w-full text-xs font-bold py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/15">
                  {t.orders.length ? 'Add order' : 'Take order'}
                </button>
              </Card>
            ))}
          </div>
        ))}

      {tab === 'order' && (
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 space-y-4">
            <div className="relative">
              <Search className="w-4 h-4 text-subtle absolute left-3 top-2.5" />
              <input aria-label="Search menu" placeholder="Search dish, stall or category" value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputClass} pl-9`} />
            </div>
            {Object.keys(filteredMenu).length === 0 ? (
              <Card>
                <EmptyState title="No dishes match" />
              </Card>
            ) : (
              Object.entries(filteredMenu).map(([stall, items]) => (
                <div key={stall} className="space-y-2">
                  <h3 className="text-sm font-bold text-muted uppercase tracking-wider">{stall}</h3>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    {items.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => changeQty(m.id, 1)}
                        data-menu-item={m.name}
                        className="text-left bg-surface border border-line rounded-lg p-3 hover:border-primary/60 hover:shadow-sm"
                      >
                        <p className="font-semibold text-sm text-fg">{m.name}</p>
                        <p className="text-xs text-muted">{m.category?.name}</p>
                        <p className="text-sm font-bold text-primary mt-1">{money(m.price)}</p>
                        {cart[m.id] ? <span className="text-xs font-bold text-success-fg">In order: {cart[m.id]}</span> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          <Card className="p-4 space-y-3 h-fit sticky top-4">
            <h3 className="font-semibold text-base flex items-center">
              <ShoppingBag className="w-4 h-4 mr-1" /> Order
            </h3>
            <div className="flex gap-2">
              {(['dine_in', 'takeaway'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setOrderType(t)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold ${orderType === t ? 'bg-primary text-primary-fg' : 'border border-line'}`}
                >
                  {humanize(t)}
                </button>
              ))}
            </div>
            {orderType === 'dine_in' && (
              <select aria-label="Table" value={tableId} onChange={(e) => setTableId(e.target.value ? Number(e.target.value) : '')} className={inputClass}>
                <option value="">Select table…</option>
                {(tables || []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.table_number} · {t.section} ({humanize(t.status)})
                  </option>
                ))}
              </select>
            )}
            {cartLines.length === 0 ? (
              <p className="text-xs text-muted py-4 text-center">Tap dishes to add them.</p>
            ) : (
              <ul className="divide-y divide-line">
                {cartLines.map((l) => (
                  <li key={l.item.id} className="py-2 flex items-center justify-between text-sm">
                    <span className="flex-1 min-w-0">
                      <span className="block truncate font-medium">{l.item.name}</span>
                      <span className="text-xs text-muted">{l.item.stall.name}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <button aria-label={`Less ${l.item.name}`} onClick={() => changeQty(l.item.id, -1)} className="p-1 rounded border border-line">
                        {l.qty === 1 ? <Trash2 className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                      </button>
                      <span className="w-6 text-center font-bold">{l.qty}</span>
                      <button aria-label={`More ${l.item.name}`} onClick={() => changeQty(l.item.id, 1)} className="p-1 rounded border border-line">
                        <Plus className="w-3 h-3" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <textarea aria-label="Order notes" rows={2} maxLength={500} placeholder="Notes for the kitchen (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
            <div className="flex justify-between text-sm">
              <span className="text-muted">Items (before tax)</span>
              <span className="font-bold">{money(estimate)}</span>
            </div>
            <p className="text-[11px] text-muted">Final total with tax is calculated by the server.</p>
            <button onClick={submit} disabled={submitting || cartLines.length === 0} className={`${buttonClass.primary} w-full justify-center`}>
              {submitting ? 'Sending…' : 'Send to kitchens'}
            </button>
          </Card>
        </div>
      )}

      {tab === 'ready' &&
        (ready === null ? (
          <Loading />
        ) : ready.length === 0 ? (
          <Card>
            <EmptyState title="Nothing waiting for pickup" hint="Dishes appear here as soon as a kitchen marks them ready." />
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {ready.map((t) => (
              <Card key={t.id} className="p-4 space-y-2 border-success/40" >
                <div className="flex items-center justify-between">
                  <span className="font-bold">{t.order?.table ? `Table ${t.order.table.table_number}` : 'Takeaway'}</span>
                  <span className="text-xs text-muted">ready {timeOnly(t.ready_at)}</span>
                </div>
                <p className="text-xs text-muted">
                  {t.stall?.name} · {t.ticket_number} · {t.order?.order_number}
                </p>
                <ul className="text-sm">
                  {t.ticket_items?.map((ti: any) => (
                    <li key={ti.id}>
                      {ti.quantity}× {ti.order_item?.item_name}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => serve(t.id)}
                  disabled={serving === t.id}
                  data-serve-ticket={t.ticket_number}
                  className="w-full py-2 rounded-lg bg-success-fg hover:opacity-90 text-surface text-sm font-bold flex items-center justify-center disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4 mr-1" />
                  {serving === t.id ? 'Saving…' : 'Mark Served'}
                </button>
              </Card>
            ))}
          </div>
        ))}
    </div>
  );
};
