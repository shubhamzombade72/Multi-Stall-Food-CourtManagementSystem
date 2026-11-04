import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { desktop } from '../desktop/bridge';
import { sound } from '../lib/sound/index';
import { FreshTracker } from '../lib/sound/tracker';
import { printingAvailable } from '../lib/print/printClient';
import type { PrintJob } from '../lib/print/types';

const kindLabel = (j: PrintJob): string => (j.kind === 'kot' ? `Kitchen ticket${j.reference.stallName ? ` (${j.reference.stallName})` : ''}` : j.kind === 'test' ? 'Test print' : 'Receipt');

/**
 * A failed print must never go unnoticed (a kitchen ticket that did not print is a missed order). Shows each failed job
 * until it is retried or dismissed, and plays the alert sound once per job that fails while the app is open. A job
 * that was already failed when the app started is shown but silent.
 */
export const PrintFailureBanner: React.FC = () => {
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const tracker = useRef(new FreshTracker<PrintJob>({ idOf: (j) => j.id }));

  useEffect(() => {
    const d = desktop();
    if (!d || !printingAvailable()) return;
    const apply = (list: PrintJob[]) => {
      setJobs(list);
      // announce each job once, when it first shows up as failed
      for (const j of tracker.current.observe(list.filter((x) => x.status === 'failed'))) void sound.play('alert', { key: `print_failed:${j.id}` });
    };
    d.listPrintJobs(50).then(apply).catch(() => undefined);
    return d.onPrintJobsChanged(apply);
  }, []);

  const failed = jobs.filter((j) => j.status === 'failed' && !dismissed.has(j.id)).slice(0, 3);
  if (failed.length === 0) return null;

  const retry = async (j: PrintJob) => {
    setBusy(j.id);
    try {
      await desktop()?.retryPrintJob(j.id);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-[100] w-96 space-y-2" role="alert" data-testid="print-failure-banner">
      {failed.map((j) => (
        <div key={j.id} className="bg-surface border border-danger/40 rounded-lg shadow-2xl p-3 text-sm space-y-1">
          <div className="flex items-start gap-2 text-danger-fg font-bold">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{kindLabel(j)} did not print</span>
          </div>
          <p className="text-xs text-fg break-words">
            {j.reference.orderNumber || j.reference.ticketNumber ? `${j.reference.orderNumber || j.reference.ticketNumber} · ` : ''}
            {j.error?.message || 'The printer did not accept the job.'}
          </p>
          {j.error?.ambiguous && <p className="text-xs text-warning-fg">It may have partly printed. Check the paper before retrying.</p>}
          <div className="flex gap-2 pt-1">
            {j.canRetry && (
              <button type="button" disabled={busy === j.id} onClick={() => retry(j)} className="px-3 py-1 text-xs font-bold bg-primary text-primary-fg rounded-lg disabled:opacity-50" data-testid="print-failure-retry">
                {busy === j.id ? 'Retrying…' : 'Retry'}
              </button>
            )}
            <button type="button" onClick={() => setDismissed((s) => new Set(s).add(j.id))} className="px-3 py-1 text-xs font-bold border border-line rounded-lg">
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
