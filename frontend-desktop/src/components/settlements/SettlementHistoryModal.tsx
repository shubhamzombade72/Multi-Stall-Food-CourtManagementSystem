import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../../api/client';
import { Badge, Field, Modal, inputClass } from '../ui';
import { statusKind } from '../../lib/status';
import { formatBusinessDate, formatDateTime, formatRupees, methodLabel, statusLabel, toPaise } from '../../lib/payout';
import { PayoutStatusBadge, PayoutReceiptModal, rowStatus } from './PayoutBits';

const actionLabel: Record<string, string> = {
  payout_recorded: 'Payout recorded',
  payout_failed: 'Failed attempt recorded',
  payout_reversed: 'Payout reversed',
  reversal_recorded: 'Reversal entry added',
  adjustment: 'Payable adjusted',
};

/** Audit entry as one readable sentence of facts (never raw JSON). */
export const auditSummary = (a: any): string => {
  const d = a.details || {};
  const parts: string[] = [];
  if (d.amount !== undefined) parts.push(formatRupees(d.amount));
  if (d.method) parts.push(methodLabel(d.method));
  if (d.reference) parts.push(`ref ${d.reference}`);
  if (d.reason) parts.push(`reason: ${d.reason}`);
  if (d.remaining_after !== undefined) parts.push(`balance after ${formatRupees(d.remaining_after)}`);
  if (d.net_payable_after !== undefined) parts.push(`payable now ${formatRupees(d.net_payable_after)}`);
  if (d.consolidated_number) parts.push(`part of ${d.consolidated_number}`);
  if (d.legacy_migration) parts.push('migrated from the earlier settlement record');
  return parts.join(' · ');
};

export const AuditTrail: React.FC<{ audit: any[] }> = ({ audit }) => (
  <ol className="space-y-1.5 text-xs" data-testid="audit-trail">
    {audit.length === 0 && <li className="text-muted">No audit entries.</li>}
    {audit.map((a) => (
      <li key={a.id} className="border-l-2 border-line pl-2">
        <div className="font-semibold text-fg">
          {actionLabel[a.action] || a.action} <span className="font-normal text-muted">· {formatDateTime(a.created_at)} · {a.user?.name || 'system'}</span>
        </div>
        <div className="text-muted">{auditSummary(a)}</div>
      </li>
    ))}
  </ol>
);

/**
 * "View Payout History" for one stall settlement: the complete ledger (every payout, failure and reversal), the audit
 * trail, and the audited adjustment / reversal actions. Nothing here edits or deletes a past record.
 */
export const SettlementHistoryModal: React.FC<{ settlementId: number; onClose: () => void; onChanged: () => void }> = ({ settlementId, onClose, onChanged }) => {
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receiptFor, setReceiptFor] = useState<number | null>(null);
  const [reversing, setReversing] = useState<any | null>(null);
  const [reason, setReason] = useState('');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get(`/settlements/${settlementId}/payouts`);
      setData(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not load the payout history.');
    }
  }, [settlementId]);

  useEffect(() => {
    load();
  }, [load]);

  const reverse = async () => {
    if (!reversing) return;
    setError(null);
    try {
      await apiClient.post(`/settlements/payouts/${reversing.id}/reverse`, { reason: reason.trim() });
      setReversing(null);
      setReason('');
      await load();
      onChanged();
    } catch (err: any) {
      setError(err.response?.data?.message || err.response?.data?.errors?.reason?.[0] || 'Could not reverse the payout.');
    }
  };

  const adjust = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (toPaise(adjAmount) === null || toPaise(adjAmount) === 0) {
      setError('Enter a non-zero adjustment in rupees, e.g. -500 for a deduction.');
      return;
    }
    try {
      await apiClient.post(`/settlements/${settlementId}/adjustments`, { amount: adjAmount, reason: adjReason.trim() });
      setAdjAmount('');
      setAdjReason('');
      await load();
      onChanged();
    } catch (err: any) {
      setError(err.response?.data?.message || err.response?.data?.errors?.reason?.[0] || 'Could not save the adjustment.');
    }
  };

  const s = data?.settlement;
  return (
    <>
      <Modal title={s ? `Payout history: ${s.stall?.name}` : 'Payout history'} onClose={onClose} wide error={error}>
        {!s ? (
          !error && <p className="text-sm text-muted">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs" data-testid="history-summary">
              {[
                ['Business date', formatBusinessDate(s.closing?.closing_date)],
                ['Payable at closing', formatRupees(s.payable_at_close)],
                ['Net payable now', formatRupees(s.net_payable)],
                ['Paid', formatRupees(s.paid_amount)],
                ['Outstanding', formatRupees(s.remaining_amount)],
              ].map(([k, v]) => (
                <div key={k} className="bg-canvas border border-line rounded-lg p-2">
                  <div className="text-muted uppercase tracking-wide text-[10px]">{k}</div>
                  <div className="font-bold text-fg text-sm">{v}</div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted">
              Status: <PayoutStatusBadge status={s.payout_status} withHint />
            </div>

            <div className="overflow-x-auto border border-line rounded-lg">
              <table className="w-full text-left text-xs" data-testid="settlement-ledger">
                <thead className="bg-canvas text-muted uppercase tracking-wider">
                  <tr>
                    <th className="py-1.5 px-2">Payout ID</th>
                    <th className="py-1.5 px-2">Paid at</th>
                    <th className="py-1.5 px-2">Method / reference</th>
                    <th className="py-1.5 px-2 text-right">Amount</th>
                    <th className="py-1.5 px-2 text-right">Balance after</th>
                    <th className="py-1.5 px-2">By</th>
                    <th className="py-1.5 px-2">Status</th>
                    <th className="py-1.5 px-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {s.payouts.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-4 text-center text-muted">No payout recorded yet.</td>
                    </tr>
                  )}
                  {s.payouts.map((p: any) => (
                    <tr key={p.id} data-testid="ledger-row">
                      <td className="py-1.5 px-2 font-mono font-semibold text-fg">{p.payout_number}</td>
                      <td className="py-1.5 px-2">{formatDateTime(p.paid_at)}</td>
                      <td className="py-1.5 px-2">
                        {methodLabel(p.payment_method)}
                        {p.transaction_reference && <span className="block font-mono text-muted">{p.transaction_reference}</span>}
                        {p.consolidated && <span className="block text-muted">in {p.consolidated.consolidated_number}</span>}
                      </td>
                      <td className={`py-1.5 px-2 text-right font-semibold ${p.entry_type === 'reversal' ? 'text-danger-fg' : 'text-fg'}`}>
                        {p.entry_type === 'reversal' ? '−' : ''}{formatRupees(p.amount)}
                      </td>
                      <td className="py-1.5 px-2 text-right">{formatRupees(p.balance_after)}</td>
                      <td className="py-1.5 px-2">{p.paid_by?.name || '—'}</td>
                      <td className="py-1.5 px-2"><Badge kind={statusKind(rowStatus(p))}>{statusLabel(rowStatus(p))}</Badge></td>
                      <td className="py-1.5 px-2 text-right whitespace-nowrap space-x-2">
                        <button type="button" onClick={() => setReceiptFor(p.id)} className="font-semibold text-primary">Receipt</button>
                        {p.entry_type === 'payment' && p.status === 'completed' && !p.consolidated_payout_id && (
                          <button type="button" onClick={() => { setReversing(p); setReason(''); }} data-testid="reverse-payout" className="font-semibold text-danger-fg">Reverse</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {reversing && (
              <div className="p-2 rounded-lg border border-danger/30 bg-danger/10 space-y-2" data-testid="reverse-box">
                <p className="text-xs text-danger-fg font-semibold">
                  Reverse {reversing.payout_number} ({formatRupees(reversing.amount)})? The original record stays; a reversal entry is added and the balance is restored.
                </p>
                <input aria-label="Reversal reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" className={inputClass} />
                <div className="flex gap-2">
                  <button type="button" onClick={() => setReversing(null)} className="flex-1 py-1 text-xs font-semibold text-muted rounded-lg border border-line">Keep payout</button>
                  <button type="button" disabled={reason.trim().length < 3} onClick={reverse} className="flex-1 py-1 text-xs font-semibold text-surface bg-danger-fg rounded-lg disabled:opacity-50">Confirm reversal</button>
                </div>
              </div>
            )}

            <form onSubmit={adjust} className="grid grid-cols-1 md:grid-cols-[8rem_1fr_auto] gap-2 items-end border border-line rounded-lg p-2">
              <Field label="Adjust payable (₹, − to deduct)">
                <input aria-label="Adjustment amount" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} placeholder="-500.00" className={inputClass} />
              </Field>
              <Field label="Reason (audited)">
                <input aria-label="Adjustment reason" value={adjReason} onChange={(e) => setAdjReason(e.target.value)} placeholder="e.g. wastage deduction agreed with owner" className={inputClass} />
              </Field>
              <button type="submit" disabled={adjReason.trim().length < 3} className="px-3 py-1.5 text-sm font-semibold border border-line rounded-lg hover:bg-surface-2 disabled:opacity-50">Add adjustment</button>
            </form>

            <div>
              <h4 className="text-xs font-bold text-fg uppercase tracking-wide mb-1.5">Audit history</h4>
              <AuditTrail audit={data.audit} />
            </div>
          </>
        )}
      </Modal>
      {receiptFor !== null && <PayoutReceiptModal payoutId={receiptFor} onClose={() => setReceiptFor(null)} />}
    </>
  );
};
