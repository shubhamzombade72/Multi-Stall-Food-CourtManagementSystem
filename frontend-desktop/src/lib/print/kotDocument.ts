import type { PrintBlock, PrintDocument } from './types.ts';

/** A kitchen ticket as the API returns it (GET /orders/{id} -> kitchenTickets, or GET /kitchen/tickets). */
export interface KotTicketInput {
  id: number;
  ticket_number: string;
  stall_id: number;
  status?: string;
  stall?: { id?: number; name?: string } | null;
  order?: KotOrderInput | null;
  ticketItems?: KotItemInput[];
  ticket_items?: KotItemInput[];
}
export interface KotItemInput {
  id?: number;
  quantity: number;
  status?: string | null;
  orderItem?: KotOrderItem | null;
  order_item?: KotOrderItem | null;
}
export interface KotOrderItem {
  item_name: string;
  special_instructions?: string | null;
  stall_id?: number | null;
}
export interface KotOrderInput {
  id?: number;
  order_number: string;
  order_type?: string | null;
  notes?: string | null;
  created_at?: string;
  table?: { table_number: string } | null;
  customer_name?: string | null;
}

export interface KotDocumentResult {
  ticketId: number;
  stallId: number;
  stallName: string;
  ticketNumber: string;
  orderNumber: string;
  dedupeKey: string;
  doc: PrintDocument;
}

export const kotDedupeKey = (ticketId: number): string => `kot:${ticketId}`;

/**
 * The paper kitchen ticket for ONE stall. The lines come only from that ticket's own items, and any line whose
 * order item belongs to a different stall is dropped as a second safeguard, so one stall's KOT can never list another
 * stall's food. No prices. Cancelled lines are left off.
 */
export function buildKotDocument(ticket: KotTicketInput, orderFallback?: KotOrderInput | null): KotDocumentResult {
  const order = ticket.order || orderFallback || { order_number: '' };
  const stallName = ticket.stall?.name || '';
  const items = (ticket.ticketItems || ticket.ticket_items || []).filter((li) => {
    if (li.status === 'cancelled') return false;
    const oi = li.orderItem || li.order_item;
    if (!oi) return false;
    return oi.stall_id === undefined || oi.stall_id === null || Number(oi.stall_id) === Number(ticket.stall_id);
  });

  const b: PrintBlock[] = [];
  b.push({ t: 'text', text: 'KITCHEN ORDER', align: 'center', bold: true });
  b.push({ t: 'text', text: stallName ? stallName.toUpperCase() : 'STALL', align: 'center', bold: true, size: 'large' });
  b.push({ t: 'rule', style: 'double' });
  b.push({ t: 'text', text: `Order: ${order.order_number}`, bold: true });
  b.push({ t: 'text', text: `Ticket: ${ticket.ticket_number}` });
  b.push({ t: 'text', text: order.table ? `Table: ${order.table.table_number}` : `Takeaway${order.order_type ? ` (${String(order.order_type).replace(/_/g, ' ')})` : ''}` });
  if (order.customer_name) b.push({ t: 'text', text: `Customer: ${order.customer_name}` });
  if (order.created_at) b.push({ t: 'text', text: `Time: ${new Date(order.created_at).toLocaleString()}` });
  b.push({ t: 'rule' });
  for (const li of items) {
    const oi = (li.orderItem || li.order_item)!;
    b.push({ t: 'text', text: `${li.quantity} x ${oi.item_name}`, bold: true, size: 'large' });
    if (oi.special_instructions && oi.special_instructions.trim()) b.push({ t: 'text', text: `  >> ${oi.special_instructions.trim()}` });
  }
  if (items.length === 0) b.push({ t: 'text', text: '(no active items on this ticket)' });
  if (order.notes && String(order.notes).trim()) {
    b.push({ t: 'rule' });
    b.push({ t: 'text', text: `ORDER NOTE: ${String(order.notes).trim()}`, bold: true });
  }
  b.push({ t: 'rule', style: 'double' });
  b.push({ t: 'feed', lines: 1 });

  return {
    ticketId: ticket.id,
    stallId: ticket.stall_id,
    stallName,
    ticketNumber: ticket.ticket_number,
    orderNumber: order.order_number,
    dedupeKey: kotDedupeKey(ticket.id),
    doc: { kind: 'kot', title: `KOT ${ticket.ticket_number}`, blocks: b },
  };
}

/** One KOT per stall ticket of an order (GET /orders/{id}); cancelled tickets are skipped. */
export function buildKotDocuments(order: KotOrderInput & { kitchenTickets?: KotTicketInput[]; kitchen_tickets?: KotTicketInput[] }): KotDocumentResult[] {
  const tickets = order.kitchenTickets || order.kitchen_tickets || [];
  return tickets.filter((t) => t.status !== 'cancelled').map((t) => buildKotDocument(t, order));
}
