import React, { useRef, useState } from 'react';
import { apiClient } from '../../api/client';
import { Field, Modal, inputClass } from '../ui';
import { formatBusinessDate, formatRupees, METHOD_LABELS, newIdempotencyKey, PAYMENT_METHODS, referenceRequired, validatePayout } from '../../lib/payout';

/**
 * Confirm a payout that has ALREADY been made (cash handed over, UPI/bank transfer done). Saving writes a permanent
 * ledger row; it does not move money. The idempotency key lives as long as this form, so a retry or double click can
 * never create a second payout.
 */
export const RecordPayoutModal: React.FC<{
  settlement: any;
  businessDate: string;
  onClose: () => void;
  onDone: (payout: any) => void;
}> = ({ settlement, businessDate, onClose, onDone }) => {
  const key = useRef(newIdempotencyKey());
  const remaining = String(settlement.remaining_amount);
  const [amount, setAmount] = useState(remaining);
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [receivedBy, setReceivedBy] = useState<string>(settlement.stall?.owner?.name || '');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validatePayout({ amount, method, reference }, remaining);
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiClient.post(`/settlements/${settlement.id}/payouts`, {
        amount,
        payment_method: method,
        transaction_reference: reference.trim() || null,
        received_by: receivedBy.trim() || null,
        notes: notes.trim() || null,
        idempotency_key: key.current,
      });
      onDone(res.data.data.payout);
    } catch (err: any) {
      setError(err.response?.data?.message || err.response?.data?.errors?.amount?.[0] || 'Could not record the payout. Nothing was saved; you can try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const Row: React.FC<{ label: string; value: string; strong?: boolean; testId?: string }> = ({ label, value, strong, testId }) => (
    <div className={`flex justify-between text-sm ${strong ? 'font-bold text-fg' : 'text-muted'}`}>
      <span>{label}</span>
      <span data-testid={testId} className={strong ? 'text-fg' : 'text-fg font-medium'}>{value}</span>
    </div>
  );

  return (
    <Modal title={`Record payout: ${settlement.stall?.name}`} onClose={onClose} onSubmit={submit} submitLabel="Confirm payout was made" submitting={submitting} error={error}>
      <div className="bg-canvas border border-line rounded-lg p-3 space-y-1" data-testid="payout-breakdown">
        <Row label={`Business date`} value={formatBusinessDate(businessDate)} />
        <Row label="Stall sales (closing)" value={formatRupees(settlement.stall_gross_sales)} />
        {Number(settlement.adjustment_amount) !== 0 && <Row label="Adjustments" value={formatRupees(settlement.adjustment_amount)} />}
        <Row label="Net payable" value={formatRupees(settlement.net_payable)} strong />
        <Row label="Already paid" value={formatRupees(settlement.paid_amount)} />
        <Row label="Outstanding" value={formatRupees(settlement.remaining_amount)} strong testId="payout-outstanding" />
      </div>

      <Field label="Amount actually paid now (₹)">
        <div className="flex gap-2">
          <input aria-label="Payout amount" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
          <button type="button" onClick={() => setAmount(remaining)} className="px-2 text-xs font-semibold text-primary whitespace-nowrap">Full balance</button>
        </div>
      </Field>

      <Field label="Payment method">
        <select aria-label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>{METHOD_LABELS[m]}</option>
          ))}
        </select>
      </Field>

      <Field label={referenceRequired(method) ? 'Transaction reference (required)' : 'Transaction reference (if any)'}>
        <input aria-label="Transaction reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={method === 'upi' ? 'UTR / UPI reference' : method === 'bank_transfer' ? 'NEFT / IMPS reference' : 'Optional'} className={inputClass} />
      </Field>

      <Field label="Received by">
        <input aria-label="Received by" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="Owner or representative who received it" className={inputClass} />
      </Field>

      <Field label="Notes">
        <textarea aria-label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
      </Field>

      <p className="text-[11px] text-muted">
        This records that you paid this amount. It does not send money, and the app does not verify the transfer with a bank.
      </p>
    </Modal>
  );
};
