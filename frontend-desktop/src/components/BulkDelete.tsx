import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Trash2, X } from 'lucide-react';
import { apiClient } from '../api/client';
import { apiError } from '../lib/format';
import { deleteInChunks, emptySummary, type BulkSummary, type Id, type PageState } from '../lib/bulkSelection';
import { buttonClass } from './ui';

/**
 * Shared bulk-delete UI for the Stall Directory and the Menu Catalog.
 * Nothing is ever deleted by ticking a checkbox: the toolbar only opens BulkDeleteDialog, and the dialog's own
 * "Delete Selected ..." button is the single place a request is sent (and it is sent in chunks, see lib/bulkSelection).
 */

/** Checkbox that can show the "some rows selected" (indeterminate) state. */
export const BulkCheckbox: React.FC<{ state: PageState | boolean; onChange: () => void; label: string; testId?: string }> = ({ state, onChange, label, testId }) => {
  const ref = useRef<HTMLInputElement>(null);
  const checked = state === true || state === 'all';
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      data-testid={testId}
      checked={checked}
      onChange={onChange}
      className="w-4 h-4 rounded border-line accent-primary cursor-pointer"
    />
  );
};

export const BulkToolbar: React.FC<{
  noun: string; // "Stalls" | "Items"
  selectedCount: number;
  filteredCount: number;
  pageState: PageState;
  onTogglePage: () => void;
  onSelectAllFiltered: () => void;
  onClear: () => void;
  onDelete: () => void;
}> = ({ noun, selectedCount, filteredCount, pageState, onTogglePage, onSelectAllFiltered, onClear, onDelete }) => (
  <div className="flex flex-wrap items-center gap-3 bg-surface px-3 py-2 rounded-lg border border-line shadow-sm" data-testid="bulk-toolbar">
    <label className="flex items-center space-x-2 text-xs font-semibold text-fg cursor-pointer">
      <BulkCheckbox state={pageState} onChange={onTogglePage} label={`Select all ${noun.toLowerCase()} on this page`} testId="bulk-select-page" />
      <span>Select page</span>
    </label>
    <span className="text-sm font-semibold text-fg" data-testid="bulk-selected-count" aria-live="polite">
      Selected: {selectedCount} {noun}
    </span>
    <button type="button" onClick={onSelectAllFiltered} disabled={filteredCount === 0 || selectedCount === filteredCount} className="text-xs font-semibold text-primary disabled:opacity-40" data-testid="bulk-select-filtered">
      Select all {filteredCount} filtered
    </button>
    <button type="button" onClick={onClear} disabled={selectedCount === 0} className="text-xs font-semibold text-muted hover:text-fg disabled:opacity-40" data-testid="bulk-clear">
      Clear selection
    </button>
    <div className="flex-1" />
    <button type="button" onClick={onDelete} disabled={selectedCount === 0} className={buttonClass.danger} data-testid="bulk-delete-open">
      <Trash2 className="w-4 h-4" />
      <span>Bulk Delete</span>
    </button>
  </div>
);

export type BulkPhase = 'idle' | 'confirm' | 'running' | 'done';

export interface BulkDeleteState {
  phase: BulkPhase;
  ids: Id[];
  progress: { done: number; total: number };
  summary: BulkSummary;
}

/** Drives the dialog: open() -> confirm() -> chunked requests -> summary -> close(). */
export function useBulkDelete(endpoint: string, onFinished: (summary: BulkSummary) => void) {
  const [state, setState] = useState<BulkDeleteState>({ phase: 'idle', ids: [], progress: { done: 0, total: 0 }, summary: emptySummary() });

  const open = useCallback((ids: Id[]) => {
    setState({ phase: 'confirm', ids, progress: { done: 0, total: ids.length }, summary: emptySummary() });
  }, []);

  const confirm = useCallback(async () => {
    const ids = state.ids;
    setState((s) => ({ ...s, phase: 'running', progress: { done: 0, total: ids.length } }));
    const summary = await deleteInChunks(
      ids,
      async (part) => (await apiClient.post(endpoint, { ids: part })).data,
      (done, total) => setState((s) => ({ ...s, progress: { done, total } })),
      (err) => apiError(err, 'Request failed'),
    );
    setState((s) => ({ ...s, phase: 'done', summary }));
    onFinished(summary);
  }, [endpoint, onFinished, state.ids]);

  const close = useCallback(() => setState((s) => (s.phase === 'running' ? s : { ...s, phase: 'idle' })), []);

  return { state, open, confirm, close };
}

export const BulkDeleteDialog: React.FC<{
  state: BulkDeleteState;
  noun: string; // "Stalls"
  confirmLabel: string; // "Delete Selected Stalls"
  warning: string;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ state, noun, confirmLabel, warning, onCancel, onConfirm }) => {
  if (state.phase === 'idle') return null;
  const { phase, ids, progress, summary } = state;
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="fixed inset-0 !m-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label={`Delete selected ${noun.toLowerCase()}`} data-testid="bulk-dialog">
      <div className="bg-surface text-fg border border-line rounded-lg max-w-lg w-full p-4 shadow-2xl space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-base text-fg">
            {phase === 'done' ? `Bulk delete finished` : `Delete ${noun.toLowerCase()}?`}
          </h3>
          {phase !== 'running' && (
            <button type="button" onClick={onCancel} aria-label="Close" className="text-muted hover:text-fg">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {phase === 'confirm' && (
          <>
            <p className="text-sm font-semibold text-fg" data-testid="bulk-confirm-count">
              Selected: {ids.length} {noun}
            </p>
            <p className="text-xs text-muted flex items-start space-x-1.5">
              <AlertTriangle className="w-4 h-4 text-warning-fg shrink-0" />
              <span>{warning}</span>
            </p>
            <div className="flex space-x-2 pt-2">
              <button type="button" onClick={onCancel} className="flex-1 py-1.5 text-sm font-semibold text-muted hover:text-fg rounded-lg border border-line" data-testid="bulk-cancel">
                Cancel
              </button>
              <button type="button" onClick={onConfirm} className={`flex-1 justify-center ${buttonClass.danger}`} data-testid="bulk-confirm">
                {confirmLabel}
              </button>
            </div>
          </>
        )}

        {phase === 'running' && (
          <div className="space-y-2" data-testid="bulk-progress">
            <p className="text-sm text-fg flex items-center space-x-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>
                Deleting… {progress.done} of {progress.total} processed
              </span>
            </p>
            <div className="h-2 rounded-full bg-surface-2 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {phase === 'done' && (
          <div className="space-y-3" data-testid="bulk-summary">
            <p className="text-sm flex items-center space-x-2 text-fg">
              <CheckCircle2 className="w-4 h-4 text-success-fg" />
              <span data-testid="bulk-summary-deleted">Successfully deleted: {summary.deleted}</span>
            </p>
            <p className="text-sm flex items-center space-x-2 text-fg">
              <AlertTriangle className={`w-4 h-4 ${summary.failed ? 'text-danger-fg' : 'text-muted'}`} />
              <span data-testid="bulk-summary-failed">Failed: {summary.failed}</span>
            </p>
            {summary.failures.length > 0 && (
              <ul className="max-h-56 overflow-y-auto divide-y divide-line border border-line rounded-lg text-xs" data-testid="bulk-failures">
                {summary.failures.map((f) => (
                  <li key={f.id} className="p-2">
                    <span className="font-semibold text-fg">{f.name ?? `#${f.id}`}</span>
                    {f.code && <span className="font-mono text-muted"> ({f.code})</span>}
                    <span className="block text-danger-fg">{f.reason}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end pt-1">
              <button type="button" onClick={onCancel} className={buttonClass.secondary} data-testid="bulk-done">
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
