import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { RecoveryKeyPanel } from '../components/RecoveryKeyPanel';
import { KeyRound } from 'lucide-react';
import logoImg from '../assets/logo.jpg';

/**
 * Owner access recovery for a single-PC install: the recovery key shown at setup resets a forgotten owner
 * password, or restores the owner account if it was deleted. A fresh key is issued afterwards.
 */
export const RecoverOwnerPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsName, setNeedsName] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    apiClient
      .get('/setup/status')
      .then((r) => {
        if (r.data?.data?.needs_setup) navigate('/first-run', { replace: true });
        setNeedsName(Boolean(r.data?.data?.recovery_required));
      })
      .catch(() => undefined);
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setError('Choose a password of at least 8 characters that includes letters and numbers.');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiClient.post('/setup/recover', { email: email.trim(), recovery_key: key, password, name: name.trim() || undefined });
      setNewKey(res.data.data.recovery_key);
    } catch (err: any) {
      const status = err?.response?.status;
      const fieldErrors = err?.response?.data?.errors;
      if (status === 429) setError('Too many tries. Wait a minute and try again.');
      else if (fieldErrors) setError((Object.values(fieldErrors)[0] as string[])?.[0] || 'Could not restore access.');
      else setError('Could not restore access. Close and reopen the application, then try again.');
    } finally {
      setBusy(false);
    }
  };

  if (newKey) return <RecoveryKeyPanel title="Access restored: save your NEW recovery key" recoveryKey={newKey} onDone={() => navigate('/login', { replace: true })} />;

  const input = 'w-full px-3 py-2 rounded-lg border border-line bg-surface text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-focus text-sm';
  return (
    <div className="min-h-screen bg-canvas flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-surface rounded-lg shadow-2xl p-4 border border-line">
        <div className="text-center mb-4">
          <div className="w-16 h-16 rounded-lg overflow-hidden border-2 border-warning/40 mx-auto mb-3 bg-surface-2">
            <img src={logoImg} alt="Logo" className="w-full h-full object-cover" />
          </div>
          <h2 className="text-xl font-bold text-fg flex items-center justify-center space-x-2">
            <KeyRound className="w-5 h-5" />
            <span>Restore owner access</span>
          </h2>
          <p className="text-sm text-muted mt-1">Enter the recovery key you saved when this Food Court was set up.</p>
        </div>
        {error && (
          <div role="alert" className="mb-4 p-2.5 rounded-lg bg-danger/10 border border-danger/30 text-danger-fg text-sm">
            {error}
          </div>
        )}
        <form onSubmit={submit} className="space-y-3">
          <input aria-label="Owner email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Owner email address" className={input} autoComplete="username" />
          {needsName && <input aria-label="Owner name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Owner name" className={input} />}
          <input aria-label="Recovery key" required value={key} onChange={(e) => setKey(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" className={`${input} font-mono`} autoComplete="off" spellCheck={false} />
          <input aria-label="New password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password (8+ characters, letters and numbers)" className={input} autoComplete="new-password" />
          <input aria-label="Confirm new password" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new password" className={input} autoComplete="new-password" />
          <button type="submit" disabled={busy} className="w-full py-2 px-4 bg-primary hover:bg-primary/90 text-primary-fg font-semibold rounded-lg disabled:opacity-50">
            {busy ? 'Checking…' : 'Restore access'}
          </button>
        </form>
        <p className="text-xs text-muted mt-4 text-center">
          No recovery key? Contact your supplier&apos;s support: they can help if you can prove you own this Food Court.
        </p>
        <p className="text-center mt-3">
          <Link to="/login" className="text-sm font-bold text-primary">
            ← Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
};
