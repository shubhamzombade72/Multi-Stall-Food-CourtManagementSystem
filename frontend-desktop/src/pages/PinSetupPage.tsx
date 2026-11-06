import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { checkNewPin } from '../lib/pin';
import { KeyRound, Loader2 } from 'lucide-react';
import logoImg from '../assets/logo.jpg';

/** After the password has been accepted: choose the PIN that opens this PC from now on. */
export const PinSetupPage: React.FC = () => {
  const { user, setupPin, logout } = useAuth();
  const [length, setLength] = useState<4 | 6>(6);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const digitsOnly = (value: string) => value.replace(/\D/g, '').slice(0, length);

  const chooseLength = (next: 4 | 6) => {
    setLength(next);
    setPin('');
    setConfirm('');
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pin.length !== length) {
      setError(`Enter a PIN of exactly ${length} digits.`);
      return;
    }
    if (checkNewPin(pin) === 'weak') {
      setError('That PIN is too easy to guess. Avoid repeated digits and simple sequences such as 1234.');
      return;
    }
    if (pin !== confirm) {
      setError('The two PINs do not match.');
      return;
    }
    setBusy(true);
    try {
      const result = await setupPin(pin);
      if (result.ok) return; // the app opens by itself
      if (result.code === 'weak_pin') setError('That PIN is too easy to guess. Choose another.');
      else if (result.code === 'unavailable') setError('Windows cannot protect a PIN on this account. Sign out and contact your administrator.');
      else setError('The PIN could not be saved. Please try again.');
    } catch {
      setError('The PIN could not be saved. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full px-3 py-2 rounded-lg border border-line bg-surface text-fg text-center tracking-[0.5em] font-mono focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition';
  const lengthClass = (active: boolean) =>
    `flex-1 py-1.5 rounded-lg border text-sm font-semibold transition ${active ? 'bg-primary border-primary text-primary-fg' : 'border-line bg-surface text-fg hover:border-primary'}`;

  return (
    <div className="min-h-screen bg-canvas flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-sm bg-surface rounded-lg shadow-2xl p-6 border border-line">
        <div className="text-center mb-5">
          <div className="w-16 h-16 rounded-lg overflow-hidden border-2 border-warning/40 mx-auto shadow-lg shadow-warning/20 mb-3 bg-surface-2 flex items-center justify-center">
            <img src={logoImg} alt="मंगलमूर्ती Logo" className="w-full h-full object-cover" />
          </div>
          <h2 className="text-xl font-bold text-fg tracking-tight flex items-center justify-center space-x-2">
            <KeyRound className="w-5 h-5" />
            <span>Create your PIN</span>
          </h2>
          <p className="text-sm text-muted mt-1">
            {user?.name ? `${user.name}, you` : 'You'} will use this PIN to open the app on this computer instead of your email and password.
          </p>
        </div>

        {error && (
          <div role="alert" className="mb-4 p-2.5 rounded-lg bg-danger/10 border border-danger/30 text-danger-fg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div className="flex space-x-2" role="group" aria-label="PIN length">
            <button type="button" aria-pressed={length === 6} onClick={() => chooseLength(6)} className={lengthClass(length === 6)}>
              6 digits (safer)
            </button>
            <button type="button" aria-pressed={length === 4} onClick={() => chooseLength(4)} className={lengthClass(length === 4)}>
              4 digits
            </button>
          </div>
          <div>
            <label htmlFor="pin-new" className="block text-xs font-semibold text-fg uppercase tracking-wider mb-1.5">
              Create PIN
            </label>
            <input id="pin-new" type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={length} value={pin} onChange={(e) => setPin(digitsOnly(e.target.value))} className={input} />
          </div>
          <div>
            <label htmlFor="pin-confirm" className="block text-xs font-semibold text-fg uppercase tracking-wider mb-1.5">
              Confirm PIN
            </label>
            <input id="pin-confirm" type="password" inputMode="numeric" autoComplete="off" maxLength={length} value={confirm} onChange={(e) => setConfirm(digitsOnly(e.target.value))} className={input} />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 px-4 bg-primary hover:bg-primary/90 text-primary-fg font-semibold rounded-lg shadow-lg shadow-primary/25 flex items-center justify-center space-x-2 transition disabled:opacity-50"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{busy ? 'Saving…' : 'Save PIN and continue'}</span>
          </button>
          <button type="button" disabled={busy} onClick={() => void logout()} className="w-full text-xs font-semibold text-muted hover:text-fg hover:underline disabled:opacity-50">
            Cancel and sign out
          </button>
        </form>
      </div>
    </div>
  );
};
