import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../../api/client';
import { Card, EmptyState, ErrorBanner, Field, Loading, Modal, inputClass } from '../ui';
import {
  autoAllocate, formatBusinessDate, formatDateTime, formatRupees, METHOD_LABELS, methodLabel, newIdempotencyKey, PAYMENT_METHODS,
  referenceRequired, validateAllocations,
} from '../../lib/payout';

/**
 * One payment to an owner for several stalls. The amount is split into allocations (by hand or oldest-first); the split
 * must add up exactly, and each allocation becomes its own ledger row so no stall is ever credited with the whole payment.
 */
const ConsolidatedPayoutModal: React.FC<{ owner: any; onClose: () => void; onDone: (c: any) => void }> = ({ owner, onClose, onDone }) => {
  const key = useRef(newIdempotencyKey());
  const [rows, setRows] = useState<any[] | null>(null);
  const [outstanding, setOutstanding] = useState('0.00');
  const [total, setTotal] = useState('');
  const [alloc, setAlloc] = useState<Record<number, string>>({});
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [receivedBy, setReceivedBy] = useState(owner.owner.name || '');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiClient
      .get(`/settlements/owners/${owner.owner.id}/outstanding`)
      .then((res) => {
        setRows(res.data.data.settlements);
        setOutstanding(res.data.data.outstanding);
      })
      .catch((err) => setError(err.response?.data?.message || 'Could not load the outstanding settlements.'));
  }, [owner.owner.id]);

  const balances: Record<number, string> = Object.fromEntries((rows || []).map((r) => [r.id, String(r.remaining_amount)]));
  const list = Object.entries(alloc).filter(([, v]) => v !== '').map(([id, amount]) => ({ settlement_id: Number(id), amount }));

  const auto = () => {
    const a = autoAllocate(total, (rows || []).map((r) => ({ settlement_id: r.id, remaining: String(r.remaining_amount) })));
    setAlloc(Object.fromEntries(a.map((x) => [x.settlement_id, x.amount])));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateAllocations(total, list, balances) || (referenceRequired(method) && !reference.trim() ? 'A transaction reference is required for this payment method.' : null);
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiClient.post(`/settlements/owners/${owner.owner.id}/payouts`, {
        total_amount: total,
        allocations: list,
        payment_method: method,
        transaction_reference: reference.trim() || null,
        received_by: receivedBy.trim() || null,
        notes: notes.trim() || null,
        idempotency_key: key.current,
      });
      onDone(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not record the payout. Nothing was saved.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={`Consolidated payout to ${owner.owner.name}`} wide onClose={onClose} onSubmit={submit} submitLabel="Confirm payout was made" submitting={submitting} error={error}>
      {!rows ? (
        !error && <p className="text-sm text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">This owner has nothing outstanding.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <Field label={`Total paid (outstanding ${formatRupees(outstanding)})`}>
              <input aria-label="Total amount paid" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Payment method">
              <select aria-label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
              </select>
            </Field>
            <Field label={referenceRequired(method) ? 'Transaction reference (required)' : 'Transaction reference'}>
              <input aria-label="Transaction reference" value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} />
            </Field>
          </div>
          <div className="flex gap-2 text-xs">
            <button type="button" onClick={() => setTotal(outstanding)} className="font-semibold text-primary">Pay full outstanding</button>
            <button type="button" onClick={auto} data-testid="auto-allocate" className="font-semibold text-primary">Allocate oldest first</button>
          </div>

          <div className="overflow-x-auto border border-line rounded-lg">
            <table className="w-full text-xs text-left" data-testid="allocation-table">
              <thead className="bg-canvas text-muted uppercase tracking-wider">
                <tr>
                  <th className="py-1.5 px-2">Stall</th>
                  <th className="py-1.5 px-2">Business date</th>
                  <th className="py-1.5 px-2 text-right">Outstanding</th>
                  <th className="py-1.5 px-2 w-32">Allocate (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="py-1 px-2 font-semibold text-fg">{r.stall_name}</td>
                    <td className="py-1 px-2">{formatBusinessDate(r.business_date)}</td>
                    <td className="py-1 px-2 text-right">{formatRupees(r.remaining_amount)}</td>
                    <td className="py-1 px-2"><input aria-label={`Allocation for ${r.stall_name} ${r.business_date}`} inputMode="decimal" value={alloc[r.id] ?? ''} onChange={(e) => setAlloc((a) => ({ ...a, [r.id]: e.target.value }))} className={inputClass} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Field label="Received by"><input aria-label="Received by" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} className={inputClass} /></Field>
          <Field label="Notes"><input aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} /></Field>
        </>
      )}
    </Modal>
  );
};

/** Owner-wise consolidated tracking: totals per owner, per-stall breakdown, methods used, payout dates and references. */
export const OwnerPayoutsTab: React.FC<{ refreshKey: number; onChanged: () => void }> = ({ refreshKey, onChanged }) => {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<any | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (from) params.date_from = from;
      if (to) params.date_to = to;
      setData((await apiClient.get('/settlements/owners', { params })).data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Could not load owner payouts.');
    } finally {
      setLoading(false);
    }
  }, [from, to, refreshKey]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-3">
      <Card className="p-3 flex flex-wrap items-end gap-3">
        <Field label="From"><input type="date" aria-label="Owner view from" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} /></Field>
        <Field label="To"><input type="date" aria-label="Owner view to" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} /></Field>
        {data && (
          <div className="ml-auto text-xs text-muted" data-testid="owners-grand-total">
            All owners: payable <strong className="text-fg">{formatRupees(data.grand_total.net_payable)}</strong> · paid <strong className="text-fg">{formatRupees(data.grand_total.paid)}</strong> · outstanding <strong className="text-fg">{formatRupees(data.grand_total.outstanding)}</strong>
          </div>
        )}
      </Card>
      {done && <div role="status" className="p-2.5 rounded-lg bg-st-served-soft border border-st-served text-success-fg text-sm">{done}</div>}
      <ErrorBanner message={error} onRetry={load} />
      {loading ? (
        <Loading />
      ) : !data || data.owners.length === 0 ? (
        <EmptyState title="No stall owners yet" hint="Assign an owner to each stall in Stalls to see owner-wise totals and pay an owner for several stalls at once." />
      ) : (
        data.owners.map((o: any) => (
          <Card key={o.owner.id ?? 'unassigned'} className="p-3 space-y-2" >
            <div data-testid="owner-card" className="space-y-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <h3 className="font-bold text-fg">{o.owner.name}</h3>
                  <p className="text-xs text-muted">{o.stall_count} stall{o.stall_count === 1 ? '' : 's'}{o.methods_used.length ? ` · paid by ${o.methods_used.map(methodLabel).join(', ')}` : ''}</p>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <div><div className="text-muted uppercase text-[10px]">Total payable</div><div className="font-bold text-fg" data-testid="owner-payable">{formatRupees(o.net_payable)}</div></div>
                  <div><div className="text-muted uppercase text-[10px]">Paid</div><div className="font-bold text-success-fg" data-testid="owner-paid">{formatRupees(o.paid)}</div></div>
                  <div><div className="text-muted uppercase text-[10px]">Outstanding</div><div className="font-bold text-fg" data-testid="owner-outstanding">{formatRupees(o.outstanding)}</div></div>
                  {o.owner.id && Number(o.outstanding) > 0 && (
                    <button type="button" onClick={() => setPaying(o)} data-testid="consolidated-payout-btn" className="px-3 py-1.5 bg-primary text-primary-fg font-semibold text-xs rounded-lg">Record consolidated payout</button>
                  )}
                </div>
              </div>
              <table className="w-full text-xs text-left">
                <thead className="text-muted uppercase tracking-wider bg-canvas">
                  <tr><th className="py-1 px-2">Stall</th><th className="py-1 px-2 text-right">Sales</th><th className="py-1 px-2 text-right">Payable</th><th className="py-1 px-2 text-right">Paid</th><th className="py-1 px-2 text-right">Outstanding</th><th className="py-1 px-2">Methods</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {o.stalls.map((s: any) => (
                    <tr key={s.stall_id}>
                      <td className="py-1 px-2 font-semibold text-fg">{s.stall_name}</td>
                      <td className="py-1 px-2 text-right">{formatRupees(s.sales)}</td>
                      <td className="py-1 px-2 text-right">{formatRupees(s.net_payable)}</td>
                      <td className="py-1 px-2 text-right">{formatRupees(s.paid)}</td>
                      <td className="py-1 px-2 text-right">{formatRupees(s.outstanding)}</td>
                      <td className="py-1 px-2">{s.methods.map(methodLabel).join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {o.payouts.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer font-semibold text-primary">Payout dates and references ({o.payouts.length})</summary>
                  <ul className="mt-1 space-y-0.5">
                    {o.payouts.map((p: any) => (
                      <li key={p.payout_number} className="flex flex-wrap gap-x-3 text-muted">
                        <span className="font-mono font-semibold text-fg">{p.payout_number}</span>
                        <span>{formatBusinessDate(p.business_date)} · {p.stall}</span>
                        <span>{formatRupees(p.amount)} {methodLabel(p.payment_method)}</span>
                        <span className="font-mono">{p.transaction_reference || ''}</span>
                        <span>{formatDateTime(p.paid_at)}</span>
                        {p.consolidated_number && <span>in {p.consolidated_number}</span>}
                        {p.status !== 'completed' && <span className="text-danger-fg">{p.status}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </Card>
        ))
      )}
      {paying && (
        <ConsolidatedPayoutModal
          owner={paying}
          onClose={() => setPaying(null)}
          onDone={(c) => {
            setPaying(null);
            setDone(`Consolidated payout ${c.consolidated_number} recorded: ${formatRupees(c.total_amount)} allocated across ${c.allocations?.length ?? 0} stall settlement(s).`);
            onChanged();
            load();
          }}
        />
      )}
    </div>
  );
};
