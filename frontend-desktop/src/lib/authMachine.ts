/**
 * The one place that decides which sign-in state the app is in. Pure table, no side effects: AuthContext performs the
 * work and reports what happened here. An event that does not apply to the current state is ignored, so a late
 * response (say a 401 arriving after the user locked the app) cannot move the app somewhere it should not be.
 */
export type AuthStatus =
  | 'INITIALIZING'
  | 'FIRST_TIME_LOGIN'
  | 'PIN_SETUP'
  | 'PIN_REQUIRED'
  | 'PIN_VERIFICATION'
  | 'AUTHENTICATED'
  | 'SESSION_EXPIRED'
  | 'ACCOUNT_RECOVERY'
  | 'LOGGED_OUT'
  | 'ERROR';

export type AuthEvent =
  | 'BOOT_NO_ACCOUNT' // nothing saved on this PC: Email + Password
  | 'BOOT_VAULT_FOUND' // a PIN is configured: PIN screen
  | 'BOOT_SESSION_NO_PIN' // a valid session from before PINs existed: choose a PIN
  | 'BOOT_SESSION_PLAIN' // web build, or PIN lock off: session restored as before
  | 'LOGIN_NEEDS_PIN' // password accepted, this PC can protect a PIN
  | 'LOGIN_NO_PIN' // password accepted, no PIN possible (web build, or Windows cannot protect it)
  | 'PIN_SET'
  | 'PIN_SUBMIT'
  | 'PIN_REJECTED'
  | 'SESSION_VALID' // the server accepted the session the PIN released
  | 'SESSION_REJECTED' // the server refused the session, or it no longer exists
  | 'FORGOT_PIN'
  | 'RECOVERY_CANCELLED'
  | 'LOCK'
  | 'LOGOUT'
  | 'FAIL'
  | 'RETRY';

const SIGNED_IN: Partial<Record<AuthEvent, AuthStatus>> = { LOGIN_NEEDS_PIN: 'PIN_SETUP', LOGIN_NO_PIN: 'AUTHENTICATED' };

const TRANSITIONS: Record<AuthStatus, Partial<Record<AuthEvent, AuthStatus>>> = {
  INITIALIZING: {
    BOOT_NO_ACCOUNT: 'FIRST_TIME_LOGIN',
    BOOT_VAULT_FOUND: 'PIN_REQUIRED',
    BOOT_SESSION_NO_PIN: 'PIN_SETUP',
    BOOT_SESSION_PLAIN: 'AUTHENTICATED',
    SESSION_REJECTED: 'SESSION_EXPIRED',
    FAIL: 'ERROR',
  },
  FIRST_TIME_LOGIN: { ...SIGNED_IN },
  PIN_SETUP: { PIN_SET: 'AUTHENTICATED', SESSION_REJECTED: 'SESSION_EXPIRED', LOGOUT: 'LOGGED_OUT', ...SIGNED_IN },
  PIN_REQUIRED: { PIN_SUBMIT: 'PIN_VERIFICATION', FORGOT_PIN: 'ACCOUNT_RECOVERY', LOGOUT: 'LOGGED_OUT', SESSION_REJECTED: 'SESSION_EXPIRED' },
  PIN_VERIFICATION: { PIN_REJECTED: 'PIN_REQUIRED', SESSION_VALID: 'AUTHENTICATED', SESSION_REJECTED: 'SESSION_EXPIRED', FAIL: 'ERROR' },
  AUTHENTICATED: { LOCK: 'PIN_REQUIRED', LOGOUT: 'LOGGED_OUT', SESSION_REJECTED: 'SESSION_EXPIRED' },
  SESSION_EXPIRED: { LOGOUT: 'LOGGED_OUT', ...SIGNED_IN },
  ACCOUNT_RECOVERY: { RECOVERY_CANCELLED: 'PIN_REQUIRED', LOGOUT: 'LOGGED_OUT', ...SIGNED_IN },
  LOGGED_OUT: { ...SIGNED_IN },
  ERROR: { RETRY: 'INITIALIZING' },
};

export const authReducer = (state: AuthStatus, event: AuthEvent): AuthStatus => TRANSITIONS[state][event] ?? state;

/** States where the app's screens may show a user's data. Only one. */
export const canShowApp = (state: AuthStatus): boolean => state === 'AUTHENTICATED';
