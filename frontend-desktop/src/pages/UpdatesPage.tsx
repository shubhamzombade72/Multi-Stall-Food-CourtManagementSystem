import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Download, RefreshCw, ShieldAlert } from 'lucide-react';
import { desktop, type UpdateState } from '../desktop/bridge';

const NOTE_SECTIONS: { key: string; title: string }[] = [
  { key: 'features', title: 'New features' },
  { key: 'bug_fixes', title: 'Bug fixes' },
  { key: 'performance', title: 'Performance' },
  { key: 'database_changes', title: 'Database changes' },
  { key: 'security', title: 'Security' },
];

const PHASE_TEXT: Record<string, string> = {
  downloading: 'Downloading the update…',
  verifying: 'Checking the download…',
  installing: 'Closing the application to install the update…',
};

const megabytes = (bytes?: number | null) => (bytes ? `${(bytes / 1048576).toFixed(1)} MB` : '0 MB');
const panel = 'rounded-xl border border-line bg-surface p-5';
const primary = 'inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:opacity-50';
const secondary = 'inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-medium text-fg disabled:opacity-50';

/** Software updates for this computer. Nothing installs without a click here. */
export const UpdatesPage: React.FC = () => {
  const [state, setState] = useState<UpdateState | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const api = desktop();

  const refresh = useCallback(() => {
    api?.updateGetState().then(setState).catch(() => undefined);
  }, [api]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (!api) return <p className="p-6 text-sm text-muted">Software updates are managed in the desktop application.</p>;

  const run = async (fn: () => Promise<UpdateState>) => {
    setBusy(true);
    setNote(null);
    try {
      setState(await fn());
    } finally {
      setBusy(false);
    }
  };

  const enroll = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const result = await api.updateEnroll(code);
    setNote(result.ok ? 'This computer is registered for updates.' : result.error ?? 'The code was not accepted.');
    if (result.ok) setCode('');
    setBusy(false);
    refresh();
  };

  const updateNow = async () => {
    setConfirming(false);
    setBusy(true);
    const result = await api.updateNow();
    if (!result.ok) setNote(result.error ?? 'The update could not start.');
    setBusy(false);
    refresh();
  };

  const update = state?.update;
  const running = state ? ['downloading', 'verifying', 'installing'].includes(state.phase) : false;
  const percent = state?.progress?.total ? Math.min(100, Math.round((state.progress.received / state.progress.total) * 100)) : 0;
  const last = state?.lastResult;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6" data-testid="updates-page">
      <header>
        <h1 className="text-2xl font-bold text-fg">Software updates</h1>
        <p className="mt-1 text-sm text-muted">
          Current version <strong data-testid="update-current-version">{state?.currentVersion ?? '…'}</strong>. Your data is backed up before any update, and nothing is installed unless you choose it.
        </p>
      </header>

      {last?.outcome === 'recovered' && (
        <div className={`${panel} border-warning`} data-testid="update-recovered" role="alert">
          <p className="flex items-center gap-2 font-semibold text-fg"><ShieldAlert className="h-5 w-5" /> The last update to {last.version} did not finish</p>
          <p className="mt-1 text-sm text-muted">
            Version {last.running_version ?? state?.currentVersion} was put back and your data is safe.
            {last.restored_database ? ' The database was restored from the backup made just before the update.' : ' The database did not need to be restored.'}
          </p>
          {last.failure && <p className="mt-1 text-xs text-muted">{last.failure}</p>}
        </div>
      )}
      {(last?.outcome === 'completed' || last?.outcome === 'installed') && last.version === state?.currentVersion && (
        <div className={panel} data-testid="update-completed">
          <p className="flex items-center gap-2 font-semibold text-fg"><CheckCircle2 className="h-5 w-5 text-success-fg" /> Updated to version {last.version}</p>
        </div>
      )}

      {state?.blocked && <p className={`${panel} text-sm text-muted`} data-testid="update-disabled">{state.blocked}</p>}

      {state && !state.blocked && !state.enrolled && (
        <form onSubmit={enroll} className={`${panel} space-y-3`}>
          <p className="text-sm text-fg">Enter the update code from your software provider to register this computer.</p>
          <div className="flex gap-2">
            <input aria-label="Update code" value={code} onChange={(e) => setCode(e.target.value)} className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" />
            <button type="submit" disabled={busy || code.trim().length < 8} className={primary}>Register</button>
          </div>
        </form>
      )}

      {state?.enrolled && !state.blocked && (
        <section className={panel}>
          <div className="flex items-center justify-between gap-4">
            <div>
              {update ? (
                <p className="font-semibold text-fg" data-testid="update-available">Version <span data-testid="update-available-version">{update.version}</span> is available{update.required ? ' (required)' : ''}</p>
              ) : (
                <p className="font-semibold text-fg" data-testid="update-none">This computer is up to date</p>
              )}
              {state.checkedAt && <p className="text-xs text-muted">Last checked {new Date(state.checkedAt).toLocaleString()}</p>}
            </div>
            <button type="button" disabled={busy || running} onClick={() => run(() => api.updateCheck())} className={secondary}><RefreshCw className="h-4 w-4" /> Check now</button>
          </div>

          {update && (
            <>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div><dt className="text-muted">Release date</dt><dd className="text-fg" data-testid="update-release-date">{update.releaseDate ? new Date(update.releaseDate).toLocaleDateString() : 'Not stated'}</dd></div>
                <div><dt className="text-muted">Download size</dt><dd className="text-fg" data-testid="update-size">{megabytes(update.packageSize)}</dd></div>
                <div><dt className="text-muted">Type</dt><dd className="text-fg">{update.packageType === 'full' ? 'Complete package' : 'Changes only'}</dd></div>
              </dl>

              <div className="mt-4 space-y-3" data-testid="update-notes">
                {NOTE_SECTIONS.map(({ key, title }) => {
                  const items = update.notes?.[key];
                  if (!Array.isArray(items) || items.length === 0) return null;
                  return (
                    <div key={key}>
                      <h3 className="text-sm font-semibold text-fg">{title}</h3>
                      <ul className="ml-5 list-disc text-sm text-muted">{items.map((item, i) => <li key={i}>{String(item)}</li>)}</ul>
                    </div>
                  );
                })}
              </div>

              {running ? (
                <div className="mt-5" data-testid="update-progress" role="status">
                  <p className="text-sm text-fg">{PHASE_TEXT[state.phase]}</p>
                  {state.phase === 'downloading' && state.progress && (
                    <>
                      <div className="mt-2 h-2 overflow-hidden rounded bg-canvas"><div className="h-full bg-primary" style={{ width: `${percent}%` }} /></div>
                      <p className="mt-1 text-xs text-muted">{megabytes(state.progress.received)} of {megabytes(state.progress.total)}</p>
                    </>
                  )}
                </div>
              ) : confirming ? (
                <div className="mt-5 space-y-3 rounded-lg border border-line p-4" data-testid="update-confirm">
                  <p className="text-sm text-fg">The application will close, back up your data, install version {update.version} and open again. Finish any open bill first.</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={updateNow} className={primary} data-testid="update-confirm-yes">Close and update</button>
                    <button type="button" onClick={() => setConfirming(false)} className={secondary}>Not now</button>
                  </div>
                </div>
              ) : (
                <div className="mt-5 flex gap-2">
                  <button type="button" disabled={busy} onClick={() => setConfirming(true)} className={primary} data-testid="update-now"><Download className="h-4 w-4" /> Update Now</button>
                  {!update.required && <button type="button" disabled={busy} onClick={() => run(() => api.updateRemindLater())} className={secondary} data-testid="update-later">Remind Me Later</button>}
                </div>
              )}
              {state.snoozed && !running && <p className="mt-2 text-xs text-muted" data-testid="update-snoozed">You will be reminded tomorrow.</p>}
            </>
          )}
          {state.serverBlocked && <p className="mt-3 text-sm text-danger-fg" data-testid="update-server-blocked">The update service cannot offer this computer an update ({state.serverBlocked}). Contact support.</p>}
        </section>
      )}

      {(state?.error || note) && <p className={`${panel} text-sm text-danger-fg`} role="alert" data-testid="update-error">{state?.error || note}</p>}
      {state?.message && !state.error && <p className={`${panel} text-sm text-muted`}>{state.message}</p>}
    </div>
  );
};
