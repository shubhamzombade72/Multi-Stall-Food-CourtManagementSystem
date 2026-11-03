/**
 * Typed access to the Electron preload bridge (electron/preload.cjs). In a plain browser build
 * `window.desktop` is undefined and every helper degrades gracefully.
 */
export interface DesktopConfig {
  /** null only when no server is available (built-in server missing or failed, nothing configured) */
  apiBaseUrl: string | null;
  source: 'saved' | 'environment' | 'release' | 'embedded' | 'none';
  /** embedded = the app's own server on this PC (default); remote = a configured shared server */
  mode: 'embedded' | 'remote' | 'none';
  /** why the built-in server could not start, when it could not */
  error: string | null;
}

export interface ConnectionTestResult {
  ok: boolean;
  code: string;
  message: string;
  url?: string;
  apiStatus?: number;
  healthStatus?: number | null;
}

export interface DesktopAppInfo {
  name: string;
  version: string;
  electron: string;
  platform: string;
  packaged: boolean;
  logFile: string;
  /** folder holding this PC's database (built-in server only) */
  dataDir: string | null;
}

export interface DesktopPrinter {
  name: string;
  displayName: string;
  isDefault: boolean;
  status: number;
}

interface DesktopBridge {
  getConfig(): Promise<DesktopConfig>;
  setApiBaseUrl(url: string): Promise<{ ok: boolean; apiBaseUrl?: string; error?: string; warnings?: string[] }>;
  testConnection(url: string): Promise<ConnectionTestResult>;
  useBuiltInServer(): Promise<DesktopConfig>;
  getAppInfo(): Promise<DesktopAppInfo>;
  log(level: 'INFO' | 'WARN' | 'ERROR', message: string): Promise<boolean>;
  listPrinters(): Promise<DesktopPrinter[]>;
  print(options?: { deviceName?: string }): Promise<{ ok: boolean; error: string | null }>;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export const desktop = (): DesktopBridge | undefined => (typeof window !== 'undefined' ? window.desktop : undefined);

export const isDesktopApp = (): boolean => desktop() !== undefined;

/** Error logging: to the desktop log file inside Electron, to the console otherwise. */
export const logError = (message: string): void => {
  const d = desktop();
  if (d) {
    d.log('ERROR', message).catch(() => undefined);
  } else {
    console.error(message);
  }
};

const RECEIPT_PRINTER_KEY = 'foodcourt.receiptPrinter';

/** Receipt printer chosen on this computer (Settings → Printers); preselected in the print dialog. */
export const getReceiptPrinter = (): string => {
  try {
    return localStorage.getItem(RECEIPT_PRINTER_KEY) || '';
  } catch {
    return '';
  }
};

export const setReceiptPrinter = (name: string): void => {
  try {
    if (name) localStorage.setItem(RECEIPT_PRINTER_KEY, name);
    else localStorage.removeItem(RECEIPT_PRINTER_KEY);
  } catch {
    // storage unavailable: the system default printer is used
  }
};

/** Prints the current page (receipts use print-only CSS). Native dialog in Electron, browser dialog on the web. */
export const printPage = async (paper: 'receipt' | 'a4' = 'a4'): Promise<void> => {
  const d = desktop();
  if (d) {
    const deviceName = paper === 'receipt' ? getReceiptPrinter() : '';
    const r = await d.print(deviceName ? { deviceName } : undefined);
    if (!r.ok && r.error && r.error !== 'cancelled') {
      throw new Error(`Printing failed: ${r.error}`);
    }
  } else {
    window.print();
  }
};
