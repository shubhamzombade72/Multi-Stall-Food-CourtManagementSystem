/**
 * Pure receipt logic (no React): what the receipt header says, whether and what UPI payment section it prints, and
 * the geometry for 58 mm / 80 mm paper. Receipt.tsx only renders what this returns, so it is unit-tested directly.
 */
import { encodeQr, qrLayout, type QrCode } from './qr.ts';
import { money } from './format.ts';
import { taxLines } from './tax.ts';

/** The Subtotal / GST lines printed on a receipt: from the bill's own stored rate and mode. */
export const receiptTaxLines = taxLines;

/** Printed at the very bottom of every customer receipt. Fixed on purpose: it is not a setting and cannot be edited or hidden. */
export const RECEIPT_CREDIT = 'Powered by MangalMurti Tech Solution';

export type PaperWidth = 58 | 80;

export interface PaperProfile {
  /** Paper roll width. */
  pageMm: PaperWidth;
  /** Printable width inside the margins. */
  contentMm: number;
  /** Largest QR (including quiet zone) that fits with room to spare. */
  qrMaxMm: number;
  fontPx: number;
}

export const paperProfile = (width?: number | null): PaperProfile =>
  width === 58
    ? { pageMm: 58, contentMm: 48, qrMaxMm: 36, fontPx: 10 }
    : { pageMm: 80, contentMm: 72, qrMaxMm: 44, fontPx: 11 };

interface ProfileLike {
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  gstin?: string | null;
}
interface SettingsLike {
  business_profile?: ProfileLike | null;
  receipt?: { header?: string | null; show_gstin?: boolean } | null;
}

const clean = (v: string | null | undefined): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Header lines in print order: business name (from the saved Business Profile), then only the details that are
 * configured. Missing/blank names fall back to "FOOD COURT" so a receipt never prints an empty title.
 */
export function receiptHeader(settings: SettingsLike | null | undefined): string[] {
  const p = settings?.business_profile;
  const lines = [(clean(p?.name) || 'Food Court').toUpperCase()];
  if (clean(p?.address)) lines.push(clean(p?.address));
  if (clean(p?.phone)) lines.push(`Tel: ${clean(p?.phone)}`);
  if (settings?.receipt?.show_gstin && clean(p?.gstin)) lines.push(`GSTIN: ${clean(p?.gstin)}`);
  if (clean(settings?.receipt?.header)) lines.push(clean(settings?.receipt?.header));
  return lines;
}

// ---------- UPI ----------

/** Same alphabet and shape the server enforces for merchant UPI IDs. */
export const isValidVpa = (v: string): boolean => /^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9]{1,63}$/i.test(v);

/** RFC 3986 percent-encoding, identical to PHP rawurlencode (encodeURIComponent leaves ! ' ( ) * unescaped). */
const rfc3986 = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

const stripControl = (s: string): string => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();

/** upi://pay?pa=..&pn=..&am=..&cu=INR&tn=.. exactly as the server builds it (UpiPaymentService::buildUri). */
export function buildUpiUri(vpa: string, payeeName: string, amount: string | number, reference: string): string {
  const name = Array.from(stripControl(payeeName)).slice(0, 50).join('');
  return (
    `upi://pay?pa=${rfc3986(vpa).replace('%40', '@')}` +
    `&pn=${rfc3986(name)}&am=${Number(amount).toFixed(2)}&cu=INR&tn=${rfc3986(stripControl(reference))}`
  );
}

export function parseUpiUri(uri: string): Record<string, string> {
  const out: Record<string, string> = {};
  const query = uri.split('?')[1] ?? '';
  for (const [k, v] of new URLSearchParams(query)) out[k] = v;
  return out;
}

export interface UpiRequestData {
  reference: string;
  vpa: string;
  payee_name: string;
  amount: string;
  upi_uri?: string;
  status: string;
}

export interface UpiSection {
  title: string;
  /** Exact text encoded in the QR. */
  qrText: string;
  vpaLine: string;
  amountLine: string;
  referenceLine: string;
  /** Short how-to-pay (or paid) note printed under the QR. */
  instructionLine: string;
  paid: boolean;
}

/**
 * The UPI block printed under the totals, or null. A pending request prints only while UPI QR is on (so a disabled
 * UPI never shows a live QR). A paid request is the record of that bill's original payment and always reprints with
 * the original UPI ID, amount and reference - never the current settings or another order's values.
 */
export function upiSection(receipt: { upi_enabled?: boolean; upi?: UpiRequestData | null; order?: { payment_status?: string } } | null | undefined): UpiSection | null {
  const upi = receipt?.upi;
  if (!upi) return null;
  const paid = upi.status === 'paid';
  if (!paid && !receipt?.upi_enabled) return null;
  return {
    title: paid ? 'PAID VIA UPI - PAYMENT RECORD' : 'SCAN & PAY USING UPI',
    qrText: buildUpiUri(upi.vpa, upi.payee_name, upi.amount, upi.reference),
    vpaLine: `UPI ID: ${upi.vpa}`,
    amountLine: `Amount: ${money(upi.amount)}`,
    referenceLine: `Ref: ${upi.reference}`,
    instructionLine: paid
      ? 'Payment received. Keep this receipt for your records.'
      : `Scan with any UPI app and pay exactly ${money(upi.amount)}. Show the payment confirmation at the counter.`,
    paid,
  };
}

/** QR matrix plus print geometry for the given paper width. */
export function upiQrFor(text: string, width: PaperWidth | number | undefined): { qr: QrCode; layout: ReturnType<typeof qrLayout> } {
  const qr = encodeQr(text);
  return { qr, layout: qrLayout(qr.size, paperProfile(width).qrMaxMm) };
}
