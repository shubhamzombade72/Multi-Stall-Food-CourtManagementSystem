import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { formatWait } from '../lib/pin';
import { Delete, Loader2, Lock } from 'lucide-react';
import logoImg from '../assets/logo.jpg';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * Daily sign-in: this PC's account, a masked PIN and a keypad (the keyboard works too). The main process checks the
 * PIN and enforces the delays and locks; this screen only shows them.
 */
export const PinLoginPage: React.FC = () => {
  const { account, pinInfo, status, unlockWithPin, forgotPin, switchAccount } = useAuth();
  const pinLength = pinInfo?.pinLength ?? 4;
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [blockedUntil, setBlockedUntil] = useState(() => (pinInfo?.retryAfterMs ? Date.now() + pinInfo.retryAfterMs : 0));
  const [locked, setLocked] = useState(Boolean(pinInfo?.locked));
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);

  const busy = status === 'PIN_VERIFICATION';
  const waitMs = Math.max(0, blockedUntil - now);
  const blocked = waitMs > 0;

  useEffect(() => {
    if (!blockedUntil) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= blockedUntil) {
        setBlockedUntil(0);
        setLocked(false);
        setError(null);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [blockedUntil]);

  const press = useCallback(
    (digit: string) => {
      setError(null);
      setPin((p) => (p.length < pinLength ? p + digit : p));
    },
    [pinLength]
  );
  const backspace = useCallback(() => setPin((p) => p.slice(0, -1)), []);

  const submit = useCallback(async () => {
    if (inFlight.current || pin.length !== pinLength || blocked) return;
    inFlight.current = true;
    const entered = pin;
    setPin('');
    setError(null);
    try {
      const result = await unlockWithPin(entered);
      if (result.ok) return;
      const code = result.code;
      const wait = 'retryAfterMs' in result ? result.retryAfterMs ?? 0 : 0;
      if (wait > 0) {
        const t = Date.now();
        setNow(t);
        setBlockedUntil(t + wait);
      }
      if (code === 'locked') {
        setLocked(true);
        setError('Too many incorrect attempts. PIN sign-in is temporarily locked.');
      } else if (code === 'wrong_pin') {
        const left = 'attemptsLeft' in result ? result.attemptsLeft ?? 0 : 0;
        setError(`Incorrect PIN. ${left} attempt${left === 1 ? '' : 's'} left before a temporary lock.`);
      } else if (code === 'wait') {
        setError('Please wait a moment before trying again.');
      } else if (code === 'unavailable') {
        setError('Windows cannot open the saved sign-in right now. Use "Forgot PIN?" to sign in with your password.');
      }
    } catch {
      setError('The PIN could not be checked. Please try again.');
    } finally {
      inFlight.current = false;
    }
  }, [blocked, pin, pinLength, unlockWithPin]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy || blocked) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') backspace();
      else if (e.key === 'Enter') void submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [backspace, blocked, busy, press, submit]);

  const useOther = () => {
    if (window.confirm('Remove the saved sign-in from this computer so another person can sign in? The PIN will be deleted and the email and password will be needed again.')) {
      void switchAccount();
    }
  };

  const keyClass = 'h-14 rounded-lg border border-line bg-surface-2 text-fg text-xl font-semibold hover:border-primary hover:bg-primary/10 focus:outline-none focus:ring-2 focus:ring-focus transition disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-surface-2';

  return (
    <div className="min-h-screen bg-canvas flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-sm bg-surface rounded-lg shadow-2xl p-6 border border-line">
        <div className="text-center mb-5">
          <div className="w-16 h-16 rounded-lg overflow-hidden border-2 border-warning/40 mx-auto shadow-lg shadow-warning/20 mb-3 bg-surface-2 flex items-center justify-center">
            <img src={logoImg} alt="मंगलमूर्ती Logo" className="w-full h-full object-cover" />
          </div>
          <h2 className="text-xl font-bold text-fg tracking-tight">Welcome Back</h2>
          <p className="text-sm font-semibold text-fg mt-1">{account?.name}</p>
          <p className="text-xs text-muted">{account?.email}</p>
        </div>

        <div className="flex justify-center space-x-3 mb-4" role="img" aria-label={`${pin.length} of ${pinLength} PIN digits entered`} data-testid="pin-dots">
          {Array.from({ length: pinLength }, (_, i) => (
            <span key={i} data-filled={i < pin.length} className={`w-3.5 h-3.5 rounded-full border-2 transition ${i < pin.length ? 'bg-primary border-primary' : 'border-line bg-transparent'}`} />
          ))}
        </div>

        <div className="min-h-[3.5rem] mb-2 text-center" aria-live="polite">
          {error && (
            <p role="alert" className="text-sm text-danger-fg">
              {error}
            </p>
          )}
          {blocked && (
            <p className="text-sm text-muted mt-0.5" data-testid="pin-wait">
              {locked ? 'Try again in' : 'Next try in'} {formatWait(waitMs)}
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {KEYS.map((k) => (
            <button key={k} type="button" disabled={busy || blocked} onClick={() => press(k)} data-testid={`pin-key-${k}`} className={keyClass}>
              {k}
            </button>
          ))}
          <div />
          <button type="button" disabled={busy || blocked} onClick={() => press('0')} data-testid="pin-key-0" className={keyClass}>
            0
          </button>
          <button type="button" disabled={busy || blocked} onClick={backspace} aria-label="Backspace" data-testid="pin-backspace" className={`${keyClass} flex items-center justify-center`}>
            <Delete className="w-5 h-5" />
          </button>
        </div>

        <button
          type="button"
          disabled={busy || blocked || pin.length !== pinLength}
          onClick={() => void submit()}
          className="w-full mt-4 py-2.5 px-4 bg-primary hover:bg-primary/90 text-primary-fg font-semibold rounded-lg shadow-lg shadow-primary/25 flex items-center justify-center space-x-2 transition disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
          <span>{busy ? 'Checking…' : 'Unlock'}</span>
        </button>

        <div className="mt-4 flex items-center justify-between text-xs">
          <button type="button" onClick={forgotPin} disabled={busy} className="font-semibold text-primary hover:underline disabled:opacity-50">
            Forgot PIN?
          </button>
          <button type="button" onClick={useOther} disabled={busy} className="font-semibold text-muted hover:text-fg hover:underline disabled:opacity-50">
            Use a different account
          </button>
        </div>
      </div>
    </div>
  );
};
