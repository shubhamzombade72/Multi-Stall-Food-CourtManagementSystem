import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { CheckCircle2, Store, Lock } from 'lucide-react';
import { statusChip } from '../lib/status';

export const SettlementsPage: React.FC = () => {
  const [data, setData] = useState<any | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);
  const [repName, setRepName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [amountPaid, setAmountPaid] = useState('');
  const [notes, setNotes] = useState('');

  const fetchSummary = async () => {
    try {
      const res = await apiClient.get('/settlements/daily-summary');
      if (res.data.success) {
        setData(res.data.data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  const handleCloseDay = async () => {
    // Closing does NOT lock the day: payments taken afterwards are accepted but not in this closing (OPEN-01, owner decision)
    if (!confirm('Execute End-of-Day closing for today? This records the day\'s totals and stall settlement registers. Payments taken after closing will not be included in it.')) {
      return;
    }

    try {
      const res = await apiClient.post('/settlements/close-day', {
        date: data?.date || new Date().toISOString().slice(0, 10),
        notes: 'End of Day formal operational closure by Owner',
      });
      if (res.data.success) {
        alert('End of Day Closing complete! Stall settlement registers generated.');
        fetchSummary();
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to execute EOD closing');
    }
  };

  const handlePaySettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecord) return;

    try {
      const res = await apiClient.post(`/settlements/${selectedRecord.id}/pay`, {
        amount_paid: amountPaid,
        paid_to_representative: repName,
        payment_method: paymentMethod,
        notes,
      });

      if (res.data.success) {
        setSelectedRecord(null);
        setRepName('');
        setAmountPaid('');
        setNotes('');
        fetchSummary();
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to record settlement payment');
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-fg tracking-tight">End-of-Day Closing & Stall Settlements</h2>
          <p className="text-sm text-muted mt-1">Audit daily consolidated revenue and record payouts to stall operators</p>
        </div>

        <div>
          {data?.is_closed ? (
            <span className="px-4 py-2 bg-st-served-soft text-st-served-fg font-bold text-sm rounded-lg flex items-center space-x-1.5">
              <CheckCircle2 className="w-4 h-4" />
              <span>Day Closed Successfully</span>
            </span>
          ) : (
            <button
              onClick={handleCloseDay}
              className="px-3 py-1.5 bg-primary hover:opacity-90 text-primary-fg font-bold text-sm rounded-lg shadow-md transition flex items-center space-x-2"
            >
              <Lock className="w-4 h-4" />
              <span>Execute End-of-Day Closing</span>
            </button>
          )}
        </div>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-surface p-4 rounded-lg border border-line shadow-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Gross Sales</span>
          <div className="text-xl font-extrabold text-fg mt-1">₹{data?.summary?.gross_sales || '0.00'}</div>
          <span className="text-xs text-muted mt-1 block">{data?.summary?.total_orders || 0} orders placed</span>
        </div>

        <div className="bg-surface p-4 rounded-lg border border-line shadow-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Net Central Revenue</span>
          <div className="text-xl font-extrabold text-primary mt-1">₹{data?.summary?.net_sales || '0.00'}</div>
          <span className="text-xs text-muted mt-1 block">Includes 5% GST</span>
        </div>

        <div className="bg-surface p-4 rounded-lg border border-line shadow-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Cash in Cashier Drawer</span>
          <div className="text-xl font-extrabold text-success-fg mt-1">₹{data?.summary?.cash_collected || '0.00'}</div>
          <span className="text-xs text-success-fg mt-1 block font-medium">Physical cash collected</span>
        </div>

        <div className="bg-surface p-4 rounded-lg border border-line shadow-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Digital / UPI Collections</span>
          <div className="text-xl font-extrabold text-info-fg mt-1">₹{data?.summary?.digital_collected || '0.00'}</div>
          <span className="text-xs text-info-fg mt-1 block font-medium">Bank account settlements</span>
        </div>
      </div>

      {/* Stall Settlements Table */}
      <div className="bg-surface rounded-lg border border-line overflow-hidden shadow-sm">
        <div className="p-4 border-b border-line flex items-center justify-between">
          <h3 className="font-semibold text-base text-fg">Stall Settlement Ledger</h3>
          <span className="text-xs text-muted font-mono">Date: {data?.date}</span>
        </div>

        <table className="w-full text-left text-sm">
          <thead className="bg-canvas text-muted text-xs uppercase tracking-wider">
            <tr>
              <th className="py-2 px-3">Stall Name</th>
              <th className="py-2 px-3">Dishes Sold</th>
              <th className="py-2 px-3">Stall Gross Sales</th>
              <th className="py-2 px-3">Amount Paid</th>
              <th className="py-2 px-3">Payment Status</th>
              <th className="py-2 px-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data?.closing?.settlements && data.closing.settlements.length > 0 ? (
              data.closing.settlements.map((record: any) => (
                <tr key={record.id} className="hover:bg-surface-2 transition">
                  <td className="py-2 px-3 font-bold text-fg">
                    <span className="inline-flex items-center space-x-2">
                      <Store className="w-4 h-4 text-primary" />
                      <span>{record.stall?.name}</span>
                    </span>
                  </td>
                  <td className="py-2 px-3 text-fg font-medium">{record.stall_item_count} items</td>
                  <td className="py-2 px-3 font-bold text-fg">₹{Number(record.stall_gross_sales).toFixed(2)}</td>
                  <td className="py-2 px-3 font-extrabold text-primary text-base">
                    {record.settlement_status === 'paid' ? `₹${Number(record.settlement_amount).toFixed(2)}` : '—'}
                  </td>
                  <td className="py-2 px-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-bold ${statusChip(record.settlement_status === 'paid' ? 'paid' : 'pending')}`}
                    >
                      {record.settlement_status === 'paid' ? 'Paid to Stall' : 'Pending Settlement'}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right">
                    {record.settlement_status === 'paid' ? (
                      <span className="text-xs text-muted block">
                        Paid to {record.paid_to_representative}
                      </span>
                    ) : (
                      <button
                        onClick={() => setSelectedRecord(record)}
                        className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-fg font-bold text-xs transition"
                      >
                        Record Payout
                      </button>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="py-8 text-center text-muted text-sm">
                  {data?.is_closed
                    ? 'No settlement records found.'
                    : 'Execute End-of-Day closing above to generate settlement records for today.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Record Payout Modal */}
      {selectedRecord && (
        <div className="fixed inset-0 !m-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <form onSubmit={handlePaySettlement} className="bg-surface rounded-lg max-w-md w-full p-4 shadow-2xl space-y-4">
            <h3 className="font-semibold text-base text-fg">Record Payout to {selectedRecord.stall?.name}</h3>
            <div className="bg-canvas p-3 rounded-lg flex justify-between items-center text-xs font-mono">
              <span>Stall Gross Sales (reference only):</span>
              <span className="text-xl font-black text-fg">₹{Number(selectedRecord.stall_gross_sales).toFixed(2)}</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-fg mb-1">Amount Paid to Stall (₹):</label>
              <input
                type="number"
                required
                min="0"
                step="0.01"
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
                placeholder="Enter the amount actually handed over"
                className="w-full px-3 py-2 rounded-lg border border-line text-sm font-semibold"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-fg mb-1">
                Representative / Stall Manager Name:
              </label>
              <input
                type="text"
                required
                value={repName}
                onChange={(e) => setRepName(e.target.value)}
                placeholder="e.g. Marco / Vikram / Pooja"
                className="w-full px-3 py-2 rounded-lg border border-line text-sm font-semibold"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-fg mb-1">Payment Method</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-line text-sm font-medium"
              >
                <option value="cash">Cash Handover</option>
                <option value="bank_transfer">Direct Bank Transfer (NEFT/IMPS)</option>
                <option value="upi">Business UPI</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-fg mb-1">Notes / Transaction Reference</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes or bank reference number..."
                rows={2}
                className="w-full px-3 py-2 rounded-lg border border-line text-sm"
              />
            </div>

            <div className="flex space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="flex-1 py-2 text-xs font-bold text-muted rounded-lg border border-line"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2 text-xs font-bold text-surface bg-success-fg hover:opacity-90 rounded-lg shadow-md"
              >
                Confirm Settlement
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
