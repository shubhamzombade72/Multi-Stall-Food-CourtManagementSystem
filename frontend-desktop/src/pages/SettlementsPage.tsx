import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { CheckCircle2, Store, Lock } from 'lucide-react';
import { ErrorBanner, Field, SuccessBanner, inputClass } from '../components/ui';
import { PayoutReceiptModal, PayoutStatusBadge } from '../components/settlements/PayoutBits';
import { RecordPayoutModal } from '../components/settlements/RecordPayoutModal';
import { SettlementHistoryModal } from '../components/settlements/SettlementHistoryModal';
import { PayoutHistoryTab } from '../components/settlements/PayoutHistoryTab';
import { OwnerPayoutsTab } from '../components/settlements/OwnerPayoutsTab';
import { ReconciliationTab } from '../components/settlements/ReconciliationTab';
import { formatBusinessDate, formatRupees } from '../lib/payout';

type Tab = 'closing' | 'history' | 'owners' | 'reconcile';

const TABS: { id: Tab; label: string }[] = [
  { id: 'closing', label: 'Day Closing & Settlements' },
  { id: 'history', label: 'Payout History' },
  { id: 'owners', label: 'Owner-wise Payouts' },
  { id: 'reconcile', label: 'Reconciliation' },
];

const Figure: React.FC<{ label: string; value: string; hint: string; testId: string; tone?: string }> = ({ label, value, hint, testId, tone = 'text-fg' }) => (
  <div className="bg-surface p-3 rounded-lg border border-line shadow-sm">
    <span className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</span>
    <div data-testid={testId} className={`text-xl font-extrabold mt-1 ${tone}`}>{value}</div>
    <span className="text-xs text-muted mt-0.5 block">{hint}</span>
  </div>
);

export const SettlementsPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('closing');
  const [date, setDate] = useState<string>('');
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paying, setPaying] = useState<any | null>(null);
  const [historyFor, setHistoryFor] = useState<number | null>(null);
  const [receiptFor, setReceiptFor] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await apiClient.get('/settlements/daily-summary', { params: date ? { date } : {} });
      if (res.data.success) {
        setData(res.data.data);
        setError(null);
        if (!date) setDate(res.data.data.date);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not load the day summary.');
    }
  }, [date]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const changed = () => {
    fetchSummary();
    setRefreshKey((k) => k + 1);
  };

  const handleCloseDay = async () => {
    // Closing does NOT lock the day: payments taken afterwards are accepted but not in this closing (OPEN-01, owner decision)
    if (!confirm('Execute End-of-Day closing for this date? This records the day\'s sales and what each stall is owed. It does NOT mark anything paid: you confirm each payout separately. Payments taken after closing will not be included in it.')) {
      return;
    }
    try {
      const res = await apiClient.post('/settlements/close-day', {
        date: data?.date || date,
        notes: 'End of Day formal operational closure by Owner',
      });
      if (res.data.success) {
        setNotice('End-of-Day closing recorded. Every stall shows what it is owed as Pending: record each payout below once the money is actually paid.');
        changed();
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to execute EOD closing');
    }
  };

  const settlements: any[] = data?.closing?.settlements || [];
  const ps = data?.payout_summary;
  const liveRows: any[] = data?.stall_breakdown || [];

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-fg tracking-tight">End-of-Day Closing & Stall Settlements</h2>
          <p className="text-sm text-muted mt-1">Close the day, then record each payout actually made to stall owners. Closing and paying are separate steps.</p>
        </div>

        <div className="flex items-end gap-3">
          <Field label="Business date">
            <input type="date" aria-label="Business date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </Field>
          {data?.is_closed ? (
            <span className="px-4 py-2 bg-st-served-soft text-st-served-fg font-bold text-sm rounded-lg flex items-center space-x-1.5" data-testid="day-closed">
              <CheckCircle2 className="w-4 h-4" />
              <span>Day Closed Successfully</span>
            </span>
          ) : (
            <button onClick={handleCloseDay} data-testid="close-day" className="px-3 py-1.5 bg-primary hover:opacity-90 text-primary-fg font-bold text-sm rounded-lg shadow-md transition flex items-center space-x-2">
              <Lock className="w-4 h-4" />
              <span>Execute End-of-Day Closing</span>
            </button>
          )}
        </div>
      </div>

      <div role="tablist" className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            data-testid={`tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px ${tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-fg'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ErrorBanner message={error} onRetry={fetchSummary} />
      <SuccessBanner message={notice} />

      {tab === 'closing' && (
        <>
          {/* Day sales */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-surface p-4 rounded-lg border border-line shadow-sm">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">Gross Sales</span>
              <div className="text-xl font-extrabold text-fg mt-1">₹{data?.summary?.gross_sales || '0.00'}</div>
              <span className="text-xs text-muted mt-1 block">{data?.summary?.total_orders || 0} orders placed</span>
            </div>
            <div className="bg-surface p-4 rounded-lg border border-line shadow-sm">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">Net Central Revenue</span>
              <div className="text-xl font-extrabold text-primary mt-1">₹{data?.summary?.net_sales || '0.00'}</div>
              <span data-testid="closing-gst" className="text-xs text-muted mt-1 block">Includes GST ₹{data?.summary?.tax_collected || '0.00'} as billed</span>
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

          {/* The four numbers that must never be confused */}
          {data?.is_closed && ps && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="payout-summary">
              <Figure testId="sum-sales" label="Sales calculated" value={formatRupees(ps.sales_calculated)} hint="Stall sales for the day" />
              <Figure testId="sum-payable" label="Settlement payable" value={formatRupees(ps.settlement_payable_now)} hint={`At closing ${formatRupees(ps.settlement_payable_at_close)}`} tone="text-primary" />
              <Figure testId="sum-paid" label="Payout actually made" value={formatRupees(ps.payout_made)} hint={`${ps.stalls_paid} paid · ${ps.stalls_partially_paid} partial · ${ps.stalls_pending} pending`} tone="text-success-fg" />
              <Figure testId="sum-outstanding" label="Outstanding balance" value={formatRupees(ps.outstanding)} hint="Still owed to stalls" />
            </div>
          )}

          <div className="bg-surface rounded-lg border border-line overflow-hidden shadow-sm">
            <div className="p-4 border-b border-line flex items-center justify-between">
              <h3 className="font-semibold text-base text-fg">Stall Settlement Ledger</h3>
              <span className="text-xs text-muted font-mono">Date: {formatBusinessDate(data?.date)}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="settlement-table">
                <thead className="bg-canvas text-muted text-xs uppercase tracking-wider">
                  <tr>
                    <th className="py-2 px-3">Stall</th>
                    <th className="py-2 px-3 text-right">Total Sales</th>
                    <th className="py-2 px-3 text-right">Net Payable</th>
                    <th className="py-2 px-3 text-right">Paid</th>
                    <th className="py-2 px-3 text-right">Remaining</th>
                    <th className="py-2 px-3">Payment Status</th>
                    <th className="py-2 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {settlements.length > 0 ? (
                    settlements.map((r: any) => (
                      <tr key={r.id} data-testid="settlement-row" data-stall={r.stall?.name} className="hover:bg-surface-2 transition">
                        <td className="py-2 px-3 font-bold text-fg">
                          <span className="inline-flex items-center space-x-2">
                            <Store className="w-4 h-4 text-primary" />
                            <span>{r.stall?.name}</span>
                          </span>
                          <span className="block text-[11px] font-normal text-muted">{r.stall?.owner?.name ? `Owner: ${r.stall.owner.name}` : 'No owner assigned'} · {r.stall_item_count} items</span>
                        </td>
                        <td className="py-2 px-3 text-right font-semibold text-fg">{formatRupees(r.stall_gross_sales)}</td>
                        <td className="py-2 px-3 text-right font-bold text-primary" data-testid="row-payable">
                          {formatRupees(r.net_payable)}
                          {Number(r.net_payable) !== Number(r.payable_at_close) && <span className="block text-[10px] font-normal text-muted">adjusted from {formatRupees(r.payable_at_close)}</span>}
                        </td>
                        <td className="py-2 px-3 text-right font-semibold text-success-fg" data-testid="row-paid">{formatRupees(r.paid_amount)}</td>
                        <td className="py-2 px-3 text-right font-bold text-fg" data-testid="row-remaining">{formatRupees(r.remaining_amount)}</td>
                        <td className="py-2 px-3"><PayoutStatusBadge status={r.payout_status} withHint /></td>
                        <td className="py-2 px-3 text-right whitespace-nowrap space-x-2">
                          <button onClick={() => setHistoryFor(r.id)} data-testid="view-payout-history" className="px-2.5 py-1.5 rounded-lg border border-line hover:bg-surface-2 text-fg font-semibold text-xs">View Payout History</button>
                          {Number(r.remaining_amount) > 0 && (
                            <button onClick={() => setPaying(r)} data-testid="record-payout" className="px-2.5 py-1.5 rounded-lg bg-primary hover:opacity-90 text-primary-fg font-bold text-xs">Record Payout</button>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : liveRows.length > 0 ? (
                    liveRows.map((r: any) => (
                      <tr key={r.stall_id} className="text-muted">
                        <td className="py-2 px-3 font-bold text-fg">{r.stall_name}</td>
                        <td className="py-2 px-3 text-right font-semibold text-fg">{formatRupees(r.stall_gross_sales)}</td>
                        <td className="py-2 px-3 text-right" colSpan={5}>Not closed yet: execute End-of-Day closing to create the payable and record payouts.</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-muted text-sm">
                        {data?.is_closed ? 'No settlement records found.' : 'No stall sales on this date yet. Execute End-of-Day closing to generate settlement records.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'history' && <PayoutHistoryTab refreshKey={refreshKey} onChanged={changed} />}
      {tab === 'owners' && <OwnerPayoutsTab refreshKey={refreshKey} onChanged={changed} />}
      {tab === 'reconcile' && <ReconciliationTab />}

      {paying && (
        <RecordPayoutModal
          settlement={paying}
          businessDate={data?.date}
          onClose={() => setPaying(null)}
          onDone={(payout) => {
            setPaying(null);
            setNotice(`Payout ${payout.payout_number} recorded: ${formatRupees(payout.amount)} to ${paying.stall?.name}. Balance remaining ${formatRupees(payout.balance_after)}.`);
            setReceiptFor(payout.id);
            changed();
          }}
        />
      )}
      {historyFor !== null && <SettlementHistoryModal settlementId={historyFor} onClose={() => setHistoryFor(null)} onChanged={changed} />}
      {receiptFor !== null && <PayoutReceiptModal payoutId={receiptFor} onClose={() => setReceiptFor(null)} />}
    </div>
  );
};
