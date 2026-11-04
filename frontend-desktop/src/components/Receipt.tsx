import React, { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { apiClient } from '../api/client';
import { printPage, logError, getReceiptWidth, setReceiptWidth, desktop } from '../desktop/bridge';
import { buildReceiptDocument, receiptDedupeKey } from '../lib/print/receiptDocument';
import { describeEnqueue, enqueuePrint, receiptUsesQueue } from '../lib/print/printClient';
import type { PreviewResult } from '../lib/print/types';
import { ThermalPreview } from './ThermalPreview';
import type { FoodCourtSettings } from '../context/SettingsContext';
import { paperProfile, RECEIPT_CREDIT, receiptHeader, receiptTaxLines, upiSection, type PaperWidth } from '../lib/receiptModel';
import { UpiQr } from './UpiQr';

/**
 * Consolidated customer receipt, rendered from GET /billing/receipt/{orderId} (server data only:
 * line totals, tax and total are exactly what the backend stored for the order). The header comes from the saved
 * Business Profile; the UPI block (QR, UPI ID, amount, reference) is the bill's own payment request.
 */
export const ReceiptContent: React.FC<{ receipt: any; settings?: FoodCourtSettings | null; width?: PaperWidth }> = ({ receipt, settings, width = 80 }) => {
  const order = receipt.order;
  const groups: Record<string, any[]> = receipt.stall_breakdown || {};
  const payment = order.payments?.[order.payments.length - 1];
  const receiptCfg = settings?.receipt;
  const [businessName, ...headerDetails] = receiptHeader(settings);
  const upi = upiSection(receipt);
  return (
    <div data-testid="receipt" data-paper-width={width}>
      <div data-testid="receipt-business-name" style={{ textAlign: 'center', fontWeight: 700, fontSize: width === 58 ? 12 : 14, wordBreak: 'break-word' }}>
        {businessName}
      </div>
      {headerDetails.map((line, i) => (
        <div key={i} style={{ textAlign: 'center', wordBreak: 'break-word' }}>
          {line}
        </div>
      ))}
      <div style={{ textAlign: 'center' }}>Consolidated Bill</div>
      <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />
      <div>Bill: {order.order_number}</div>
      <div>Date: {new Date(order.created_at).toLocaleString()}</div>
      <div>{order.table ? `Table: ${order.table.table_number}` : 'Takeaway'}</div>
      {order.customer_name && <div>Customer: {order.customer_name}</div>}
      {/* Items stay grouped per stall, but the stall (owner) name is deliberately not printed on the customer bill. */}
      {Object.entries(groups).map(([stall, items]) => (
        <div key={stall} style={{ marginTop: 4 }}>
          <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />
          {items.map((it: any) => (
            <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
              <span style={{ minWidth: 0, wordBreak: 'break-word' }}>
                {it.quantity} x {it.item_name}
              </span>
              <span>{Number(it.subtotal).toFixed(2)}</span>
            </div>
          ))}
        </div>
      ))}
      <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />
      {receiptTaxLines(order).map((line) => (
        <Row key={line.label} label={line.label} value={line.value} />
      ))}
      {Number(order.discount_amount) > 0 && <Row label="Discount" value={`-${order.discount_amount}`} />}
      <Row label="TOTAL" value={order.total_amount} bold />
      {payment && (
        <>
          <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />
          <Row label={`Paid (${String(payment.payment_method).toUpperCase()})`} value={payment.amount} />
          {payment.payment_method === 'cash' && (
            <>
              <Row label="Tendered" value={payment.cash_tendered} />
              <Row label="Change" value={payment.change_returned} />
            </>
          )}
          <div>Receipt: {payment.payment_number}</div>
          {payment.payment_method === 'upi_qr' && payment.transaction_reference && <div>UPI Ref: {payment.transaction_reference}</div>}
          <div>Cashier: {payment.cashier?.name || order.cashier?.name || '-'}</div>
        </>
      )}
      {upi && (
        <div data-testid="receipt-upi" style={{ breakInside: 'avoid', pageBreakInside: 'avoid', textAlign: 'center' }}>
          <div style={{ borderTop: '1px dashed #000', margin: '6px 0 4px' }} />
          <div data-testid="receipt-upi-title" style={{ fontWeight: 700 }}>
            {upi.title}
          </div>
          <UpiQr text={upi.qrText} paper={width} />
          <div style={{ wordBreak: 'break-all' }}>{upi.vpaLine}</div>
          <div data-testid="receipt-upi-amount" style={{ fontWeight: 700 }}>{upi.amountLine}</div>
          <div style={{ wordBreak: 'break-all' }}>{upi.referenceLine}</div>
          {upi.instructionLine && <div data-testid="receipt-upi-instruction" style={{ marginTop: 2, fontSize: width === 58 ? 9 : 10, wordBreak: 'break-word' }}>{upi.instructionLine}</div>}
        </div>
      )}
      {order.payment_status !== 'paid' && <div style={{ fontWeight: 700, marginTop: 4 }}>*** UNPAID - NOT A RECEIPT ***</div>}
      <div style={{ textAlign: 'center', marginTop: 6 }}>{receiptCfg?.footer || 'Thank you!'}</div>
      <div data-testid="receipt-powered-by" style={{ textAlign: 'center', marginTop: 4, fontSize: '0.9em', wordBreak: 'break-word' }}>{RECEIPT_CREDIT}</div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: any; bold?: boolean }> = ({ label, value, bold }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: bold ? 700 : 400 }}>
    <span>{label}</span>
    <span>{Number(value).toFixed(2)}</span>
  </div>
);

/** Renders any content into #print-root (the only printed element) and opens the print dialog. */
export const printContent = async (node: React.ReactNode, paper: 'receipt' | 'a4' = 'receipt', width: PaperWidth = 80): Promise<void> => {
  let host = document.getElementById('print-root');
  if (!host) {
    host = document.createElement('div');
    host.id = 'print-root';
    document.body.appendChild(host);
  }
  host.dataset.paper = paper;
  host.dataset.width = String(width);
  const root = createRoot(host);
  flushSync(() => root.render(node));
  try {
    await printPage(paper);
  } finally {
    root.unmount();
  }
};

/**
 * Receipt data for an order plus the food court settings. An unpaid bill with UPI QR switched on gets its payment
 * request (QR) created here, so the printed bill and the POS show the same reference; the server derives the amount.
 * A paid bill never creates a request: it reprints the original one.
 */
export const loadReceiptData = async (orderId: number): Promise<{ receipt: any; settings: FoodCourtSettings | null }> => {
  const [res, settings] = await Promise.all([
    apiClient.get(`/billing/receipt/${orderId}`),
    apiClient.get('/settings').then((r) => r.data.data as FoodCourtSettings).catch(() => null),
  ]);
  let receipt = res.data.data;
  if (receipt.upi_enabled && !receipt.upi && receipt.order.payment_status !== 'paid' && receipt.order.status !== 'cancelled') {
    try {
      const req = await apiClient.post(`/billing/orders/${orderId}/upi-request`);
      receipt = { ...receipt, upi: req.data.data };
    } catch (err: any) {
      logError(`UPI QR not added to the bill for order ${orderId}: ${err?.response?.data?.message || err?.message || err}`);
    }
  }
  return { receipt, settings };
};

/** Fetches the receipt for an order (plus the food court's receipt settings) and prints it on this PC's paper width. */
export type ReceiptPrintOutcome = ReturnType<typeof describeEnqueue>;

/** Hands loaded receipt data to the print queue (thermal printer configured). Duplicate protection is by order + paid/bill state. */
const queueReceipt = async (receipt: any, settings: FoodCourtSettings | null, reprint: boolean): Promise<ReceiptPrintOutcome> => {
  const doc = buildReceiptDocument(receipt, settings);
  const r = await enqueuePrint('receipt', doc, {
    dedupeKey: receiptDedupeKey(receipt.order.id, receipt.order.payment_status),
    reprint,
    reference: { orderId: receipt.order.id, orderNumber: receipt.order.order_number },
  });
  return describeEnqueue(r);
};

/**
 * With a thermal printer set up (Settings, Printers) the receipt goes through the print queue; otherwise it opens the
 * Windows print dialog on this PC's paper width, exactly as before.
 */
export const printReceipt = async (orderId: number, opts: { reprint?: boolean } = {}): Promise<ReceiptPrintOutcome> => {
  const { receipt, settings } = await loadReceiptData(orderId);
  if (await receiptUsesQueue()) return queueReceipt(receipt, settings, opts.reprint === true);
  const width = getReceiptWidth();
  await printContent(<ReceiptContent receipt={receipt} settings={settings} width={width} />, 'receipt', width);
  return { kind: 'sent', message: '' };
};

/** Button that prints the receipt for an order and reports failures inline. */
export const PrintReceiptButton: React.FC<{ orderId: number; className?: string; label?: string }> = ({ orderId, className, label }) => {
  const [busy, setBusy] = useState(false);
  const [sentNote, setSentNote] = useState(false);
  const onClick = async () => {
    setBusy(true);
    try {
      let out = await printReceipt(orderId);
      // Already printed: never print a second slip silently; ask, then stamp the copy on paper
      if (out.kind === 'duplicate-done') {
        if (!window.confirm(`${out.message} Print another copy marked COPY?`)) return;
        out = await printReceipt(orderId, { reprint: true });
      }
      if (out.kind === 'sent') {
        if (out.job) {
          setSentNote(true);
          setTimeout(() => setSentNote(false), 2500);
        }
      } else {
        alert(out.message);
      }
    } catch (err: any) {
      logError(`Receipt print failed for order ${orderId}: ${err?.message || err}`);
      alert(err?.response?.data?.message || err?.message || 'Could not print the receipt.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" onClick={onClick} disabled={busy} className={className} data-testid="receipt-print">
      {busy ? 'Preparing…' : sentNote ? 'Sent to printer' : label || 'Print Receipt'}
    </button>
  );
};

/** Opens an on-screen preview of the receipt exactly as it prints (same component, same paper width). */
export const ReceiptPreviewButton: React.FC<{ orderId: number; className?: string; label?: string }> = ({ orderId, className, label }) => {
  const [data, setData] = useState<{ receipt: any; settings: FoodCourtSettings | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [width, setWidth] = useState<PaperWidth>(getReceiptWidth());
  const [error, setError] = useState<string | null>(null);
  // Set when a thermal printer is configured: the preview then shows what that printer receives
  const [thermal, setThermal] = useState<Extract<PreviewResult, { ok: true; mode: 'text' | 'html' }> | null>(null);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const loaded = await loadReceiptData(orderId);
      setThermal(null);
      if (await receiptUsesQueue()) {
        const p = await desktop()!.previewPrintDocument({ role: 'receipt', doc: buildReceiptDocument(loaded.receipt, loaded.settings) });
        if (!p.ok) throw new Error(p.message);
        if (p.mode === 'text' || p.mode === 'html') setThermal(p);
      }
      setData(loaded);
      setWidth(getReceiptWidth());
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Could not load the receipt.');
      alert(err?.response?.data?.message || err?.message || 'Could not load the receipt.');
    } finally {
      setBusy(false);
    }
  };
  const profile = paperProfile(width);

  return (
    <>
      <button type="button" onClick={open} disabled={busy} className={className} data-testid="receipt-preview-open">
        {busy ? 'Loading…' : label || 'Preview'}
      </button>
      {data && (
        <div role="dialog" aria-label="Receipt preview" data-testid="receipt-preview" className="fixed inset-0 !m-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-full overflow-y-auto rounded-lg bg-surface border border-line shadow-2xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <h3 className="font-semibold text-base text-fg">Receipt preview</h3>
              {thermal ? (
                <span className="text-xs text-muted" data-testid="receipt-preview-printer">
                  {thermal.mode === 'text' ? `Thermal text · ${thermal.paperWidthMm} mm · ${thermal.columns} columns` : `Windows printer page · ${thermal.paperWidthMm} mm`}
                </span>
              ) : (
              <label className="text-xs text-muted flex items-center gap-2">
                Paper
                <select
                  data-testid="receipt-preview-width"
                  value={width}
                  onChange={(e) => {
                    const w = Number(e.target.value) === 58 ? 58 : 80;
                    setWidth(w);
                    setReceiptWidth(w);
                  }}
                  className="border border-line rounded px-1 py-0.5 bg-surface text-fg"
                >
                  <option value={80}>80 mm</option>
                  <option value={58}>58 mm</option>
                </select>
              </label>
              )}
            </div>
            {thermal && <ThermalPreview result={thermal} />}
            <div
              hidden={!!thermal}
              data-testid="receipt-preview-paper"
              style={{ background: '#fff', color: '#000', fontFamily: "'Courier New', monospace", fontSize: profile.fontPx, width: `${profile.contentMm}mm`, padding: '4mm', margin: '0 auto', boxShadow: '0 0 0 1px #999' }}
            >
              <ReceiptContent receipt={data.receipt} settings={data.settings} width={width} />
            </div>
            {error && <p role="alert" className="text-xs text-danger-fg">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                className="px-3 py-1.5 border border-line rounded-lg text-xs font-bold text-fg hover:bg-surface-2"
                onClick={async () => {
                  try {
                    if (thermal) {
                      let out = await queueReceipt(data.receipt, data.settings, false);
                      if (out.kind === 'duplicate-done' && window.confirm(`${out.message} Print another copy marked COPY?`)) out = await queueReceipt(data.receipt, data.settings, true);
                      if (out.kind !== 'sent' && out.kind !== 'duplicate-done') setError(out.message);
                    } else {
                      await printContent(<ReceiptContent receipt={data.receipt} settings={data.settings} width={width} />, 'receipt', width);
                    }
                  } catch (err: any) {
                    setError(err?.message || 'Could not print the receipt.');
                  }
                }}
              >
                Print
              </button>
              <button type="button" className="px-3 py-1.5 bg-primary text-primary-fg rounded-lg text-xs font-bold" onClick={() => setData(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
