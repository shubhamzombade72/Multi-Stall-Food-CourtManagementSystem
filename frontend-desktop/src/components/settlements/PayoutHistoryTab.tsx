import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../../api/client';
import { Badge, Card, EmptyState, ErrorBanner, Field, Loading, Modal, Pagination, inputClass } from '../ui';
import { statusKind } from '../../lib/status';
import { formatBusinessDate, formatDateTime, formatRupees, METHOD_LABELS, methodLabel, PAYMENT_METHODS, statusLabel } from '../../lib/payout';
import { PayoutReceiptModal, PayoutStatusBadge, rowStatus } from './PayoutBits';
import { AuditTrail } from './SettlementHistoryModal';

const EMPTY = { business_date: '', date_from: '', date_to: '', stall_id: '', stall_owner_id: '', payment_method: '', status: '', q: '' };

/** One payout opened in full: all fields, the audit history, the consolidated payment it belongs to, and its reversal. */
const PayoutDetailModal: React.FC<{ id: number; onClose: () => void; onChanged: () => void }> = ({ id, onClose, onChanged }) => {
  const [detail, setDetail] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState(false);
  const [reason, setReason] = useState('');
  const [askReverse, setAskReverse] = useState<'payout' | 'consolidated' | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail((await apiClient.get(`/settlements/payouts/${id}`)).data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not load the payout.');
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const p = detail?.payout;
  const reverse = async () => {
    setError(null);
    try {
      if (askReverse === 'consolidated') await apiClient.post(`/settlements/consolidated-payouts/${p.consolidated_payout_id}/reverse`, { reason: reason.trim() });
      else await apiClient.post(`/settlements/payouts/${id}/reverse`, { reason: reason.trim() });
      setAskReverse(null);
      setReason('');
      await load();
      onChanged();
    } catch (err: any) {
      setError(err.response?.data?.message || err.response?.data?.errors?.reason?.[0] || 'Could not reverse.');
    }
  };

  const reversible = p && p.entry_type === 'payment' && p.status === 'completed';
  return (
    <>
      <Modal title={p ? `Payout ${p.payout_number}` : 'Payout'} onClose={onClose} wide error={error}>
        {!p ? (
          !error && <p className="text-sm text-muted">Loading…</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-xs" data-testid="payout-detail">
              {[
                ['Business date', formatBusinessDate(p.business_date)],
                ['Stall', p.stall?.name],
                ['Owner', p.owner?.name || '—'],
                ['Net payable then', formatRupees(p.payable_at_time)],
                [p.entry_type === 'reversal' ? 'Amount reversed' : 'Amount paid', formatRupees(p.amount)],
                ['Balance after', formatRupees(p.balance_after)],
                ['Method', methodLabel(p.payment_method)],
                ['Reference', p.transaction_reference || '—'],
                ['Paid at', formatDateTime(p.paid_at)],
                ['Paid by', p.paid_by?.name || '—'],
                ['Received by', p.received_by || '—'],
                ['Notes', p.notes || p.failure_reason || '—'],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <dt className="text-muted uppercase tracking-wide text-[10px]">{k}</dt>
                  <dd className="font-semibold text-fg break-words">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="flex items-center gap-2 text-xs">
              <PayoutStatusBadge status={rowStatus(p)} />
              {p.reverses && <span className="text-muted">Reverses {p.reverses.payout_number}</span>}
              {detail.reversal && <span className="text-danger-fg font-semibold">Reversed by {detail.reversal.payout_number}: {detail.reversal.reversal_reason}</span>}
            </div>

            {p.consolidated && (
              <div className="border border-line rounded-lg p-2 text-xs" data-testid="consolidated-allocations">
                <div className="font-bold text-fg mb-1">
                  Part of consolidated payout {p.consolidated.consolidated_number} ({formatRupees(p.consolidated.total_amount)}, {p.consolidated.status})
                </div>
                <ul className="space-y-0.5">
                  {(p.consolidated.allocations || []).map((a: any) => (
                    <li key={a.id} className="flex justify-between">
                      <span>{a.stall?.name} <span className="text-muted font-mono">{a.payout_number}</span></span>
                      <span className="font-semibold">{formatRupees(a.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h4 className="text-xs font-bold text-fg uppercase tracking-wide mb-1.5">Audit history</h4>
              <AuditTrail audit={p.audits || []} />
            </div>

            {askReverse && (
              <div className="p-2 rounded-lg border border-danger/30 bg-danger/10 space-y-2">
                <p className="text-xs text-danger-fg font-semibold">
                  {askReverse === 'consolidated' ? `Reverse the whole consolidated payout ${p.consolidated?.consolidated_number} across all its stalls?` : `Reverse ${p.payout_number}?`} The records are kept; reversal entries are added.
                </p>
                <input aria-label="Reversal reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" className={inputClass} />
                <div className="flex gap-2">
                  <button type="button" onClick={() => setAskReverse(null)} className="flex-1 py-1 text-xs font-semibold text-muted rounded-lg border border-line">Cancel</button>
                  <button type="button" disabled={reason.trim().length < 3} onClick={reverse} className="flex-1 py-1 text-xs font-semibold text-surface bg-danger-fg rounded-lg disabled:opacity-50">Confirm reversal</button>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button type="button" onClick={() => setReceipt(true)} className="flex-1 py-1.5 text-sm font-semibold border border-line rounded-lg hover:bg-surface-2">Receipt</button>
              {reversible && !askReverse && (
                <button type="button" onClick={() => setAskReverse(p.consolidated_payout_id ? 'consolidated' : 'payout')} className="flex-1 py-1.5 text-sm font-semibold text-danger-fg border border-danger/40 rounded-lg hover:bg-danger/10">
                  {p.consolidated_payout_id ? 'Reverse consolidated payout' : 'Reverse payout'}
                </button>
              )}
            </div>
          </>
        )}
      </Modal>
      {receipt && <PayoutReceiptModal payoutId={id} onClose={() => setReceipt(false)} />}
    </>
  );
};

/** Payout history across all stalls, with filters. Completed payments only feed the total; reversals and failures are shown but never counted. */
export const PayoutHistoryTab: React.FC<{ refreshKey: number; onChanged: () => void }> = ({ refreshKey, onChanged }) => {
  const [filters, setFilters] = useState({ ...EMPTY });
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<any[]>([]);
  const [meta, setMeta] = useState<{ last_page: number; total: number }>({ last_page: 1, total: 0 });
  const [total, setTotal] = useState('0.00');
  const [stalls, setStalls] = useState<any[]>([]);
  const [owners, setOwners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    apiClient.get('/stalls', { params: { include_inactive: 1 } }).then((r) => setStalls(r.data.data)).catch(() => undefined);
    apiClient.get('/stall-owners').then((r) => setOwners(r.data.data)).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, any> = { page, per_page: 15 };
      Object.entries(filters).forEach(([k, v]) => v && (params[k] = v));
      const res = await apiClient.get('/settlements/payouts', { params });
      setRows(res.data.data.data);
      setMeta({ last_page: res.data.data.last_page, total: res.data.data.total });
      setTotal(res.data.totals.completed_paid);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not load the payout history.');
    } finally {
      setLoading(false);
    }
  }, [filters, page, refreshKey]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setPage(1);
    setFilters((f) => ({ ...f, [k]: e.target.value }));
  };

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2" data-testid="payout-filters">
          <Field label="Business date"><input type="date" aria-label="Business date" value={filters.business_date} onChange={set('business_date')} className={inputClass} /></Field>
          <Field label="From"><input type="date" aria-label="From date" value={filters.date_from} onChange={set('date_from')} className={inputClass} /></Field>
          <Field label="To"><input type="date" aria-label="To date" value={filters.date_to} onChange={set('date_to')} className={inputClass} /></Field>
          <Field label="Search"><input aria-label="Search payouts" placeholder="PAY-… or reference" value={filters.q} onChange={set('q')} className={inputClass} /></Field>
          <Field label="Stall">
            <select aria-label="Filter by stall" value={filters.stall_id} onChange={set('stall_id')} className={inputClass}>
              <option value="">All stalls</option>
              {stalls.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Stall owner">
            <select aria-label="Filter by owner" value={filters.stall_owner_id} onChange={set('stall_owner_id')} className={inputClass}>
              <option value="">All owners</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
          <Field label="Payment method">
            <select aria-label="Filter by method" value={filters.payment_method} onChange={set('payment_method')} className={inputClass}>
              <option value="">All methods</option>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
            </select>
          </Field>
          <Field label="Payout status">
            <select aria-label="Filter by status" value={filters.status} onChange={set('status')} className={inputClass}>
              <option value="">All</option>
              <option value="completed">Completed</option>
              <option value="reversed">Reversed</option>
              <option value="failed">Failed</option>
              <option value="reversal">Reversal entries</option>
            </select>
          </Field>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs">
          <button type="button" onClick={() => { setFilters({ ...EMPTY }); setPage(1); }} className="font-semibold text-primary">Clear filters</button>
          <span className="text-muted">Completed payouts in this view: <strong data-testid="history-total" className="text-fg">{formatRupees(total)}</strong></span>
        </div>
      </Card>

      <ErrorBanner message={error} onRetry={load} />
      <Card className="overflow-hidden">
        {loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState title="No payouts match" hint="Payouts appear here once an authorised user confirms a payment." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs" data-testid="payout-history-table">
              <thead className="bg-canvas text-muted uppercase tracking-wider">
                <tr>
                  <th className="py-2 px-2">Payout ID</th>
                  <th className="py-2 px-2">Business date</th>
                  <th className="py-2 px-2">Stall</th>
                  <th className="py-2 px-2">Owner</th>
                  <th className="py-2 px-2 text-right">Net payable</th>
                  <th className="py-2 px-2 text-right">Amount</th>
                  <th className="py-2 px-2">Method</th>
                  <th className="py-2 px-2">Reference</th>
                  <th className="py-2 px-2">Paid at</th>
                  <th className="py-2 px-2">Paid by</th>
                  <th className="py-2 px-2">Status</th>
                  <th className="py-2 px-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-2" data-testid="history-row">
                    <td className="py-1.5 px-2 font-mono font-semibold text-fg">{p.payout_number}</td>
                    <td className="py-1.5 px-2">{formatBusinessDate(p.business_date)}</td>
                    <td className="py-1.5 px-2 font-semibold text-fg">{p.stall?.name}</td>
                    <td className="py-1.5 px-2">{p.owner?.name || '—'}</td>
                    <td className="py-1.5 px-2 text-right">{formatRupees(p.payable_at_time)}</td>
                    <td className={`py-1.5 px-2 text-right font-semibold ${p.entry_type === 'reversal' ? 'text-danger-fg' : 'text-fg'}`}>{p.entry_type === 'reversal' ? '−' : ''}{formatRupees(p.amount)}</td>
                    <td className="py-1.5 px-2">{methodLabel(p.payment_method)}</td>
                    <td className="py-1.5 px-2 font-mono">{p.transaction_reference || '—'}</td>
                    <td className="py-1.5 px-2 whitespace-nowrap">{formatDateTime(p.paid_at)}</td>
                    <td className="py-1.5 px-2">{p.paid_by?.name || '—'}</td>
                    <td className="py-1.5 px-2"><Badge kind={statusKind(rowStatus(p))}>{statusLabel(rowStatus(p))}</Badge></td>
                    <td className="py-1.5 px-2 text-right"><button type="button" onClick={() => setOpenId(p.id)} className="font-semibold text-primary">Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} lastPage={meta.last_page} total={meta.total} onPage={setPage} />
      </Card>

      {openId !== null && <PayoutDetailModal id={openId} onClose={() => setOpenId(null)} onChanged={() => { onChanged(); load(); }} />}
    </div>
  );
};
