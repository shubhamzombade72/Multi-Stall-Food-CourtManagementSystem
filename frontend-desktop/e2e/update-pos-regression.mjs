/**
 * POS regression against a running API, used after an update: cashier sign-in, new order, pending bills, table orders, served
 * item tracking, outstanding items, cash, UPI and card payments, receipts, cancellation and inventory deduction. It uses the
 * real API and synthetic data, and returns one result per workflow.
 */
export async function posRegression({ api: base, ownerEmail, ownerPassword, tag, check, kotPrint }) {
  const raw = async (token, method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const api = async (token, method, path, body) => {
    const r = await raw(token, method, path, body);
    if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
    return r.json;
  };

  const owner = (await api(null, 'POST', '/auth/login', { email: ownerEmail, password: ownerPassword })).data.token;
  const pw = 'Str0ngPass99';
  const stall = (await api(owner, 'POST', '/stalls', { name: `Reg Stall ${tag}`, code: `R${tag}` })).data;
  const category = (await api(owner, 'POST', '/menu-categories', { stall_id: stall.id, name: `Mains ${tag}` })).data;
  const item = (await api(owner, 'POST', '/menu', { stall_id: stall.id, category_id: category.id, name: `Reg Dosa ${tag}`, price: 100 })).data;
  const table = (await api(owner, 'POST', '/tables', { table_number: `R-${tag}`, capacity: 4, section: 'Main' })).data;
  await api(owner, 'POST', '/staff', { name: 'Reg Cashier', email: `reg.cashier.${tag}@example.test`, password: pw, role: 'cashier' });
  await api(owner, 'PUT', '/settings/upi', { enabled: true, vpa: 'synthetic@oksbi' });

  const login = await raw(null, 'POST', '/auth/login', { email: `reg.cashier.${tag}@example.test`, password: pw });
  const cashier = login.json?.data?.token;
  check('POS-01', 'Cashier signs in', login.status === 200 && Boolean(cashier));

  const place = async (extra = {}) => (await api(cashier, 'POST', '/orders', { order_type: 'takeaway', items: [{ menu_item_id: item.id, quantity: 1 }], ...extra })).data;
  const firstOrder = await place();
  check('POS-02', 'New order is placed from the POS', Boolean(firstOrder.id) && firstOrder.order_number !== undefined, firstOrder.order_number);

  const tableOrder = await place({ order_type: 'dine_in', table_id: table.id, guest_count: 2 });
  const board = (await api(owner, 'GET', '/orders/board')).data.orders;
  check('POS-03', 'Table order appears on the tracking board', board.some((o) => o.id === tableOrder.id));

  const pendingBefore = (await api(cashier, 'GET', '/billing/pending')).data.map((o) => o.id);
  const refused = await raw(cashier, 'POST', '/billing/pay', { order_id: tableOrder.id, payment_method: 'cash', amount: tableOrder.total_amount, cash_tendered: 1000 });
  check('POS-04', 'Outstanding items block billing until served', !pendingBefore.includes(tableOrder.id) && refused.status >= 400, `pay=${refused.status}`);

  const itemsOf = async (id) => (await api(owner, 'GET', '/orders/board')).data.orders.find((o) => o.id === id).items;
  const serve = async (id) => {
    for (const i of await itemsOf(id)) await api(cashier, 'PATCH', `/ticket-items/${i.id}/status`, { status: 'served' });
  };
  await serve(tableOrder.id);
  const servedItems = await raw(owner, 'GET', `/orders/${tableOrder.id}`);
  const tickets = servedItems.json.data.kitchen_tickets.flatMap((t) => t.ticket_items);
  check('POS-05', 'Served item tracking records the served state', tickets.length > 0 && tickets.every((i) => i.status === 'served'));

  const pendingAfter = (await api(cashier, 'GET', '/billing/pending')).data.map((o) => o.id);
  check('POS-06', 'Pending bills lists the order once all is served', pendingAfter.includes(tableOrder.id));

  const paid = async (order, body) => raw(cashier, 'POST', '/billing/pay', { order_id: order.id, amount: order.total_amount, ...body });
  const cash = await paid(tableOrder, { payment_method: 'cash', cash_tendered: Number(tableOrder.total_amount) + 50 });
  const cashOrder = (await api(owner, 'GET', `/orders/${tableOrder.id}`)).data;
  check('POS-07', 'Cash payment settles the bill and records change', cash.status < 300 && cashOrder.payment_status === 'paid' && cashOrder.payments.length === 1 && Number(cashOrder.payments[0].change_returned) === 50, `status=${cash.status}`);

  const receipt = await raw(cashier, 'GET', `/billing/receipt/${tableOrder.id}`);
  check('POS-08', 'Receipt is available for the paid order', receipt.status === 200 && Boolean(receipt.json.data), `status=${receipt.status}`);

  await serve(firstOrder.id);
  const card = await paid(firstOrder, { payment_method: 'card', transaction_reference: `CARD${tag}0001` });
  check('POS-09', 'Card payment settles the bill', card.status < 300, `status=${card.status} ${card.status >= 300 ? JSON.stringify(card.json).slice(0, 200) : ''}`);

  const upiOrder = await place();
  await serve(upiOrder.id);
  const upiRequest = await raw(cashier, 'POST', `/billing/orders/${upiOrder.id}/upi-request`);
  const reference = upiRequest.json?.data?.reference ?? upiRequest.json?.data?.upi_reference;
  const upi = await paid(upiOrder, { payment_method: 'upi_qr', upi_reference: reference, payment_verified: true, transaction_reference: `UPI${tag}0001` });
  check('POS-10', 'UPI payment settles the bill', upiRequest.status < 300 && upi.status < 300, `request=${upiRequest.status} pay=${upi.status} ${upi.status >= 300 ? JSON.stringify(upi.json).slice(0, 200) : ''}`);

  const cancelOrder = await place();
  const cancel = await raw(cashier, 'POST', `/orders/${cancelOrder.id}/cancel`, { reason: 'regression' });
  const cancelled = (await api(owner, 'GET', `/orders/${cancelOrder.id}`)).data;
  check('POS-11', 'Cancellation works', cancel.status < 300 && cancelled.status === 'cancelled', `status=${cancel.status} ${cancelled.status}`);

  const stock = (await api(owner, 'POST', '/inventory', { stall_id: stall.id, name: `Reg Rice ${tag}`, unit: 'kg', current_stock: 10, minimum_alert_stock: 1, unit_cost: 40 })).data;
  const out = await raw(owner, 'POST', `/inventory/${stock.id}/stock-out`, { quantity: 2.5, movement_type: 'consumption', reason: 'regression' });
  const stockNow = (await api(owner, 'GET', '/inventory')).data;
  const list = Array.isArray(stockNow) ? stockNow : stockNow.data;
  const row = list.find((x) => x.id === stock.id);
  check('POS-12', 'Inventory deduction is recorded', out.status < 300 && Number(row.current_stock) === 7.5, `status=${out.status} stock=${row?.current_stock}`);

  if (kotPrint) check('POS-13', 'KOT prints through the kitchen printer queue', await kotPrint(), '');

  const history = await raw(owner, 'GET', '/billing/payments');
  check('POS-14', 'Payment history lists the payments', history.status === 200 && history.json.data.total >= 3, `total=${history.json?.data?.total}`);
  const report = await raw(owner, 'GET', '/reports/dashboard');
  check('POS-15', 'Owner dashboard report still works', report.status === 200);
}
