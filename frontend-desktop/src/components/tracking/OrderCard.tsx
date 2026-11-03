import { memo, useCallback, useState } from 'react';
import { cardLabel, cardState, isDelayed, progress, type BoardItem, type BoardOrder, type CardState } from '../../lib/fulfillment';
import { statusClasses } from '../../lib/status';
import { ItemRow } from './ItemRow';
import { LateBadge } from '../ui';

const borderTone: Record<CardState, string> = {
  red: statusClasses('cooking').border,
  amber: statusClasses('ready').border,
  green: statusClasses('served').border,
  empty: statusClasses('pending').border,
};
const barTone: Record<CardState, string> = {
  red: statusClasses('cooking').solid,
  amber: statusClasses('ready').solid,
  green: statusClasses('served').solid,
  empty: statusClasses('pending').solid,
};

interface Props {
  order: BoardOrder;
  nowMs: number;
  delayMinutes: number;
  expanded: boolean;
  canMarkReady: boolean;
  busyItems: ReadonlySet<number>;
  serving: boolean;
  onToggle: (orderId: number) => void;
  onItemAction: (order: BoardOrder, item: BoardItem, to: 'ready' | 'served') => void;
  onServeAll: (order: BoardOrder, itemIds: number[]) => void;
}

/**
 * Memoised: the page passes stable callbacks and a per-card clock that only moves when this order's elapsed minute
 * changes (cardNow), so a card re-renders when its own data, minute or busy state changes, not every second.
 */
export const OrderCard = memo(function OrderCard({ order, nowMs, delayMinutes, expanded, canMarkReady, busyItems, serving, onToggle, onItemAction, onServeAll }: Props) {
  const [confirming, setConfirming] = useState(false);
  const onAction = useCallback((it: BoardItem, to: 'ready' | 'served') => onItemAction(order, it, to), [order, onItemAction]);
  const state = cardState(order.items);
  const delayed = isDelayed(order, nowMs, delayMinutes);
  const p = progress(order.items);
  const pct = p.total === 0 ? 0 : Math.round((p.served / p.total) * 100);
  const remaining = order.items.filter((i) => i.status !== 'served' && i.status !== 'cancelled');
  const remainingIds = remaining.map((i) => i.id);

  const startServeAll = () => {
    if (remainingIds.length > 1) setConfirming(true);
    else onServeAll(order, remainingIds);
  };

  return (
    <div data-testid={`order-card-${order.id}`} className="relative">
      <div data-testid={`card-state-${state}`} className={`relative bg-surface rounded-lg border-2 ${borderTone[state]} shadow-sm overflow-hidden`}>
        {delayed && (
          <span
            data-testid={`delayed-${order.id}`}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-inset ring-st-cooking motion-safe:animate-pulse"
          />
        )}
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => onToggle(order.id)}
          className="relative w-full text-left px-3 pt-2 pb-1.5 hover:bg-surface-2"
        >
          <span className="flex items-center justify-between gap-2">
            <span data-testid={`order-label-${order.id}`} className="block text-sm font-semibold text-fg tabular-nums">
              {cardLabel(order, nowMs)}
            </span>
            {delayed && <LateBadge />}
          </span>
        </button>
        {/* Outside the button: interactive content must not contain other landmark/widget roles. */}
        <div className="relative px-3 pb-2">
          <div
            data-testid={`progress-${order.id}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={p.total}
            aria-valuenow={p.served}
            className="h-1 rounded-full bg-surface-2 overflow-hidden"
          >
            <div className={`h-full ${barTone[state]}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
        {expanded && (
          <div className="relative px-3 pb-2 border-t border-line">
            <ul className="divide-y divide-line">
              {order.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  canMarkReady={canMarkReady}
                  busy={busyItems.has(item.id)}
                  onAction={onAction}
                />
              ))}
            </ul>
            {remaining.length > 0 && (
              <div className="pt-2 flex items-center justify-end gap-2">
                {confirming ? (
                  <>
                    <span className="text-xs font-semibold text-fg">Serve {remainingIds.length} items?</span>
                    <button
                      type="button"
                      data-testid={`serve-all-confirm-${order.id}`}
                      disabled={serving}
                      onClick={() => {
                        setConfirming(false);
                        onServeAll(order, remainingIds);
                      }}
                      className="px-2.5 py-1 rounded-lg text-xs font-bold bg-st-served-fg text-surface hover:opacity-90 disabled:opacity-50"
                    >
                      Confirm
                    </button>
                    <button type="button" onClick={() => setConfirming(false)} className="px-2.5 py-1 rounded-lg text-xs font-bold border border-line text-muted">
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    data-testid={`serve-all-${order.id}`}
                    disabled={serving}
                    onClick={startServeAll}
                    className="px-2.5 py-1 rounded-lg text-xs font-bold bg-st-served-fg text-surface hover:opacity-90 disabled:opacity-50"
                  >
                    {serving ? 'Serving…' : 'Serve All Remaining'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
