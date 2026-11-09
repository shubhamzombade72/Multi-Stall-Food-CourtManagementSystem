import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../api/client';
import { desktop } from '../desktop/bridge';
import { Lock, Mail, User as UserIcon, ArrowRight } from 'lucide-react';
import { RecoveryKeyPanel } from '../components/RecoveryKeyPanel';
import logoImg from '../assets/logo.jpg';

/**
 * Shown once on a new single-PC install (built-in server with an empty database). Creates the owner
 * account the business signs in with; there are no demo accounts or default passwords.
 */
export const FirstRunPage: React.FC = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  // If setup was already completed (or this is not a built-in server) there is nothing to do here
  useEffect(() => {
    apiClient
      .get('/setup/status')
      .then((r) => {
        if (r.data?.data?.recovery_required) navigate('/recover', { replace: true });
        else if (!r.data?.data?.needs_setup) navigate('/login', { replace: true });
      })
      .catch(() => navigate('/login', { replace: true }));
  }, [navigate]);

  // A new PC taking over from an old one: bring the old data in instead of creating a new owner
  const restoreInstead = async () => {
    setError(null);
    setRestoring(true);
    try {
      const r = await desktop()!.restoreBackup(null);
      if (r.ok) {
        window.location.hash = '#/login';
        window.location.reload();
      } else if (!r.cancelled) {
        setError(r.error || 'The backup could not be restored.');
      }
    } finally {
      setRestoring(false);
    }
  };

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
      const res = await apiClient.post('/setup/owner', { name: name.trim(), email: email.trim(), password });
      login(res.data.data.token, res.data.data.user);
      setRecoveryKey(res.data.data.recovery_key ?? null); // shown once before the dashboard opens
      if (!res.data.data.recovery_key) navigate('/', { replace: true });
    } catch (err: any) {
      if (err?.response?.status === 409) {
        navigate('/login', { replace: true });
        return;
      }
      const fieldErrors = err?.response?.data?.errors;
      setError((fieldErrors && (Object.values(fieldErrors)[0] as string[])?.[0]) || 'Could not create the account. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const input =
    'w-full pl-9 pr-3 py-2 rounded-lg border border-line bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent text-sm transition';

  if (recoveryKey) return <RecoveryKeyPanel recoveryKey={recoveryKey} onDone={() => navigate('/', { replace: true })} />;

  return (
    <div className="min-h-screen bg-canvas flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-surface rounded-lg shadow-2xl p-4 border border-line">
        <div className="text-center mb-4">
          <div className="w-16 h-16 rounded-lg overflow-hidden border-2 border-warning/40 mx-auto shadow-lg shadow-warning/20 mb-3 bg-surface-2 flex items-center justify-center">
            <img src={logoImg} alt="Logo" className="w-full h-full object-cover" />
          </div>
          <h2 className="text-xl font-bold text-fg tracking-tight">Welcome</h2>
          <p className="text-sm text-muted mt-1">Create the owner account for this Food Court. You will use it to sign in.</p>
        </div>

        {error && (
          <div role="alert" className="mb-4 p-2.5 rounded-lg bg-danger/10 border border-danger/30 text-danger-fg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="block text-xs font-semibold text-fg uppercase tracking-wider mb-1.5">Your name</span>
            <div className="relative">
              <UserIcon className="w-4 h-4 text-subtle absolute left-3 top-2.5" />
              <input id="owner-name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} className={input} autoComplete="name" />
            </div>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-fg uppercase tracking-wider mb-1.5">Email address</span>
            <div className="relative">
              <Mail className="w-4 h-4 text-subtle absolute left-3 top-2.5" />
              <input id="owner-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={input} autoComplete="email" />
            </div>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-fg uppercase tracking-wider mb-1.5">Password</span>
            <div className="relative">
              <Lock className="w-4 h-4 text-subtle absolute left-3 top-2.5" />
              <input id="owner-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={input} autoComplete="new-password" />
            </div>
            <span className="block text-xs text-muted mt-1">At least 8 characters, with letters and numbers.</span>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-fg uppercase tracking-wider mb-1.5">Confirm password</span>
            <div className="relative">
              <Lock className="w-4 h-4 text-subtle absolute left-3 top-2.5" />
              <input id="owner-confirm" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} autoComplete="new-password" />
            </div>
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full py-2 px-4 bg-primary hover:bg-primary/90 text-primary-fg font-semibold rounded-lg shadow-lg shadow-primary/25 flex items-center justify-center space-x-2 transition disabled:opacity-50 mt-2"
          >
            <span>{busy ? 'Creating…' : 'Create account and start'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
        <p className="text-xs text-muted mt-4 text-center">Write the password down somewhere safe. This account manages stalls, staff and reports.</p>
        <p className="text-xs text-center mt-3">
          <Link to="/connect-host" className="font-semibold text-primary hover:underline">Connect to an existing food court instead</Link>
        </p>
        {desktop() && (
          <p className="text-xs text-center mt-2">
            <button type="button" disabled={restoring} onClick={restoreInstead} className="font-semibold text-primary hover:underline disabled:opacity-50">
              {restoring ? 'Restoring…' : 'Restore from a backup (moving from another computer)'}
            </button>
          </p>
        )}
      </div>
    </div>
  );
};
