/**
 * Typed access to the Electron preload bridge (electron/preload.cjs). In a plain browser build
 * `window.desktop` is undefined and every helper degrades gracefully.
 */
export interface DesktopConfig {
  /** null only when no server is available (the built-in server failed to start) */
  apiBaseUrl: string | null;
  source: 'paired' | 'environment' | 'release' | 'embedded' | 'none';
  /** embedded = this PC's own database (default); remote = a shared food court host this PC is connected to */
  mode: 'embedded' | 'remote' | 'none';
  /** plain-language reason the built-in server could not start, when it could not */
  error: string | null;
  /** true when this PC was connected to its host with a connection code */
  paired: boolean;
  foodCourtName: string;
}

export type StartupPhase = 'starting' | 'preparing_database' | 'connecting' | 'ready' | 'degraded' | 'failed' | 'host_unreachable';

/** What the startup screen shows. Messages are written for the operator: no addresses, ports or product names. */
export interface StartupStatus {
  phase: StartupPhase;
  message: string;
  code?: string;
  mode?: 'remote';
  setup?: 'needed' | 'complete' | 'recovery_required' | null;
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

export interface BackupEntry {
  name: string;
  bytes: number;
  modified: string;
  kind: string;
}

export interface BackupStatus {
  available: boolean;
  directory: string;
  customDirectory: boolean;
  lastBackupAt: string | null;
  lastError: { at: string; message: string } | null;
  backups: BackupEntry[];
}

export interface BackupResult {
  ok: boolean;
  name?: string;
  error?: string;
  cancelled?: boolean;
}

export interface DesktopDiagnostics {
  app: { name: string; version: string; electron: string; packaged: boolean; platform: string };
  mode: string;
  startup: StartupStatus;
  apiBase: string | null;
  readiness: { reachable: boolean; reason?: string; httpStatus?: number; report?: unknown } | null;
  paths: { log: string; data: string | null; backups: string | null };
  recentLog: string[];
}

export interface DesktopPrinter {
  name: string;
  displayName: string;
  isDefault: boolean;
  status: number;
}

interface DesktopBridge {
  getConfig(): Promise<DesktopConfig>;
  getStartupStatus(): Promise<StartupStatus>;
  retryStart(): Promise<DesktopConfig>;
  useBuiltInServer(): Promise<DesktopConfig>;
  connectToHost(pairingString: string): Promise<{ ok: boolean; error?: string; foodCourtName?: string }>;
  getAppInfo(): Promise<DesktopAppInfo>;
  getDiagnostics(): Promise<DesktopDiagnostics>;
  getBackupStatus(): Promise<BackupStatus>;
  backupNow(): Promise<BackupResult>;
  chooseBackupFolder(): Promise<BackupResult>;
  restoreBackup(name?: string | null): Promise<BackupResult>;
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

const RECEIPT_WIDTH_KEY = 'foodcourt.receiptWidth';

/** Paper roll loaded in this computer's receipt printer: 58 mm or 80 mm (default). Chosen per computer. */
export const getReceiptWidth = (): 58 | 80 => {
  try {
    return localStorage.getItem(RECEIPT_WIDTH_KEY) === '58' ? 58 : 80;
  } catch {
    return 80;
  }
};

export const setReceiptWidth = (width: 58 | 80): void => {
  try {
    localStorage.setItem(RECEIPT_WIDTH_KEY, String(width));
  } catch {
    // storage unavailable: 80 mm is used
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
