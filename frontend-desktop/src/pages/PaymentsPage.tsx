import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { PrintReceiptButton, ReceiptPreviewButton } from '../components/Receipt';
import { CreditCard } from 'lucide-react';

const METHODS = [
  { value: '', label: 'All methods' },
  { value: 'cash', label: 'Cash' },
  { value: 'upi_qr', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'split', label: 'Split' },
];

/** Payment history from GET /billing/payments (server data only) with receipt reprint. */
export const PaymentsPage: React.FC = () => {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/billing/payments', { params: { date, ...(method ? { payment_method: method } : {}), per_page: 200 } });
      setRows(res.data.data.data);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load payments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [date, method]);

  const total = rows.reduce((sum, p) => sum + Math.round(Number(p.amount) * 100), 0) / 100;

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-fg tracking-tight flex items-center space-x-2">
            <CreditCard className="w-5 h-5" />
            <span>Payment History</span>
          </h2>
          <p className="text-sm text-muted mt-1">Every recorded payment; reprint the customer receipt at any time</p>
        </div>
        <div className="flex items-center space-x-2">
          <input aria-label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="px-3 py-2 rounded-lg border border-line text-sm" />
          <select aria-label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)} className="px-3 py-2 rounded-lg border border-line text-sm">
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div role="alert" className="p-3 rounded-lg bg-danger/10 border border-danger/30 text-danger-fg text-sm">{error}</div>}

      <div className="bg-surface rounded-lg border border-line overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-xs uppercase text-muted">
            <tr>
              <th className="text-left px-3 py-1.5">Time</th>
              <th className="text-left px-3 py-1.5">Receipt</th>
              <th className="text-left px-3 py-1.5">Bill</th>
              <th className="text-left px-3 py-1.5">Table</th>
              <th className="text-left px-3 py-1.5">Method</th>
              <th className="text-right px-3 py-1.5">Amount</th>
              <th className="text-left px-3 py-1.5">Cashier</th>
              <th className="text-right px-3 py-1.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-2 text-muted whitespace-nowrap">{new Date(p.created_at).toLocaleTimeString()}</td>
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{p.payment_number}</td>
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{p.order?.order_number}</td>
                <td className="px-3 py-2">{p.order?.table?.table_number || 'Takeaway'}</td>
                <td className="px-3 py-2 uppercase text-xs font-bold">{p.payment_method}</td>
                <td className="px-3 py-2 text-right font-bold">₹{Number(p.amount).toFixed(2)}</td>
                <td className="px-3 py-2">{p.cashier?.name}</td>
                <td className="px-3 py-2 text-right space-x-3">
                  <ReceiptPreviewButton orderId={p.order_id} label="Preview" className="text-xs font-bold text-primary" />
                  <PrintReceiptButton orderId={p.order_id} label="Reprint" className="text-xs font-bold text-primary" />
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted">No payments for this filter.</td>
              </tr>
            )}
          </tbody>
          <tfoot className="bg-canvas font-bold">
            <tr>
              <td colSpan={5} className="px-3 py-1.5 text-right">{rows.length} payments</td>
              <td className="px-3 py-1.5 text-right">₹{total.toFixed(2)}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};
