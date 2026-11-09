import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListChecks, Receipt } from 'lucide-react';
import { usePendingBillsCount } from '../hooks/usePendingBillsCount';
import { useAuth } from '../context/AuthContext';
import { useNow } from '../hooks/useNow';
import { addOrderItem, fetchBoard, serveRemaining, setItemStatus, updateItemQuantity } from '../api/fulfillment';
import { applyOptimistic, cardNow, serverOffset, type BoardItem, type BoardOrder, type BoardPage } from '../lib/fulfillment';
import { mergePages, nextPageCursor, revertItem, shouldApplyPage, showingCounts } from '../lib/boardMerge';
import { EmptyState, ErrorBanner, Loading, PageHeader, buttonClass } from '../components/ui';
import { OrderCard } from '../components/tracking/OrderCard';
import { AddItemModal } from '../components/tracking/AddItemModal';

const POLL_MS = 5000;
const NO_BUSY: ReadonlySet<number> = new Set();

const messageFor = (err: any): string => {
  if (err?.response?.status === 409) return 'Someone else updated this item; showing the latest.';
  const m = err?.response?.data?.message;
  if (typeof m === 'string' && m) return m;
  return 'Could not update the order. Showing the latest state.';
};

const newKey = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `k-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const OrderTrackingPage: React.FC = () => {
  const navigate = useNavigate();
  const pendingCount = usePendingBillsCount();
  const { user } = useAuth();
  // Mark Served: the roles the server allows (owner, cashier, waiter). Kitchen and stall staff only watch the board.
  const canServe = user?.role === 'owner' || user?.role === 'cashier' || user?.role === 'waiter';

  const [orders, setOrders] = useState<BoardOrder[]>([]);
  const [totalActive, setTotalActive] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [delayMinutes, setDelayMinutes] = useState(15);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cards are open by default and stay open (several at once, across refreshes); only cards the user collapsed are listed.
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<number>>(new Set());
  const [busyItems, setBusyItems] = useState<ReadonlySet<number>>(new Set());
  const [servingOrders, setServingOrders] = useState<ReadonlySet<number>>(new Set());
  const [activeOrderForAdd, setActiveOrderForAdd] = useState<BoardOrder | null>(null);

  // Orders with a request in flight (count per order): polls must not overwrite their optimistic state.
  const inFlight = useRef<Map<number, number>>(new Map());
  // Pages to refresh on every poll (page 1 .. deepest loaded); "Load more" raises it by one.
  const wantedPages = useRef(1);
  const busyRef = useRef<Set<number>>(new Set());
  const loadingMoreRef = useRef(false);
  const ordersRef = useRef<BoardOrder[]>([]);
  const serveKeys = useRef<Map<number, { sig: string; key: string }>>(new Map());
  const mounted = useRef(true);
  // Stale-poll guards: bumped whenever a mutation finishes; fetch ordering.
  const mutationSeq = useRef(0);
  const fetchCounter = useRef(0);
  const lastApplied = useRef(0);

  const now = useNow(offset);

  const commitOrders = useCallback((next: BoardOrder[]) => {
    ordersRef.current = next;
    setOrders(next);
  }, []);

  const track = (orderId: number, delta: 1 | -1) => {
    const n = (inFlight.current.get(orderId) ?? 0) + delta;
    if (n <= 0) inFlight.current.delete(orderId);
    else inFlight.current.set(orderId, n);
  };

  const applyPages = useCallback((pages: BoardPage[], wanted: number) => {
    const last = pages[pages.length - 1];
    setOffset(serverOffset(last.server_time, Date.now()));
    setDelayMinutes(last.delay_minutes);
    const merged = mergePages(ordersRef.current, pages, new Set(inFlight.current.keys()));
    setTotalActive(merged.totalActive);
    setNextCursor(merged.nextCursor);
    // The board shrank: refresh fewer pages next time (unless "Load more" raised the target meanwhile).
    if (wantedPages.current === wanted) wantedPages.current = Math.max(1, merged.pagesLoaded);
    commitOrders(merged.orders);
  }, [commitOrders]);

  /** Re-fetches every loaded page (page 1 .. deepest), sequentially, and replaces the board with their union. */
  const refresh = useCallback(async (force = false) => {
    const fetchSeq = ++fetchCounter.current;
    const mutationSeqAtStart = mutationSeq.current;
    const wanted = wantedPages.current;
    try {
      const pages: BoardPage[] = [];
      for (;;) {
        const step = nextPageCursor(pages, wanted);
        if (step.done) break;
        pages.push(await fetchBoard(step.cursor));
        if (!mounted.current) return;
      }
      if (!shouldApplyPage({ fetchSeq, lastAppliedSeq: lastApplied.current, mutationSeqAtStart, mutationSeqNow: mutationSeq.current, force })) return;
      lastApplied.current = fetchSeq;
      applyPages(pages, wanted);
      setError(null);
    } catch (err: any) {
      if (mounted.current) setError(err?.response?.data?.message || 'Could not load the orders board.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [applyPages]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(() => void refresh(), POLL_MS);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        void refresh();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mounted.current = false;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  const replaceOrder = useCallback(
    (next: BoardOrder) => commitOrders(ordersRef.current.map((o) => (o.id === next.id ? next : o))),
    [commitOrders],
  );

  // Stable callbacks (refs only), so memoised cards do not re-render when an unrelated card changes.
  const handleItemAction = useCallback(async (order: BoardOrder, item: BoardItem, to: 'ready' | 'served') => {
    if (busyRef.current.has(item.id)) return;
    busyRef.current.add(item.id);
    setError(null);
    track(order.id, 1);
    setBusyItems((s) => new Set(s).add(item.id));
    replaceOrder(applyOptimistic(ordersRef.current.find((o) => o.id === order.id) ?? order, item.id, to));
    let failed: string | null = null;
    try {
      const res = await setItemStatus(item.id, to, item.version);
      const cur = ordersRef.current.find((o) => o.id === order.id);
      if (cur && mounted.current) replaceOrder({ ...cur, items: cur.items.map((i) => (i.id === item.id ? res.item : i)) });
    } catch (err: any) {
      failed = messageFor(err);
    } finally {
      track(order.id, -1);
      busyRef.current.delete(item.id);
      mutationSeq.current += 1;
      window.dispatchEvent(new Event('pending-bills-updated')); // the item may have made this bill ready: recount now
      if (mounted.current) {
        setBusyItems((s) => {
          const n = new Set(s);
          n.delete(item.id);
          return n;
        });
      }
    }
    if (failed) {
      // Drop the failed optimistic status locally first: another action may keep this order's local copy alive.
      const cur = ordersRef.current.find((o) => o.id === order.id);
      if (cur && mounted.current) replaceOrder(revertItem(cur, item.id, item.status));
      await refresh(true);
      if (mounted.current) setError(failed);
    }
  }, [refresh, replaceOrder]);

  const handleItemQuantityChange = useCallback(
    async (order: BoardOrder, item: BoardItem, delta: 1 | -1) => {
      if (busyRef.current.has(item.id)) return;
      if (delta === -1 && item.quantity <= 1) {
        return;
      }
      busyRef.current.add(item.id);
      setError(null);
      track(order.id, 1);
      setBusyItems((s) => new Set(s).add(item.id));

      try {
        const res = await updateItemQuantity(item.id, delta);
        if (res.order && mounted.current) {
          replaceOrder(res.order);
        }
      } catch (err: any) {
        if (mounted.current) {
          setError(err?.response?.data?.message || 'Could not update item quantity.');
        }
        await refresh(true);
      } finally {
        track(order.id, -1);
        busyRef.current.delete(item.id);
        mutationSeq.current += 1;
        if (mounted.current) {
          setBusyItems((s) => {
            const n = new Set(s);
            n.delete(item.id);
            return n;
          });
        }
      }
    },
    [refresh, replaceOrder]
  );

  const handleAddItem = useCallback(
    async (orderId: number, menuItemId: number, quantity: number, instructions?: string) => {
      setError(null);
      track(orderId, 1);
      try {
        const res = await addOrderItem(orderId, menuItemId, quantity, instructions);
        if (res.order && mounted.current) {
          replaceOrder(res.order);
          setActiveOrderForAdd(res.order);
        }
        return true;
      } catch (err: any) {
        if (mounted.current) {
          setError(err?.response?.data?.message || 'Could not add item to order.');
        }
        await refresh(true);
        return false;
      } finally {
        track(orderId, -1);
        mutationSeq.current += 1;
      }
    },
    [refresh, replaceOrder]
  );

  const handleServeAll = useCallback(async (order: BoardOrder, itemIds: number[]) => {
    const sig = [...itemIds].sort((a, b) => a - b).join(',');
    let entry = serveKeys.current.get(order.id);
    if (!entry || entry.sig !== sig) {
      entry = { sig, key: newKey() };
      serveKeys.current.set(order.id, entry);
    }
    setError(null);
    track(order.id, 1);
    setServingOrders((s) => new Set(s).add(order.id));
    let failed: string | null = null;
    try {
      const res = await serveRemaining(order.id, entry.key, itemIds);
      serveKeys.current.delete(order.id);
      if (mounted.current) replaceOrder(res.order);
    } catch (err: any) {
      failed = messageFor(err);
    } finally {
      track(order.id, -1);
      mutationSeq.current += 1;
      window.dispatchEvent(new Event('pending-bills-updated')); // the bill may be ready now: recount immediately
      if (mounted.current) {
        setServingOrders((s) => {
          const n = new Set(s);
          n.delete(order.id);
          return n;
        });
      }
    }
    if (failed) {
      await refresh(true);
      if (mounted.current) setError(failed);
    }
  }, [refresh, replaceOrder]);

  const onToggle = useCallback(
    (id: number) =>
      setCollapsedIds((cur) => {
        const next = new Set(cur);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );

  /** Load more = one more page in every refresh; sequenced exactly like a poll (same guards). */
  const loadMore = async () => {
    if (!nextCursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    wantedPages.current += 1;
    try {
      await refresh();
    } finally {
      loadingMoreRef.current = false;
      if (mounted.current) setLoadingMore(false);
    }
  };

  const showing = showingCounts(orders, totalActive);

  return (
    <div className="p-4 space-y-4">
      <PageHeader
        title="Orders & Table Tracking"
        icon={ListChecks}
        subtitle={`${totalActive} ${totalActive === 1 ? 'order' : 'orders'} with food still to serve`}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="go-to-pending-bills"
              onClick={() => navigate('/pos?mode=pending_bills')}
              className={buttonClass.secondary}
              title="View and Settle Pending Table Bills"
            >
              <Receipt className="w-4 h-4 text-warning-fg" />
              <span>Pending Bills</span>
              {pendingCount > 0 && (
                <span className="ml-1.5 px-2 py-0.5 rounded-full text-[11px] font-black bg-primary text-primary-fg tabular-nums">
                  {pendingCount}
                </span>
              )}
            </button>
          </div>
        }
      />
      <ErrorBanner message={error} onRetry={() => void refresh()} />
      {loading ? (
        <Loading label="Loading orders…" />
      ) : orders.length === 0 ? (
        <EmptyState title="No active orders" hint="Orders appear here as soon as they are placed." />
      ) : (
        <>
          <div data-testid="board-grid" className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,24rem),1fr))] items-start">
            {orders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                nowMs={cardNow(order.created_at, now)}
                delayMinutes={delayMinutes}
                expanded={!collapsedIds.has(order.id)}
                canServe={canServe}
                busyItems={order.items.some((i) => busyItems.has(i.id)) ? busyItems : NO_BUSY}
                serving={servingOrders.has(order.id)}
                onToggle={onToggle}
                onItemAction={handleItemAction}
                onServeAll={handleServeAll}
                onQuantityChange={handleItemQuantityChange}
                onOpenAddItem={(o) => setActiveOrderForAdd(o)}
              />
            ))}
          </div>
          {nextCursor && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <span className="text-sm text-muted">
                Showing {showing.shown} of {showing.total}
              </span>
              <button type="button" data-testid="board-load-more" disabled={loadingMore} onClick={() => void loadMore()} className={buttonClass.secondary}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}

      {activeOrderForAdd && (
        <AddItemModal
          order={activeOrderForAdd}
          onClose={() => setActiveOrderForAdd(null)}
          onAdd={handleAddItem}
        />
      )}
    </div>
  );
};
