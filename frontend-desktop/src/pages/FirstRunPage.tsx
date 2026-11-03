import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../api/client';
import { Lock, Mail, User as UserIcon, ArrowRight } from 'lucide-react';
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
  const { login } = useAuth();
  const navigate = useNavigate();

  // If setup was already completed (or this is not a built-in server) there is nothing to do here
  useEffect(() => {
    apiClient
      .get('/setup/status')
      .then((r) => {
        if (!r.data?.data?.needs_setup) navigate('/login', { replace: true });
      })
      .catch(() => navigate('/login', { replace: true }));
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
      const res = await apiClient.post('/setup/owner', { name: name.trim(), email: email.trim(), password });
      login(res.data.data.token, res.data.data.user);
      navigate('/', { replace: true });
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
    'w-full pl-11 pr-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm transition';

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 border border-slate-100">
        <div className="text-center mb-6">
          <div className="w-20 h-20 rounded-2xl overflow-hidden border-2 border-amber-300 mx-auto shadow-lg shadow-amber-500/20 mb-3 bg-slate-900 flex items-center justify-center">
            <img src={logoImg} alt="Logo" className="w-full h-full object-cover" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Welcome</h2>
          <p className="text-sm text-slate-500 mt-1">Create the owner account for this Food Court. You will use it to sign in.</p>
        </div>

        {error && (
          <div role="alert" className="mb-4 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">Your name</span>
            <div className="relative">
              <UserIcon className="w-5 h-5 text-slate-400 absolute left-3.5 top-3" />
              <input id="owner-name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} className={input} autoComplete="name" />
            </div>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">Email address</span>
            <div className="relative">
              <Mail className="w-5 h-5 text-slate-400 absolute left-3.5 top-3" />
              <input id="owner-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={input} autoComplete="email" />
            </div>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">Password</span>
            <div className="relative">
              <Lock className="w-5 h-5 text-slate-400 absolute left-3.5 top-3" />
              <input id="owner-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={input} autoComplete="new-password" />
            </div>
            <span className="block text-xs text-slate-400 mt-1">At least 8 characters, with letters and numbers.</span>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">Confirm password</span>
            <div className="relative">
              <Lock className="w-5 h-5 text-slate-400 absolute left-3.5 top-3" />
              <input id="owner-confirm" type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} autoComplete="new-password" />
            </div>
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 px-4 bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-xl shadow-lg shadow-brand-500/25 flex items-center justify-center space-x-2 transition disabled:opacity-50 mt-2"
          >
            <span>{busy ? 'Creating…' : 'Create account and start'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
        <p className="text-xs text-slate-400 mt-4 text-center">Write the password down somewhere safe. This account manages stalls, staff and reports.</p>
      </div>
    </div>
  );
};
