import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../api/client';
import { Store, Lock, Mail, ArrowRight, ShieldCheck } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await apiClient.post('/auth/login', { email, password });
      if (response.data.success) {
        login(response.data.data.token, response.data.data.user);
        if (response.data.data.user.role === 'cashier') {
          navigate('/pos');
        } else {
          navigate('/dashboard');
        }
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Login failed. Please verify your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const setQuickUser = (userEmail: string) => {
    setEmail(userEmail);
    setPassword('password123');
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 border border-slate-100">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-brand-500 rounded-2xl flex items-center justify-center text-white mx-auto shadow-lg shadow-brand-500/30 mb-3">
            <Store className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Urban Food Court</h2>
          <p className="text-sm text-slate-500 mt-1">Multi-Stall Management & POS Platform</p>
        </div>

        {error && (
          <div className="mb-6 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-center space-x-2">
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

        <div className="mt-8 pt-6 border-t border-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider text-center mb-3">
            Quick 1-Click Role Login
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

        <div className="mt-6 flex items-center justify-center space-x-1.5 text-xs text-slate-400">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span>Role-Based PostgreSQL Access Control</span>
        </div>
      </div>
    </div>
  );
};

