import axios from 'axios';
import { desktop, isDesktopApp, logError, type DesktopConfig } from '../desktop/bridge';
import { API_NOT_CONFIGURED } from '../lib/apiErrors';
import { clearAuthToken, getAuthToken } from '../lib/authToken';

// Web build: VITE_API_BASE_URL or same-origin /api (the web build is served next to the API).
// Desktop (Electron): there is NO build-time default and nobody types an address. The main process reports
// the address of this PC's own built-in server, or of the food court host this PC was connected to; it is
// loaded by initApiBaseUrl() once the startup screen reports ready. Until then API_BASE_URL is '' and every
// API call is refused with API_NOT_CONFIGURED instead of guessing a host.
export let API_BASE_URL: string = isDesktopApp() ? '' : import.meta.env.VITE_API_BASE_URL || '/api';

export const isApiConfigured = (): boolean => API_BASE_URL !== '';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
});

export const setApiBaseUrl = (url: string) => {
  API_BASE_URL = url;
  apiClient.defaults.baseURL = url;
};

let desktopConfig: DesktopConfig | null = null;

/** What the desktop main process resolved at startup (null in the web build). */
export const getDesktopConfig = (): DesktopConfig | null => desktopConfig;
export const setDesktopConfig = (cfg: DesktopConfig): void => {
  desktopConfig = cfg;
  if (cfg.apiBaseUrl) setApiBaseUrl(cfg.apiBaseUrl);
};

export const initApiBaseUrl = async (): Promise<void> => {
  const d = desktop();
  if (!d) return;
  try {
    const cfg = await d.getConfig();
    if (cfg) setDesktopConfig(cfg);
  } catch (err: any) {
    logError(`Could not read desktop configuration: ${err?.message || err}`);
  }
};

/** Laravel health endpoint lives at the server root (/up), next to /api. Empty when no server is configured. */
export const healthUrl = (): string => {
  if (!isApiConfigured()) return '';
  const base = API_BASE_URL.replace(/\/api\/?$/, '');
  return `${base || ''}/up`;
};

export const SESSION_EXPIRED_KEY = 'fc_session_expired';

let onSessionRejected: (() => void) | null = null;

/** AuthContext registers here: it owns what happens when the server stops accepting this session. */
export const setSessionRejectedHandler = (handler: (() => void) | null): void => {
  onSessionRejected = handler;
};

apiClient.interceptors.request.use((config) => {
  if (!isApiConfigured()) {
    return Promise.reject(Object.assign(new Error('No server address is configured'), { code: API_NOT_CONFIGURED, config }));
  }
  const token = getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // A 401 on the sign-in call itself is a credentials problem, not an expired session
      const isLogin = String(error.config?.url || '').includes('/auth/login');
      const current = getAuthToken();
      // A late answer to a request made with an older token (before a lock or a new sign-in) says nothing about this session
      const sameSession = Boolean(current) && error.config?.headers?.Authorization === `Bearer ${current}`;
      if (!isLogin && sameSession) {
        clearAuthToken();
        try {
          sessionStorage.setItem(SESSION_EXPIRED_KEY, '1');
        } catch {
          // storage unavailable: the user simply lands on the sign-in page
        }
        onSessionRejected?.();
      }
    } else if (error.code === API_NOT_CONFIGURED) {
      // expected until the operator enters the server address; not worth logging per request
    } else if (!error.response) {
      logError(`Network error calling ${error.config?.url}: ${error.message}`);
    } else if (error.response.status >= 500) {
      logError(`Server error ${error.response.status} on ${error.config?.url}`);
    }
    return Promise.reject(error);
  }
);
