import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Power, Trash2, X } from 'lucide-react';
import { apiClient } from '../api/client';
import { apiError } from '../lib/format';
import { chunk, deleteInChunks, emptySummary, type BulkSummary, type Id, type PageState } from '../lib/bulkSelection';
import { blockerSentence, deactivateAll, outcomeLines, splitPreview, type PreviewResponse } from '../lib/stallDeletion';
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

/** 'previewing' and 'review' exist only when the hook is given `stalls` options: the server is asked first which records can be deleted. */
export type BulkPhase = 'idle' | 'previewing' | 'review' | 'confirm' | 'running' | 'done';

export interface BulkDeleteState {
  phase: BulkPhase;
  ids: Id[];
  progress: { done: number; total: number };
  summary: BulkSummary;
  /** the server's verdict per selected record (review phase) */
  preview: PreviewResponse | null;
  previewError: string | null;
  deactivating: boolean;
  deactivated: Id[];
  deactivateFailed: Array<{ id: Id; reason: string }>;
}

/** Opt-in for records that have a safer alternative to deletion (stalls: Deactivate). */
export interface BulkPreviewOptions {
  previewEndpoint: string;
  deactivate: (id: Id) => Promise<void>;
  /** called after at least one deactivation succeeded, so the page can refresh its list */
  onDeactivated?: () => void;
}

const initialState = (): BulkDeleteState => ({
  phase: 'idle', ids: [], progress: { done: 0, total: 0 }, summary: emptySummary(),
  preview: null, previewError: null, deactivating: false, deactivated: [], deactivateFailed: [],
});

/** Drives the dialog: open() -> [preview] -> confirm() -> chunked requests -> summary -> close(). */
export function useBulkDelete(endpoint: string, onFinished: (summary: BulkSummary) => void, options?: BulkPreviewOptions) {
  const [state, setState] = useState<BulkDeleteState>(initialState);
  const openToken = useRef(0); // a preview that comes back after the dialog was closed (or reopened) is ignored

  const loadPreview = useCallback(async (ids: Id[]) => {
    if (!options) return;
    const token = ++openToken.current;
    setState({ ...initialState(), phase: 'previewing', ids, progress: { done: 0, total: ids.length } });
    try {
      const merged: PreviewResponse = { stalls: [], missing: [] };
      for (const part of chunk(ids)) {
        const data = (await apiClient.post(options.previewEndpoint, { ids: part })).data as PreviewResponse;
        merged.stalls.push(...data.stalls);
        merged.missing.push(...data.missing);
      }
      if (token === openToken.current) setState((s) => ({ ...s, phase: 'review', preview: merged }));
    } catch (err) {
      // Never delete blind: if the check fails, nothing is offered except Retry / Close
      if (token === openToken.current) setState((s) => ({ ...s, phase: 'review', preview: null, previewError: apiError(err, 'Could not check which records can be deleted') }));
    }
  }, [options]);

  const open = useCallback((ids: Id[]) => {
    if (options) {
      void loadPreview(ids);
      return;
    }
    openToken.current++;
    setState({ ...initialState(), phase: 'confirm', ids, progress: { done: 0, total: ids.length } });
  }, [loadPreview, options]);

  const retryPreview = useCallback(() => void loadPreview(state.ids), [loadPreview, state.ids]);

  const confirm = useCallback(async () => {
    // With a preview, only what the server said is deletable is sent; the delete still re-checks each record under a lock
    const ids = state.preview ? splitPreview(state.preview).deletable.map((s) => s.id) : state.ids;
    if (ids.length === 0) return;
    setState((s) => ({ ...s, phase: 'running', progress: { done: 0, total: ids.length } }));
    const summary = await deleteInChunks(
      ids,
      async (part) => (await apiClient.post(endpoint, { ids: part })).data,
      (done, total) => setState((s) => ({ ...s, progress: { done, total } })),
      (err) => apiError(err, 'Request failed'),
    );
    setState((s) => ({ ...s, phase: 'done', summary }));
    onFinished(summary);
  }, [endpoint, onFinished, state.ids, state.preview]);

  const deactivate = useCallback(async (ids: Id[]) => {
    if (!options || ids.length === 0) return;
    const token = openToken.current;
    setState((s) => ({ ...s, deactivating: true }));
    const out = await deactivateAll(ids, options.deactivate, (err) => apiError(err, 'Request failed'));
    // The stalls really were deactivated, so the page always refreshes; but a dialog that was closed or reopened meanwhile is left alone
    if (token === openToken.current) {
      setState((s) => ({
        ...s,
        deactivating: false,
        deactivated: [...s.deactivated, ...out.done],
        deactivateFailed: [...s.deactivateFailed.filter((f) => !out.done.includes(f.id) && !out.failed.some((o) => o.id === f.id)), ...out.failed],
        preview: s.preview && { ...s.preview, stalls: s.preview.stalls.map((p) => (out.done.includes(p.id) ? { ...p, is_active: false, can_deactivate: false } : p)) },
      }));
    }
    if (out.done.length) options.onDeactivated?.();
  }, [options]);

  const close = useCallback(() => {
    openToken.current++;
    setState((s) => (s.phase === 'running' ? s : { ...s, phase: 'idle' }));
  }, []);

  return { state, open, confirm, close, deactivate, retryPreview };
}

export const BulkDeleteDialog: React.FC<{
  state: BulkDeleteState;
  noun: string; // "Stalls"
  confirmLabel: string; // "Delete Selected Stalls"
  warning: string;
  onCancel: () => void;
  onConfirm: () => void;
  /** only for the preview flow (stalls) */
  onDeactivate?: (ids: Id[]) => void;
  onRetry?: () => void;
}> = ({ state, noun, confirmLabel, warning, onCancel, onConfirm, onDeactivate, onRetry }) => {
  if (state.phase === 'idle') return null;
  const { phase, ids, progress, summary, preview } = state;
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const split = preview ? splitPreview(preview) : null;
  const single = noun.replace(/s$/i, '').toLowerCase();
  const nameOf = (id: Id) => preview?.stalls.find((s) => s.id === id)?.name ?? summary.failures.find((f) => f.id === id)?.name ?? `#${id}`;
  const deactivatable = split ? split.blocked.filter((s) => s.can_deactivate) : [];
  // Selected stalls that were not deleted and are still active/blocked, or no longer exist: counted so nothing is skipped silently
  const kept = split ? split.blocked.filter((s) => !state.deactivated.includes(s.id)).length + split.missing.length : 0;
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

        {phase === 'previewing' && (
          <p className="text-sm text-fg flex items-center space-x-2" data-testid="bulk-previewing" role="status" aria-live="polite">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Checking which {noun.toLowerCase()} can be deleted…</span>
          </p>
        )}

        {phase === 'review' && state.previewError && (
          <div className="space-y-3" data-testid="bulk-preview-error">
            <p className="text-sm text-danger-fg flex items-start space-x-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{state.previewError}. Nothing was deleted.</span>
            </p>
            <div className="flex space-x-2">
              <button type="button" onClick={onCancel} className="flex-1 py-1.5 text-sm font-semibold text-muted hover:text-fg rounded-lg border border-line" data-testid="bulk-cancel">
                Close
              </button>
              {onRetry && (
                <button type="button" onClick={onRetry} className={`flex-1 justify-center ${buttonClass.secondary}`} data-testid="bulk-retry">
                  Try again
                </button>
              )}
            </div>
          </div>
        )}

        {phase === 'review' && split && (
          <div className="space-y-3" data-testid="stall-review">
            <p className="text-sm font-semibold text-fg" data-testid="bulk-confirm-count">
              Selected: {ids.length} {noun}
            </p>
            {split.missing.length > 0 && <p className="text-xs text-muted">{split.missing.length} selected {single}(s) no longer exist and will be ignored.</p>}

            {split.deletable.length > 0 && (
              <section className="border border-line rounded-lg p-3 space-y-2" data-testid="stall-deletable">
                <h4 className="text-sm font-semibold text-danger-fg flex items-center space-x-1.5">
                  <Trash2 className="w-4 h-4" />
                  <span>Can be deleted permanently ({split.deletable.length})</span>
                </h4>
                <ul className="text-xs divide-y divide-line">
                  {split.deletable.map((s) => (
                    <li key={s.id} className="py-1.5">
                      <span className="font-semibold text-fg">{s.name}</span>
                      {s.code && <span className="font-mono text-muted"> ({s.code})</span>}
                      <span className="block text-muted">
                        No orders or other records. Its {s.menu_items} dish(es) and {s.categories} categor{s.categories === 1 ? 'y' : 'ies'} are deleted with it.
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted flex items-start space-x-1.5">
                  <AlertTriangle className="w-4 h-4 text-warning-fg shrink-0" />
                  <span>{warning}</span>
                </p>
              </section>
            )}

            {split.blocked.length > 0 && (
              <section className="border border-line rounded-lg p-3 space-y-2" data-testid="stall-blocked">
                <h4 className="text-sm font-semibold text-fg flex items-center space-x-1.5">
                  <Power className="w-4 h-4" />
                  <span>Cannot be deleted permanently ({split.blocked.length})</span>
                </h4>
                <ul className="text-xs divide-y divide-line">
                  {split.blocked.map((s) => (
                    <li key={s.id} className="py-1.5 space-y-1" data-testid="stall-blocked-row">
                      <div className="flex items-center justify-between gap-2">
                        <span>
                          <span className="font-semibold text-fg">{s.name}</span>
                          {s.code && <span className="font-mono text-muted"> ({s.code})</span>}
                        </span>
                        {state.deactivated.includes(s.id) ? (
                          <span className="inline-flex items-center space-x-1 text-success-fg font-semibold" data-testid="stall-deactivated" role="status" aria-live="polite">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Deactivated - history kept</span>
                          </span>
                        ) : s.can_deactivate && onDeactivate ? (
                          <button type="button" disabled={state.deactivating} onClick={() => onDeactivate([s.id])} className={`${buttonClass.secondary} disabled:opacity-50`} data-testid="stall-deactivate">
                            <Power className="w-3.5 h-3.5" />
                            <span>Deactivate</span>
                          </button>
                        ) : null}
                      </div>
                      <span className="block text-muted">{blockerSentence(s)}</span>
                      {state.deactivateFailed.find((f) => f.id === s.id) && (
                        <span className="block text-danger-fg" data-testid="stall-deactivate-error">Could not deactivate: {state.deactivateFailed.find((f) => f.id === s.id)?.reason}</span>
                      )}
                    </li>
                  ))}
                </ul>
                {deactivatable.length >= 2 && onDeactivate && (
                  <button type="button" disabled={state.deactivating} onClick={() => onDeactivate(deactivatable.map((s) => s.id))} className={`${buttonClass.secondary} disabled:opacity-50`} data-testid="stall-deactivate-all">
                    <Power className="w-3.5 h-3.5" />
                    <span>Deactivate all {deactivatable.length} blocked {noun.toLowerCase()}</span>
                  </button>
                )}
                <p className="text-xs text-muted">
                  <span className="font-semibold">Deactivate</span> hides the {single} from the POS and keeps every order, ticket and settlement; you can activate it again. <span className="font-semibold">Delete permanently</span> erases the {single} and its menu and cannot be undone.
                </p>
              </section>
            )}

            {split.deletable.length === 0 && split.blocked.length === 0 && <p className="text-sm text-muted">Nothing to delete: none of the selected {noun.toLowerCase()} exist any more.</p>}

            <div className="flex space-x-2 pt-1">
              {split.deletable.length > 0 ? (
                <>
                  <button type="button" onClick={onCancel} className="flex-1 py-1.5 text-sm font-semibold text-muted hover:text-fg rounded-lg border border-line" data-testid="bulk-cancel">
                    Cancel
                  </button>
                  <button type="button" onClick={onConfirm} className={`flex-1 justify-center ${buttonClass.danger}`} data-testid="bulk-confirm">
                    Delete {split.deletable.length} {split.deletable.length === 1 ? single : noun.toLowerCase()} permanently
                  </button>
                </>
              ) : (
                <button type="button" onClick={onCancel} className={`flex-1 justify-center ${buttonClass.secondary}`} data-testid="bulk-done">
                  Close
                </button>
              )}
            </div>
          </div>
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
            {preview && (
              <p className="text-sm flex items-center space-x-2 text-fg">
                <Power className="w-4 h-4 text-muted" />
                <span data-testid="bulk-summary-kept">Kept, not deleted: {kept}</span>
              </p>
            )}
            {preview && (
              <ul className="max-h-56 overflow-y-auto divide-y divide-line border border-line rounded-lg text-xs" data-testid="bulk-outcomes">
                {outcomeLines(
                  {
                    deleted: summary.deletedIds,
                    deactivated: state.deactivated,
                    blocked: [
                      ...splitPreview(preview).blocked.filter((s) => !state.deactivated.includes(s.id)).map((s) => ({ id: s.id, reason: s.reason ?? blockerSentence(s) })),
                      ...summary.failures.map((f) => ({ id: f.id, reason: f.reason })),
                      ...splitPreview(preview).missing.map((id) => ({ id, reason: 'It no longer exists.' })),
                    ],
                    deactivateFailed: state.deactivateFailed,
                  },
                  nameOf,
                ).map((l) => (
                  <li key={`${l.kind}-${l.id}`} className={`p-2 ${l.kind === 'deleted' || l.kind === 'deactivated' ? 'text-fg' : 'text-danger-fg'}`} data-outcome={l.kind}>
                    {l.text}
                  </li>
                ))}
              </ul>
            )}
            {!preview && summary.failures.length > 0 && (
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
