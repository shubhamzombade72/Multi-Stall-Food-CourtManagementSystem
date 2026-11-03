import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { API_BASE_URL, getDesktopConfig, healthUrl, isApiConfigured, setApiBaseUrl, setDesktopConfig } from '../api/client';
import { useConnection } from '../hooks/useConnection';
import { desktop, getReceiptPrinter, isDesktopApp, setReceiptPrinter, type DesktopAppInfo, type DesktopPrinter } from '../desktop/bridge';
import { Server, Printer, Info, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

/**
 * Connection & device settings. Reachable before sign-in (/connection) so a new install can be pointed
 * at the food court server. Only the API address is stored; never database credentials.
 * `onConfigured` is set by the first-run gate: it is called once a valid address has been saved.
 */
export const SettingsPage: React.FC<{ standalone?: boolean; setupRequired?: boolean; onConfigured?: () => void }> = ({ standalone, setupRequired, onConfigured }) => {
  const [url, setUrl] = useState(API_BASE_URL);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [info, setInfo] = useState<DesktopAppInfo | null>(null);
  const [printers, setPrinters] = useState<DesktopPrinter[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [receiptPrinter, setReceiptPrinterState] = useState(getReceiptPrinter());
  const { state: liveState } = useConnection();
  const builtIn = getDesktopConfig()?.mode === 'embedded';

  useEffect(() => {
    const d = desktop();
    if (d) {
      d.getAppInfo().then(setInfo).catch(() => undefined);
      d.listPrinters().then(setPrinters).catch(() => setPrinters([]));
    }
  }, []);

  const test = async (target = url): Promise<boolean> => {
    setStatus(null);
    setTesting(true);
    try {
      const d = desktop();
      if (d) {
        const r = await d.testConnection(target);
        setStatus({ ok: r.ok, text: r.ok ? `${r.message} (${r.url})` : r.message });
        return r.ok;
      }
      // Web build: the browser hides the failure reason, so only reachable / not reachable is known
      await axios.get(target.replace(/\/api\/?$/, '') + '/up', { timeout: 8000 });
      setStatus({ ok: true, text: 'Server reachable.' });
      return true;
    } catch (err: any) {
      setStatus({ ok: false, text: `Cannot reach the server: ${err.message}` });
      return false;
    } finally {
      setTesting(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const d = desktop();
    if (!d) return;
    setSaving(true);
    setWarnings([]);
    try {
      const r = await d.setApiBaseUrl(url);
      if (!r.ok || !r.apiBaseUrl) {
        setStatus({ ok: false, text: r.error || 'Invalid address' });
        return;
      }
      setApiBaseUrl(r.apiBaseUrl);
      setUrl(r.apiBaseUrl);
      setWarnings(r.warnings ?? []);
      const reachable = await test(r.apiBaseUrl);
      // First-run setup moves on only once the server answered, after a moment to read the confirmation.
      // On failure the operator stays here to correct the address (it is saved either way).
      if (reachable && onConfigured) setTimeout(onConfigured, 1200);
    } finally {
      setSaving(false);
    }
  };

  const useBuiltIn = async () => {
    const d = desktop();
    if (!d) return;
    setSaving(true);
    try {
      const cfg = await d.useBuiltInServer();
      if (cfg.mode === 'embedded' && cfg.apiBaseUrl) {
        setDesktopConfig(cfg);
        window.location.reload(); // restart the session cleanly against the built-in server
      } else {
        setStatus({ ok: false, text: cfg.error || 'This copy of the app has no built-in server.' });
      }
    } finally {
      setSaving(false);
    }
  };

  const liveLabel = liveState === 'online' ? 'Online' : liveState === 'offline' ? 'Offline' : 'Checking…';
  const liveColor = liveState === 'online' ? 'text-emerald-700' : liveState === 'offline' ? 'text-rose-700' : 'text-slate-500';

  return (
    <div className={standalone ? 'min-h-screen bg-slate-900 flex items-center justify-center p-4' : 'p-8 max-w-3xl mx-auto'}>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-6 w-full max-w-2xl">
        <section className="space-y-3">
          <h2 className="text-lg font-bold flex items-center space-x-2">
            <Server className="w-5 h-5" />
            <span>{setupRequired ? 'Server setup required' : 'Server connection'}</span>
          </h2>
          {setupRequired && (
            <p role="note" className="text-sm text-slate-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
              This copy of the app has not been told where the Food Court server is. Enter the server address you were given by your administrator (it ends in <span className="font-mono">/api</span>), then press <b>Save &amp; test</b>.
            </p>
          )}
          {builtIn ? (
            <div className="space-y-2 text-sm text-slate-700">
              <p>
                This app runs its own server on this computer. <span className={`font-semibold ${liveColor}`}>{liveLabel}</span>
              </p>
              {info?.dataDir && <p className="text-xs text-slate-500">Your data is stored on this computer, in: <span className="font-mono">{info.dataDir}</span></p>}
              <p className="text-xs text-slate-500">Data on this computer is not shared with other computers.</p>
              <details className="pt-2">
                <summary className="cursor-pointer text-xs font-semibold text-slate-600">Advanced: connect to a different server</summary>
                <div className="pt-3 space-y-2">
          <form onSubmit={save} className="space-y-2">
            <label htmlFor="api-url" className="block text-xs font-semibold text-slate-700">Food court server API address</label>
            <input
              id="api-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={!isDesktopApp()}
              placeholder="https://your-server.example.com/api"
              autoComplete="off"
              spellCheck={false}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono"
            />
            {!isDesktopApp() && <p className="text-xs text-slate-500">Web build: the address is fixed at build time (VITE_API_BASE_URL).</p>}
            <div className="flex space-x-2">
              {isDesktopApp() && (
                <button type="submit" disabled={saving || testing || !url.trim()} className="px-4 py-2 bg-brand-500 text-white text-sm font-bold rounded-xl disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save & test'}
                </button>
              )}
              <button type="button" onClick={() => test()} disabled={testing || saving || !url.trim()} className="px-4 py-2 border border-slate-200 text-sm font-bold rounded-xl disabled:opacity-50">
                {testing ? 'Testing…' : 'Test connection'}
              </button>
            </div>
          </form>
          {status && (
            <div role="status" className={`flex items-start space-x-2 text-sm ${status.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
              {status.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
              <span>{status.text}</span>
            </div>
          )}
          {warnings.map((w) => (
            <div key={w} role="alert" className="flex items-start space-x-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
                </div>
              </details>
            </div>
          ) : (
            <>
          <form onSubmit={save} className="space-y-2">
            <label htmlFor="api-url" className="block text-xs font-semibold text-slate-700">Food court server API address</label>
            <input
              id="api-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={!isDesktopApp()}
              placeholder="https://your-server.example.com/api"
              autoComplete="off"
              spellCheck={false}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono"
            />
            {!isDesktopApp() && <p className="text-xs text-slate-500">Web build: the address is fixed at build time (VITE_API_BASE_URL).</p>}
            <div className="flex space-x-2">
              {isDesktopApp() && (
                <button type="submit" disabled={saving || testing || !url.trim()} className="px-4 py-2 bg-brand-500 text-white text-sm font-bold rounded-xl disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save & test'}
                </button>
              )}
              <button type="button" onClick={() => test()} disabled={testing || saving || !url.trim()} className="px-4 py-2 border border-slate-200 text-sm font-bold rounded-xl disabled:opacity-50">
                {testing ? 'Testing…' : 'Test connection'}
              </button>
            </div>
          </form>
          {status && (
            <div role="status" className={`flex items-start space-x-2 text-sm ${status.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
              {status.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
              <span>{status.text}</span>
            </div>
          )}
          {warnings.map((w) => (
            <div key={w} role="alert" className="flex items-start space-x-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
              {isDesktopApp() && (
                <div className="pt-1">
                  <button type="button" onClick={useBuiltIn} disabled={saving || testing} className="text-xs font-semibold text-brand-600 hover:underline disabled:opacity-50">
                    Use the built-in server on this computer instead
                  </button>
                </div>
              )}
            </>
          )}
          {isApiConfigured() ? (
            <p className="text-xs text-slate-500">
              Current server: <span className="font-mono">{API_BASE_URL}</span> · <span className={`font-semibold ${liveColor}`}>{liveLabel}</span>
              <span className="text-slate-400"> · Health check: {healthUrl()}</span>
            </p>
          ) : (
            <p className="text-xs text-slate-500">Current server: <span className="font-semibold">not set</span></p>
          )}
        </section>

        {isDesktopApp() && (
          <section className="space-y-2">
            <h2 className="text-lg font-bold flex items-center space-x-2">
              <Printer className="w-5 h-5" />
              <span>Printers</span>
            </h2>
            {printers === null ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : printers.length === 0 ? (
              <p className="text-sm text-slate-500">No printers installed in Windows. Receipts use the system print dialog.</p>
            ) : (
              <>
                <ul className="text-sm space-y-1">
                  {printers.map((p) => (
                    <li key={p.name}>
                      {p.displayName || p.name} {p.isDefault && <span className="text-xs text-emerald-700 font-bold">(default)</span>}
                    </li>
                  ))}
                </ul>
                <label className="block text-xs font-semibold text-slate-700 pt-2">Receipt printer on this computer</label>
                <select
                  aria-label="Receipt printer"
                  value={receiptPrinter}
                  onChange={(e) => {
                    setReceiptPrinterState(e.target.value);
                    setReceiptPrinter(e.target.value);
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
                >
                  <option value="">Windows default printer</option>
                  {printers.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.displayName || p.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500">Preselected in the print dialog for receipts. Reports use the default printer.</p>
              </>
            )}
          </section>
        )}

        <section className="space-y-1 text-sm text-slate-600">
          <h2 className="text-lg font-bold flex items-center space-x-2 text-slate-900">
            <Info className="w-5 h-5" />
            <span>About</span>
          </h2>
          {info ? (
            <>
              <p>
                {info.name} v{info.version} · Electron {info.electron} · {info.platform} {info.packaged ? '(installed)' : '(development)'}
              </p>
              <p className="text-xs text-slate-400">Log file: {info.logFile}</p>
            </>
          ) : (
            <p>Web build</p>
          )}
        </section>

        {standalone && !setupRequired && (
          <Link to="/login" className="block text-center text-sm font-bold text-brand-600">
            ← Back to sign in
          </Link>
        )}
      </div>
    </div>
  );
};
