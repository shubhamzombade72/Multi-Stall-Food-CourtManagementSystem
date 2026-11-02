import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { PrintReceiptButton } from '../components/Receipt';
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
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center space-x-2">
            <CreditCard className="w-6 h-6" />
            <span>Payment History</span>
          </h2>
          <p className="text-sm text-slate-500 mt-1">Every recorded payment; reprint the customer receipt at any time</p>
        </div>
        <div className="flex items-center space-x-2">
          <input aria-label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-200 text-sm" />
          <select aria-label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-200 text-sm">
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">{error}</div>}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="text-left px-4 py-3">Time</th>
              <th className="text-left px-4 py-3">Receipt</th>
              <th className="text-left px-4 py-3">Bill</th>
              <th className="text-left px-4 py-3">Table</th>
              <th className="text-left px-4 py-3">Method</th>
              <th className="text-right px-4 py-3">Amount</th>
              <th className="text-left px-4 py-3">Cashier</th>
              <th className="text-right px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2 text-slate-500">{new Date(p.created_at).toLocaleTimeString()}</td>
                <td className="px-4 py-2 font-mono text-xs">{p.payment_number}</td>
                <td className="px-4 py-2 font-mono text-xs">{p.order?.order_number}</td>
                <td className="px-4 py-2">{p.order?.table?.table_number || 'Takeaway'}</td>
                <td className="px-4 py-2 uppercase text-xs font-bold">{p.payment_method}</td>
                <td className="px-4 py-2 text-right font-bold">₹{Number(p.amount).toFixed(2)}</td>
                <td className="px-4 py-2">{p.cashier?.name}</td>
                <td className="px-4 py-2 text-right">
                  <PrintReceiptButton orderId={p.order_id} label="Reprint" className="text-xs font-bold text-brand-600" />
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">No payments for this filter.</td>
              </tr>
            )}
          </tbody>
          <tfoot className="bg-slate-50 font-bold">
            <tr>
              <td colSpan={5} className="px-4 py-3 text-right">{rows.length} payments</td>
              <td className="px-4 py-3 text-right">₹{total.toFixed(2)}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};
