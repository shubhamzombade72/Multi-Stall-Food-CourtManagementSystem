import React, { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { apiClient } from '../../api/client';
import { Badge, Modal } from '../ui';
import { printContent } from '../Receipt';
import { formatBusinessDate, formatDateTime, formatRupees, methodLabel, statusLabel, STATUS_HINTS } from '../../lib/payout';
import { statusKind } from '../../lib/status';

/** Pending / Partially Paid / Paid (and the edge states) as one consistent badge. */
export const PayoutStatusBadge: React.FC<{ status: string; withHint?: boolean }> = ({ status, withHint }) => (
  <span className="inline-flex flex-col items-start gap-0.5" data-testid="payout-status" data-status={status}>
    <Badge kind={statusKind(status)}>{statusLabel(status)}</Badge>
    {withHint && STATUS_HINTS[status] && <span className="text-[10px] text-muted">{STATUS_HINTS[status]}</span>}
  </span>
);

const line = { borderTop: '1px dashed #000', margin: '4px 0' } as const;

const RRow: React.FC<{ label: string; value: React.ReactNode; bold?: boolean }> = ({ label, value, bold }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontWeight: bold ? 700 : 400 }}>
    <span>{label}</span>
    <span style={{ textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
  </div>
);

/**
 * Payout receipt, rendered from GET /settlements/payouts/{id}/receipt. It documents that an authorised user
 * confirmed a manual payout; it is not proof of an electronic transfer, and says so.
 */
export const PayoutReceiptContent: React.FC<{ r: any }> = ({ r }) => (
  <div data-testid="payout-receipt" style={{ fontFamily: 'monospace', fontSize: 12, color: '#000', background: '#fff', padding: 8 }}>
    <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 14 }}>{r.food_court}</div>
    <div style={{ textAlign: 'center' }}>{r.entry_type === 'reversal' ? 'PAYOUT REVERSAL' : 'STALL PAYOUT RECEIPT'}</div>
    <div style={line} />
    <RRow label="Receipt" value={r.receipt_number} bold />
    <RRow label="Business date" value={formatBusinessDate(r.business_date)} />
    <RRow label="Paid at" value={formatDateTime(r.paid_at)} />
    <div style={line} />
    <RRow label="Stall" value={r.stall?.name} />
    {r.owner && <RRow label="Owner" value={r.owner.name} />}
    {r.consolidated && <RRow label="Consolidated" value={r.consolidated.consolidated_number} />}
    <div style={line} />
    <RRow label="Net payable" value={formatRupees(r.payable)} />
    <RRow label={r.entry_type === 'reversal' ? 'Amount reversed' : 'Amount paid now'} value={formatRupees(r.amount)} bold />
    <RRow label="Paid so far" value={formatRupees(r.paid_to_date)} />
    <RRow label="Balance remaining" value={formatRupees(r.balance_after)} bold />
    <div style={line} />
    <RRow label="Method" value={methodLabel(r.payment_method)} />
    {r.transaction_reference && <RRow label="Reference" value={r.transaction_reference} />}
    <RRow label="Paid by" value={r.paid_by || '—'} />
    {r.received_by && <RRow label="Received by" value={r.received_by} />}
    {r.notes && <div style={{ marginTop: 2, wordBreak: 'break-word' }}>Note: {r.notes}</div>}
    <div style={line} />
    <div style={{ fontSize: 10, wordBreak: 'break-word' }}>{r.disclaimer}</div>
    <div style={{ marginTop: 14 }}>Receiver signature: ______________</div>
  </div>
);

/** Loads a payout receipt, previews it, and prints it on this PC's receipt printer. */
export const PayoutReceiptModal: React.FC<{ payoutId: number; onClose: () => void }> = ({ payoutId, onClose }) => {
  const [receipt, setReceipt] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get(`/settlements/payouts/${payoutId}/receipt`)
      .then((res) => setReceipt(res.data.data))
      .catch((err) => setError(err.response?.data?.message || 'Could not load the receipt.'));
  }, [payoutId]);

  const print = async () => {
    if (!receipt) return;
    try {
      await printContent(<PayoutReceiptContent r={receipt} />, 'receipt', 80);
    } catch (err: any) {
      setError(err?.message || 'Could not print the receipt.');
    }
  };

  return (
    <Modal title="Payout receipt" onClose={onClose} error={error}>
      {receipt ? (
        <div className="border border-line rounded-lg overflow-hidden">
          <PayoutReceiptContent r={receipt} />
        </div>
      ) : (
        !error && <p className="text-sm text-muted">Loading receipt…</p>
      )}
      <button type="button" onClick={print} disabled={!receipt} data-testid="print-payout-receipt" className="w-full py-1.5 text-sm font-semibold text-primary-fg bg-primary rounded-lg disabled:opacity-50 flex items-center justify-center gap-1.5">
        <Printer className="w-4 h-4" />
        Print receipt
      </button>
    </Modal>
  );
};

/** The ledger table shared by the stall drawer: one row per recorded transaction. */
export const rowStatus = (p: any): string => (p.entry_type === 'reversal' ? 'reversal' : p.status);
