import React, { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { SESSION_EXPIRED_KEY, apiClient, getDesktopConfig } from '../api/client';
import { describeLoginError } from '../lib/apiErrors';
import { Lock, Mail, ArrowRight, ShieldCheck } from 'lucide-react';
import logoImg from '../assets/logo.jpg';

// Seeded demo accounts are offered only in development or an explicitly enabled demo build,
// never in a staging / pilot / production build.
const DEMO_LOGIN = import.meta.env.DEV || import.meta.env.VITE_DEMO_LOGIN === 'true';
const DEMO_PASSWORD = 'password123';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const { login, status, account, notice: authNotice, cancelRecovery, switchAccount } = useAuth();
  const navigate = useNavigate();
  const builtIn = getDesktopConfig()?.mode === 'embedded';
  // Forgot PIN: the account is fixed, so a PIN can only be reset by proving this account's own password
  const recovery = status === 'ACCOUNT_RECOVERY' && account !== null;
  const shownNotice = recovery ? 'Forgot PIN? Re-authenticate to reset your PIN.' : notice || authNotice;

  // A brand-new single-PC install has no accounts yet: go to the one-time owner setup
  useEffect(() => {
    if (!builtIn || recovery) return;
    apiClient
      .get('/setup/status')
      .then((r) => {
        if (r.data?.data?.needs_setup) navigate('/first-run', { replace: true });
        else if (r.data?.data?.recovery_required) navigate('/recover', { replace: true });
      })
      .catch(() => undefined);
  }, [builtIn, recovery, navigate]);

  // The API interceptor leaves this flag when a stored session was rejected (expired or revoked token)
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_EXPIRED_KEY)) {
        sessionStorage.removeItem(SESSION_EXPIRED_KEY);
        setNotice('Your session has expired. Please sign in again.');
      }
    } catch {
      // storage unavailable: no notice
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setIsLoading(true);

    try {
      const response = await apiClient.post('/auth/login', { email: recovery ? account.email : email, password });
      if (response.data.success) {
        if (recovery && response.data.data.user.id !== account.id) {
          // Should not happen with the email fixed; refuse rather than hand this PC's PIN to another account
          apiClient.post('/auth/logout', null, { headers: { Authorization: `Bearer ${response.data.data.token}` } }).catch(() => undefined);
          setError('Those details belong to a different account. Go back and choose "Use a different account".');
          return;
        }
        login(response.data.data.token, response.data.data.user);
        navigate('/');
      }
    } catch (err: any) {
      const described = describeLoginError(err);
      let message = described.message;
      if (described.kind === 'setup_required') {
        navigate('/first-run', { replace: true });
        return;
      }
      if (described.kind === 'owner_missing') {
        navigate('/recover', { replace: true });
        return;
      }
      if (described.kind === 'unreachable' || described.kind === 'timeout') {
        message = builtIn
          ? 'The food court services are not responding. Close the application completely and open it again.'
          : 'This computer cannot reach the food court system. Check the network connection and that the main computer is switched on.';
      }
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const setQuickUser = (userEmail: string) => {
    setEmail(userEmail);
    setPassword(DEMO_PASSWORD);
    setError(null);
  };

  // Already signed in (for example the sign-in address was open when the PIN was entered)
  if (status === 'AUTHENTICATED' || status === 'PIN_SETUP') return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-canvas flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-surface rounded-lg shadow-2xl p-4 border border-line">
        <div className="text-center mb-4">
          <div className="w-16 h-16 rounded-lg overflow-hidden border-2 border-warning/40 mx-auto shadow-lg shadow-warning/20 mb-3 bg-surface-2 flex items-center justify-center">
            <img src={logoImg} alt="मंगलमूर्ती Logo" className="w-full h-full object-cover" />
          </div>
          <h2 className="text-xl font-bold text-fg tracking-tight">मंगलमूर्ती</h2>
          <p className="text-sm text-muted mt-1">Food Court POS & Management</p>
        </div>

        {shownNotice && (
          <div role="status" className="mb-4 p-2.5 rounded-lg bg-st-ready-soft border border-st-ready text-st-ready-fg text-sm">
            {shownNotice}
          </div>
        )}

        {error && (
          <div role="alert" className="mb-4 p-2.5 rounded-lg bg-danger/10 border border-danger/30 text-danger-fg text-sm flex items-center space-x-2">
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-fg uppercase tracking-wider mb-1.5">
              Email Address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-subtle absolute left-3 top-2.5" />
              <input
                type="email"
                required
                readOnly={recovery}
                value={recovery ? account.email : email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-line bg-surface read-only:bg-surface-2 text-fg focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent text-sm transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-fg uppercase tracking-wider mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-subtle absolute left-3 top-2.5" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-line bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent text-sm transition"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2 px-4 bg-primary hover:bg-primary/90 text-primary-fg font-semibold rounded-lg shadow-lg shadow-primary/25 flex items-center justify-center space-x-2 transition disabled:opacity-50 mt-2"
          >
            <span>{isLoading ? 'Authenticating...' : recovery ? 'Verify and reset PIN' : 'Sign In to Food Court'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
          {recovery && (
            <button type="button" onClick={cancelRecovery} className="w-full text-sm font-semibold text-primary hover:underline">
              Back to PIN
            </button>
          )}
        </form>

        {DEMO_LOGIN && !recovery && (
        <div className="mt-4 pt-4 border-t border-line">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider text-center mb-3">
            Quick 1-Click Role Login (demo data)
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setQuickUser('owner@foodcourt.com')}
              className="py-1.5 px-3 rounded-lg border border-line hover:border-primary hover:bg-primary/10 text-xs font-medium text-fg transition"
            >
              👑 Owner / Admin
            </button>
            <button
              onClick={() => setQuickUser('cashier@foodcourt.com')}
              className="py-1.5 px-3 rounded-lg border border-line hover:border-primary hover:bg-primary/10 text-xs font-medium text-fg transition"
            >
              💳 Central Cashier
            </button>
            <button
              onClick={() => setQuickUser('manager.pizza@foodcourt.com')}
              className="py-1.5 px-3 rounded-lg border border-line hover:border-primary hover:bg-primary/10 text-xs font-medium text-fg transition"
            >
              🍕 Pizza Manager
            </button>
            <button
              onClick={() => setQuickUser('waiter1@foodcourt.com')}
              className="py-1.5 px-3 rounded-lg border border-line hover:border-primary hover:bg-primary/10 text-xs font-medium text-fg transition"
            >
              🧑‍🍳 Waiter Staff
            </button>
          </div>
        </div>
        )}

        <div className="mt-4 flex items-center justify-between text-xs text-muted">
          <span className="flex items-center space-x-1.5">
            <ShieldCheck className="w-4 h-4 text-success-fg" />
            <span>Role-based access</span>
          </span>
          {builtIn && (
            // Owner forgot the password as well: the recovery key route replaces the password, so the old PIN goes with it
            <Link to="/recover" onClick={() => void (recovery ? switchAccount() : undefined)} className="font-semibold text-primary hover:underline">
              Forgot password?
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};
