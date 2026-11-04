/**
 * The print document: a small, printer-neutral description of a receipt or kitchen ticket. The renderer builds it from
 * server data; the Electron main process validates it and lays it out for the chosen printer (thermal text, or a page
 * for a Windows driver). The same document drives preview, print, retry and reprint, so they cannot disagree.
 */
export type PrintAlign = 'left' | 'center' | 'right';

export type PrintBlock =
  | { t: 'text'; text: string; align?: PrintAlign; bold?: boolean; size?: 'normal' | 'large' }
  | { t: 'row'; left: string; right: string; bold?: boolean }
  | { t: 'rule'; style?: 'dash' | 'double' }
  /** `modules` = the QR matrix as square rows of '0'/'1' (used when a page is drawn); thermal printers draw `data` natively. */
  | { t: 'qr'; data: string; modules?: string[] }
  | { t: 'feed'; lines: number };

export type PrintKind = 'receipt' | 'kot' | 'test';

export interface PrintDocument {
  kind: PrintKind;
  title?: string;
  blocks: PrintBlock[];
}

export type PrinterRole = 'receipt' | 'kot';
export type PrintTransport = 'dialog' | 'none' | 'driver' | 'spooler-raw' | 'network';

export interface PrinterProfile {
  transport: PrintTransport;
  printerName: string;
  host: string;
  port: number;
  paperWidthMm: 58 | 80;
  codepage: 'CP437' | 'CP850' | 'CP858' | 'CP1252';
  columns: number | null;
  cut: boolean;
}

export interface PrintConfig {
  receipt: PrinterProfile;
  kot: PrinterProfile;
  autoPrint: { kotOnNewTicket: boolean };
}

export interface PrintReference {
  orderId?: number | null;
  ticketId?: number | null;
  stallId?: number | null;
  orderNumber?: string;
  ticketNumber?: string;
  stallName?: string;
}

export type PrintJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface PrintJob {
  id: string;
  kind: PrintKind;
  role: PrinterRole;
  status: PrintJobStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  attempts: number;
  error: { code: string; message: string; ambiguous: boolean; at: string } | null;
  warnings: string[];
  reference: Required<PrintReference>;
  dedupeKey: string | null;
  copyNumber: number;
  printer: string;
  hasDocument: boolean;
  canRetry: boolean;
  canReprint: boolean;
}

export type EnqueueResult =
  | { ok: true; job: PrintJob }
  | { ok: false; code: 'DUPLICATE'; reason: 'in-progress' | 'already-printed' | 'failed'; job: PrintJob; message: string }
  | { ok: false; code: string; message: string };

export interface PrinterStatus {
  state: 'ready' | 'offline' | 'not-found' | 'unconfigured' | 'unknown';
  message: string;
  checkedAt: string;
}

export type PreviewResult =
  | { ok: true; mode: 'text'; columns: number; paperWidthMm: number; lines: { text: string; bold: boolean; large: boolean; qr: boolean }[]; unsupported: string[] }
  | { ok: true; mode: 'html'; paperWidthMm: number; html: string; unsupported: string[] }
  | { ok: true; mode: 'none' }
  | { ok: false; code: string; message: string };
