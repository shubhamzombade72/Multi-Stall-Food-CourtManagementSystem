import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { CheckCircle2, Store, Lock } from 'lucide-react';

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
    if (!confirm('Execute formal End-of-Day closing for today? This will lock day transactions and generate stall settlement registers.')) {
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
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">End-of-Day Closing & Stall Settlements</h2>
          <p className="text-sm text-slate-500 mt-1">Audit daily consolidated revenue and record payouts to stall operators</p>
        </div>

        <div>
          {data?.is_closed ? (
            <span className="px-4 py-2 bg-emerald-100 text-emerald-800 font-bold text-sm rounded-xl flex items-center space-x-1.5">
              <CheckCircle2 className="w-4 h-4" />
              <span>Day Closed Successfully</span>
            </span>
          ) : (
            <button
              onClick={handleCloseDay}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm rounded-xl shadow-md transition flex items-center space-x-2"
            >
              <Lock className="w-4 h-4" />
              <span>Execute End-of-Day Closing</span>
            </button>
          )}
        </div>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Gross Sales</span>
          <div className="text-2xl font-extrabold text-slate-900 mt-1">₹{data?.summary?.gross_sales || '0.00'}</div>
          <span className="text-xs text-slate-400 mt-1 block">{data?.summary?.total_orders || 0} orders placed</span>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Net Central Revenue</span>
          <div className="text-2xl font-extrabold text-brand-600 mt-1">₹{data?.summary?.net_sales || '0.00'}</div>
          <span className="text-xs text-slate-400 mt-1 block">Includes 5% GST</span>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Cash in Cashier Drawer</span>
          <div className="text-2xl font-extrabold text-emerald-600 mt-1">₹{data?.summary?.cash_collected || '0.00'}</div>
          <span className="text-xs text-emerald-600 mt-1 block font-medium">Physical cash collected</span>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Digital / UPI Collections</span>
          <div className="text-2xl font-extrabold text-blue-600 mt-1">₹{data?.summary?.digital_collected || '0.00'}</div>
          <span className="text-xs text-blue-600 mt-1 block font-medium">Bank account settlements</span>
        </div>
      </div>

      {/* Stall Settlements Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-slate-900 text-lg">Stall Settlement Ledger</h3>
          <span className="text-xs text-slate-400 font-mono">Date: {data?.date}</span>
        </div>

        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="py-3 px-6">Stall Name</th>
              <th className="py-3 px-6">Dishes Sold</th>
              <th className="py-3 px-6">Stall Gross Sales</th>
              <th className="py-3 px-6">Amount Paid</th>
              <th className="py-3 px-6">Payment Status</th>
              <th className="py-3 px-6 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data?.closing?.settlements && data.closing.settlements.length > 0 ? (
              data.closing.settlements.map((record: any) => (
                <tr key={record.id} className="hover:bg-slate-50 transition">
                  <td className="py-4 px-6 font-bold text-slate-900 flex items-center space-x-2">
                    <Store className="w-4 h-4 text-brand-600" />
                    <span>{record.stall?.name}</span>
                  </td>
                  <td className="py-4 px-6 text-slate-700 font-medium">{record.stall_item_count} items</td>
                  <td className="py-4 px-6 font-bold text-slate-900">₹{Number(record.stall_gross_sales).toFixed(2)}</td>
                  <td className="py-4 px-6 font-extrabold text-brand-600 text-base">
                    {record.settlement_status === 'paid' ? `₹${Number(record.settlement_amount).toFixed(2)}` : '—'}
                  </td>
                  <td className="py-4 px-6">
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-bold ${
                        record.settlement_status === 'paid'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {record.settlement_status === 'paid' ? 'Paid to Stall' : 'Pending Settlement'}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-right">
                    {record.settlement_status === 'paid' ? (
                      <span className="text-xs text-slate-400 block">
                        Paid to {record.paid_to_representative}
                      </span>
                    ) : (
                      <button
                        onClick={() => setSelectedRecord(record)}
                        className="px-3 py-1.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-xs transition"
                      >
                        Record Payout
                      </button>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400 text-sm">
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
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <form onSubmit={handlePaySettlement} className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="font-bold text-slate-900 text-lg">Record Payout to {selectedRecord.stall?.name}</h3>
            <div className="bg-slate-50 p-3 rounded-xl flex justify-between items-center text-xs font-mono">
              <span>Stall Gross Sales (reference only):</span>
              <span className="text-base font-extrabold text-slate-700">₹{Number(selectedRecord.stall_gross_sales).toFixed(2)}</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Amount Paid to Stall (₹):</label>
              <input
                type="number"
                required
                min="0"
                step="0.01"
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
                placeholder="Enter the amount actually handed over"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Representative / Stall Manager Name:
              </label>
              <input
                type="text"
                required
                value={repName}
                onChange={(e) => setRepName(e.target.value)}
                placeholder="e.g. Marco / Vikram / Pooja"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Method</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium"
              >
                <option value="cash">Cash Handover</option>
                <option value="bank_transfer">Direct Bank Transfer (NEFT/IMPS)</option>
                <option value="upi">Business UPI</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Notes / Transaction Reference</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes or bank reference number..."
                rows={2}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
              />
            </div>

            <div className="flex space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="flex-1 py-2 text-xs font-bold text-slate-600 rounded-xl border border-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-md"
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
