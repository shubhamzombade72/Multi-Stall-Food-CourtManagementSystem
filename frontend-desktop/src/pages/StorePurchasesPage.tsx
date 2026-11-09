import React, { useEffect, useState } from 'react';
import { CheckCircle2, Eye, Pencil, Plus, Trash2, Truck, XCircle } from 'lucide-react';
import { apiClient } from '../api/client';
import { apiError, dateOnly, isoDate, money } from '../lib/format';
import { Badge, Card, EmptyState, ErrorBanner, Field, Loading, Modal, PageHeader, Pagination, SuccessBanner, buttonClass, compactInputClass, inputClass, statusTone } from '../components/ui';

/** The central store's buying: purchase orders and suppliers. Receiving an order adds its stock to the store. */
export const StorePurchasesPage: React.FC = () => {
  const [tab, setTab] = useState<'purchases' | 'suppliers'>('purchases');
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">
      <PageHeader title="Purchases & Suppliers" subtitle="Everything here is bought for the central store." icon={Truck} />
      <SuccessBanner message={notice} />
      <div className="flex gap-2" role="tablist">
        {(['purchases', 'suppliers'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${tab === t ? 'bg-primary text-primary-fg' : 'bg-surface border border-line text-muted'}`}>
            {t === 'purchases' ? 'Purchase orders' : 'Suppliers'}
          </button>
        ))}
      </div>
      {tab === 'purchases' ? <Purchases onNotice={setNotice} /> : <Suppliers onNotice={setNotice} />}
    </div>
  );
};

const Purchases: React.FC<{ onNotice: (m: string) => void }> = ({ onNotice }) => {
  const [rows, setRows] = useState<any[] | null>(null);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<any>(null);
  const [cancelling, setCancelling] = useState<any>(null);
  const [receiving, setReceiving] = useState<any>(null);

  const load = async () => {
    try {
      const res = await apiClient.get('/store/purchases', { params: { status: status || undefined, page, per_page: 20 } });
      const d = res.data.data;
      setRows(d.data);
      setLastPage(d.last_page);
      setTotal(d.total);
      setError(null);
    } catch (err) {
      setRows([]);
      setError(apiError(err, 'Failed to load purchase orders'));
    }
  };

  useEffect(() => {
    load();
  }, [status, page]);

  const done = async (message: string) => {
    onNotice(message);
    setCreating(false);
    setCancelling(null);
    setReceiving(null);
    await load();
  };

  return (
    <>
      <ErrorBanner message={error} onRetry={load} />
      <Card>
        <div className="p-3 border-b border-line flex items-center justify-between gap-3 flex-wrap">
          <select aria-label="Filter by status" className={compactInputClass} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            <option value="ordered">Ordered</option>
            <option value="received">Received</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button className={buttonClass.primary} onClick={() => setCreating(true)}>
            <Plus className="w-4 h-4" />
            <span>New purchase order</span>
          </button>
        </div>
        {rows === null ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState title="No purchase orders" hint="Add a supplier and a raw material first, then create an order." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-canvas text-muted text-xs uppercase">
                <tr>
                  <th className="py-2 px-3 text-left">Order</th>
                  <th className="py-2 px-3 text-left">Date</th>
                  <th className="py-2 px-3 text-left">Supplier</th>
                  <th className="py-2 px-3 text-right">Total</th>
                  <th className="py-2 px-3 text-left">Status</th>
                  <th className="py-2 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 px-3 font-semibold text-fg whitespace-nowrap">{p.purchase_number}</td>
                    <td className="py-2 px-3 whitespace-nowrap">{dateOnly(p.order_date)}</td>
                    <td className="py-2 px-3">{p.supplier?.name}</td>
                    <td className="py-2 px-3 text-right">{money(p.total_amount)}</td>
                    <td className="py-2 px-3">
                      <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex justify-end gap-1">
                        <button aria-label={`View ${p.purchase_number}`} onClick={() => setViewing(p)} className="px-2 py-1 rounded border border-line text-xs font-semibold flex items-center gap-1">
                          <Eye className="w-3 h-3" />
                          View
                        </button>
                        {p.status === 'ordered' && (
                          <>
                            <button aria-label={`Receive ${p.purchase_number}`} onClick={() => setReceiving(p)} className="px-2 py-1 rounded border border-line text-xs font-semibold flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              Receive
                            </button>
                            <button aria-label={`Cancel ${p.purchase_number}`} onClick={() => setCancelling(p)} className="px-2 py-1 rounded border border-line text-xs font-semibold flex items-center gap-1">
                              <XCircle className="w-3 h-3" />
                              Cancel
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} lastPage={lastPage} total={total} onPage={setPage} />
      </Card>

      {creating && <NewPurchaseModal onClose={() => setCreating(false)} onSaved={done} />}
      {viewing && (
        <Modal title={viewing.purchase_number} onClose={() => setViewing(null)} wide>
          <PurchaseLines purchase={viewing} />
          {viewing.notes && <p className="text-sm text-muted whitespace-pre-line">{viewing.notes}</p>}
        </Modal>
      )}
      {receiving && <ReceiveModal purchase={receiving} onClose={() => setReceiving(null)} onSaved={done} />}
      {cancelling && <CancelModal purchase={cancelling} onClose={() => setCancelling(null)} onSaved={done} />}
    </>
  );
};

const PurchaseLines: React.FC<{ purchase: any }> = ({ purchase }) => (
  <table className="w-full text-sm">
    <thead className="text-muted text-xs uppercase">
      <tr>
        <th className="py-1 px-2 text-left">Raw material</th>
        <th className="py-1 px-2 text-right">Quantity</th>
        <th className="py-1 px-2 text-right">Price</th>
        <th className="py-1 px-2 text-right">Total</th>
      </tr>
    </thead>
    <tbody className="divide-y divide-line">
      {(purchase.items || []).map((l: any) => (
        <tr key={l.id}>
          <td className="py-1 px-2">{l.item?.name}</td>
          <td className="py-1 px-2 text-right whitespace-nowrap">
            {Number(l.quantity)} {l.item?.unit}
          </td>
          <td className="py-1 px-2 text-right">{money(l.unit_price)}</td>
          <td className="py-1 px-2 text-right">{money(l.total_price)}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const ReceiveModal: React.FC<{ purchase: any; onClose: () => void; onSaved: (m: string) => void }> = ({ purchase, onClose, onSaved }) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiClient.post(`/store/purchases/${purchase.id}/receive`);
      onSaved(`${purchase.purchase_number} received. Stock added to the store.`);
    } catch (err) {
      setError(apiError(err, 'Could not receive this order'));
      setSaving(false);
    }
  };
  return (
    <Modal title={`Receive ${purchase.purchase_number}`} onClose={onClose} onSubmit={submit} submitLabel="Receive all" submitting={saving} error={error} wide>
      <p className="text-sm text-muted">All of this will be added to store stock, and each raw material's price will change to this order's price.</p>
      <PurchaseLines purchase={purchase} />
    </Modal>
  );
};

const CancelModal: React.FC<{ purchase: any; onClose: () => void; onSaved: (m: string) => void }> = ({ purchase, onClose, onSaved }) => {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiClient.post(`/store/purchases/${purchase.id}/cancel`, { reason });
      onSaved(`${purchase.purchase_number} cancelled.`);
    } catch (err) {
      setError(apiError(err, 'Could not cancel this order'));
      setSaving(false);
    }
  };
  return (
    <Modal title={`Cancel ${purchase.purchase_number}`} onClose={onClose} onSubmit={submit} submitLabel="Cancel order" submitting={saving} error={error}>
      <Field label="Reason">
        <input required maxLength={255} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
};

const NewPurchaseModal: React.FC<{ onClose: () => void; onSaved: (m: string) => void }> = ({ onClose, onSaved }) => {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [orderDate, setOrderDate] = useState(isoDate());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([{ store_item_id: '', quantity: '', unit_price: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([apiClient.get('/store/suppliers'), apiClient.get('/store/items')])
      .then(([s, i]) => {
        setSuppliers(s.data.data);
        setItems(i.data.data);
      })
      .catch((err) => setError(apiError(err, 'Failed to load suppliers and raw materials')));
  }, []);

  const setLine = (index: number, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const chooseItem = (index: number, id: string) => {
    const item = items.find((i) => String(i.id) === id);
    setLine(index, { store_item_id: id, unit_price: item ? String(Number(item.unit_cost)) : '' });
  };
  const total = lines.reduce((sum, l) => sum + Number(l.quantity || 0) * Number(l.unit_price || 0), 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.post('/store/purchases', { store_supplier_id: Number(supplierId), order_date: orderDate, notes: notes || undefined, items: lines.map((l) => ({ ...l, store_item_id: Number(l.store_item_id) })) });
      onSaved(`${res.data.data.purchase_number} created.`);
    } catch (err) {
      setError(apiError(err, 'Could not create the order'));
      setSaving(false);
    }
  };

  return (
    <Modal title="New purchase order" onClose={onClose} onSubmit={submit} submitLabel="Create order" submitting={saving} error={error} wide>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Supplier">
          <select aria-label="Supplier" required className={inputClass} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Select supplier</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Order date">
          <input required type="date" className={inputClass} value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
        </Field>
      </div>
      {lines.map((line, index) => (
        <div key={index} className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-6">
            <Field label="Raw material">
              <select aria-label={`Raw material line ${index + 1}`} required className={inputClass} value={line.store_item_id} onChange={(e) => chooseItem(index, e.target.value)}>
                <option value="">Select</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.unit})
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Quantity">
              <input aria-label={`Quantity line ${index + 1}`} required type="number" min="0.001" step="0.001" className={inputClass} value={line.quantity} onChange={(e) => setLine(index, { quantity: e.target.value })} />
            </Field>
          </div>
          <div className="col-span-3">
            <Field label="Price (₹)">
              <input aria-label={`Price line ${index + 1}`} required type="number" min="0" step="0.01" className={inputClass} value={line.unit_price} onChange={(e) => setLine(index, { unit_price: e.target.value })} />
            </Field>
          </div>
          <div className="col-span-1 pb-1">
            <button type="button" aria-label={`Remove line ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, i) => i !== index))} className="p-1.5 text-muted hover:text-danger-fg disabled:opacity-30">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <button type="button" className={buttonClass.secondary} onClick={() => setLines((ls) => [...ls, { store_item_id: '', quantity: '', unit_price: '' }])}>
          <Plus className="w-4 h-4" />
          <span>Add line</span>
        </button>
        <span className="font-bold text-fg">Total {money(total)}</span>
      </div>
      <Field label="Notes (optional)">
        <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  );
};

const Suppliers: React.FC<{ onNotice: (m: string) => void }> = ({ onNotice }) => {
  const [rows, setRows] = useState<any[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<any>(null);
  const [history, setHistory] = useState<any>(null);

  const load = async () => {
    try {
      const res = await apiClient.get('/store/suppliers', { params: { search: search || undefined, include_inactive: 1 } });
      setRows(res.data.data);
      setError(null);
    } catch (err) {
      setRows([]);
      setError(apiError(err, 'Failed to load suppliers'));
    }
  };

  useEffect(() => {
    load();
  }, [search]);

  const openHistory = async (id: number) => {
    try {
      setHistory((await apiClient.get(`/store/suppliers/${id}`)).data.data);
    } catch (err) {
      setError(apiError(err, 'Failed to load supplier history'));
    }
  };

  return (
    <>
      <ErrorBanner message={error} onRetry={load} />
      <Card>
        <div className="p-3 border-b border-line flex items-center justify-between gap-3 flex-wrap">
          <input aria-label="Search suppliers" placeholder="Name, contact or phone" value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputClass} max-w-xs`} />
          <button className={buttonClass.primary} onClick={() => setEditing({ name: '', contact_person: '', phone: '', email: '', address: '' })}>
            <Plus className="w-4 h-4" />
            <span>Add supplier</span>
          </button>
        </div>
        {rows === null ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState title="No suppliers yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-canvas text-muted text-xs uppercase">
                <tr>
                  <th className="py-2 px-3 text-left">Supplier</th>
                  <th className="py-2 px-3 text-left">Contact</th>
                  <th className="py-2 px-3 text-left">Phone</th>
                  <th className="py-2 px-3 text-right">Orders</th>
                  <th className="py-2 px-3 text-right">Received value</th>
                  <th className="py-2 px-3 text-left">Status</th>
                  <th className="py-2 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2 px-3 font-semibold text-fg">{s.name}</td>
                    <td className="py-2 px-3">{s.contact_person || '—'}</td>
                    <td className="py-2 px-3">{s.phone || '—'}</td>
                    <td className="py-2 px-3 text-right">{s.purchase_orders_count}</td>
                    <td className="py-2 px-3 text-right">{money(s.received_total)}</td>
                    <td className="py-2 px-3">
                      <Badge tone={statusTone(s.is_active ? 'active' : 'inactive')}>{s.is_active ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex justify-end gap-1">
                        <button aria-label={`History of ${s.name}`} onClick={() => openHistory(s.id)} className="px-2 py-1 rounded border border-line text-xs font-semibold flex items-center gap-1">
                          <Eye className="w-3 h-3" />
                          History
                        </button>
                        <button aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)} className="px-2 py-1 rounded border border-line text-xs font-semibold flex items-center gap-1">
                          <Pencil className="w-3 h-3" />
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <SupplierModal
          supplier={editing}
          onClose={() => setEditing(null)}
          onSaved={async (m) => {
            onNotice(m);
            setEditing(null);
            await load();
          }}
        />
      )}
      {history && (
        <Modal title={history.supplier.name} onClose={() => setHistory(null)} wide>
          <p className="text-sm text-muted">
            {history.summary.purchase_orders} order(s) · {history.summary.open_orders} open · received {money(history.summary.received_total)}
          </p>
          {history.purchases.length === 0 ? (
            <EmptyState title="No orders from this supplier yet" />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-muted text-xs uppercase">
                <tr>
                  <th className="py-1 px-2 text-left">Order</th>
                  <th className="py-1 px-2 text-left">Date</th>
                  <th className="py-1 px-2 text-right">Total</th>
                  <th className="py-1 px-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {history.purchases.map((p: any) => (
                  <tr key={p.id}>
                    <td className="py-1 px-2">{p.purchase_number}</td>
                    <td className="py-1 px-2">{dateOnly(p.order_date)}</td>
                    <td className="py-1 px-2 text-right">{money(p.total_amount)}</td>
                    <td className="py-1 px-2">
                      <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}
    </>
  );
};

const SupplierModal: React.FC<{ supplier: any; onClose: () => void; onSaved: (m: string) => void }> = ({ supplier, onClose, onSaved }) => {
  const isNew = !supplier.id;
  const [form, setForm] = useState({
    name: supplier.name || '',
    contact_person: supplier.contact_person || '',
    phone: supplier.phone || '',
    email: supplier.email || '',
    address: supplier.address || '',
    is_active: supplier.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = { ...form, contact_person: form.contact_person || null, phone: form.phone || null, email: form.email || null, address: form.address || null };
    try {
      if (isNew) await apiClient.post('/store/suppliers', body);
      else await apiClient.put(`/store/suppliers/${supplier.id}`, body);
      onSaved(isNew ? `${form.name} added` : `${form.name} updated`);
    } catch (err) {
      setError(apiError(err, 'Could not save the supplier'));
      setSaving(false);
    }
  };

  return (
    <Modal title={isNew ? 'Add supplier' : `Edit ${supplier.name}`} onClose={onClose} onSubmit={submit} submitting={saving} error={error}>
      <Field label="Name">
        <input required maxLength={255} className={inputClass} value={form.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Contact person">
          <input maxLength={100} className={inputClass} value={form.contact_person} onChange={(e) => set({ contact_person: e.target.value })} />
        </Field>
        <Field label="Phone">
          <input maxLength={20} className={inputClass} value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
        </Field>
      </div>
      <Field label="Email">
        <input type="email" maxLength={100} className={inputClass} value={form.email} onChange={(e) => set({ email: e.target.value })} />
      </Field>
      <Field label="Address">
        <input maxLength={500} className={inputClass} value={form.address} onChange={(e) => set({ address: e.target.value })} />
      </Field>
      {!isNew && (
        <label className="text-sm text-fg flex items-center gap-2">
          <input type="checkbox" checked={form.is_active} onChange={(e) => set({ is_active: e.target.checked })} />
          Active
        </label>
      )}
    </Modal>
  );
};
