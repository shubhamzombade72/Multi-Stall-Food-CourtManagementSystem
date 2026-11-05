import React, { memo } from 'react';
import { BellRing, CheckCircle2, ChefHat, Minus, Plus, XCircle } from 'lucide-react';
import { isStruck, statusClasses, type StatusKind } from '../../lib/status';
import { displayStatus, nextItemAction, type BoardItem, type DisplayStatus } from '../../lib/fulfillment';

const chip = (kind: StatusKind) => `${statusClasses(kind).soft} ${statusClasses(kind).text}${isStruck(kind) ? ' line-through' : ''}`;
const chipTone: Record<DisplayStatus, string> = {
  Cooking: chip('cooking'),
  Ready: chip('ready'),
  Served: chip('served'),
  Cancelled: chip('cancelled'),
};

const chipIcon: Record<DisplayStatus, React.ElementType> = {
  Cooking: ChefHat,
  Ready: BellRing,
  Served: CheckCircle2,
  Cancelled: XCircle,
};

interface Props {
  item: BoardItem;
  canMarkReady: boolean;
  busy: boolean;
  onAction: (item: BoardItem, to: 'ready' | 'served') => void;
  onQuantityChange?: (item: BoardItem, delta: 1 | -1) => void;
}

export const ItemRow = memo(function ItemRow({ item, canMarkReady, busy, onAction, onQuantityChange }: Props) {
  const label = displayStatus(item.status);
  const Icon = chipIcon[label];
  const action = nextItemAction(item.status, canMarkReady);
  const isEligibleForQty =
    Boolean(onQuantityChange) &&
    item.status !== 'cancelled' &&
    item.status !== 'served' &&
    item.status !== 'ready';

  return (
    <li data-testid={`item-row-${item.id}`} className="flex items-center justify-between gap-2 py-1.5 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Quantity Controls and Dish Label: [-] 1 × Hisha (Stall 2) [+] */}
          <div className="flex items-center gap-1.5 min-w-0">
            {isEligibleForQty && (
              <button
                type="button"
                data-testid={`qty-decrease-${item.id}`}
                disabled={busy || item.quantity <= 1}
                onClick={() => onQuantityChange?.(item, -1)}
                className="w-5 h-5 rounded flex items-center justify-center bg-surface-2 hover:bg-surface border border-line text-xs font-bold text-fg hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition shrink-0"
                title={item.quantity <= 1 ? 'Minimum quantity is 1' : 'Decrease quantity (-1)'}
                aria-label="Decrease quantity"
              >
                <Minus className="w-2.5 h-2.5" />
              </button>
            )}

            <p className={`font-medium truncate ${item.status === 'cancelled' ? 'line-through text-muted' : 'text-fg'}`}>
              <span className="font-bold tabular-nums">{item.quantity} ×</span> {item.name}{' '}
              <span data-testid={`item-stall-${item.id}`} className="text-[11px] font-medium text-muted">
                ({item.stall.name})
              </span>
            </p>

            {isEligibleForQty && (
              <button
                type="button"
                data-testid={`qty-increase-${item.id}`}
                disabled={busy}
                onClick={() => onQuantityChange?.(item, 1)}
                className="w-5 h-5 rounded flex items-center justify-center bg-surface-2 hover:bg-surface border border-line text-xs font-bold text-fg hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition shrink-0"
                title="Increase quantity (+1)"
                aria-label="Increase quantity"
              >
                <Plus className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        </div>
        {item.notes && <p className="text-[11px] text-muted truncate mt-0.5">{item.notes}</p>}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <span
          data-testid={`item-status-${item.id}`}
          className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-semibold ${chipTone[label]}`}
        >
          <Icon className="w-3 h-3" aria-hidden="true" />
          {label}
        </span>
        {action && (
          <button
            type="button"
            data-testid={`item-action-${item.id}`}
            disabled={busy}
            onClick={() => onAction(item, action)}
            className="px-2.5 py-1 rounded-lg text-xs font-bold bg-primary text-primary-fg hover:opacity-90 disabled:opacity-50"
          >
            {action === 'served' ? 'Mark Served' : 'Mark Ready'}
          </button>
        )}
      </div>
    </li>
  );
});
