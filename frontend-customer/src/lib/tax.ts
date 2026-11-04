/**
 * GST on the desktop. The server (TaxService) is the authority and prices every real bill from Food Court Settings; this
 * file only (a) estimates a bill on screen before it exists, using the same rules, and (b) describes a stored bill's
 * tax lines from the rate and mode that bill was priced with. tests/tax.test.ts runs both against qa/tax-vectors.json,
 * the same vectors the server's tests use. There is no rate in this file: it always comes from settings or from the bill.
 *
 * Rules (whole paise, no floating point): exclusive tax = items x rate / 100 and total = items + tax; inclusive tax =
 * items x rate / (100 + rate) and total = items (never added twice); disabled = no tax. Half up, once, on the whole bill.
 */
export interface TaxConfig {
  enabled: boolean;
  rate_percent: string;
  mode: 'exclusive' | 'inclusive';
}

export interface TaxResult {
  subtotal: string;
  tax_amount: string;
  total_amount: string;
  tax_mode: 'exclusive' | 'inclusive' | 'none';
  tax_rate_percent: string;
}

const paise = (v: string | number | null | undefined): number => Math.round(Number(v ?? 0) * 100);
const money = (p: number): string => `${Math.floor(p / 100)}.${String(p % 100).padStart(2, '0')}`;
const divideHalfUp = (numerator: number, denominator: number): number => Math.floor((2 * numerator + denominator) / (2 * denominator));

/** Same numbers the server will store for a bill whose line prices add up to `itemsTotal`. */
export function calculateTax(itemsTotal: string | number, config: TaxConfig): TaxResult {
  const items = paise(itemsTotal);
  if (!config.enabled) {
    return { subtotal: money(items), tax_amount: '0.00', total_amount: money(items), tax_mode: 'none', tax_rate_percent: '0.00' };
  }
  const rate = paise(config.rate_percent); // hundredths of a percent
  if (config.mode === 'inclusive') {
    const tax = divideHalfUp(items * rate, 10000 + rate);
    return { subtotal: money(items - tax), tax_amount: money(tax), total_amount: money(items), tax_mode: 'inclusive', tax_rate_percent: money(rate) };
  }
  const tax = divideHalfUp(items * rate, 10000);
  return { subtotal: money(items), tax_amount: money(tax), total_amount: money(items + tax), tax_mode: 'exclusive', tax_rate_percent: money(rate) };
}

/** 5.00 -> "5", 12.50 -> "12.5": how a rate reads in a label. */
export function formatRate(rate: string | number | null | undefined): string {
  const n = Number(rate ?? 0);
  return Number.isFinite(n) ? String(parseFloat(n.toFixed(2))) : '0';
}

export interface StoredBill {
  subtotal: string | number;
  tax_amount: string | number;
  total_amount?: string | number;
  tax_rate_percent?: string | number | null;
  tax_mode?: string | null;
}

/**
 * The Subtotal / GST lines a bill shows (receipt, order detail), from the bill's own snapshot - never from today's
 * settings, so an old bill keeps its rate. Inclusive bills show the gross subtotal "including GST" and the part of it
 * that is GST; the total is not increased.
 */
export function taxLines(bill: StoredBill): { label: string; value: string }[] {
  const subtotal = paise(bill.subtotal);
  const tax = paise(bill.tax_amount);
  const rate = formatRate(bill.tax_rate_percent);
  if (bill.tax_mode === 'inclusive') {
    return [
      { label: 'Subtotal (including GST)', value: money(subtotal + tax) },
      { label: `GST Included (${rate}%)`, value: money(tax) },
    ];
  }
  const lines = [{ label: 'Subtotal', value: money(subtotal) }];
  if (bill.tax_mode === 'none') return lines;
  if (bill.tax_mode === 'exclusive') lines.push({ label: `GST (${rate}%)`, value: money(tax) });
  else if (tax > 0) lines.push({ label: 'GST', value: money(tax) }); // payload without a snapshot: no rate is invented
  return lines;
}

/** Stored amounts as numbers (taxable subtotal, GST, total) for reconciliation checks and summaries. */
export function billTotals(bill: StoredBill): { subtotal: number; tax: number; total: number } {
  return { subtotal: paise(bill.subtotal) / 100, tax: paise(bill.tax_amount) / 100, total: paise(bill.total_amount) / 100 };
}
