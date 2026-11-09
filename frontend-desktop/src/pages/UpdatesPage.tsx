import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Download, FolderOpen, RefreshCw, ShieldAlert } from 'lucide-react';
import { desktop, type UpdatePolicy, type UpdateState } from '../desktop/bridge';
import { getAuthToken } from '../lib/authToken';

const POLICY_TEXT: Record<UpdatePolicy['mode'], string> = {
  idle: 'Install by itself as soon as this computer is not in use',
  silent: 'Install by itself during the night window',
  approve_once: 'Ask me once, then install during the night window',
  ask: 'Only when I press Update Now',
};

const WAITING_TEXT: Record<string, string> = {
  unsaved_cart: 'an open cart',
  unsaved_payment: 'an open payment',
  unsaved_form: 'an unsaved form',
  request_in_flight: 'a sale being saved',
  recent_write: 'recent activity',
  print_jobs: 'printing',
  backup_or_restore: 'a backup',
  upi_payment_open: 'an open UPI payment',
};
const waitingText = (code: string) => WAITING_TEXT[code] ?? 'the application being busy';

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

/** Software updates for this computer: what is ready, when it will install, and the rules for that. */
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
    const result = await api.updateNow(getAuthToken() ?? '');
    if (!result.ok) setNote(result.error ?? 'The update could not start.');
    setBusy(false);
    refresh();
  };

  const setPolicy = async (next: UpdatePolicy) => {
    setBusy(true);
    setNote(null);
    const result = await api.updateSetPolicy(getAuthToken() ?? '', next);
    if (result.ok === false) setNote(result.error ?? 'The rule could not be changed.');
    setBusy(false);
    refresh();
  };

  const approve = async () => {
    setBusy(true);
    await api.updateApprove(getAuthToken() ?? '');
    setBusy(false);
    refresh();
  };

  const installFromFolder = async () => {
    setBusy(true);
    setNote(null);
    const result = await api.updateInstallFromFolder(getAuthToken() ?? '');
    if (result.ok) setNote(`Version ${result.version} was checked and is ready. You can remove the pen drive.`);
    else if (!result.cancelled) setNote(result.error ?? 'That folder does not hold a usable update.');
    setBusy(false);
    refresh();
  };

  const update = state?.update;
  // Updates download by themselves, so an offered version may already be on this PC: never present it as still to fetch
  const downloaded = Boolean(update && state?.pending?.version === update.version);
  const running = state ? ['downloading', 'verifying', 'installing'].includes(state.phase) : false;
  const percent = state?.progress?.total ? Math.min(100, Math.round((state.progress.received / state.progress.total) * 100)) : 0;
  const last = state?.lastResult;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6" data-testid="updates-page">
      <header>
        <h1 className="text-2xl font-bold text-fg">Software updates</h1>
        <p className="mt-1 text-sm text-muted">
          Current version <strong data-testid="update-current-version">{state?.currentVersion ?? '…'}</strong>. Your data is backed up before any update, and it never installs during an open bill.
        </p>
      </header>

      {state?.pending && (
        <section className={panel} data-testid="update-ready">
          <p className="flex items-center gap-2 font-semibold text-fg"><Clock className="h-5 w-5" /> Version <span data-testid="update-ready-version">{state.pending.version}</span> is downloaded and checked</p>
          <p className="mt-1 text-sm text-muted" data-testid="update-install-time">
            {state.policy.mode === 'idle' && state.pending.installAt
              ? 'It will install by itself as soon as this computer is not in use. There is nothing you need to do. The application restarts during this.'
              : state.pending.installAt
              ? `It will install around ${new Date(state.pending.installAt).toLocaleString()}, when the application is free. The application restarts during this.`
              : state.policy.mode === 'approve_once'
                ? 'It is waiting for your approval.'
                : 'It will install when you press Update Now. The application restarts during this.'}
          </p>
          {state.waitingFor.length > 0 && <p className="mt-1 text-sm text-muted" data-testid="update-waiting">Waiting for: {[...new Set(state.waitingFor.map(waitingText))].join(', ')}.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {!downloaded && <button type="button" disabled={busy || running} onClick={() => setConfirming(true)} className={primary} data-testid="update-ready-now"><Download className="h-4 w-4" /> Update Now</button>}
            {state.policy.mode === 'approve_once' && !state.pending.approved && <button type="button" disabled={busy} onClick={approve} className={secondary} data-testid="update-approve">Approve for tonight</button>}
          </div>
          {confirming && !update && (
            <div className="mt-3 space-y-3 rounded-lg border border-line p-4" data-testid="update-ready-confirm">
              <p className="text-sm text-fg">The application will close, back up your data, install version {state.pending.version} and open again.</p>
              <div className="flex gap-2">
                <button type="button" onClick={updateNow} className={primary} data-testid="update-ready-confirm-yes">Close and update</button>
                <button type="button" onClick={() => setConfirming(false)} className={secondary}>Not now</button>
              </div>
            </div>
          )}
        </section>
      )}

      {state && !state.policyLocked && (
        <section className={`${panel} space-y-3`} data-testid="update-policy">
          <h2 className="font-semibold text-fg">When to install</h2>
          <select aria-label="When to install" disabled={busy} value={state.policy.mode} onChange={(e) => setPolicy({ ...state.policy, mode: e.target.value as UpdatePolicy['mode'] })} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg" data-testid="update-policy-mode">
            {(Object.keys(POLICY_TEXT) as UpdatePolicy['mode'][]).map((mode) => <option key={mode} value={mode}>{POLICY_TEXT[mode]}</option>)}
          </select>
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg">
            <span>Night window</span>
            <input aria-label="Window start" type="time" disabled={busy} value={state.policy.window.start} onChange={(e) => e.target.value && setPolicy({ ...state.policy, window: { ...state.policy.window, start: e.target.value } })} className="rounded-lg border border-line bg-surface px-2 py-1" />
            <span>to</span>
            <input aria-label="Window end" type="time" disabled={busy} value={state.policy.window.end} onChange={(e) => e.target.value && setPolicy({ ...state.policy, window: { ...state.policy.window, end: e.target.value } })} className="rounded-lg border border-line bg-surface px-2 py-1" />
          </div>
          <p className="text-xs text-muted">If this computer is off or busy during the window, the update installs the next time the application opens.</p>
        </section>
      )}

      {state?.hasKeys && (
        <section className={panel} data-testid="update-from-folder">
          <h2 className="font-semibold text-fg">Update without internet</h2>
          <p className="mt-1 text-sm text-muted">Choose the update folder from your software provider, usually on a pen drive. It is checked before anything changes.</p>
          <button type="button" disabled={busy || running} onClick={installFromFolder} className={`${secondary} mt-3`} data-testid="update-choose-folder"><FolderOpen className="h-4 w-4" /> Choose update folder</button>
        </section>
      )}

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

      {state?.blocked && <p className={`${panel} text-sm text-muted`} data-testid="update-disabled">{state.hasKeys ? `Online updates are off: ${state.blocked}` : state.blocked}</p>}

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
                <p className="font-semibold text-fg" data-testid="update-available">Version <span data-testid="update-available-version">{update.version}</span> {downloaded ? 'is ready to install' : 'is available'}{update.required ? ' (required)' : ''}</p>
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
                <div><dt className="text-muted">{downloaded ? 'Size' : 'Download size'}</dt><dd className="text-fg" data-testid="update-size">{megabytes(update.packageSize)}</dd></div>
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
                  <button type="button" disabled={busy} onClick={() => setConfirming(true)} className={primary} data-testid="update-now">{downloaded ? 'Install now' : <><Download className="h-4 w-4" /> Update Now</>}</button>
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
