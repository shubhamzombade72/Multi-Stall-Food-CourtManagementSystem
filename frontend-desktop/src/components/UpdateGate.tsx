import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, RefreshCw, ShieldCheck } from 'lucide-react';
import { desktop, type UpdateState } from '../desktop/bridge';
import { openWork } from '../lib/unsavedWork';

const NOTE_SECTIONS: { key: string; title: string }[] = [
  { key: 'features', title: 'New features' },
  { key: 'bug_fixes', title: 'Bug fixes' },
  { key: 'performance', title: 'Performance' },
  { key: 'database_changes', title: 'Database changes' },
  { key: 'security', title: 'Security' },
];
const WAITING_TEXT: Record<string, string> = {
  unsaved_cart: 'an open cart',
  unsaved_payment: 'an open payment',
  request_in_flight: 'a sale being saved',
  print_jobs: 'printing to finish',
  backup_or_restore: 'a backup to finish',
  upi_payment_open: 'an open UPI payment',
};
const OPEN_WORK_TEXT: Record<string, string> = { cart: 'the open order', payment: 'the open payment' };

const Notes: React.FC<{ notes: Record<string, unknown> | undefined }> = ({ notes }) => {
  const sections = NOTE_SECTIONS.map(({ key, title }) => ({ title, items: Array.isArray(notes?.[key]) ? (notes![key] as unknown[]).map(String) : [] })).filter((s) => s.items.length > 0);
  if (sections.length === 0) return null;
  return (
    <div data-testid="update-dialog-notes" className="mt-4 max-h-40 overflow-y-auto rounded-lg border border-line bg-canvas px-4 py-3 text-sm">
      {sections.map((s) => (
        <div key={s.title} className="mb-2 last:mb-0">
          <p className="font-semibold text-fg">{s.title}</p>
          <ul className="ml-5 list-disc text-muted">{s.items.map((it, i) => <li key={i}>{it}</li>)}</ul>
        </div>
      ))}
    </div>
  );
};

const primary = 'inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-fg hover:opacity-90 disabled:opacity-50';
const secondary = 'inline-flex items-center justify-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-fg hover:bg-surface-2';

/**
 * Tells everyone at the PC about updates, from the update agent's own state (signed release data only).
 * Mandatory: a screen over the whole application, also over sign-in, with only "Update Now"; everything behind it is inert and
 * Escape does nothing. Two safety exceptions: while a cart or payment is open, a fixed banner says so and the screen follows as
 * soon as it is saved or cleared; and a mandatory release that already failed and was rolled back may be retried but does not
 * lock the PC, so a bad release cannot stop the shop in an install loop.
 * Owner's rule (2026-11-07): every update uses this screen, with Update Now as its only button.
 */
export const UpdateGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const api = desktop();
  const [state, setState] = useState<UpdateState | null>(null);
  const [work, setWork] = useState<string[]>([]);
  const [requested, setRequested] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string; code?: string; reasons?: string[] } | null>(null);
  const [failedDismissed, setFailedDismissed] = useState<string | null>(null);
  const attempt = useRef(false);

  const refresh = useCallback(() => {
    api?.updateGetState().then(setState).catch(() => undefined);
    setWork(openWork());
  }, [api]);
  useEffect(() => {
    if (!api) return undefined;
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, [api, refresh]);

  const required = state?.required && state.required.version !== state.currentVersion ? state.required : null;
  const failedBefore = Boolean(required?.failedBefore);
  const blocking = Boolean(required) && work.length === 0 && !(failedBefore && failedDismissed === required!.version);

  const start = useCallback(async () => {
    if (!api || attempt.current) return;
    attempt.current = true;
    setRequested(true);
    setResult(null); // a Retry must not keep showing the last attempt's error while it runs
    try {
      const r = await api.updateInstallRequired();
      setResult(r);
    } catch {
      setResult({ ok: false, error: 'The update could not start. Your software was not changed.' });
    } finally {
      attempt.current = false;
      refresh();
    }
  }, [api, refresh]);

  // Pressed while a background download was running, or while printing finished: carry on by itself once that is done
  const waiting = requested && result && !result.ok && (result.code === 'running' || result.code === 'busy');
  useEffect(() => {
    if (!waiting || !state) return undefined;
    if (result!.code === 'running' && state.phase !== 'idle') return undefined;
    const t = window.setTimeout(() => void start(), result!.code === 'busy' ? 3000 : 500);
    return () => window.clearTimeout(t);
  }, [waiting, state, result, start]);

  // Nothing behind the screen can be reached, and Escape cannot close it
  useEffect(() => {
    if (!blocking) return undefined;
    const stop = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', stop, true);
    return () => window.removeEventListener('keydown', stop, true);
  }, [blocking]);

  if (!api) return <>{children}</>;

  const phase = state?.phase ?? 'idle';
  const percent = state?.progress?.total ? Math.min(100, Math.round((state.progress.received / state.progress.total) * 100)) : null;
  const busyPhase = phase !== 'idle';
  const failure = requested && result && !result.ok && !waiting && !busyPhase ? result.error || state?.error || 'The update could not continue. Your software was not changed.' : null;
  let status: string | null = null;
  if (result?.ok) status = 'Restarting application…';
  else if (phase === 'downloading') status = 'Downloading update…';
  else if (phase === 'verifying') status = 'Verifying update…';
  else if (phase === 'installing') status = 'Installing update…';
  else if (waiting && result?.code === 'busy') status = `Waiting for ${[...new Set((result.reasons ?? []).map((r) => WAITING_TEXT[r] ?? 'the application to finish its work'))].join(', ')}…`;
  else if (requested && !failure) status = 'Preparing update…';
  const running = Boolean(status);

  return (
    <>
      {required && work.length > 0 && (
        <div role="alert" data-testid="update-required-banner" className="fixed inset-x-0 top-0 z-[900] flex items-center justify-center gap-2 bg-warning px-4 py-2 text-center text-sm font-semibold text-warning-fg shadow">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Update {required.version} is required. Finish {work.map((w) => OPEN_WORK_TEXT[w] ?? 'the open work').join(' and ')}; the update starts straight after.
        </div>
      )}

      <div {...(blocking ? { inert: '', 'aria-hidden': true } : {})}>{children}</div>

      {required && blocking && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4" data-testid="update-required-overlay">
          <div role="alertdialog" aria-modal="true" aria-labelledby="update-required-title" aria-describedby="update-required-text" data-testid="update-required-dialog" className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-2xl max-h-[calc(100vh-2rem)] overflow-y-auto">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><ShieldCheck className="h-6 w-6" /></span>
              <h2 id="update-required-title" className="text-xl font-bold text-fg">{failedBefore ? 'The required update did not finish' : 'Application Update Required'}</h2>
            </div>
            <p id="update-required-text" className="mt-3 text-sm text-fg">
              {failedBefore
                ? `Installing version ${required.version} failed, and version ${state!.currentVersion} was put back. Your data is safe. Try again, or contact support if it keeps failing.`
                : 'A new version of MangalMurti POS is available. Please update the application to continue using MangalMurti POS.'}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-surface-2 px-4 py-3 text-sm">
              <div><dt className="text-muted">Current version</dt><dd data-testid="update-required-current" className="font-semibold text-fg">{state!.currentVersion}</dd></div>
              <div><dt className="text-muted">New version</dt><dd data-testid="update-required-version" className="font-semibold text-fg">{required.version}</dd></div>
            </dl>
            <Notes notes={required.notes} />

            {running && (
              <div className="mt-5" role="status" data-testid="update-required-status">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-fg">{status}</span>
                  {phase === 'downloading' && percent !== null && <span data-testid="update-required-percent" className="tabular-nums text-muted">{percent}%</span>}
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-canvas" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={phase === 'downloading' && percent !== null ? percent : undefined}>
                  <div className={`h-full bg-primary transition-all ${phase === 'downloading' && percent !== null ? '' : 'animate-pulse'}`} style={{ width: `${phase === 'downloading' && percent !== null ? percent : result?.ok || phase === 'installing' ? 100 : 35}%` }} />
                </div>
              </div>
            )}
            {failure && (
              <p role="alert" data-testid="update-required-error" className="mt-5 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger-fg">{failure}</p>
            )}

            <div className="mt-5 space-y-2">
              {!running && (
                <button type="button" autoFocus data-testid="update-required-now" onClick={() => void start()} className={primary}>
                  {failure || failedBefore ? <RefreshCw className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                  {failure || failedBefore ? 'Retry' : 'Update Now'}
                </button>
              )}
              {failedBefore && !running && (
                <button type="button" data-testid="update-required-continue" onClick={() => setFailedDismissed(required.version)} className={`${secondary} w-full`}>
                  Continue with version {state!.currentVersion} for now
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
