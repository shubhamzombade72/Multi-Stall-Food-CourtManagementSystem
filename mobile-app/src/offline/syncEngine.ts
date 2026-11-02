/**
 * Offline order queue synchronisation, kept free of React Native / storage imports so the
 * exact production logic can be exercised by Node tests against a real staging server.
 *
 * Guarantees:
 *  - An order keeps ONE idempotency key from its first submission attempt through every retry,
 *    so "server committed but the response was lost" can never create a second order.
 *  - Network failures (no response, timeout, 408/429/5xx) are retried with exponential backoff.
 *  - Business rejections (other 4xx, e.g. item out of stock) are NOT retried forever; they are
 *    marked 'rejected' for the waiter to review.
 *  - Concurrent sync calls (button double-tap + background timer) share a single run.
 */

export type SyncStatus = 'pending' | 'syncing' | 'failed' | 'rejected' | 'synced';

export interface QueuedOrderLike {
  id: string; // == idempotency key
  sync_status: SyncStatus;
  retry_count?: number;
  last_attempt_at?: number;
  error_message?: string;
}

export interface QueueStoreLike<T extends QueuedOrderLike> {
  getQueue(): Promise<T[]>;
  updateQueueItem(id: string, updates: Partial<T>): Promise<void>;
  removeQueueItem(id: string): Promise<void>;
}

export interface HttpResult {
  status: number;
  data: any;
}

/** Must resolve with the HTTP status for ANY server response and reject only when no response arrived. */
export type PostOrderFn<T> = (item: T) => Promise<HttpResult>;

export const MAX_BACKOFF_MS = 5 * 60 * 1000;

export const backoffDelayMs = (retryCount: number): number =>
  Math.min(2 ** Math.max(retryCount - 1, 0) * 1000, MAX_BACKOFF_MS);

/** 'retry' = transient, try again later; 'reject' = the server refused this order, retrying will not help. */
export const classifyStatus = (status: number): 'ok' | 'retry' | 'reject' => {
  if (status === 200 || status === 201) return 'ok';
  if (status === 408 || status === 429 || status >= 500) return 'retry';
  return 'reject';
};

export const newIdempotencyKey = (prefix = 'waiter'): string => {
  const rand = Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 8)).join('');
  return `${prefix}_${Date.now()}_${rand}`.slice(0, 64);
};

export interface SyncSummary {
  synced: number;
  failed: number;
  rejected: number;
  skipped: number;
}

let inFlight: Promise<SyncSummary> | null = null;

export const syncQueue = <T extends QueuedOrderLike>(
  store: QueueStoreLike<T>,
  post: PostOrderFn<T>,
  opts: { force?: boolean; now?: () => number; onProgress?: (done: number, total: number) => void } = {}
): Promise<SyncSummary> => {
  if (inFlight) return inFlight;
  inFlight = runSync(store, post, opts).finally(() => {
    inFlight = null;
  });
  return inFlight;
};

const runSync = async <T extends QueuedOrderLike>(
  store: QueueStoreLike<T>,
  post: PostOrderFn<T>,
  opts: { force?: boolean; now?: () => number; onProgress?: (done: number, total: number) => void }
): Promise<SyncSummary> => {
  const now = opts.now ?? Date.now;
  const queue = await store.getQueue();
  const summary: SyncSummary = { synced: 0, failed: 0, rejected: 0, skipped: 0 };

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];

    // Rejected orders wait for a human decision; backoff applies unless the waiter forces a sync
    const waitMs = backoffDelayMs(item.retry_count ?? 0);
    const tooSoon = item.last_attempt_at !== undefined && now() - item.last_attempt_at < waitMs;
    if (item.sync_status === 'synced' || item.sync_status === 'rejected' || (!opts.force && tooSoon)) {
      summary.skipped++;
      continue;
    }

    await store.updateQueueItem(item.id, {
      sync_status: 'syncing',
      retry_count: (item.retry_count ?? 0) + 1,
      last_attempt_at: now(),
    } as Partial<T>);

    try {
      const res = await post(item);
      const verdict = classifyStatus(res.status);
      if (verdict === 'ok') {
        await store.removeQueueItem(item.id);
        summary.synced++;
      } else if (verdict === 'retry') {
        await store.updateQueueItem(item.id, {
          sync_status: 'failed',
          error_message: res.data?.message || `Server busy (HTTP ${res.status})`,
        } as Partial<T>);
        summary.failed++;
      } else {
        await store.updateQueueItem(item.id, {
          sync_status: 'rejected',
          error_message: res.data?.message || `Rejected by server (HTTP ${res.status})`,
        } as Partial<T>);
        summary.rejected++;
      }
    } catch (err: any) {
      // No response at all: the server may or may not have committed. The unchanged
      // idempotency key makes the next attempt safe either way.
      await store.updateQueueItem(item.id, {
        sync_status: 'failed',
        error_message: err?.message || 'Network unreachable',
      } as Partial<T>);
      summary.failed++;
    }

    opts.onProgress?.(i + 1, queue.length);
  }

  return summary;
};
