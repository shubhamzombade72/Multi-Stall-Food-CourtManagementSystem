import axios from 'axios';
import { desktop, logError } from '../desktop/bridge';

// Web build: VITE_API_BASE_URL or same-origin /api. Desktop (Electron): the URL saved in the app's
// configuration, loaded by initApiBaseUrl() before the UI renders.
export let API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL || '/api';

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

export const initApiBaseUrl = async (): Promise<void> => {
  const d = desktop();
  if (!d) return;
  try {
    const cfg = await d.getConfig();
    if (cfg?.apiBaseUrl) setApiBaseUrl(cfg.apiBaseUrl);
  } catch (err: any) {
    logError(`Could not read desktop configuration: ${err?.message || err}`);
  }
};

/** Laravel health endpoint lives at the server root (/up), next to /api. */
export const healthUrl = (): string => {
  const base = API_BASE_URL.replace(/\/api\/?$/, '');
  return `${base || ''}/up`;
};

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('fc_auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('fc_auth_token');
      localStorage.removeItem('fc_auth_user');
      if (!window.location.hash.startsWith('#/login')) {
        window.location.hash = '#/login';
      }
    } else if (!error.response) {
      logError(`Network error calling ${error.config?.url}: ${error.message}`);
    } else if (error.response.status >= 500) {
      logError(`Server error ${error.response.status} on ${error.config?.url}`);
    }
    return Promise.reject(error);
  }
);
