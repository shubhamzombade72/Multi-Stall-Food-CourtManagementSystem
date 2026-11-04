import { desktop, getReceiptPrinter, getReceiptWidth, setReceiptPrinter, setReceiptWidth } from '../../desktop/bridge';
import type { EnqueueResult, PrintConfig, PrintDocument, PrintJob, PrinterRole, PrintReference } from './types';

/**
 * Renderer-side access to the thermal printing service. Everything here is a thin call across the preload bridge;
 * the main process owns the printers, the queue and the history.
 */
export const printingAvailable = (): boolean => typeof desktop()?.enqueuePrintJob === 'function';

let cached: PrintConfig | null = null;
let loading: Promise<PrintConfig | null> | null = null;

/**
 * This PC's printing settings. On first use, a receipt printer/width chosen under the old Settings (browser storage)
 * is carried over, so upgrading does not lose it.
 */
export const loadPrintConfig = async (force = false): Promise<PrintConfig | null> => {
  const d = desktop();
  if (!d || !printingAvailable()) return null;
  if (cached && !force) return cached;
  if (!loading || force) {
    loading = (async () => {
      let cfg = await d.getPrintConfig();
      const legacyName = getReceiptPrinter();
      const legacyWidth = getReceiptWidth();
      // Legacy values only matter while the receipt printer is still the untouched default
      if (cfg.receipt.transport === 'dialog' && !cfg.receipt.printerName && (legacyName || legacyWidth !== cfg.receipt.paperWidthMm)) {
        const migrated = { ...cfg, receipt: { ...cfg.receipt, printerName: legacyName, paperWidthMm: legacyWidth } };
        const saved = await d.setPrintConfig(migrated);
        if (saved.ok) cfg = saved.config;
      }
      cached = cfg;
      return cfg;
    })().finally(() => {
      loading = null;
    });
  }
  return loading;
};

/** Saves settings; also mirrors printer name and paper width into the legacy per-PC keys the dialog path reads. */
export const savePrintConfig = async (config: PrintConfig): Promise<{ ok: true; config: PrintConfig } | { ok: false; message: string }> => {
  const d = desktop();
  if (!d || !printingAvailable()) return { ok: false, message: 'Printing settings are only available in the desktop app.' };
  const r = await d.setPrintConfig(config);
  if (!r.ok) return { ok: false, message: r.message };
  cached = r.config;
  setReceiptPrinter(r.config.receipt.printerName);
  setReceiptWidth(r.config.receipt.paperWidthMm);
  return r;
};

/** True when receipts should go through the queue (a thermal printer is configured) rather than the print dialog. */
export const receiptUsesQueue = async (): Promise<boolean> => {
  const cfg = await loadPrintConfig();
  return !!cfg && cfg.receipt.transport !== 'dialog';
};

export const enqueuePrint = async (role: PrinterRole, doc: PrintDocument, opts: { dedupeKey?: string | null; reprint?: boolean; reference?: PrintReference } = {}): Promise<EnqueueResult> => {
  const d = desktop();
  if (!d || !printingAvailable()) return { ok: false, code: 'UNAVAILABLE', message: 'Thermal printing is only available in the desktop app.' };
  return d.enqueuePrintJob({ role, doc, dedupeKey: opts.dedupeKey ?? null, reprint: opts.reprint === true, reference: opts.reference });
};

/** Plain-language outcome of an enqueue, for a button label or message. `retry` = a failed job exists to retry. */
export const describeEnqueue = (r: EnqueueResult): { kind: 'sent' | 'duplicate-done' | 'duplicate-busy' | 'duplicate-failed' | 'error'; message: string; job?: PrintJob } => {
  if (r.ok) return { kind: 'sent', message: 'Sent to the printer.', job: r.job };
  if (r.code === 'DUPLICATE' && 'job' in r) {
    if (r.reason === 'already-printed') return { kind: 'duplicate-done', message: `Already printed${r.job.completedAt ? ` at ${new Date(r.job.completedAt).toLocaleTimeString()}` : ''}.`, job: r.job };
    if (r.reason === 'in-progress') return { kind: 'duplicate-busy', message: 'This is already being printed.', job: r.job };
    return { kind: 'duplicate-failed', message: 'The earlier attempt failed. Retry it from Settings, Printers, or fix the printer first.', job: r.job };
  }
  return { kind: 'error', message: r.message };
};
