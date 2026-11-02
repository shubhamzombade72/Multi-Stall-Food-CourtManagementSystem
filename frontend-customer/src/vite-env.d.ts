/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API base URL, e.g. http://192.168.1.50:8000/api. Defaults to same-origin /api. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
