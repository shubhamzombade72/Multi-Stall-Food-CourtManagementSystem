/**
 * Where the running app keeps its API token.
 *  - memory (desktop app): the token lives in this variable while unlocked. At rest it exists only inside the sealed
 *    vault in the main process, so it is never in localStorage where any script could read it.
 *  - local (web build, or the PIN lock switched off for tests): localStorage, as it always was.
 */
export const LEGACY_TOKEN_KEY = 'fc_auth_token';
export const LEGACY_USER_KEY = 'fc_auth_user';

export type TokenMode = 'memory' | 'local';

let mode: TokenMode = typeof window !== 'undefined' && (window as { desktop?: unknown }).desktop ? 'memory' : 'local';
let memoryToken: string | null = null;

export const setTokenMode = (next: TokenMode): void => {
  mode = next;
};

export const getTokenMode = (): TokenMode => mode;

export const getAuthToken = (): string | null => (mode === 'memory' ? memoryToken : localStorage.getItem(LEGACY_TOKEN_KEY));

export const setAuthToken = (token: string): void => {
  if (mode === 'memory') memoryToken = token;
  else localStorage.setItem(LEGACY_TOKEN_KEY, token);
};

/** Removes the token wherever it is, including what an older version of the app left in localStorage. */
export const clearAuthToken = (): void => {
  memoryToken = null;
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem(LEGACY_USER_KEY);
  } catch {
    // storage unavailable: nothing was kept there either
  }
};
