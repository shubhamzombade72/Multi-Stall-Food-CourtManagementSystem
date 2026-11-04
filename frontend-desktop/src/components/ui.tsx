import React from 'react';
import { ChevronLeft, ChevronRight, Inbox, Loader2, X } from 'lucide-react';
import { isStruck, statusClasses, statusKind, type StatusKind } from '../lib/status';

/** Small shared building blocks so every management screen looks and behaves the same. */

export const inputClass =
  'w-full px-2.5 py-1.5 rounded-lg border border-line text-sm bg-surface text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-focus disabled:bg-surface-2 disabled:text-muted';

export const buttonClass = {
  primary: 'px-3 py-1.5 bg-primary text-primary-fg hover:opacity-90 font-semibold text-sm rounded-lg flex items-center space-x-1.5 disabled:opacity-50',
  secondary: 'px-3 py-1.5 border border-line bg-surface hover:bg-surface-2 text-fg font-semibold text-sm rounded-lg flex items-center space-x-1.5 disabled:opacity-50',
  danger: 'px-3 py-1.5 bg-danger-fg text-surface hover:opacity-90 font-semibold text-sm rounded-lg flex items-center space-x-1.5 disabled:opacity-50',
};

export const PageHeader: React.FC<{ title: string; subtitle?: string; icon?: React.ElementType; actions?: React.ReactNode }> = ({ title, subtitle, icon: Icon, actions }) => (
  <div className="flex items-start justify-between gap-3 flex-wrap">
    <div>
      <h2 className="text-xl font-bold text-fg tracking-tight flex items-center space-x-2">
        {Icon && <Icon className="w-5 h-5" />}
        <span>{title}</span>
      </h2>
      {subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}
    </div>
    {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
  </div>
);

export const ErrorBanner: React.FC<{ message: string | null; onRetry?: () => void }> = ({ message, onRetry }) =>
  message ? (
    <div role="alert" className="p-2.5 rounded-lg bg-danger/10 border border-danger/30 text-danger-fg text-sm flex items-center justify-between">
      <span>{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="text-xs font-bold underline">
          Retry
        </button>
      )}
    </div>
  ) : null;

export const SuccessBanner: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <div role="status" className="p-2.5 rounded-lg bg-st-served-soft border border-st-served text-success-fg text-sm">
      {message}
    </div>
  ) : null;

export const Loading: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div className="py-8 flex items-center justify-center text-muted text-sm" role="status">
    <Loader2 className="w-4 h-4 animate-spin mr-2" />
    {label}
  </div>
);

export const EmptyState: React.FC<{ title: string; hint?: string }> = ({ title, hint }) => (
  <div className="py-10 flex flex-col items-center justify-center text-center text-muted">
    <Inbox className="w-8 h-8 mb-2" />
    <p className="font-semibold text-fg">{title}</p>
    {hint && <p className="text-xs mt-1">{hint}</p>}
  </div>
);

/** Legacy colour names kept for existing callers; each is an alias of a status kind. */
const legacyTones = {
  green: 'served',
  amber: 'ready',
  red: 'cancelled',
  blue: 'running',
  slate: 'pending',
  purple: 'kitchen',
} as const satisfies Record<string, StatusKind>;

export type BadgeTone = keyof typeof legacyTones | StatusKind;

const toKind = (tone: BadgeTone): StatusKind => (tone in legacyTones ? legacyTones[tone as keyof typeof legacyTones] : (tone as StatusKind));

export const Badge: React.FC<{ kind?: StatusKind; tone?: BadgeTone; children: React.ReactNode }> = ({ kind, tone = 'slate', children }) => {
  const k = kind ?? toKind(tone);
  const c = statusClasses(k);
  return <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${c.soft} ${c.text}${isStruck(k) ? ' line-through' : ''}`}>{children}</span>;
};

/** Neutral label for non-status facts (order channel, type): outlined and square-cornered so it never reads as a status pill. */
export const Tag: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="text-[11px] px-1.5 py-0.5 rounded font-semibold whitespace-nowrap border border-line text-muted">{children}</span>
);

/** Explicit "LATE" label for overdue work (KDS tickets, tracking cards): solid danger, >= 6:1 in both themes. */
export const LateBadge: React.FC = () => (
  <span className="text-[11px] font-extrabold tracking-wider px-1.5 py-0.5 rounded bg-danger-fg text-surface">LATE</span>
);

/** Badge tone for an order / ticket / payment / table status: a thin wrapper over the shared statusKind(). */
export const statusTone = (status: string): BadgeTone => statusKind(status);

export const Modal: React.FC<{
  title: string;
  onClose: () => void;
  onSubmit?: (e: React.FormEvent) => void;
  submitLabel?: string;
  submitting?: boolean;
  error?: string | null;
  wide?: boolean;
  children: React.ReactNode;
}> = ({ title, onClose, onSubmit, submitLabel = 'Save', submitting, error, wide, children }) => {
  const body = (
    <>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base text-fg">{title}</h3>
        <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-fg">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="space-y-3">{children}</div>
      {error && (
        <div role="alert" className="p-2 rounded-lg bg-danger/10 border border-danger/30 text-danger-fg text-xs">
          {error}
        </div>
      )}
      <div className="flex space-x-2 pt-2">
        <button type="button" onClick={onClose} className="flex-1 py-1.5 text-sm font-semibold text-muted hover:text-fg rounded-lg border border-line">
          {onSubmit ? 'Cancel' : 'Close'}
        </button>
        {onSubmit && (
          <button type="submit" disabled={submitting} className="flex-1 py-1.5 text-sm font-semibold text-primary-fg bg-primary hover:opacity-90 rounded-lg disabled:opacity-50">
            {submitting ? 'Saving…' : submitLabel}
          </button>
        )}
      </div>
    </>
  );
  const panel = `bg-surface text-fg border border-line rounded-lg ${wide ? 'max-w-3xl' : 'max-w-md'} w-full p-4 shadow-2xl space-y-3 max-h-[90vh] overflow-y-auto`;
  return (
    <div className="fixed inset-0 !m-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label={title}>
      {onSubmit ? (
        <form onSubmit={onSubmit} className={panel}>
          {body}
        </form>
      ) : (
        <div className={panel}>{body}</div>
      )}
    </div>
  );
};

export const Field: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => (
  <label className="block">
    <span className="text-xs font-semibold text-muted uppercase tracking-wide">{label}</span>
    <div className="mt-1">{children}</div>
    {hint && <span className="text-[11px] text-muted">{hint}</span>}
  </label>
);

/** Laravel paginator footer. */
export const Pagination: React.FC<{ page: number; lastPage: number; total?: number; onPage: (p: number) => void }> = ({ page, lastPage, total, onPage }) =>
  lastPage > 1 || total !== undefined ? (
    <div className="flex items-center justify-between px-3 py-2 text-xs text-muted border-t border-line">
      <span>{total !== undefined ? `${total} record${total === 1 ? '' : 's'}` : ''}</span>
      <div className="flex items-center space-x-2">
        <button aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} className="p-1 rounded border border-line hover:bg-surface-2 disabled:opacity-40">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span>
          Page {page} of {Math.max(lastPage, 1)}
        </span>
        <button aria-label="Next page" disabled={page >= lastPage} onClick={() => onPage(page + 1)} className="p-1 rounded border border-line hover:bg-surface-2 disabled:opacity-40">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  ) : null;

export const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`bg-surface rounded-lg border border-line shadow-sm ${className}`}>{children}</div>
);
