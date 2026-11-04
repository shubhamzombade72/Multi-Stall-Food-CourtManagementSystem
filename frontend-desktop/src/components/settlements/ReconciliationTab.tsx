import React, { useState } from 'react';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { apiClient } from '../../api/client';
import { Card, ErrorBanner, Field, inputClass } from '../ui';
import { formatRupees } from '../../lib/payout';

/** Proves the books: every settlement's cached paid/remaining equals the ledger, PAID means paid in full, payable = paid + outstanding. */
export const ReconciliationTab: React.FC = () => {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (from) params.date_from = from;
      if (to) params.date_to = to;
      setResult((await apiClient.get('/settlements/reconciliation', { params })).data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Reconciliation failed to run.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card className="p-3 flex flex-wrap items-end gap-3">
        <Field label="From"><input type="date" aria-label="Reconcile from" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} /></Field>
        <Field label="To"><input type="date" aria-label="Reconcile to" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} /></Field>
        <button type="button" onClick={run} disabled={running} data-testid="run-reconciliation" className="px-3 py-1.5 bg-primary text-primary-fg font-semibold text-sm rounded-lg disabled:opacity-50">
          {running ? 'Checking…' : 'Run reconciliation'}
        </button>
      </Card>
      <ErrorBanner message={error} />
      {result && (
        <Card className="p-4 space-y-3" >
          <div data-testid="reconciliation-result" data-ok={result.ok ? 'true' : 'false'} className={`flex items-center gap-2 font-bold ${result.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
            {result.ok ? <CheckCircle2 className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
            {result.ok ? 'Books balance: every settlement matches its payout ledger' : `${result.discrepancies.length} discrepancy(ies) found`}
          </div>
          <p className="text-xs text-muted">{result.settlements_checked} settlement(s) and {result.consolidated_checked} consolidated payout(s) checked.</p>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="bg-canvas border border-line rounded-lg p-2"><div className="text-[10px] uppercase text-muted">Net payable</div><div className="font-bold">{formatRupees(result.totals.net_payable)}</div></div>
            <div className="bg-canvas border border-line rounded-lg p-2"><div className="text-[10px] uppercase text-muted">Paid (ledger)</div><div className="font-bold">{formatRupees(result.totals.paid)}</div></div>
            <div className="bg-canvas border border-line rounded-lg p-2"><div className="text-[10px] uppercase text-muted">Outstanding</div><div className="font-bold">{formatRupees(result.totals.outstanding)}</div></div>
          </div>
          <p className="text-xs text-muted">Payable ({formatRupees(result.totals.net_payable)}) = Paid ({formatRupees(result.totals.paid)}) + Outstanding ({formatRupees(result.totals.outstanding)})</p>
          {result.discrepancies.length > 0 && (
            <ul className="text-xs space-y-1 text-danger-fg">
              {result.discrepancies.map((d: any, i: number) => (
                <li key={i}>{d.settlement_id ? `Settlement #${d.settlement_id}: ` : d.payout_id ? `Payout #${d.payout_id}: ` : ''}{d.issue}</li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
};
