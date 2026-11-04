/**
 * Pure helpers for bulk selection and bulk deletion on the Stall Directory and Menu Catalog pages.
 * No React in here, so the rules (selection that survives paging, chunked requests, merged summaries) are unit-tested.
 */

export type Id = number;

/** Server cap per request (BulkDeleteService::MAX_IDS is 200); the client stays well below it. */
export const BULK_CHUNK_SIZE = 100;

export interface BulkFailure {
  id: Id;
  name: string | null;
  code: string | null;
  reason: string;
}

export interface BulkSummary {
  requested: number;
  deleted: number;
  failed: number;
  deletedIds: Id[];
  failures: BulkFailure[];
}

export type PageState = 'none' | 'some' | 'all';

export const pageCount = (total: number, pageSize: number): number => Math.max(1, Math.ceil(total / pageSize));

/** Clamp a page number into 1..last (e.g. after a filter or a delete shrank the list). */
export const clampPage = (page: number, total: number, pageSize: number): number => Math.min(Math.max(1, page), pageCount(total, pageSize));

export function pageSlice<T>(items: readonly T[], page: number, pageSize: number): T[] {
  const p = clampPage(page, items.length, pageSize);
  return items.slice((p - 1) * pageSize, p * pageSize);
}

export function toggleId(selected: ReadonlySet<Id>, id: Id): Set<Id> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function pageState(selected: ReadonlySet<Id>, pageIds: readonly Id[]): PageState {
  if (pageIds.length === 0) return 'none';
  const n = pageIds.filter((id) => selected.has(id)).length;
  return n === 0 ? 'none' : n === pageIds.length ? 'all' : 'some';
}

/** The header checkbox: select every row on this page, or - when they are all selected already - unselect just those. Other pages are untouched. */
export function togglePage(selected: ReadonlySet<Id>, pageIds: readonly Id[]): Set<Id> {
  const next = new Set(selected);
  if (pageState(selected, pageIds) === 'all') pageIds.forEach((id) => next.delete(id));
  else pageIds.forEach((id) => next.add(id));
  return next;
}

/** "Select all N filtered records": every id in the filtered list, across all pages. */
export const selectAllFiltered = (filteredIds: readonly Id[]): Set<Id> => new Set(filteredIds);

/** Drop ids that no longer exist (after a delete or a refresh). */
export function pruneSelection(selected: ReadonlySet<Id>, existingIds: Iterable<Id>): Set<Id> {
  const existing = new Set(existingIds);
  return new Set([...selected].filter((id) => existing.has(id)));
}

export function chunk<T>(items: readonly T[], size: number = BULK_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const emptySummary = (): BulkSummary => ({ requested: 0, deleted: 0, failed: 0, deletedIds: [], failures: [] });

export function mergeSummary(a: BulkSummary, b: BulkSummary): BulkSummary {
  return {
    requested: a.requested + b.requested,
    deleted: a.deleted + b.deleted,
    failed: a.failed + b.failed,
    deletedIds: [...a.deletedIds, ...b.deletedIds],
    failures: [...a.failures, ...b.failures],
  };
}

/** Turn one server response (`{ deleted: [...], failed: [...] }`) into a summary. */
export function summaryFromResponse(data: { deleted?: Array<{ id: Id }>; failed?: BulkFailure[] }): BulkSummary {
  const deletedIds = (data.deleted ?? []).map((d) => d.id);
  const failures = data.failed ?? [];
  return { requested: deletedIds.length + failures.length, deleted: deletedIds.length, failed: failures.length, deletedIds, failures };
}

export type BulkRequest = (ids: Id[]) => Promise<{ deleted?: Array<{ id: Id }>; failed?: BulkFailure[] }>;

/**
 * Delete `ids` in chunks, strictly one request at a time. A request that throws (network, 403, 500) marks every id in
 * that chunk as failed with the error text; later chunks still run, so one bad chunk never hides the others' results.
 * `onProgress(done, total)` fires after every chunk.
 */
export async function deleteInChunks(
  ids: readonly Id[],
  request: BulkRequest,
  onProgress?: (done: number, total: number) => void,
  describeError: (err: unknown) => string = (e) => (e instanceof Error ? e.message : 'Request failed'),
  size: number = BULK_CHUNK_SIZE,
): Promise<BulkSummary> {
  let summary = emptySummary();
  let done = 0;
  for (const part of chunk(ids, size)) {
    try {
      summary = mergeSummary(summary, summaryFromResponse(await request(part)));
    } catch (err) {
      const reason = describeError(err);
      summary = mergeSummary(summary, {
        requested: part.length,
        deleted: 0,
        failed: part.length,
        deletedIds: [],
        failures: part.map((id) => ({ id, name: null, code: null, reason })),
      });
    }
    done += part.length;
    onProgress?.(done, ids.length);
  }
  return summary;
}
