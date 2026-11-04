import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { logError } from '../desktop/bridge';
import { buildKotDocument, buildKotDocuments, type KotDocumentResult, type KotTicketInput } from '../lib/print/kotDocument';
import { describeEnqueue, enqueuePrint, loadPrintConfig, printingAvailable } from '../lib/print/printClient';

/** True when this computer has a kitchen printer set up (the KOT buttons are hidden otherwise). */
export const useKotPrinterReady = (): boolean => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    if (printingAvailable()) {
      loadPrintConfig()
        .then((c) => alive && setReady(!!c && c.kot.transport !== 'none'))
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, []);
  return ready;
};

const send = (k: KotDocumentResult, reprint: boolean) =>
  enqueuePrint('kot', k.doc, {
    dedupeKey: k.dedupeKey,
    reprint,
    reference: { ticketId: k.ticketId, stallId: k.stallId, stallName: k.stallName, ticketNumber: k.ticketNumber, orderNumber: k.orderNumber },
  });

/**
 * Sends KOTs to the kitchen printer. A ticket that was already printed is not printed again silently: the operator is
 * asked, and a confirmed copy is stamped REPRINT on paper.
 */
async function printKots(items: KotDocumentResult[]): Promise<string> {
  if (items.length === 0) return 'This order has no kitchen tickets to print.';
  const results = await Promise.all(items.map(async (k) => ({ k, out: describeEnqueue(await send(k, false)) })));
  const sent = results.filter((r) => r.out.kind === 'sent');
  const done = results.filter((r) => r.out.kind === 'duplicate-done');
  const other = results.filter((r) => r.out.kind !== 'sent' && r.out.kind !== 'duplicate-done');
  let copies = 0;
  if (done.length && window.confirm(`${done.map((r) => r.k.stallName || r.k.ticketNumber).join(', ')}: already printed. Print another copy marked REPRINT?`)) {
    const again = await Promise.all(done.map(async (r) => describeEnqueue(await send(r.k, true))));
    copies = again.filter((o) => o.kind === 'sent').length;
  }
  const parts: string[] = [];
  if (sent.length + copies) parts.push(`Sent ${sent.length + copies} kitchen ticket${sent.length + copies === 1 ? '' : 's'}`);
  const problems = other.filter((r) => r.out.kind !== 'sent').map((r) => `${r.k.stallName || r.k.ticketNumber}: ${r.out.message}`);
  if (problems.length) parts.push(problems.join(' '));
  return parts.join('. ') || 'Nothing was printed.';
}

/** Prints the stall-wise KOTs of a whole order (one paper ticket per stall). */
export const PrintOrderKotButton: React.FC<{ orderId: number; className?: string; label?: string }> = ({ orderId, className, label }) => {
  const ready = useKotPrinterReady();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!ready) return null;
  const onClick = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await apiClient.get(`/orders/${orderId}`);
      setNote(await printKots(buildKotDocuments(res.data.data)));
    } catch (err: any) {
      logError(`KOT print failed for order ${orderId}: ${err?.message || err}`);
      setNote(err?.response?.data?.message || err?.message || 'Could not print the kitchen tickets.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" onClick={onClick} disabled={busy} className={className} data-testid="print-kot-order">
        {busy ? 'Sending…' : label || 'Print KOTs'}
      </button>
      {note && (
        <span role="status" data-testid="print-kot-note" className="text-xs text-muted self-center">
          {note}
        </span>
      )}
    </>
  );
};

/** Prints one stall ticket from the Kitchen board. */
export const PrintTicketButton: React.FC<{ ticket: KotTicketInput; className?: string }> = ({ ticket, className }) => {
  const ready = useKotPrinterReady();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!ready) return null;
  const onClick = async () => {
    setBusy(true);
    setNote(null);
    try {
      setNote(await printKots([buildKotDocument(ticket)]));
    } catch (err: any) {
      setNote(err?.message || 'Could not print the ticket.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={onClick} disabled={busy} className={className} data-testid="print-kot-ticket" title="Print this kitchen ticket">
        {busy ? 'Sending…' : 'Print KOT'}
      </button>
      {note && (
        <span role="status" className="text-[11px] text-muted">
          {note}
        </span>
      )}
    </div>
  );
};
