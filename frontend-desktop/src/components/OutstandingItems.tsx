import React from 'react';

export interface OutstandingItem {
  order_item_id: number;
  name: string;
  quantity: number;
  stall: string | null;
  status: string;
  status_label: string;
}

/** Server-provided items that are keeping an order from being billed, with their current statuses. */
export const OutstandingItems: React.FC<{ items: OutstandingItem[] }> = ({ items }) => (
  <ul data-testid="outstanding-items" className="space-y-0.5">
    {items.map((item) => (
      <li key={item.order_item_id} className="flex justify-between gap-3">
        <span className="min-w-0 truncate">
          {item.quantity}× {item.name}
          {item.stall ? ` (${item.stall})` : ''}
        </span>
        <span className="font-bold shrink-0">{item.status_label}</span>
      </li>
    ))}
  </ul>
);
