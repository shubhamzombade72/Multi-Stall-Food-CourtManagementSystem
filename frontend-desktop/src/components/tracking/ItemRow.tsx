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
  /** Owner, cashier or waiter: the people the server lets mark an item served. */
  canServe: boolean;
  busy: boolean;
  onAction: (item: BoardItem, to: 'served') => void;
  onQuantityChange?: (item: BoardItem, delta: 1 | -1) => void;
}

export const ItemRow = memo(function ItemRow({ item, canServe, busy, onAction, onQuantityChange }: Props) {
  const label = displayStatus(item.status);
  const Icon = chipIcon[label];
  const action = nextItemAction(item.status, canServe);
  // Only two states on the board: still to serve (the Mark Served button) and Served. Cancelled keeps its own chip.
  const showChip = item.status === 'served' || item.status === 'cancelled' || !action;
  const isEligibleForQty =
    Boolean(onQuantityChange) &&
    item.status !== 'cancelled' &&
    item.status !== 'served' &&
    item.status !== 'ready';

  const qtyButton =
    'w-6 h-6 rounded flex items-center justify-center bg-surface-2 hover:bg-surface border border-line text-xs font-bold text-fg hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition shrink-0';

  // Quantity | full dish name (wraps, never cut off) | status + action. The name takes the free width; when the card is too
  // narrow for all three, the status and action move to their own line instead of squeezing the name.
  return (
    <li data-testid={`item-row-${item.id}`} className="flex flex-wrap items-start gap-x-2 gap-y-1.5 py-2 text-sm">
      <div data-testid={`item-qty-${item.id}`} className="flex items-center gap-1 shrink-0 pt-px">
        {isEligibleForQty && (
          <button
            type="button"
            data-testid={`qty-decrease-${item.id}`}
            disabled={busy || item.quantity <= 1}
            onClick={() => onQuantityChange?.(item, -1)}
            className={qtyButton}
            title={item.quantity <= 1 ? 'Minimum quantity is 1' : 'Decrease quantity (-1)'}
            aria-label="Decrease quantity"
          >
            <Minus className="w-3 h-3" />
          </button>
        )}
        <span className="min-w-[2.25rem] text-center font-bold tabular-nums text-fg">{item.quantity} ×</span>
        {isEligibleForQty && (
          <button
            type="button"
            data-testid={`qty-increase-${item.id}`}
            disabled={busy}
            onClick={() => onQuantityChange?.(item, 1)}
            className={qtyButton}
            title="Increase quantity (+1)"
            aria-label="Increase quantity"
          >
            <Plus className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="min-w-0 flex-1 basis-40">
        <p data-testid={`item-name-${item.id}`} className={`font-medium leading-snug break-words ${item.status === 'cancelled' ? 'line-through text-muted' : 'text-fg'}`}>
          {item.name}
        </p>
        <p data-testid={`item-stall-${item.id}`} className="text-[11px] font-medium text-muted leading-snug break-words">
          {item.stall.name}
        </p>
        {item.notes && <p className="text-[11px] text-muted mt-0.5 break-words">{item.notes}</p>}
      </div>

      <div data-testid={`item-controls-${item.id}`} className="flex items-center justify-end gap-2 shrink-0 ml-auto">

        {showChip && (
        <span
          data-testid={`item-status-${item.id}`}
          className={`inline-flex items-center gap-1 whitespace-nowrap text-[11px] px-2 py-0.5 rounded-full font-semibold ${chipTone[label]}`}
        >
          <Icon className="w-3 h-3" aria-hidden="true" />
          {label === 'Cooking' || label === 'Ready' ? 'Not served' : label}
        </span>
        )}
        {action && (
          <button
            type="button"
            data-testid={`item-action-${item.id}`}
            disabled={busy}
            onClick={() => onAction(item, action)}
            className="min-w-[6.5rem] whitespace-nowrap px-2.5 py-1 rounded-lg text-xs font-bold bg-primary text-primary-fg hover:opacity-90 disabled:opacity-50"
          >
            Mark Served
          </button>
        )}
      </div>
    </li>
  );
});
