import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL, SESSION_EXPIRED_KEY, apiClient, getDesktopConfig } from '../api/client';
import { desktop } from '../desktop/bridge';
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

  const { login } = useAuth();
  const navigate = useNavigate();
  const builtIn = getDesktopConfig()?.mode === 'embedded';

  // A brand-new single-PC install has no accounts yet: go to the one-time owner setup
  useEffect(() => {
    if (!builtIn) return;
    apiClient
      .get('/setup/status')
      .then((r) => {
        if (r.data?.data?.needs_setup) navigate('/first-run', { replace: true });
      })
      .catch(() => undefined);
  }, [builtIn, navigate]);

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
      const response = await apiClient.post('/auth/login', { email, password });
      if (response.data.success) {
        login(response.data.data.token, response.data.data.user);
        navigate('/');
      }
    } catch (err: any) {
      const described = describeLoginError(err);
      let message = described.message;
      // Server not reachable at all: ask the desktop main process WHY (DNS, certificate, refused, timeout)
      if (builtIn && (described.kind === 'unreachable' || described.kind === 'timeout')) {
        message = "The program's built-in server is not responding. Close the app completely and open it again.";
      } else if (described.kind === 'unreachable' || described.kind === 'timeout') {
        const d = desktop();
        if (d && API_BASE_URL) {
          try {
            const probe = await d.testConnection(API_BASE_URL);
            if (!probe.ok) message = probe.message;
          } catch {
            // keep the generic message
          }
        }
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

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 border border-slate-100">
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-2xl overflow-hidden border-2 border-amber-300 mx-auto shadow-lg shadow-amber-500/20 mb-3 bg-slate-900 flex items-center justify-center">
            <img src={logoImg} alt="मंगलमूर्ती Logo" className="w-full h-full object-cover" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">मंगलमूर्ती</h2>
          <p className="text-sm text-slate-500 mt-1">Multi-Stall Food Court Management & POS</p>
        </div>

        {notice && (
          <div role="status" className="mb-6 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
            {notice}
          </div>
        )}

        {error && (
          <div role="alert" className="mb-6 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-center space-x-2">
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Email Address
            </label>
            <div className="relative">
              <Mail className="w-5 h-5 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@foodcourt.com"
                className="w-full pl-11 pr-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock className="w-5 h-5 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-11 pr-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm transition"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 px-4 bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-xl shadow-lg shadow-brand-500/25 flex items-center justify-center space-x-2 transition disabled:opacity-50 mt-2"
          >
            <span>{isLoading ? 'Authenticating...' : 'Sign In to Food Court'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {DEMO_LOGIN && (
        <div className="mt-8 pt-6 border-t border-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider text-center mb-3">
            Quick 1-Click Role Login (demo data)
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setQuickUser('owner@foodcourt.com')}
              className="py-1.5 px-3 rounded-lg border border-slate-200 hover:border-brand-500 hover:bg-brand-50 text-xs font-medium text-slate-700 transition"
            >
              👑 Owner / Admin
            </button>
            <button
              onClick={() => setQuickUser('cashier@foodcourt.com')}
              className="py-1.5 px-3 rounded-lg border border-slate-200 hover:border-brand-500 hover:bg-brand-50 text-xs font-medium text-slate-700 transition"
            >
              💳 Central Cashier
            </button>
            <button
              onClick={() => setQuickUser('manager.pizza@foodcourt.com')}
              className="py-1.5 px-3 rounded-lg border border-slate-200 hover:border-brand-500 hover:bg-brand-50 text-xs font-medium text-slate-700 transition"
            >
              🍕 Pizza Manager
            </button>
            <button
              onClick={() => setQuickUser('waiter1@foodcourt.com')}
              className="py-1.5 px-3 rounded-lg border border-slate-200 hover:border-brand-500 hover:bg-brand-50 text-xs font-medium text-slate-700 transition"
            >
              🧑‍🍳 Waiter Staff
            </button>
          </div>
        </div>
        )}

        <div className="mt-6 flex items-center justify-between text-xs text-slate-400">
          <span className="flex items-center space-x-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>Role-based access</span>
          </span>
          {!builtIn && (
            <Link to="/connection" className="font-semibold text-brand-600 hover:underline">
              Server settings
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};
