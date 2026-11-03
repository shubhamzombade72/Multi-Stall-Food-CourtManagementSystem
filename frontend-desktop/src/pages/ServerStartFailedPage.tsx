import React, { useEffect, useState } from 'react';
import { desktop, type DesktopAppInfo } from '../desktop/bridge';
import { AlertTriangle } from 'lucide-react';

/** Shown only if the app's own server could not be started (rare: damaged install, blocked by security software). */
export const ServerStartFailedPage: React.FC<{ error: string; onRetry: () => Promise<void> }> = ({ error, onRetry }) => {
  const [info, setInfo] = useState<DesktopAppInfo | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    desktop()?.getAppInfo().then(setInfo).catch(() => undefined);
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 w-full max-w-xl">
        <h2 className="text-lg font-bold flex items-center space-x-2 text-rose-700">
          <AlertTriangle className="w-5 h-5" />
          <span>The Food Court system could not start</span>
        </h2>
        <p className="text-sm text-slate-700">
          The program&apos;s built-in server did not start. Your data has not been changed. Press <b>Try again</b>. If it keeps happening, restart this computer, or ask your
          antivirus / IT administrator to allow this application, then contact support.
        </p>
        <p role="note" className="text-xs font-mono text-slate-500 bg-slate-50 rounded-xl p-3 break-words">
          {error}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onRetry();
            } finally {
              setBusy(false);
            }
          }}
          className="px-4 py-2 bg-brand-500 text-white text-sm font-bold rounded-xl disabled:opacity-50"
        >
          {busy ? 'Starting…' : 'Try again'}
        </button>
        {info && <p className="text-xs text-slate-400">Support file: {info.logFile}</p>}
      </div>
    </div>
  );
};
