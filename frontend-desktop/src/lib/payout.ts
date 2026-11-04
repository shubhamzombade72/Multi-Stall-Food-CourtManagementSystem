/**
 * Settlement payout helpers: labels, input validation and money arithmetic. The server is the authority (it re-checks
 * every rule under a row lock); these exist so the cashier sees the problem before submitting and so the numbers shown
 * on screen are added up in whole paise, never floating point.
 */

export const PAYMENT_METHODS = ['cash', 'upi', 'bank_transfer', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  bank_transfer: 'Bank Transfer',
  other: 'Other',
};

export const methodLabel = (m: string | null | undefined): string => (m ? METHOD_LABELS[m] ?? m : '—');

/** UPI and bank transfers leave a trace outside the app, so they must carry a reference; cash and other do not. */
export const referenceRequired = (method: string): boolean => method === 'upi' || method === 'bank_transfer';

export const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  partially_paid: 'Partially Paid',
  paid: 'Paid',
  nothing_due: 'Nothing Due',
  negative_balance: 'Negative Balance',
  overpaid: 'Overpaid (check)',
  completed: 'Completed',
  failed: 'Failed',
  reversed: 'Reversed',
  reversal: 'Reversal',
};

export const statusLabel = (s: string | null | undefined): string => (s ? STATUS_LABELS[s] ?? s : '—');

/** One-line explanation shown under a status badge. */
export const STATUS_HINTS: Record<string, string> = {
  pending: 'No payment recorded',
  partially_paid: 'Some amount paid, balance remains',
  paid: 'Full payable amount recorded as paid',
  nothing_due: 'Nothing payable for this day',
  negative_balance: 'Adjustments exceed sales; no payout possible',
  overpaid: 'Paid more than payable: run reconciliation',
};

/** "123.45" / 123.4 / "" -> integer paise, or null when it is not a valid non-negative amount with at most 2 decimals. */
export function toPaise(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const negative = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return negative ? -paise : paise;
}

export function fromPaise(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Indian digit grouping with the rupee sign: 125000 -> ₹1,25,000.00 */
export function formatRupees(value: string | number | null | undefined): string {
  const paise = toPaise(typeof value === 'number' ? value.toFixed(2) : value ?? '0');
  if (paise === null) return '₹—';
  const [whole, frac] = fromPaise(Math.abs(paise)).split('.');
  const grouped = whole.length > 3 ? whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + whole.slice(-3) : whole;
  return `${paise < 0 ? '-' : ''}₹${grouped}.${frac}`;
}

export interface PayoutForm {
  amount: string;
  method: string;
  reference: string;
}

/** Returns the first problem with a payout form, or null when it can be submitted. `remaining` is the outstanding balance. */
export function validatePayout(form: PayoutForm, remaining: string): string | null {
  const amount = toPaise(form.amount);
  if (amount === null) return 'Enter the amount as rupees with at most two decimals.';
  if (amount <= 0) return 'The payout amount must be greater than zero.';
  const left = toPaise(remaining) ?? 0;
  if (amount > left) return `The amount exceeds the outstanding balance of ${formatRupees(remaining)}.`;
  if (!(PAYMENT_METHODS as readonly string[]).includes(form.method)) return 'Choose a payment method.';
  if (referenceRequired(form.method) && form.reference.trim() === '') return `A transaction reference is required for ${methodLabel(form.method)} payouts.`;
  return null;
}

export interface Allocation {
  settlement_id: number;
  amount: string;
}

/** Checks a consolidated payout's allocations: each within its stall's balance and together exactly equal to the payment. */
export function validateAllocations(total: string, allocations: Allocation[], balances: Record<number, string>): string | null {
  const totalPaise = toPaise(total);
  if (totalPaise === null || totalPaise <= 0) return 'Enter the total amount paid to the owner.';
  let sum = 0;
  for (const a of allocations) {
    const paise = toPaise(a.amount);
    if (paise === null || paise < 0) return 'Every allocation must be a valid amount.';
    if (paise > (toPaise(balances[a.settlement_id]) ?? 0)) return `An allocation exceeds that stall's outstanding balance of ${formatRupees(balances[a.settlement_id])}.`;
    sum += paise;
  }
  if (sum !== totalPaise) return `Allocations add up to ${formatRupees(fromPaise(sum))} but the payment is ${formatRupees(total)}. They must match exactly.`;
  return null;
}

/** Allocate `total` over the balances, oldest first (the same rule the server uses for automatic allocation). */
export function autoAllocate(total: string, rows: { settlement_id: number; remaining: string }[]): Allocation[] {
  let left = toPaise(total) ?? 0;
  const out: Allocation[] = [];
  for (const r of rows) {
    const bal = toPaise(r.remaining) ?? 0;
    if (left <= 0 || bal <= 0) continue;
    const part = Math.min(left, bal);
    out.push({ settlement_id: r.settlement_id, amount: fromPaise(part) });
    left -= part;
  }
  return out;
}

/** A fresh key per payout form. Re-sending the same form (retry, double click) reuses it so the server can recognise a duplicate. */
export function newIdempotencyKey(): string {
  const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Date + time in the local format, e.g. 04/11/2026, 11:30 pm. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** YYYY-MM-DD (or an ISO timestamp) to DD-MM-YYYY, without time-zone shifting. */
export function formatBusinessDate(value: string | null | undefined): string {
  if (!value) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : value;
}
