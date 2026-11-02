import React from 'react';
import { ChevronLeft, ChevronRight, Inbox, Loader2, X } from 'lucide-react';

/** Small shared building blocks so every management screen looks and behaves the same. */

export const inputClass =
  'w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-50';

export const buttonClass = {
  primary: 'px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm rounded-xl flex items-center space-x-1.5 disabled:opacity-50',
  secondary: 'px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-sm rounded-xl flex items-center space-x-1.5 disabled:opacity-50',
  danger: 'px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-sm rounded-xl flex items-center space-x-1.5 disabled:opacity-50',
};

export const PageHeader: React.FC<{ title: string; subtitle?: string; icon?: React.ElementType; actions?: React.ReactNode }> = ({ title, subtitle, icon: Icon, actions }) => (
  <div className="flex items-start justify-between gap-4 flex-wrap">
    <div>
      <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center space-x-2">
        {Icon && <Icon className="w-6 h-6" />}
        <span>{title}</span>
      </h2>
      {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
    </div>
    {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
  </div>
);

export const ErrorBanner: React.FC<{ message: string | null; onRetry?: () => void }> = ({ message, onRetry }) =>
  message ? (
    <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-center justify-between">
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
    <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">
      {message}
    </div>
  ) : null;

export const Loading: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div className="py-10 flex items-center justify-center text-slate-400 text-sm" role="status">
    <Loader2 className="w-4 h-4 animate-spin mr-2" />
    {label}
  </div>
);

export const EmptyState: React.FC<{ title: string; hint?: string }> = ({ title, hint }) => (
  <div className="py-12 flex flex-col items-center justify-center text-center text-slate-400">
    <Inbox className="w-8 h-8 mb-2" />
    <p className="font-semibold text-slate-500">{title}</p>
    {hint && <p className="text-xs mt-1">{hint}</p>}
  </div>
);

const badgeTones: Record<string, string> = {
  green: 'bg-emerald-100 text-emerald-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-rose-100 text-rose-700',
  blue: 'bg-sky-100 text-sky-800',
  slate: 'bg-slate-200 text-slate-600',
  purple: 'bg-purple-100 text-purple-700',
};

export const Badge: React.FC<{ tone?: keyof typeof badgeTones; children: React.ReactNode }> = ({ tone = 'slate', children }) => (
  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${badgeTones[tone]}`}>{children}</span>
);

/** Tone for an order / ticket / payment status. */
export const statusTone = (status: string): keyof typeof badgeTones => {
  if (['completed', 'paid', 'received', 'picked_up', 'served', 'available', 'success', 'active'].includes(status)) return 'green';
  if (['cancelled', 'failed', 'refunded', 'inactive'].includes(status)) return 'red';
  if (['ready', 'reserved'].includes(status)) return 'blue';
  if (['occupied', 'preparing', 'accepted', 'partially_ready', 'ordered'].includes(status)) return 'amber';
  return 'slate';
};

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
        <h3 className="font-bold text-slate-900 text-lg">{title}</h3>
        <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="space-y-3">{children}</div>
      {error && (
        <div role="alert" className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
          {error}
        </div>
      )}
      <div className="flex space-x-2 pt-2">
        <button type="button" onClick={onClose} className="flex-1 py-2 text-sm font-bold text-slate-600 rounded-xl border border-slate-200">
          {onSubmit ? 'Cancel' : 'Close'}
        </button>
        {onSubmit && (
          <button type="submit" disabled={submitting} className="flex-1 py-2 text-sm font-bold text-white bg-brand-500 hover:bg-brand-600 rounded-xl disabled:opacity-50">
            {submitting ? 'Saving…' : submitLabel}
          </button>
        )}
      </div>
    </>
  );
  const panel = `bg-white rounded-2xl ${wide ? 'max-w-3xl' : 'max-w-md'} w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto`;
  return (
    <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label={title}>
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
    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</span>
    <div className="mt-1">{children}</div>
    {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
  </label>
);

/** Laravel paginator footer. */
export const Pagination: React.FC<{ page: number; lastPage: number; total?: number; onPage: (p: number) => void }> = ({ page, lastPage, total, onPage }) =>
  lastPage > 1 || total !== undefined ? (
    <div className="flex items-center justify-between px-4 py-3 text-xs text-slate-500 border-t border-slate-100">
      <span>{total !== undefined ? `${total} record${total === 1 ? '' : 's'}` : ''}</span>
      <div className="flex items-center space-x-2">
        <button aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} className="p-1 rounded border border-slate-200 disabled:opacity-40">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span>
          Page {page} of {Math.max(lastPage, 1)}
        </span>
        <button aria-label="Next page" disabled={page >= lastPage} onClick={() => onPage(page + 1)} className="p-1 rounded border border-slate-200 disabled:opacity-40">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  ) : null;

export const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm ${className}`}>{children}</div>
);
