import React, { useCallback, useEffect, useState } from 'react';
import { Calculator } from 'lucide-react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { apiError, dateOnly, dateTime, isoDate, money } from '../lib/format';
import { Badge, buttonClass, Card, EmptyState, ErrorBanner, Field, inputClass, Loading, PageHeader, Pagination, SuccessBanner } from '../components/ui';

/**
 * Cashier-wise closing. The cashier counts the cash taken for sales and records it against the cash payments
 * the system holds for them that day. Variance = counted − expected. What to do with a shortage or excess
 * is the owner's policy and is not applied here.
 */
export const CashierClosingPage: React.FC = () => {
  const { user, isOwner } = useAuth();
  const [date, setDate] = useState(isoDate());
  const [cashiers, setCashiers] = useState<{ id: number; name: string }[]>([]);
  const [cashierId, setCashierId] = useState<number | ''>(isOwner ? '' : user?.id ?? '');
  const [preview, setPreview] = useState<any | null>(null);
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [history, setHistory] = useState<any[] | null>(null);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOwner) return;
    apiClient
      .get('/staff', { params: { role: 'cashier' } })
      .then((r) => setCashiers(r.data.data.filter((s: any) => s.is_active)))
      .catch((err) => setError(apiError(err)));
  }, [isOwner]);

  const loadPreview = useCallback(async () => {
    if (!cashierId) {
      setPreview(null);
      return;
    }
    try {
      const res = await apiClient.get('/cashier-closings/preview', { params: { date, cashier_id: isOwner ? cashierId : undefined } });
      setPreview(res.data.data);
    } catch (err) {
      setError(apiError(err));
    }
  }, [date, cashierId, isOwner]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await apiClient.get('/cashier-closings', { params: { page, per_page: 20 } });
      setHistory(res.data.data.data);
      setLastPage(res.data.data.last_page);
    } catch (err) {
      setError(apiError(err));
    }
  }, [page]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const expected = preview ? Number(preview.totals.expected_cash) : 0;
  const variance = counted === '' ? null : Number(counted) - expected;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preview || counted === '') return;
    if (!confirm(`Record closing for ${preview.cashier.name} on ${dateOnly(date)} with counted cash ${money(counted)}? This cannot be edited afterwards.`)) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await apiClient.post('/cashier-closings', { date, counted_cash: counted, notes: notes || null, cashier_id: isOwner ? cashierId : undefined });
      setSuccess('Cashier closing recorded.');
      setCounted('');
      setNotes('');
      await Promise.all([loadPreview(), loadHistory()]);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const varianceTone = (v: number) => (v === 0 ? 'green' : v < 0 ? 'red' : 'amber');

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">
      <PageHeader title="Cashier Closing" icon={Calculator} subtitle="Count the cash from sales at the end of the day and record it against the system's cash payments." />
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />

      <Card className="p-4 space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Business date">
            <input type="date" max={isoDate()} value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </Field>
          {isOwner && (
            <Field label="Cashier">
              <select aria-label="Cashier" value={cashierId} onChange={(e) => setCashierId(e.target.value ? Number(e.target.value) : '')} className={inputClass}>
                <option value="">Select cashier…</option>
                {cashiers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        {!preview ? (
          <p className="text-sm text-muted">{isOwner ? 'Select a cashier to see their totals.' : 'Loading your totals…'}</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-canvas rounded-lg p-4">
                <p className="text-xs text-muted">Payments taken</p>
                <p className="text-xl font-bold">{preview.totals.payments_count}</p>
              </div>
              <div className="bg-canvas rounded-lg p-4">
                <p className="text-xs text-muted">Expected cash (cash payments)</p>
                <p className="text-xl font-bold" data-testid="expected-cash">
                  {money(preview.totals.expected_cash)}
                </p>
              </div>
              <div className="bg-canvas rounded-lg p-4">
                <p className="text-xs text-muted">Card / UPI / other</p>
                <p className="text-xl font-bold">{money(preview.totals.non_cash_total)}</p>
              </div>
            </div>

            {preview.closing ? (
              <div className="rounded-lg border border-success/40 bg-success/10 p-4 text-sm space-y-1">
                <p className="font-bold text-success-fg">
                  Closed by {preview.closing.closed_by?.name} at {dateTime(preview.closing.created_at)}
                </p>
                <p>
                  Counted {money(preview.closing.counted_cash)} · expected {money(preview.closing.expected_cash)} · variance{' '}
                  <Badge tone={varianceTone(Number(preview.closing.variance))}>{money(preview.closing.variance)}</Badge>
                </p>
                {preview.closing.notes && <p className="text-muted">Note: {preview.closing.notes}</p>}
                <p className="text-xs text-muted">Payments taken after this closing are not included in it.</p>
              </div>
            ) : (
              <form onSubmit={submit} className="grid grid-cols-3 gap-4 items-end">
                <Field label="Counted cash" hint="Sales cash only; leave out any opening float.">
                  <input required type="number" min={0} step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} className={inputClass} />
                </Field>
                <Field label="Note (optional)">
                  <input maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
                </Field>
                <div className="space-y-2">
                  {variance !== null && (
                    <p className="text-sm">
                      Variance: <Badge tone={varianceTone(Math.round(variance * 100) / 100)}>{money(variance)}</Badge>
                    </p>
                  )}
                  <button type="submit" disabled={saving || counted === ''} className={`${buttonClass.primary} w-full justify-center`}>
                    {saving ? 'Saving…' : 'Record closing'}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </Card>

      <Card className="overflow-hidden">
        <h3 className="font-semibold text-base px-4 pt-4">Closing history</h3>
        {history === null ? (
          <Loading />
        ) : history.length === 0 ? (
          <EmptyState title="No cashier closings recorded yet" />
        ) : (
          <table className="w-full text-sm mt-2">
            <thead className="bg-canvas text-xs uppercase text-muted">
              <tr>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-left px-3 py-2">Cashier</th>
                <th className="text-right px-3 py-2">Payments</th>
                <th className="text-right px-3 py-2">Expected</th>
                <th className="text-right px-3 py-2">Counted</th>
                <th className="text-right px-3 py-2">Variance</th>
                <th className="text-right px-3 py-2">Non-cash</th>
                <th className="text-left px-3 py-2">Closed by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {history.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2 whitespace-nowrap">{dateOnly(c.business_date)}</td>
                  <td className="px-3 py-2 font-semibold">{c.cashier?.name}</td>
                  <td className="px-3 py-2 text-right">{c.payments_count}</td>
                  <td className="px-3 py-2 text-right">{money(c.expected_cash)}</td>
                  <td className="px-3 py-2 text-right">{money(c.counted_cash)}</td>
                  <td className="px-3 py-2 text-right">
                    <Badge tone={varianceTone(Number(c.variance))}>{money(c.variance)}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right">{money(c.non_cash_total)}</td>
                  <td className="px-3 py-2 text-muted">{c.closed_by?.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination page={page} lastPage={lastPage} onPage={setPage} />
      </Card>
    </div>
  );
};
