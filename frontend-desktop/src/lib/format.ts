/** Shared display formatting: Indian rupees, local dates and API error messages. */

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const money = (value: string | number | null | undefined): string => {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return inr.format(Number.isFinite(n) ? n : 0);
};

export const dateTime = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export const dateOnly = (iso: string | null | undefined): string =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const timeOnly = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—';

/** Local calendar date as YYYY-MM-DD (not UTC), for date inputs and API filters. */
export const isoDate = (d: Date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
};

export const humanize = (value: string | null | undefined): string =>
  value ? value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—';

/** Readable message from an axios error: validation errors first, then the server message. */
export const apiError = (err: any, fallback = 'Request failed'): string => {
  const errors = err?.response?.data?.errors;
  if (errors && typeof errors === 'object') {
    return Object.values(errors).flat().join(' ');
  }
  if (err?.response?.data?.message) return err.response.data.message;
  if (err?.code === 'ERR_NETWORK' || !err?.response) return 'Server unreachable. Check the connection and try again.';
  return fallback;
};
