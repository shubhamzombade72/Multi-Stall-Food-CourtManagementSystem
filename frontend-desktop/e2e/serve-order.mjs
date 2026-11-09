/** Billing requires every item served or cancelled: e2e scripts about money serve the food first, through the real API. */
export const serveAll = async (apiBase, token, orderId) => {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const order = await (await fetch(`${apiBase}/orders/${orderId}`, { headers })).json();
  const itemIds = order.data.kitchen_tickets.flatMap((t) => t.ticket_items.map((i) => i.id));
  const res = await fetch(`${apiBase}/orders/${orderId}/serve-remaining`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ idempotency_key: `e2e-serve-${orderId}-${Date.now()}`, item_ids: itemIds }),
  });
  if (!res.ok) throw new Error(`serve-remaining ${orderId} -> ${res.status} ${await res.text()}`);
};
