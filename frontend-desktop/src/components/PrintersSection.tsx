import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Printer as PrinterIcon, RefreshCw } from 'lucide-react';
import { desktop, type DesktopPrinter } from '../desktop/bridge';
import { loadPrintConfig, printingAvailable, savePrintConfig } from '../lib/print/printClient';
import type { PrintConfig, PrintJob, PrinterProfile, PrinterRole, PrinterStatus, PrintTransport } from '../lib/print/types';

const btn = 'px-3 py-1.5 border border-line text-xs font-bold rounded-lg disabled:opacity-50 hover:bg-surface-2';
const primary = 'px-3 py-1.5 bg-primary text-primary-fg text-xs font-bold rounded-lg disabled:opacity-50';
const field = 'w-full px-3 py-2 rounded-lg border border-line text-sm bg-surface text-fg';

const OPTIONS: Record<PrinterRole, { value: PrintTransport; label: string }[]> = {
  receipt: [
    { value: 'dialog', label: 'Windows print dialog (as before)' },
    { value: 'driver', label: 'Windows printer, silent (supports Marathi)' },
    { value: 'spooler-raw', label: 'Windows printer, thermal text (ESC/POS)' },
    { value: 'network', label: 'Network printer by IP address (ESC/POS)' },
  ],
  kot: [
    { value: 'none', label: 'No kitchen printer' },
    { value: 'driver', label: 'Windows printer, silent (supports Marathi)' },
    { value: 'spooler-raw', label: 'Windows printer, thermal text (ESC/POS)' },
    { value: 'network', label: 'Network printer by IP address (ESC/POS)' },
  ],
};

const STATE_TEXT: Record<PrinterStatus['state'], string> = { ready: 'OK', offline: 'Problem', 'not-found': 'Not found', unconfigured: 'Not set up', unknown: 'Unknown' };
const JOB_TEXT: Record<PrintJob['status'], string> = { queued: 'Waiting', processing: 'Sending', completed: 'Sent', failed: 'Failed' };
const JOB_TONE: Record<PrintJob['status'], string> = { queued: 'text-muted', processing: 'text-muted', completed: 'text-success-fg', failed: 'text-danger-fg' };

const ProfileEditor: React.FC<{
  role: PrinterRole;
  profile: PrinterProfile;
  printers: DesktopPrinter[];
  dirty: boolean;
  status: PrinterStatus | null;
  testMessage: string | null;
  onChange: (p: PrinterProfile) => void;
  onTest: () => void;
  onStatus: () => void;
}> = ({ role, profile, printers, dirty, status, testMessage, onChange, onTest, onStatus }) => {
  const set = (patch: Partial<PrinterProfile>) => onChange({ ...profile, ...patch });
  const needsWindowsPrinter = profile.transport === 'driver' || profile.transport === 'spooler-raw';
  const textMode = profile.transport === 'spooler-raw' || profile.transport === 'network';
  const thermal = profile.transport !== 'dialog' && profile.transport !== 'none';
  const title = role === 'receipt' ? 'Receipt printer' : 'Kitchen (KOT) printer';
  return (
    <div className="border border-line rounded-lg p-3 space-y-2" data-testid={`printer-${role}`}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <label className="block text-xs font-semibold" htmlFor={`${role}-transport`}>
        Connection
      </label>
      <select id={`${role}-transport`} data-testid={`${role}-transport`} className={field} value={profile.transport} onChange={(e) => set({ transport: e.target.value as PrintTransport })}>
        {OPTIONS[role].map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {needsWindowsPrinter && (
        <>
          <label className="block text-xs font-semibold" htmlFor={`${role}-printer`}>
            Windows printer
          </label>
          <select id={`${role}-printer`} data-testid={`${role}-printer`} className={field} value={profile.printerName} onChange={(e) => set({ printerName: e.target.value })}>
            <option value="">Choose a printer…</option>
            {printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.displayName || p.name}
              </option>
            ))}
            {profile.printerName && !printers.some((p) => p.name === profile.printerName) && <option value={profile.printerName}>{profile.printerName} (not installed)</option>}
          </select>
        </>
      )}

      {profile.transport === 'network' && (
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label className="block text-xs font-semibold" htmlFor={`${role}-host`}>
              Printer address
            </label>
            <input id={`${role}-host`} data-testid={`${role}-host`} className={field} placeholder="192.168.1.50" value={profile.host} onChange={(e) => set({ host: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-semibold" htmlFor={`${role}-port`}>
              Port
            </label>
            <input id={`${role}-port`} data-testid={`${role}-port`} className={field} inputMode="numeric" value={profile.port} onChange={(e) => set({ port: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
          </div>
        </div>
      )}

      {thermal && (
        <>
          <label className="block text-xs font-semibold" htmlFor={`${role}-paper`}>
            Paper roll
          </label>
          <select id={`${role}-paper`} data-testid={`${role}-paper`} className={field} value={profile.paperWidthMm} onChange={(e) => set({ paperWidthMm: Number(e.target.value) === 58 ? 58 : 80 })}>
            <option value={80}>80 mm</option>
            <option value={58}>58 mm</option>
          </select>
        </>
      )}

      {textMode && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-semibold" htmlFor={`${role}-codepage`}>
              Character set
            </label>
            <select id={`${role}-codepage`} className={field} value={profile.codepage} onChange={(e) => set({ codepage: e.target.value as PrinterProfile['codepage'] })}>
              <option value="CP858">CP858 (Latin + euro, default)</option>
              <option value="CP850">CP850</option>
              <option value="CP437">CP437</option>
              <option value="CP1252">WPC1252</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold" htmlFor={`${role}-columns`}>
              Columns (blank = {profile.paperWidthMm === 58 ? 32 : 48})
            </label>
            <input id={`${role}-columns`} className={field} inputMode="numeric" value={profile.columns ?? ''} onChange={(e) => set({ columns: e.target.value === '' ? null : Number(e.target.value.replace(/\D/g, '')) })} />
          </div>
          <label className="col-span-2 flex items-center space-x-2 text-xs">
            <input type="checkbox" checked={profile.cut} onChange={(e) => set({ cut: e.target.checked })} />
            <span>Cut the paper after each print</span>
          </label>
          <p className="col-span-2 text-xs text-muted">Thermal text mode uses the printer's own font and cannot print Marathi/Devanagari. Use the "silent" Windows printer connection for that.</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" className={btn} onClick={onStatus} disabled={!thermal || dirty} data-testid={`${role}-status-check`}>
          Check printer
        </button>
        <button type="button" className={btn} onClick={onTest} disabled={!thermal || dirty} data-testid={`${role}-test`}>
          Send test print
        </button>
        {dirty && <span className="text-xs text-warning-fg">Save changes before testing.</span>}
      </div>
      {status && (
        <p className="text-xs" data-testid={`${role}-status`}>
          <span className={`font-bold ${status.state === 'ready' ? 'text-success-fg' : status.state === 'unknown' || status.state === 'unconfigured' ? 'text-muted' : 'text-danger-fg'}`}>{STATE_TEXT[status.state]}</span> · {status.message}
        </p>
      )}
      {testMessage && (
        <p className="text-xs text-muted" data-testid={`${role}-test-message`}>
          {testMessage}
        </p>
      )}
    </div>
  );
};

/** Thermal printer setup (receipt + kitchen) and the print job history with Retry / Print again. */
export const PrintersSection: React.FC = () => {
  const [saved, setSaved] = useState<PrintConfig | null>(null);
  const [draft, setDraft] = useState<PrintConfig | null>(null);
  const [printers, setPrinters] = useState<DesktopPrinter[]>([]);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [status, setStatus] = useState<Partial<Record<PrinterRole, PrinterStatus>>>({});
  const [testMsg, setTestMsg] = useState<Partial<Record<PrinterRole, string>>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const d = desktop();
    if (!d || !printingAvailable()) return;
    loadPrintConfig().then((c) => {
      setSaved(c);
      setDraft(c);
    });
    d.listPrinters().then(setPrinters).catch(() => undefined);
    d.listPrintJobs(30).then(setJobs).catch(() => undefined);
    return d.onPrintJobsChanged((list) => setJobs(list.slice(0, 30)));
  }, []);

  const dirty = useMemo(() => JSON.stringify(saved) !== JSON.stringify(draft), [saved, draft]);

  const save = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setMessage(null);
    const r = await savePrintConfig(draft);
    setSaving(false);
    if (r.ok) {
      setSaved(r.config);
      setDraft(r.config);
      setMessage({ ok: true, text: 'Printer settings saved.' });
    } else {
      setMessage({ ok: false, text: r.message });
    }
  }, [draft]);

  if (!printingAvailable() || !draft) return null;
  const d = desktop()!;

  const check = async (role: PrinterRole) => {
    setStatus((s) => ({ ...s, [role]: undefined }));
    const st = await d.getPrinterStatus(role);
    setStatus((s) => ({ ...s, [role]: st }));
  };
  const test = async (role: PrinterRole) => {
    const r = await d.sendTestPrint(role);
    setTestMsg((m) => ({ ...m, [role]: r.ok ? 'Test print queued. Watch the job list below for the result.' : r.message }));
  };
  const act = async (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    const r = await fn();
    if (!r.ok) setMessage({ ok: false, text: r.message || 'That did not work.' });
  };

  return (
    <section className="space-y-3" data-testid="printers-section">
      <h2 className="text-base font-semibold flex items-center space-x-2">
        <PrinterIcon className="w-5 h-5" />
        <span>Thermal printers</span>
      </h2>
      <p className="text-xs text-muted">
        Set these up once per computer. Receipts and kitchen tickets are queued, recorded below, and never sent twice by accident. Nothing here has been verified against a specific printer model until you run "Send test print" on yours.
      </p>

      <ProfileEditor role="receipt" profile={draft.receipt} printers={printers} dirty={dirty} status={status.receipt || null} testMessage={testMsg.receipt || null} onChange={(p) => setDraft({ ...draft, receipt: p })} onTest={() => test('receipt')} onStatus={() => void check('receipt')} />
      <ProfileEditor role="kot" profile={draft.kot} printers={printers} dirty={dirty} status={status.kot || null} testMessage={testMsg.kot || null} onChange={(p) => setDraft({ ...draft, kot: p })} onTest={() => test('kot')} onStatus={() => void check('kot')} />

      <label className="flex items-start space-x-2 text-sm">
        <input type="checkbox" data-testid="auto-print-kot" checked={draft.autoPrint.kotOnNewTicket} disabled={draft.kot.transport === 'none'} onChange={(e) => setDraft({ ...draft, autoPrint: { ...draft.autoPrint, kotOnNewTicket: e.target.checked } })} />
        <span>
          <span className="font-semibold">Print each new kitchen ticket automatically</span>
          <span className="block text-xs text-muted">Only for tickets that arrive while the Kitchen screen is open on this computer. Tickets already on the board are not printed.</span>
        </span>
      </label>

      <div className="flex items-center gap-2">
        <button type="button" className={primary} disabled={!dirty || saving} onClick={save} data-testid="printers-save">
          {saving ? 'Saving…' : 'Save printer settings'}
        </button>
        {message && (
          <span role="status" className={`text-xs ${message.ok ? 'text-success-fg' : 'text-danger-fg'}`} data-testid="printers-message">
            {message.text}
          </span>
        )}
      </div>

      <div className="space-y-1" data-testid="print-center">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Print history</h3>
          <button type="button" className={btn} onClick={() => void d.listPrintJobs(30).then(setJobs)} title="Refresh">
            <RefreshCw className="w-3.5 h-3.5 inline" />
          </button>
        </div>
        <p className="text-xs text-muted">"Sent" means the printer connection or Windows accepted the job. The app cannot see paper come out, so check the first print on every new printer.</p>
        {jobs.length === 0 ? (
          <p className="text-xs text-muted">Nothing printed yet.</p>
        ) : (
          <div className="border border-line rounded-lg divide-y divide-line max-h-80 overflow-y-auto">
            {jobs.map((j) => (
              <div key={j.id} className="p-2 text-xs space-y-0.5" data-testid="print-job" data-status={j.status}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">
                    {j.kind === 'kot' ? 'Kitchen ticket' : j.kind === 'test' ? 'Test print' : 'Receipt'}
                    {j.reference.stallName ? ` · ${j.reference.stallName}` : ''}
                    {j.reference.orderNumber ? ` · ${j.reference.orderNumber}` : j.reference.ticketNumber ? ` · ${j.reference.ticketNumber}` : ''}
                    {j.copyNumber > 0 ? ` · copy #${j.copyNumber}` : ''}
                  </span>
                  <span className={`font-bold ${JOB_TONE[j.status]}`}>{JOB_TEXT[j.status]}</span>
                </div>
                <div className="text-muted">
                  {new Date(j.createdAt).toLocaleString()} · {j.printer}
                  {j.attempts > 1 ? ` · ${j.attempts} attempts` : ''}
                </div>
                {j.error && <div className="text-danger-fg break-words">{j.error.message}</div>}
                {j.error?.ambiguous && <div className="text-warning-fg">It may have partly printed. Check the paper before retrying.</div>}
                {j.warnings.map((w, i) => (
                  <div key={i} className="text-warning-fg break-words">
                    {w}
                  </div>
                ))}
                <div className="flex gap-2 pt-0.5">
                  {j.canRetry && (
                    <button type="button" className={btn} onClick={() => act(() => d.retryPrintJob(j.id))} data-testid="print-job-retry">
                      Retry
                    </button>
                  )}
                  {j.canReprint && (
                    <button type="button" className={btn} onClick={() => act(() => d.reprintPrintJob(j.id))} data-testid="print-job-reprint">
                      Print another copy
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
