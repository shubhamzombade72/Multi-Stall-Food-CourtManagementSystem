import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../../api/client';
import { Receipt, Search } from 'lucide-react';
import { formatRupees } from '../../lib/payout';
import { Loading, EmptyState, ErrorBanner, inputClass } from '../ui';

export interface StallBillItem {
  id: number;
  item_name: string;
  quantity: number;
  unit_price: string;
  subtotal: string;
}

export interface StallBill {
  order_id: number;
  order_number: string;
  created_at: string;
  table_number?: string;
  order_type: string;
  order_channel: string;
  stall_id: number;
  stall_name: string;
  stall_code: string;
  items: StallBillItem[];
  stall_subtotal: string;
  order_total_amount: string;
  payment_method: string;
  payment_status: string;
}

interface StallBillsReviewProps {
  date: string;
  stallId?: number;
  stallName?: string;
  compact?: boolean;
  onSettleStall?: (stallId: number) => void;
  stallsList?: { id: number; name: string }[];
}

export const StallBillsReview: React.FC<StallBillsReviewProps> = ({
  date,
  stallId,
  stallName,
  compact = false,
  onSettleStall,
  stallsList = [],
}) => {
  const [bills, setBills] = useState<StallBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedStallId, setSelectedStallId] = useState<number | ''>(stallId || '');
  const [selectedMethod, setSelectedMethod] = useState('');

  const loadBills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const activeStallId = stallId || (selectedStallId ? Number(selectedStallId) : undefined);
      const res = await apiClient.get('/settlements/stall-bills', {
        params: {
          date,
          stall_id: activeStallId,
        },
      });
      if (res.data.success) {
        setBills(res.data.data.bills || []);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not load stall bills.');
    } finally {
      setLoading(false);
    }
  }, [date, stallId, selectedStallId]);

  useEffect(() => {
    loadBills();
  }, [loadBills]);

  const filteredBills = bills.filter((b) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchOrder = b.order_number.toLowerCase().includes(q);
      const matchStall = b.stall_name.toLowerCase().includes(q);
      const matchItems = b.items.some((i) => i.item_name.toLowerCase().includes(q));
      if (!matchOrder && !matchStall && !matchItems) return false;
    }
    if (selectedMethod && b.payment_method !== selectedMethod) {
      return false;
    }
    return true;
  });

  const totalFilteredSales = filteredBills.reduce((sum, b) => sum + Number(b.stall_subtotal || 0), 0);

  if (compact) {
    return (
      <div className="space-y-3 p-3 bg-surface-2 rounded-lg border border-line text-xs" data-testid={`stall-bills-compact-${stallId}`}>
        <div className="flex items-center justify-between">
          <span className="font-bold text-fg flex items-center gap-1.5">
            <Receipt className="w-3.5 h-3.5 text-primary" />
            <span>Paid Bills for {stallName || 'Stall'} ({bills.length} bills)</span>
          </span>
          <span className="font-extrabold text-primary">{formatRupees(totalFilteredSales)}</span>
        </div>

        {loading ? (
          <div className="py-4 text-center text-muted">Loading bills…</div>
        ) : error ? (
          <div className="text-danger-fg">{error}</div>
        ) : bills.length === 0 ? (
          <div className="text-muted italic py-2">No paid bills recorded for this stall on this date.</div>
        ) : (
          <div className="overflow-x-auto max-h-60 overflow-y-auto">
            <table className="w-full text-left">
              <thead className="bg-canvas text-muted uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="py-1 px-2">Order #</th>
                  <th className="py-1 px-2">Time</th>
                  <th className="py-1 px-2">Table / Type</th>
                  <th className="py-1 px-2">Dishes Ordered</th>
                  <th className="py-1 px-2 text-right">Stall Subtotal</th>
                  <th className="py-1 px-2 text-right">Method</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {bills.map((b) => (
                  <tr key={`${b.order_id}-${b.stall_id}`} className="hover:bg-surface transition">
                    <td className="py-1.5 px-2 font-mono font-bold text-fg">{b.order_number}</td>
                    <td className="py-1.5 px-2 text-muted">{new Date(b.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="py-1.5 px-2 text-fg">
                      {b.table_number ? `Table ${b.table_number}` : b.order_type === 'takeaway' ? 'Takeaway' : b.order_type}
                    </td>
                    <td className="py-1.5 px-2 text-fg">
                      {b.items.map((i) => `${i.quantity}x ${i.item_name}`).join(', ')}
                    </td>
                    <td className="py-1.5 px-2 text-right font-bold text-primary">{formatRupees(b.stall_subtotal)}</td>
                    <td className="py-1.5 px-2 text-right uppercase text-[10px] font-semibold text-muted">{b.payment_method}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="all-stall-bills-tab">
      {/* Filters and search bar */}
      <div className="bg-surface p-4 rounded-lg border border-line shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-primary" />
            <h3 className="font-bold text-base text-fg">Consolidated Stall Bills Review</h3>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="bg-canvas border border-line px-2.5 py-1.5 rounded-lg text-muted">
              Total Bills: <strong className="text-fg">{filteredBills.length}</strong>
            </span>
            <span className="bg-canvas border border-line px-2.5 py-1.5 rounded-lg text-muted">
              Total Stall Sales: <strong className="text-primary font-extrabold">{formatRupees(totalFilteredSales)}</strong>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted" />
            <input
              type="text"
              placeholder="Search by Order #, stall or dish name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`${inputClass} pl-9`}
              aria-label="Search stall bills"
            />
          </div>

          {!stallId && stallsList.length > 0 && (
            <div>
              <select
                value={selectedStallId}
                onChange={(e) => setSelectedStallId(e.target.value ? Number(e.target.value) : '')}
                className={inputClass}
                aria-label="Filter by stall"
              >
                <option value="">All Stalls</option>
                {stallsList.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <select
              value={selectedMethod}
              onChange={(e) => setSelectedMethod(e.target.value)}
              className={inputClass}
              aria-label="Filter by payment method"
            >
              <option value="">All Payment Methods</option>
              <option value="cash">Cash</option>
              <option value="upi_qr">UPI / QR</option>
              <option value="card">Card</option>
              <option value="split">Split Bill</option>
            </select>
          </div>
        </div>
      </div>

      <ErrorBanner message={error} onRetry={loadBills} />

      {loading ? (
        <Loading label="Loading stall bills…" />
      ) : filteredBills.length === 0 ? (
        <EmptyState
          title="No Stall Bills Found"
          hint={search || selectedMethod || selectedStallId ? "No bills match the current filters." : "No paid orders found for any stall on this business date."}
        />
      ) : (
        <div className="bg-surface rounded-lg border border-line overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="stall-bills-table">
              <thead className="bg-canvas text-muted text-xs uppercase tracking-wider">
                <tr>
                  <th className="py-2.5 px-3">Order #</th>
                  <th className="py-2.5 px-3">Stall</th>
                  <th className="py-2.5 px-3">Time</th>
                  <th className="py-2.5 px-3">Table / Channel</th>
                  <th className="py-2.5 px-3">Dishes & Items</th>
                  <th className="py-2.5 px-3 text-right">Stall Bill Subtotal</th>
                  <th className="py-2.5 px-3 text-right">Customer Bill Total</th>
                  <th className="py-2.5 px-3">Payment Method</th>
                  {onSettleStall && <th className="py-2.5 px-3 text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredBills.map((b) => (
                  <tr key={`${b.order_id}-${b.stall_id}`} className="hover:bg-surface-2 transition">
                    <td className="py-2.5 px-3 font-mono font-bold text-fg">
                      {b.order_number}
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-fg">
                      <div>{b.stall_name}</div>
                      <span className="text-[10px] font-normal text-muted">{b.stall_code}</span>
                    </td>
                    <td className="py-2.5 px-3 text-muted text-xs whitespace-nowrap">
                      {new Date(b.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-2.5 px-3 text-fg text-xs">
                      {b.table_number ? (
                        <span className="inline-block px-2 py-0.5 rounded bg-surface border border-line font-medium">
                          Table {b.table_number}
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded bg-surface border border-line font-medium capitalize">
                          {b.order_type}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-fg text-xs">
                      <div className="flex flex-wrap gap-1">
                        {b.items.map((i) => (
                          <span key={i.id} className="bg-surface border border-line px-1.5 py-0.5 rounded text-[11px]">
                            <strong>{i.quantity}×</strong> {i.item_name} <span className="text-muted">({formatRupees(i.subtotal)})</span>
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-extrabold text-primary">
                      {formatRupees(b.stall_subtotal)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-muted text-xs">
                      {formatRupees(b.order_total_amount)}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-canvas border border-line text-muted">
                        {b.payment_method}
                      </span>
                    </td>
                    {onSettleStall && (
                      <td className="py-2.5 px-3 text-right">
                        <button
                          onClick={() => onSettleStall(b.stall_id)}
                          className="px-2.5 py-1 text-xs font-semibold rounded bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 transition"
                        >
                          Settle Stall
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
