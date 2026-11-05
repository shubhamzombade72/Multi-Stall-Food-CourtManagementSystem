import React, { useCallback, useEffect, useRef, useState } from 'react';
import { desktop, type StartupStatus } from '../desktop/bridge';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import logoImg from '../assets/logo.jpg';

const STEPS: { phase: StartupStatus['phase']; label: string }[] = [
  { phase: 'starting', label: 'Starting application…' },
  { phase: 'preparing_database', label: 'Preparing database…' },
  { phase: 'connecting', label: 'Connecting to food court services…' },
  { phase: 'ready', label: 'Application ready.' },
];

/**
 * Shown while the application brings its own services up (desktop build only). Replaces the old "Server
 * connection" screen: nobody enters an address. It calls `onReady` once the services answer, and otherwise
 * explains in plain words what to do. Support details are only copied, never displayed.
 */
export const StartupScreen: React.FC<{ onReady: () => void }> = ({ onReady }) => {
  const [status, setStatus] = useState<StartupStatus>({ phase: 'starting', message: 'Starting application…' });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const stopped = useRef(false);

  const poll = useCallback(async () => {
    const d = desktop();
    if (!d) return;
    while (!stopped.current) {
      let s: StartupStatus;
      try {
        s = await d.getStartupStatus();
      } catch {
        s = { phase: 'failed', message: 'The application could not start. Close it and open it again.' };
      }
      if (stopped.current) return;
      setStatus(s);
      if (s.phase === 'ready') {
        stopped.current = true;
        onReady();
        return;
      }
      if (s.phase === 'failed' || s.phase === 'host_unreachable') return; // wait for the operator
      await new Promise((r) => setTimeout(r, 400));
    }
  }, [onReady]);

  useEffect(() => {
    stopped.current = false;
    poll();
    return () => {
      stopped.current = true;
    };
  }, [poll]);

  const retry = async () => {
    setBusy(true);
    setNote(null);
    try {
      if (status.phase === 'failed') await desktop()?.retryStart();
      stopped.current = false;
      setStatus({ phase: 'starting', message: 'Starting application…' });
      poll();
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await desktop()!.restoreBackup(null);
      if (r.ok) {
        stopped.current = false;
        poll();
      } else if (!r.cancelled) {
        setNote(r.error || 'The backup could not be restored.');
      }
    } finally {
      setBusy(false);
    }
  };

  const copySupport = async () => {
    try {
      const diag = await desktop()!.getDiagnostics();
      await navigator.clipboard.writeText(JSON.stringify(diag, null, 2));
      setNote('Support information copied. Paste it into your message to support.');
    } catch {
      setNote('Could not copy. Send the file named in the application folder "logs" instead.');
    }
  };

  const failed = status.phase === 'failed';
  const unreachable = status.phase === 'host_unreachable';
  const activeIndex = Math.max(0, STEPS.findIndex((s) => s.phase === status.phase));

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-surface rounded-lg shadow-2xl p-8 border border-line" role="status" aria-live="polite">
        <div className="text-center mb-6">
          <div className="w-20 h-20 rounded-lg overflow-hidden border-2 border-st-ready mx-auto shadow-lg mb-3 bg-canvas">
            <img src={logoImg} alt="Logo" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-xl font-bold text-fg">मंगलमूर्ती POS</h1>
        </div>

        {failed || unreachable ? (
          <div className="space-y-4">
            <p className="flex items-start space-x-2 text-danger-fg font-semibold">
              <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
              <span>{unreachable ? 'Cannot reach the food court' : 'Service unavailable. Contact your administrator.'}</span>
            </p>
            <p className="text-sm text-fg">{status.message}</p>
            {failed && <p className="text-xs text-muted">Your data has not been changed.</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={retry} className="px-4 py-2 bg-primary text-primary-fg text-sm font-bold rounded-lg disabled:opacity-50">
                {busy ? 'Trying…' : 'Try again'}
              </button>
              {failed && (
                <button type="button" disabled={busy} onClick={restore} className="px-4 py-2 border border-line text-sm font-bold rounded-lg disabled:opacity-50">
                  Restore a backup…
                </button>
              )}
              <button type="button" onClick={copySupport} className="px-4 py-2 border border-line text-sm font-bold rounded-lg">
                Copy support information
              </button>
            </div>
            {note && <p className="text-xs text-muted">{note}</p>}
          </div>
        ) : (
          <ol className="space-y-3">
            {STEPS.map((step, i) => {
              const done = i < activeIndex || status.phase === 'ready';
              const current = i === activeIndex && status.phase !== 'ready';
              const text = status.phase === 'degraded' && i === 2 ? status.message : step.label;
              return (
                <li key={step.phase} className={`flex items-center space-x-3 text-sm ${done ? 'text-success-fg' : current ? 'text-fg font-semibold' : 'text-muted'}`}>
                  {done ? <CheckCircle2 className="w-5 h-5" /> : current ? <Loader2 className="w-5 h-5 animate-spin" /> : <span className="w-5 h-5 rounded-full border border-line inline-block" />}
                  <span>{text}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
};
