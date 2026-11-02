/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API base URL, e.g. http://192.168.1.50:8000/api. Defaults to same-origin /api. */
  readonly VITE_API_BASE_URL?: string;
  /** 'true' shows the seeded demo-account quick-login buttons (never in staging/production). */
  readonly VITE_DEMO_LOGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
