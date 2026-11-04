import React, { memo } from 'react';
import { BellRing, CheckCircle2, ChefHat, XCircle } from 'lucide-react';
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
}

export const ItemRow = memo(function ItemRow({ item, canMarkReady, busy, onAction }: Props) {
  const label = displayStatus(item.status);
  const Icon = chipIcon[label];
  const action = nextItemAction(item.status, canMarkReady);
  return (
    <li data-testid={`item-row-${item.id}`} className="flex items-center justify-between gap-2 py-1.5 text-sm">
      <div className="min-w-0">
        <p className={`font-medium truncate ${item.status === 'cancelled' ? 'line-through text-muted' : 'text-fg'}`}>
          {item.quantity} × {item.name}{' '}
          <span data-testid={`item-stall-${item.id}`} className="text-[11px] font-medium text-muted">
            ({item.stall.name})
          </span>
        </p>
        {item.notes && <p className="text-[11px] text-muted truncate">{item.notes}</p>}
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
