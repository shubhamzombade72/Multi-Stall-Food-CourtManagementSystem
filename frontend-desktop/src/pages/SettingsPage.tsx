import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { API_BASE_URL, healthUrl, setApiBaseUrl } from '../api/client';
import { desktop, getReceiptPrinter, isDesktopApp, setReceiptPrinter, type DesktopAppInfo, type DesktopPrinter } from '../desktop/bridge';
import { Server, Printer, Info, CheckCircle2, XCircle } from 'lucide-react';

/**
 * Connection & device settings. Reachable before sign-in (/connection) so a new install can be pointed
 * at the food court server. Only the API address is stored; never database credentials.
 */
export const SettingsPage: React.FC<{ standalone?: boolean }> = ({ standalone }) => {
  const [url, setUrl] = useState(API_BASE_URL);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [info, setInfo] = useState<DesktopAppInfo | null>(null);
  const [printers, setPrinters] = useState<DesktopPrinter[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [receiptPrinter, setReceiptPrinterState] = useState(getReceiptPrinter());

  useEffect(() => {
    const d = desktop();
    if (d) {
      d.getAppInfo().then(setInfo).catch(() => undefined);
      d.listPrinters().then(setPrinters).catch(() => setPrinters([]));
    }
  }, []);

  const test = async (target = url) => {
    setStatus(null);
    try {
      const health = target.replace(/\/api\/?$/, '') + '/up';
      await axios.get(health, { timeout: 5000 });
      setStatus({ ok: true, text: `Connected to ${health}` });
      return true;
    } catch (err: any) {
      setStatus({ ok: false, text: `Cannot reach server: ${err.message}` });
      return false;
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const d = desktop();
    if (!d) return;
    setSaving(true);
    try {
      const r = await d.setApiBaseUrl(url);
      if (!r.ok || !r.apiBaseUrl) {
        setStatus({ ok: false, text: r.error || 'Invalid address' });
        return;
      }
      setApiBaseUrl(r.apiBaseUrl);
      setUrl(r.apiBaseUrl);
      await test(r.apiBaseUrl);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={standalone ? 'min-h-screen bg-slate-900 flex items-center justify-center p-4' : 'p-8 max-w-3xl mx-auto'}>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-6 w-full max-w-2xl">
        <section className="space-y-3">
          <h2 className="text-lg font-bold flex items-center space-x-2">
            <Server className="w-5 h-5" />
            <span>Server connection</span>
          </h2>
          <form onSubmit={save} className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700">Food court server API address</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={!isDesktopApp()}
              placeholder="http://192.168.1.50:8000/api"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono"
            />
            {!isDesktopApp() && <p className="text-xs text-slate-500">Web build: the address is fixed at build time (VITE_API_BASE_URL).</p>}
            <div className="flex space-x-2">
              {isDesktopApp() && (
                <button type="submit" disabled={saving} className="px-4 py-2 bg-brand-500 text-white text-sm font-bold rounded-xl disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save & test'}
                </button>
              )}
              <button type="button" onClick={() => test()} className="px-4 py-2 border border-slate-200 text-sm font-bold rounded-xl">
                Test connection
              </button>
            </div>
          </form>
          {status && (
            <div role="status" className={`flex items-center space-x-2 text-sm ${status.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
              {status.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              <span>{status.text}</span>
            </div>
          )}
          <p className="text-xs text-slate-400">Health check: {healthUrl()}</p>
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

        {standalone && (
          <Link to="/login" className="block text-center text-sm font-bold text-brand-600">
            ← Back to sign in
          </Link>
        )}
      </div>
    </div>
  );
};
