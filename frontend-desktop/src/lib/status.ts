/**
 * One mapping from every raw backend status (order, ticket, item, payment, table, closing, settlement)
 * to a visual kind, so a status looks the same on badges, the tracking board, tables and the KDS.
 */
export type StatusKind = 'pending' | 'running' | 'cooking' | 'ready' | 'served' | 'settled' | 'kitchen' | 'void' | 'cancelled';

export const STATUS_KINDS: readonly StatusKind[] = ['pending', 'running', 'cooking', 'ready', 'served', 'settled', 'kitchen', 'void', 'cancelled'];

const RAW: Record<string, StatusKind> = {
  // order
  pending: 'pending',
  confirmed: 'running',
  in_preparation: 'cooking',
  partially_ready: 'ready',
  ready: 'ready',
  served: 'served',
  completed: 'settled',
  cancelled: 'cancelled',
  // kitchen ticket
  accepted: 'running',
  preparing: 'cooking',
  picked_up: 'served',
  // payment
  success: 'settled',
  failed: 'cancelled',
  refunded: 'void',
  // table
  available: 'served',
  occupied: 'running',
  reserved: 'kitchen',
  // closing / settlement
  closed: 'settled',
  paid: 'settled',
  // stall payout ledger: Pending / Partially Paid / Paid must read differently at a glance
  partially_paid: 'ready',
  nothing_due: 'void',
  negative_balance: 'cooking',
  overpaid: 'cancelled',
  reversed: 'void',
  reversal: 'kitchen',
  // unpaid: neutral for now; the owner will pick an attention colour later
  unpaid: 'pending',
  // misc statuses shown through Badge elsewhere (purchases, active flags)
  received: 'served',
  ordered: 'running',
  active: 'served',
  inactive: 'void',
};

export function statusKind(raw: string | null | undefined): StatusKind {
  if (!raw) return 'pending';
  return RAW[raw.trim().toLowerCase()] ?? 'pending';
}

export interface StatusClasses {
  solid: string;
  soft: string;
  text: string;
  border: string;
}

/** Literal class strings (not built dynamically) so Tailwind's scanner sees every token class. */
const CLASSES: Record<StatusKind, StatusClasses> = {
  pending: { solid: 'bg-st-pending', soft: 'bg-st-pending-soft', text: 'text-st-pending-fg', border: 'border-st-pending' },
  running: { solid: 'bg-st-running', soft: 'bg-st-running-soft', text: 'text-st-running-fg', border: 'border-st-running' },
  cooking: { solid: 'bg-st-cooking', soft: 'bg-st-cooking-soft', text: 'text-st-cooking-fg', border: 'border-st-cooking' },
  ready: { solid: 'bg-st-ready', soft: 'bg-st-ready-soft', text: 'text-st-ready-fg', border: 'border-st-ready' },
  served: { solid: 'bg-st-served', soft: 'bg-st-served-soft', text: 'text-st-served-fg', border: 'border-st-served' },
  settled: { solid: 'bg-st-settled', soft: 'bg-st-settled-soft', text: 'text-st-settled-fg', border: 'border-st-settled' },
  kitchen: { solid: 'bg-st-kitchen', soft: 'bg-st-kitchen-soft', text: 'text-st-kitchen-fg', border: 'border-st-kitchen' },
  void: { solid: 'bg-st-void', soft: 'bg-st-void-soft', text: 'text-st-void-fg', border: 'border-st-void' },
  cancelled: { solid: 'bg-st-cancelled', soft: 'bg-st-cancelled-soft', text: 'text-st-cancelled-fg', border: 'border-st-cancelled' },
};

export function statusClasses(kind: StatusKind): StatusClasses {
  return CLASSES[kind];
}

/**
 * Struck-through chip text: only the cancelled kind (raw cancelled / failed), so "this no longer happens" reads at a glance.
 * The void kind (refunded payments, inactive records) is muted grey but not struck: those records still exist.
 */
export function isStruck(kind: StatusKind): boolean {
  return kind === 'cancelled';
}

/** Soft chip classes (background + text) for a raw status: the one-liner pages use for inline status pills. */
export function statusChip(raw: string | null | undefined): string {
  const kind = statusKind(raw);
  const c = CLASSES[kind];
  return `${c.soft} ${c.text}${isStruck(kind) ? ' line-through' : ''}`;
}
