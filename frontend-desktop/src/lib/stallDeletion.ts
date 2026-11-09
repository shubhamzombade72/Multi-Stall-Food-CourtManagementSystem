/**
 * Pure helpers for the stall delete dialog (no React, unit-tested).
 * The server decides what is deletable (POST /stalls/deletion-preview); this file only groups that verdict and words it.
 * Permanent deletion and deactivation are kept visibly different everywhere: deleting erases the stall and its menu,
 * deactivating hides it from the POS and keeps every order, ticket and settlement.
 */
import type { Id } from './bulkSelection';

export interface Blocker {
  key: string;
  label: string;
  count: number;
  /** history = sales / kitchen / money records that are never erased; setup = working data to reassign or remove first */
  kind: 'history' | 'setup';
}

export interface StallPreview {
  id: Id;
  name: string;
  code: string | null;
  is_active: boolean;
  eligible: boolean;
  can_deactivate: boolean;
  menu_items: number;
  categories: number;
  blockers: Blocker[];
  reason: string | null;
}

export interface PreviewResponse {
  stalls: StallPreview[];
  missing: Id[];
}

export function splitPreview(r: PreviewResponse): { deletable: StallPreview[]; blocked: StallPreview[]; missing: Id[] } {
  return {
    deletable: r.stalls.filter((s) => s.eligible),
    blocked: r.stalls.filter((s) => !s.eligible),
    missing: r.missing,
  };
}

/** Why this stall cannot be deleted for good, and what to do instead. */
export function blockerSentence(p: StallPreview): string {
  const list = p.blockers.map((b) => `${b.count} ${b.label}`).join(', ');
  const hasHistory = p.blockers.some((b) => b.kind === 'history');
  if (hasHistory) {
    const next = p.can_deactivate
      ? 'Deactivate it instead: it disappears from the POS and every record is kept.'
      : 'It is already inactive and keeps all of its records.';
    return `Has ${list}. Permanent deletion is unavailable because it would erase sales, kitchen and settlement history. ${next}`;
  }
  return p.can_deactivate
    ? `Still has ${list}. Reassign or remove these first to delete it, or deactivate the stall instead (nothing is lost).`
    : `Still has ${list}. Reassign or remove these first to delete it.`;
}

export interface DeactivateOutcome {
  done: Id[];
  failed: Array<{ id: Id; reason: string }>;
}

/** Deactivate each id with its own request, in order. A failure never stops or hides the others. */
export async function deactivateAll(
  ids: readonly Id[],
  put: (id: Id) => Promise<void>,
  describeError: (err: unknown) => string = (e) => (e instanceof Error ? e.message : 'Request failed'),
): Promise<DeactivateOutcome> {
  const out: DeactivateOutcome = { done: [], failed: [] };
  for (const id of ids) {
    try {
      await put(id);
      out.done.push(id);
    } catch (err) {
      out.failed.push({ id, reason: describeError(err) });
    }
  }
  return out;
}

export interface Outcomes {
  deleted: Id[];
  deactivated: Id[];
  blocked: Array<{ id: Id; reason: string }>;
  deactivateFailed: Array<{ id: Id; reason: string }>;
}

export interface OutcomeLine {
  kind: 'deleted' | 'deactivated' | 'blocked' | 'failed';
  id: Id;
  text: string;
}

/** One line per stall for the result list, so nothing is skipped silently. */
export function outcomeLines(o: Outcomes, nameOf: (id: Id) => string): OutcomeLine[] {
  return [
    ...o.deleted.map((id) => ({ kind: 'deleted' as const, id, text: `${nameOf(id)}: permanently deleted.` })),
    ...o.deactivated.map((id) => ({ kind: 'deactivated' as const, id, text: `${nameOf(id)}: deactivated (all history kept).` })),
    ...o.blocked.map((b) => ({ kind: 'blocked' as const, id: b.id, text: `${nameOf(b.id)}: not deleted. ${b.reason}` })),
    ...o.deactivateFailed.map((f) => ({ kind: 'failed' as const, id: f.id, text: `${nameOf(f.id)}: could not be deactivated. ${f.reason}` })),
  ];
}
