import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { desktop, isDesktopApp } from '../desktop/bridge';
import { Network } from 'lucide-react';
import logoImg from '../assets/logo.jpg';

/**
 * Multi-PC food court: this computer joins the shared host with the connection code the owner (or the
 * administrator) shows on the host. The code carries the host's address, so nothing is typed but the code.
 */
export const ConnectHostPage: React.FC = () => {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    const d = desktop();
    if (!d) return;
    setError(null);
    setBusy(true);
    try {
      const r = await d.connectToHost(code);
      if (!r.ok) {
        setError(r.error || 'Could not connect.');
        return;
      }
      // Restart the session cleanly against the shared host
      localStorage.removeItem('fc_auth_token');
      localStorage.removeItem('fc_auth_user');
      window.location.hash = '#/login';
      window.location.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-surface rounded-lg shadow-2xl p-4 border border-line">
        <div className="text-center mb-4">
          <div className="w-16 h-16 rounded-lg overflow-hidden border-2 border-warning/40 mx-auto mb-3 bg-surface-2">
            <img src={logoImg} alt="Logo" className="w-full h-full object-cover" />
          </div>
          <h2 className="text-xl font-bold text-fg flex items-center justify-center space-x-2">
            <Network className="w-5 h-5" />
            <span>Connect to an existing food court</span>
          </h2>
          <p className="text-sm text-muted mt-1">
            Use this when the food court already has a main computer. Ask the owner to open <b>Device Settings → Connected computers → Add a computer</b> and paste the code they see.
          </p>
        </div>
        {!isDesktopApp() ? (
          <p className="text-sm text-muted">This is available in the Windows application.</p>
        ) : (
          <form onSubmit={connect} className="space-y-3">
            {error && (
              <div role="alert" className="p-2.5 rounded-lg bg-danger/10 border border-danger/30 text-danger-fg text-sm">
                {error}
              </div>
            )}
            <label className="block text-xs font-semibold text-fg uppercase tracking-wider" htmlFor="pair-code">
              Connection code
            </label>
            <textarea
              id="pair-code"
              required
              rows={3}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Paste the connection code here"
              className="w-full px-2.5 py-1.5 rounded-lg border border-line bg-surface text-fg text-xs font-mono"
              spellCheck={false}
              autoComplete="off"
            />
            <button type="submit" disabled={busy || !code.trim()} className="w-full py-2 px-4 bg-primary hover:bg-primary/90 text-primary-fg font-semibold rounded-lg disabled:opacity-50">
              {busy ? 'Connecting…' : 'Connect this computer'}
            </button>
          </form>
        )}
        <p className="text-center mt-4">
          <Link to="/login" className="text-sm font-bold text-primary">
            ← Back
          </Link>
        </p>
      </div>
    </div>
  );
};
