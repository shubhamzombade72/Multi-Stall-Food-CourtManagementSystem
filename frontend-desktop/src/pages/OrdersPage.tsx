import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Eye, Search } from 'lucide-react';
import { apiClient } from '../api/client';
import { PrintReceiptButton, ReceiptPreviewButton } from '../components/Receipt';
import { taxLines } from '../lib/tax';
import { apiError, dateTime, humanize, isoDate, money } from '../lib/format';
import { Badge, buttonClass, Card, EmptyState, ErrorBanner, Field, inputClass, Loading, Modal, PageHeader, Pagination, statusTone, Tag } from '../components/ui';
import { statusChip } from '../lib/status';

const STATUSES = ['confirmed', 'partially_ready', 'ready', 'served', 'completed', 'cancelled'];
const CHANNELS = [
  ['cashier_pos', 'Cashier POS'],
  ['waiter_app', 'Waiter'],
  ['qr_customer', 'Customer QR'],
];

interface Filters {
  search: string;
  status: string;
  payment_status: string;
  order_channel: string;
  stall_id: string;
  date_from: string;
  date_to: string;
}

/** Order management: server-side search, filters and pagination; detail with tickets, payments and cancellation. */
export const OrdersPage: React.FC = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Filters>({ search: '', status: '', payment_status: '', order_channel: '', stall_id: '', date_from: isoDate(), date_to: isoDate() });
  const [applied, setApplied] = useState<Filters>(filters);
  const [orders, setOrders] = useState<any[] | null>(null);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ last_page: 1, total: 0 });
  const [stalls, setStalls] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [showCancel, setShowCancel] = useState(false);

  useEffect(() => {
    apiClient.get('/stalls').then((r) => setStalls(r.data.data)).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    try {
      const params = Object.fromEntries(Object.entries(applied).filter(([, v]) => v !== ''));
      const res = await apiClient.get('/orders', { params: { ...params, page, per_page: 25 } });
      setOrders(res.data.data.data);
      setMeta({ last_page: res.data.data.last_page, total: res.data.data.total });
      setError(null);
    } catch (err) {
      setError(apiError(err, 'Could not load orders'));
    }
  }, [applied, page]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (id: number) => {
    try {
      const res = await apiClient.get(`/orders/${id}`);
      setDetail(res.data.data);
      setShowCancel(false);
      setCancelReason('');
      setCancelError(null);
    } catch (err) {
      setError(apiError(err));
    }
  };

  const cancelOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await apiClient.post(`/orders/${detail.id}/cancel`, { reason: cancelReason.trim() });
      await Promise.all([openDetail(detail.id), load()]);
    } catch (err) {
      setCancelError(apiError(err));
    } finally {
      setCancelling(false);
    }
  };

  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const canCancel = detail && detail.status !== 'cancelled' && detail.payment_status !== 'paid' && !detail.kitchen_tickets?.some((t: any) => ['preparing', 'ready', 'picked_up'].includes(t.status));

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <PageHeader title="Orders & Receipts" icon={ClipboardList} subtitle="Parent orders from every channel with their stall kitchen tickets" />

      <Card className="p-4">
        <form
          className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setApplied(filters);
          }}
        >
          <div className="col-span-2">
            <Field label="Search">
              <div className="relative">
                <Search className="w-4 h-4 text-subtle absolute left-3 top-2.5" />
                <input aria-label="Search orders" placeholder="Order #, customer, phone" value={filters.search} onChange={set('search')} className={`${inputClass} pl-9`} />
              </div>
            </Field>
          </div>
          <Field label="Status">
            <select aria-label="Order status" value={filters.status} onChange={set('status')} className={inputClass}>
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Payment">
            <select aria-label="Payment status" value={filters.payment_status} onChange={set('payment_status')} className={inputClass}>
              <option value="">All</option>
              <option value="unpaid">Unpaid</option>
              <option value="paid">Paid</option>
            </select>
          </Field>
          <Field label="Channel">
            <select aria-label="Order channel" value={filters.order_channel} onChange={set('order_channel')} className={inputClass}>
              <option value="">All</option>
              {CHANNELS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Stall">
            <select aria-label="Stall" value={filters.stall_id} onChange={set('stall_id')} className={inputClass}>
              <option value="">All</option>
              {stalls.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="From">
            <input type="date" aria-label="From date" value={filters.date_from} onChange={set('date_from')} className={inputClass} />
          </Field>
          <Field label="To">
            <input type="date" aria-label="To date" value={filters.date_to} onChange={set('date_to')} className={inputClass} />
          </Field>
          <div className="col-span-2 md:col-span-4 xl:col-span-8 flex gap-2">
            <button type="submit" className={buttonClass.primary}>
              Apply filters
            </button>
            <button
              type="button"
              className={buttonClass.secondary}
              onClick={() => {
                const cleared = { search: '', status: '', payment_status: '', order_channel: '', stall_id: '', date_from: '', date_to: '' };
                setFilters(cleared);
                setApplied(cleared);
                setPage(1);
              }}
            >
              Clear
            </button>
          </div>
        </form>
      </Card>
      <ErrorBanner message={error} onRetry={load} />

      <Card className="overflow-hidden">
        {orders === null ? (
          <Loading />
        ) : orders.length === 0 ? (
          <EmptyState title="No orders match these filters" />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas text-muted text-xs uppercase tracking-wider">
              <tr>
                <th className="py-1.5 px-3">Order</th>
                <th className="py-1.5 px-3">Time</th>
                <th className="py-1.5 px-3">Table / Type</th>
                <th className="py-1.5 px-3">Customer</th>
                <th className="py-1.5 px-3">Channel</th>
                <th className="py-1.5 px-3">Stall tickets</th>
                <th className="py-1.5 px-3 text-right">Total</th>
                <th className="py-1.5 px-3">Status</th>
                <th className="py-1.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-surface-2">
                  <td className="py-1.5 px-3 font-mono font-semibold text-fg whitespace-nowrap">{o.order_number}</td>
                  <td className="py-1.5 px-3 text-xs text-muted whitespace-nowrap">{dateTime(o.created_at)}</td>
                  <td className="py-1.5 px-3">{o.table ? <span className="font-bold">{o.table.table_number}</span> : 'Takeaway'}</td>
                  <td className="py-1.5 px-3 text-xs">{o.customer_name || '—'}</td>
                  <td className="py-1.5 px-3">
                    <Tag>{CHANNELS.find(([v]) => v === o.order_channel)?.[1] || o.order_channel}</Tag>
                  </td>
                  <td className="py-1.5 px-3">
                    <div className="flex flex-wrap gap-1">
                      {o.kitchen_tickets?.map((t: any) => (
                        <span key={t.id} className={`text-[11px] px-2 py-0.5 rounded-md font-semibold whitespace-nowrap ${statusChip(t.status)}`}>
                          {t.stall?.code}: {humanize(t.status)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-1.5 px-3 font-bold text-right whitespace-nowrap">{money(o.total_amount)}</td>
                  <td className="py-1.5 px-3 space-y-1">
                    <Badge tone={statusTone(o.status)}>{humanize(o.status)}</Badge>{' '}
                    <Badge tone={statusTone(o.payment_status)}>{humanize(o.payment_status)}</Badge>
                  </td>
                  <td className="py-1.5 px-3 text-right">
                    <button onClick={() => openDetail(o.id)} aria-label={`Open ${o.order_number}`} className="p-1 rounded-lg border border-line hover:bg-surface-2 text-muted">
                      <Eye className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination page={page} lastPage={meta.last_page} total={meta.total} onPage={setPage} />
      </Card>

      {detail && (
        <Modal title={`Order ${detail.order_number}`} onClose={() => setDetail(null)} wide>
          <div className="grid grid-cols-4 gap-3 text-xs">
            <div className="bg-canvas rounded-lg p-2">
              <p className="text-muted">Created</p>
              <p className="font-semibold">{dateTime(detail.created_at)}</p>
            </div>
            <div className="bg-canvas rounded-lg p-2">
              <p className="text-muted">Table / type</p>
              <p className="font-semibold">{detail.table ? detail.table.table_number : 'Takeaway'}</p>
            </div>
            <div className="bg-canvas rounded-lg p-2">
              <p className="text-muted">Customer</p>
              <p className="font-semibold">{detail.customer_name || '—'} {detail.customer_phone ? `· ${detail.customer_phone}` : ''}</p>
            </div>
            <div className="bg-canvas rounded-lg p-2">
              <p className="text-muted">Staff</p>
              <p className="font-semibold">{detail.waiter?.name || detail.cashier?.name || '—'}</p>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-bold text-muted uppercase">Stall kitchen tickets</h4>
            {detail.kitchen_tickets?.map((t: any) => (
              <div key={t.id} className="p-3 bg-canvas rounded-lg border border-line text-xs flex justify-between items-start gap-2">
                <div>
                  <span className="font-bold text-fg block">{t.stall?.name}</span>
                  <span className="text-muted font-mono">{t.ticket_number}</span>
                  <span className="text-muted block">{t.ticket_items?.map((ti: any) => `${ti.quantity}× ${ti.order_item?.item_name}`).join(', ')}</span>
                </div>
                <Badge tone={statusTone(t.status)}>{humanize(t.status)}</Badge>
              </div>
            ))}
          </div>

          <div className="bg-canvas p-4 rounded-lg space-y-1 text-sm">
            {taxLines(detail).map((line) => (
              <div key={line.label} data-testid="order-tax-line" className="flex justify-between">
                <span>{line.label}</span>
                <span>{money(line.value)}</span>
              </div>
            ))}
            <div className="flex justify-between font-bold border-t border-line pt-1">
              <span>Total</span>
              <span>{money(detail.total_amount)}</span>
            </div>
            {detail.payments?.map((p: any) => (
              <div key={p.id} className="flex justify-between text-xs text-success-fg">
                <span>
                  Paid {humanize(p.payment_method)} · {p.payment_number} · {p.cashier?.name}
                </span>
                <span>{money(p.amount)}</span>
              </div>
            ))}
          </div>
          {detail.notes && <p className="text-xs whitespace-pre-line bg-warning/10 border border-warning/40 rounded-lg p-2">{detail.notes}</p>}

          <div className="flex flex-wrap gap-2">
            <ReceiptPreviewButton orderId={detail.id} className={buttonClass.secondary} label="Preview" />
            <PrintReceiptButton orderId={detail.id} className={buttonClass.secondary} label={detail.payment_status === 'paid' ? 'Print receipt' : 'Print bill'} />
            {detail.payment_status === 'unpaid' && detail.status !== 'cancelled' && (
              <button onClick={() => navigate('/pos')} className={buttonClass.primary}>
                Settle at POS
              </button>
            )}
            {canCancel && !showCancel && (
              <button onClick={() => setShowCancel(true)} className={buttonClass.danger}>
                Cancel order
              </button>
            )}
          </div>
          {showCancel && (
            <form onSubmit={cancelOrder} className="border border-danger/30 bg-danger/10 rounded-lg p-3 space-y-2">
              <Field label="Reason for cancellation (recorded in the audit log)">
                <input required minLength={3} maxLength={255} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className={inputClass} />
              </Field>
              {cancelError && <p className="text-xs text-danger-fg">{cancelError}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={cancelling} className={buttonClass.danger}>
                  {cancelling ? 'Cancelling…' : 'Confirm cancellation'}
                </button>
                <button type="button" onClick={() => setShowCancel(false)} className={buttonClass.secondary}>
                  Keep order
                </button>
              </div>
            </form>
          )}
          {detail.status !== 'cancelled' && detail.payment_status !== 'paid' && !canCancel && (
            <p className="text-xs text-muted">This order can no longer be cancelled: a kitchen has started preparing it.</p>
          )}
        </Modal>
      )}
    </div>
  );
};
