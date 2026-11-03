/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Web build only: API base URL, e.g. https://your-server.example.com/api. Defaults to same-origin /api. Ignored by the desktop app. */
  readonly VITE_API_BASE_URL?: string;
  /** 'true' shows the seeded demo-account quick-login buttons (never in staging/production). */
  readonly VITE_DEMO_LOGIN?: string;
  /** Optional Reverb (realtime) settings; without a key every screen relies on polling only. */
  readonly VITE_REVERB_APP_KEY?: string;
  readonly VITE_REVERB_HOST?: string;
  readonly VITE_REVERB_PORT?: string;
  readonly VITE_REVERB_SCHEME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
