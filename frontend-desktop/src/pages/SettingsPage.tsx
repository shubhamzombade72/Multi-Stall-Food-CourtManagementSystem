import React, { useCallback, useEffect, useState } from 'react';
import { apiClient, getDesktopConfig, setDesktopConfig } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useConnection } from '../hooks/useConnection';
import {
  desktop,
  getReceiptPrinter,
  getReceiptWidth,
  setReceiptWidth,
  isDesktopApp,
  setReceiptPrinter,
  type BackupStatus,
  type DesktopAppInfo,
  type DesktopDiagnostics,
  type DesktopPrinter,
} from '../desktop/bridge';
import { RecoveryKeyPanel } from '../components/RecoveryKeyPanel';
import { SoundSettingsSection } from '../components/SoundSettingsSection';
import { PrintersSection } from '../components/PrintersSection';
import { Printer, Info, DatabaseBackup, Network, LifeBuoy, KeyRound, CheckCircle2, XCircle } from 'lucide-react';

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'never');

const btn = 'px-4 py-2 border border-line text-sm font-bold rounded-lg disabled:opacity-50';
const primary = 'px-4 py-2 bg-primary text-primary-fg text-sm font-bold rounded-lg disabled:opacity-50';

/**
 * Device settings. Printers and "About" are for everyone on this PC; backups, connected computers and
 * support information are owner-only. There is no server address anywhere on this page.
 */
export const SettingsPage: React.FC = () => {
  const { isOwner } = useAuth();
  const [info, setInfo] = useState<DesktopAppInfo | null>(null);
  const [printers, setPrinters] = useState<DesktopPrinter[] | null>(null);
  const [receiptPrinter, setReceiptPrinterState] = useState(getReceiptPrinter());
  const [receiptWidth, setReceiptWidthState] = useState<58 | 80>(getReceiptWidth());
  const { state: liveState } = useConnection();
  const mode = getDesktopConfig()?.mode;

  useEffect(() => {
    const d = desktop();
    if (d) {
      d.getAppInfo().then(setInfo).catch(() => undefined);
      d.listPrinters().then(setPrinters).catch(() => setPrinters([]));
    }
  }, []);

  const liveLabel = liveState === 'online' ? 'Working normally' : liveState === 'offline' ? 'Not responding' : 'Checking…';
  const liveColor = liveState === 'online' ? 'text-success-fg' : liveState === 'offline' ? 'text-danger-fg' : 'text-muted';

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <div className="bg-surface rounded-lg border border-line p-4 space-y-4 w-full">
        <section className="space-y-1 text-sm text-fg">
          <h2 className="text-base font-semibold text-fg">Status</h2>
          <p>
            Food court system: <span className={`font-semibold ${liveColor}`}>{liveLabel}</span>
          </p>
          {mode === 'embedded' && <p className="text-xs text-muted">Data is stored safely on this computer and is not shared with other computers.</p>}
          {mode === 'remote' && <p className="text-xs text-muted">This computer shares its data with the other computers of this food court.</p>}
        </section>

        {isDesktopApp() && (
          <section className="space-y-2">
            <h2 className="text-base font-semibold flex items-center space-x-2">
              <Printer className="w-5 h-5" />
              <span>Printers</span>
            </h2>
            {printers === null ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : printers.length === 0 ? (
              <p className="text-sm text-muted">No printers installed in Windows. Receipts use the system print dialog.</p>
            ) : (
              <>
                <ul className="text-sm space-y-1">
                  {printers.map((p) => (
                    <li key={p.name}>
                      {p.displayName || p.name} {p.isDefault && <span className="text-xs text-success-fg font-bold">(default)</span>}
                    </li>
                  ))}
                </ul>
                <label className="block text-xs font-semibold text-fg pt-2">Receipt printer on this computer</label>
                <select
                  aria-label="Receipt printer"
                  value={receiptPrinter}
                  onChange={(e) => {
                    setReceiptPrinterState(e.target.value);
                    setReceiptPrinter(e.target.value);
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-line text-sm"
                >
                  <option value="">Windows default printer</option>
                  {printers.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.displayName || p.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted">Preselected in the print dialog for receipts. Reports use the default printer.</p>
              </>
            )}
            <label className="block text-xs font-semibold text-fg pt-2" htmlFor="receipt-width">
              Receipt paper width on this computer
            </label>
            <select
              id="receipt-width"
              data-testid="receipt-width"
              value={receiptWidth}
              onChange={(e) => {
                const w = Number(e.target.value) === 58 ? 58 : 80;
                setReceiptWidthState(w);
                setReceiptWidth(w);
              }}
              className="w-full px-3 py-2 rounded-lg border border-line text-sm"
            >
              <option value={80}>80 mm roll (default)</option>
              <option value={58}>58 mm roll</option>
            </select>
            <p className="text-xs text-muted">Bills and the UPI QR are laid out for this width. Choose the roll loaded in this computer's receipt printer.</p>
          </section>
        )}

        <PrintersSection />

        <SoundSettingsSection />

        {isOwner && isDesktopApp() && mode === 'embedded' && <BackupSection />}
        {isOwner && isDesktopApp() && mode === 'embedded' && <RecoveryKeySection />}
        {isOwner && mode === 'remote' && <ConnectedComputersSection />}
        {isOwner && isDesktopApp() && <SupportSection mode={mode} />}

        <section className="space-y-1 text-sm text-muted">
          <h2 className="text-base font-semibold flex items-center space-x-2 text-fg">
            <Info className="w-5 h-5" />
            <span>About</span>
          </h2>
          <p className="text-xs text-muted">Powered by MangalMurti Tech Solution</p>
          {info ? (
            <p>
              {info.name} v{info.version} · {info.platform}
            </p>
          ) : (
            <p>MangalMurti POS · Web build</p>
          )}
        </section>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ backups
const BackupSection: React.FC = () => {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    desktop()?.getBackupStatus().then(setStatus).catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string; cancelled?: boolean }>, okText: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (r.cancelled) return;
      setMsg({ ok: r.ok, text: r.ok ? okText : r.error || 'That did not work.' });
      load();
      return r;
    } finally {
      setBusy(false);
    }
  };

  const restore = async (name: string | null) => {
    const r = await run(() => desktop()!.restoreBackup(name), 'Backup restored. Locking the app…');
    if (r?.ok) {
      localStorage.removeItem('fc_auth_token');
      localStorage.removeItem('fc_auth_user');
      setTimeout(() => {
        window.location.hash = '#/login';
        window.location.reload();
      }, 1200);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold flex items-center space-x-2">
        <DatabaseBackup className="w-5 h-5" />
        <span>Backup &amp; recovery</span>
      </h2>
      {!status ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <>
          <p className="text-sm text-fg">
            A backup is made automatically every day while the application is open. Every backup is checked after it is made. Last successful backup: <b>{when(status.lastBackupAt)}</b>.
          </p>
          {status.lastError && (
            <p role="alert" className="text-sm text-danger-fg bg-danger/10 border border-danger/30 rounded-lg p-3">
              The last backup failed ({when(status.lastError.at)}): {status.lastError.message}
            </p>
          )}
          <p className="text-xs text-muted">
            Backups are kept in <span className="font-mono">{status.directory}</span>. Choose a USB drive or a cloud-synced folder so they survive if this computer fails.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => run(() => desktop()!.backupNow(), 'Backup made and checked.')} className={primary}>
              {busy ? 'Working…' : 'Back up now'}
            </button>
            <button type="button" disabled={busy} onClick={() => run(() => desktop()!.chooseBackupFolder(), 'Backup folder changed.')} className={btn}>
              Choose backup folder…
            </button>
            <button type="button" disabled={busy} onClick={() => restore(null)} className={btn}>
              Restore from a file…
            </button>
          </div>
          {msg && (
            <p role="status" className={`flex items-start space-x-2 text-sm ${msg.ok ? 'text-success-fg' : 'text-danger-fg'}`}>
              {msg.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
              <span>{msg.text}</span>
            </p>
          )}
          {status.backups.length > 0 && (
            <div className="border border-line rounded-lg divide-y divide-line max-h-56 overflow-y-auto">
              {status.backups.map((b) => (
                <div key={b.name} className="flex items-center justify-between px-3 py-2 text-xs">
                  <span>
                    {when(b.modified)} · {b.kind} · {mb(b.bytes)}
                  </span>
                  <button type="button" disabled={busy} onClick={() => restore(b.name)} className="font-bold text-primary hover:underline disabled:opacity-50">
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
};

// ------------------------------------------------------------------ recovery key
const RecoveryKeySection: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);

  const issue = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await apiClient.post('/setup/recovery-key', { password });
      setKey(r.data.data.recovery_key);
    } catch (err: any) {
      setError(err?.response?.data?.errors?.password?.[0] || 'Could not create a recovery key.');
    }
  };

  if (key) {
    return (
      <div className="fixed inset-0 !m-0 z-50 overflow-y-auto">
        <RecoveryKeyPanel recoveryKey={key} title="Save your new recovery key" onDone={() => { setKey(null); setOpen(false); setPassword(''); }} />
      </div>
    );
  }

  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold flex items-center space-x-2">
        <KeyRound className="w-5 h-5" />
        <span>Owner recovery key</span>
      </h2>
      <p className="text-sm text-fg">The recovery key lets the owner back in if the password is forgotten. Create a new one if the old one is lost; the old key stops working.</p>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className={btn}>
          Create a new recovery key…
        </button>
      ) : (
        <form onSubmit={issue} className="space-y-2 max-w-sm">
          <input aria-label="Your password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Confirm with your password" className="w-full px-3 py-2 rounded-lg border border-line text-sm" autoComplete="current-password" />
          {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
          <button type="submit" className={primary}>Create key</button>
        </form>
      )}
    </section>
  );
};

// ------------------------------------------------------------------ connected computers (shared host)
interface DeviceRow {
  id: number;
  name: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}

const ConnectedComputersSection: React.FC = () => {
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [code, setCode] = useState<{ pairing_string: string; code: string; expires_at: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    apiClient
      .get('/pairing/devices')
      .then((r) => setDevices(r.data.data))
      .catch((e) => setDevices(e?.response?.status === 404 ? null : []));
  }, []);
  useEffect(load, [load]);

  if (devices === null) return null; // this host does not offer pairing

  const add = async () => {
    setError(null);
    setCopied(false);
    try {
      const r = await apiClient.post('/pairing/codes');
      setCode(r.data.data);
    } catch {
      setError('Could not create a connection code.');
    }
  };

  const revoke = async (d: DeviceRow) => {
    if (!window.confirm(`Disconnect ${d.name}? It will not be able to sign in until it is connected again.`)) return;
    await apiClient.delete(`/pairing/devices/${d.id}`).catch(() => undefined);
    load();
  };

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold flex items-center space-x-2">
        <Network className="w-5 h-5" />
        <span>Connected computers</span>
      </h2>
      <p className="text-sm text-fg">Counter, kitchen and waiter computers join this food court with a one-time connection code. Nobody has to type an address.</p>
      <button type="button" onClick={add} className={primary}>
        Add a computer
      </button>
      {error && <p role="alert" className="text-sm text-danger-fg">{error}</p>}
      {code && (
        <div className="bg-canvas border border-line rounded-lg p-3 space-y-2">
          <p className="text-xs text-muted">
            On the other computer choose <b>Connect to an existing food court</b> and paste this. It works once and expires at {new Date(code.expires_at).toLocaleTimeString()}.
          </p>
          <textarea readOnly rows={3} value={code.pairing_string} className="w-full px-2 py-1 rounded-lg border border-line text-xs font-mono" onFocus={(e) => e.currentTarget.select()} />
          <button
            type="button"
            className={btn}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(code.pairing_string);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? 'Copied' : 'Copy code'}
          </button>
        </div>
      )}
      {devices.length > 0 && (
        <div className="border border-line rounded-lg divide-y divide-line">
          {devices.map((d) => (
            <div key={d.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>
                {d.name} <span className="text-xs text-muted">· last seen {when(d.last_seen_at)}</span>
                {d.revoked_at && <span className="ml-2 text-xs font-bold text-danger-fg">disconnected</span>}
              </span>
              {!d.revoked_at && (
                <button type="button" onClick={() => revoke(d)} className="text-xs font-bold text-danger-fg hover:underline">
                  Disconnect
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

// ------------------------------------------------------------------ support (administrator)
const SupportSection: React.FC<{ mode?: string }> = ({ mode }) => {
  const [diag, setDiag] = useState<DesktopDiagnostics | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setDiag(await desktop()!.getDiagnostics());
    } catch {
      setNote('Could not collect support information.');
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(diag, null, 2));
      setNote('Support information copied.');
    } catch {
      setNote('Could not copy.');
    }
  };

  const leaveHost = async () => {
    if (!window.confirm('Disconnect this computer from the food court and go back to its own separate data? Orders from the shared food court will no longer be visible here.')) return;
    setBusy(true);
    try {
      const cfg = await desktop()!.useBuiltInServer();
      if (cfg.mode === 'embedded' && cfg.apiBaseUrl) {
        setDesktopConfig(cfg);
        localStorage.removeItem('fc_auth_token');
        localStorage.removeItem('fc_auth_user');
        window.location.hash = '#/login';
        window.location.reload();
      } else {
        setNote(cfg.error || 'This copy of the application cannot run on its own.');
      }
    } finally {
      setBusy(false);
    }
  };

  const ready = diag?.readiness && diag.readiness.reachable ? (diag.readiness.report as { ready?: boolean; database?: boolean; migrations_current?: boolean } | undefined) : undefined;

  return (
    <details className="border border-line rounded-lg p-3" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && !diag && load()}>
      <summary className="cursor-pointer text-sm font-bold flex items-center space-x-2 inline-flex">
        <LifeBuoy className="w-4 h-4" />
        <span>Support information (administrator)</span>
      </summary>
      <div className="pt-3 space-y-2 text-sm text-fg">
        {!diag ? (
          <p>Collecting…</p>
        ) : (
          <>
            <p>
              Version {diag.app.version} · {diag.mode} · status: <b>{diag.startup.phase}</b>
            </p>
            <p>
              Services: {diag.readiness?.reachable ? 'responding' : 'not responding'}
              {ready && (
                <>
                  {' · '}database {ready.database ? 'OK' : 'problem'} · updates {ready.migrations_current ? 'current' : 'pending'}
                </>
              )}
            </p>
            <p className="text-xs text-muted">
              Log file: <span className="font-mono">{diag.paths.log}</span>
              {diag.paths.data && (
                <>
                  <br />
                  Data folder: <span className="font-mono">{diag.paths.data}</span>
                </>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={copy} className={btn}>
                Copy support information
              </button>
              <button type="button" onClick={load} className={btn}>
                Refresh
              </button>
              {mode === 'remote' && (
                <button type="button" disabled={busy} onClick={leaveHost} className={btn}>
                  Disconnect from the food court…
                </button>
              )}
            </div>
          </>
        )}
        {note && <p className="text-xs text-muted">{note}</p>}
      </div>
    </details>
  );
};
