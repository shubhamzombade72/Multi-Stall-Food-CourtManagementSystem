import React, { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState } from 'react';
import { apiClient, setSessionRejectedHandler, SESSION_EXPIRED_KEY } from '../api/client';
import { desktop, logError, type VaultAccount, type VaultSetupResult, type VaultUnlockResult } from '../desktop/bridge';
import { authReducer, type AuthStatus } from '../lib/authMachine';
import { clearAuthToken, getAuthToken, LEGACY_TOKEN_KEY, LEGACY_USER_KEY, setAuthToken, setTokenMode } from '../lib/authToken';
import { resetEcho } from '../realtime/echo';

export interface User {
  id: number;
  name: string;
  email: string;
  role: 'owner' | 'cashier' | 'stall_manager' | 'kitchen_staff' | 'waiter' | 'store_staff';
  phone: string | null;
  stall_id: number | null;
  stall?: {
    id: number;
    name: string;
    code: string;
  } | null;
}

/** What the PIN screen shows before anything is unlocked. */
export interface PinInfo {
  pinLength: number;
  locked: boolean;
  retryAfterMs: number;
  attemptsLeft: number;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  status: AuthStatus;
  /** The account this PC's PIN belongs to (known without unlocking) */
  account: VaultAccount | null;
  pinInfo: PinInfo | null;
  /** A plain-language note for the sign-in screen, such as why the saved sign-in is gone */
  notice: string | null;
  errorMessage: string | null;
  /** True when this PC protects its session with a PIN, so Lock is meaningful */
  pinEnabled: boolean;
  login: (token: string, user: User) => void;
  logout: () => Promise<void>;
  lock: () => void;
  setupPin: (pin: string) => Promise<VaultSetupResult>;
  unlockWithPin: (pin: string) => Promise<VaultUnlockResult | { ok: false; code: 'session_expired' | 'server_unreachable' }>;
  forgotPin: () => void;
  cancelRecovery: () => void;
  /** Removes this PC's saved sign-in without opening it, for when someone else needs to sign in. */
  switchAccount: () => Promise<void>;
  retry: () => void;
  isOwner: boolean;
  isCashier: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** vault: PIN protected desktop. none: no PIN possible, so the session lasts until the app closes. local: web build or tests. */
type PinMode = 'vault' | 'none' | 'local';

const USER_CACHE_PREFIXES = ['foodcourt.notifications.seen.'];

const clearUserCaches = () => {
  try {
    Object.keys(localStorage)
      .filter((k) => USER_CACHE_PREFIXES.some((p) => k.startsWith(p)))
      .forEach((k) => localStorage.removeItem(k));
    sessionStorage.clear();
  } catch {
    // storage unavailable: nothing was kept there either
  }
};

const readLegacySession = (): { token: string; user: User } | null => {
  try {
    const token = localStorage.getItem(LEGACY_TOKEN_KEY);
    const saved = localStorage.getItem(LEGACY_USER_KEY);
    if (!token || !saved) return null;
    return { token, user: JSON.parse(saved) };
  } catch {
    return null;
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, dispatch] = useReducer(authReducer, 'INITIALIZING' as AuthStatus);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [account, setAccount] = useState<VaultAccount | null>(null);
  const [pinInfo, setPinInfo] = useState<PinInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bootAttempt, setBootAttempt] = useState(0);
  const pinMode = useRef<PinMode>(desktop() ? 'vault' : 'local');
  const bootedFor = useRef(-1);

  const forgetSession = useCallback(() => {
    clearAuthToken();
    resetEcho();
    setToken(null);
    setUser(null);
  }, []);

  // The server stopped accepting this session (expired, revoked, signed in elsewhere). A PIN cannot bring it back.
  useEffect(() => {
    setSessionRejectedHandler(() => {
      resetEcho();
      setToken(null);
      setUser(null);
      setAccount(null);
      setPinInfo(null);
      if (pinMode.current === 'vault') desktop()?.authVaultClear().catch(() => undefined);
      dispatch('SESSION_REJECTED');
    });
    return () => setSessionRejectedHandler(null);
  }, []);

  const applyVaultState = useCallback(async (): Promise<boolean> => {
    const st = await desktop()!.authVaultStatus();
    if (st.state !== 'ready') return false;
    setAccount(st.account);
    setPinInfo({ pinLength: st.pinLength, locked: st.locked, retryAfterMs: st.retryAfterMs, attemptsLeft: st.attemptsLeft });
    return true;
  }, []);

  // Startup decision: no account -> Email + Password; account without a PIN -> PIN setup; otherwise -> PIN screen.
  useEffect(() => {
    if (bootedFor.current === bootAttempt) return; // StrictMode runs effects twice; the startup decision runs once
    bootedFor.current = bootAttempt;

    const restorePlainSession = () => {
      setTokenMode('local');
      pinMode.current = 'local';
      const saved = readLegacySession();
      if (saved) {
        setToken(saved.token);
        setUser(saved.user);
        dispatch('BOOT_SESSION_PLAIN');
      } else {
        dispatch('BOOT_NO_ACCOUNT');
      }
    };

    const boot = async () => {
      const d = desktop();
      if (!d) return restorePlainSession();

      const vault = await d.authVaultStatus();
      if (vault.state === 'disabled') return restorePlainSession();

      setTokenMode('memory');
      if (vault.state === 'unavailable') {
        pinMode.current = 'none';
        clearAuthToken();
        setNotice('Windows cannot protect a PIN on this account, so you will sign in with your password each time.');
        return dispatch('BOOT_NO_ACCOUNT');
      }
      pinMode.current = 'vault';
      if (vault.state === 'corrupt') {
        clearAuthToken();
        setNotice('The saved sign-in on this computer could not be read. Please sign in again.');
        return dispatch('BOOT_NO_ACCOUNT');
      }
      if (vault.state === 'ready') {
        clearAuthToken(); // the vault is the only saved session; remove anything an older version left behind
        setAccount(vault.account);
        setPinInfo({ pinLength: vault.pinLength, locked: vault.locked, retryAfterMs: vault.retryAfterMs, attemptsLeft: vault.attemptsLeft });
        return dispatch('BOOT_VAULT_FOUND');
      }

      // No PIN yet. An install from before PINs existed has its session in localStorage: keep the user signed in, check
      // the session is still good, and move it out of localStorage on the way to choosing a PIN.
      const legacy = readLegacySession();
      if (!legacy) {
        clearAuthToken();
        return dispatch('BOOT_NO_ACCOUNT');
      }
      setAuthToken(legacy.token);
      try {
        const me = await apiClient.get('/auth/me');
        clearAuthToken();
        setAuthToken(legacy.token); // memory only from here on
        setToken(legacy.token);
        setUser(me.data.data.user);
        dispatch('BOOT_SESSION_NO_PIN');
      } catch (err: any) {
        if (err?.response?.status === 401) return; // the API layer already reported SESSION_REJECTED
        setErrorMessage('Could not reach the food court system to check your sign-in.');
        dispatch('FAIL');
      }
    };

    boot().catch((err) => {
      logError(`Sign-in startup failed: ${err?.message || err}`);
      setErrorMessage('The application could not read its sign-in information.');
      dispatch('FAIL');
    });
  }, [bootAttempt]);

  const login = useCallback((newToken: string, newUser: User) => {
    setAuthToken(newToken);
    if (pinMode.current === 'local') localStorage.setItem(LEGACY_USER_KEY, JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
    setNotice(null);
    dispatch(pinMode.current === 'vault' ? 'LOGIN_NEEDS_PIN' : 'LOGIN_NO_PIN');
  }, []);

  const setupPin = useCallback(async (pin: string): Promise<VaultSetupResult> => {
    const current = getAuthToken();
    if (!current || !user) return { ok: false, code: 'invalid_session' };
    const result = await desktop()!.authVaultSetup({
      pin,
      token: current,
      account: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
    if (result.ok) {
      setAccount(result.account);
      dispatch('PIN_SET');
    }
    return result;
  }, [user]);

  const unlockWithPin = useCallback<AuthContextType['unlockWithPin']>(async (pin) => {
    dispatch('PIN_SUBMIT');
    const result = await desktop()!.authVaultUnlock(pin);
    if (!result.ok) {
      if (result.code === 'wiped' || result.code === 'corrupt' || result.code === 'no_vault') {
        setAccount(null);
        setPinInfo(null);
        setNotice(result.code === 'wiped' ? 'Too many wrong PINs. Please sign in with your email and password.' : 'The saved sign-in on this computer could not be read. Please sign in again.');
        dispatch('SESSION_REJECTED');
      } else {
        dispatch('PIN_REJECTED');
      }
      return result;
    }

    // The PIN only opened this PC's copy of the session. The server decides whether that session is still good.
    setAuthToken(result.token);
    try {
      const me = await apiClient.get('/auth/me');
      setToken(result.token);
      setUser(me.data.data.user);
      setNotice(null);
      dispatch('SESSION_VALID');
      return result;
    } catch (err: any) {
      if (err?.response?.status === 401) return { ok: false, code: 'session_expired' }; // already handled by the API layer
      clearAuthToken();
      setErrorMessage('Your PIN is correct, but the food court system is not responding. Check that it is running and try again.');
      dispatch('FAIL');
      return { ok: false, code: 'server_unreachable' };
    }
  }, []);

  const lock = useCallback(() => {
    if (pinMode.current !== 'vault') return;
    const finish = (ready: boolean) => {
      forgetSession();
      window.location.hash = '#/';
      // The saved sign-in vanished while unlocked: there is nothing a PIN could open
      dispatch(ready ? 'LOCK' : 'LOGOUT');
    };
    applyVaultState().then(finish).catch(() => finish(false));
  }, [applyVaultState, forgetSession]);

  const logout = useCallback(async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // Ignore network errors on logout: the local sign-in is removed either way
    } finally {
      forgetSession();
      setAccount(null);
      setPinInfo(null);
      setNotice(null);
      clearUserCaches();
      try {
        sessionStorage.removeItem(SESSION_EXPIRED_KEY);
      } catch {
        // storage unavailable
      }
      if (pinMode.current === 'vault') await desktop()?.authVaultClear().catch(() => undefined);
      dispatch('LOGOUT');
      window.location.hash = '#/login';
    }
  }, [forgetSession]);

  const forgotPin = useCallback(() => dispatch('FORGOT_PIN'), []);

  const cancelRecovery = useCallback(() => {
    applyVaultState()
      .then((ready) => dispatch(ready ? 'RECOVERY_CANCELLED' : 'LOGOUT'))
      .catch(() => dispatch('LOGOUT'));
  }, [applyVaultState]);

  const switchAccount = useCallback(async () => {
    forgetSession();
    setAccount(null);
    setPinInfo(null);
    clearUserCaches();
    await desktop()?.authVaultClear().catch(() => undefined);
    dispatch('LOGOUT');
  }, [forgetSession]);

  const retry = useCallback(() => {
    setErrorMessage(null);
    dispatch('RETRY');
    setBootAttempt((n) => n + 1);
  }, []);

  const isOwner = user?.role === 'owner';
  const isCashier = user?.role === 'cashier' || isOwner;

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading: status === 'INITIALIZING',
        status,
        account,
        pinInfo,
        notice,
        errorMessage,
        pinEnabled: pinMode.current === 'vault',
        login,
        logout,
        lock,
        setupPin,
        unlockWithPin,
        forgotPin,
        cancelRecovery,
        switchAccount,
        retry,
        isOwner,
        isCashier,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
