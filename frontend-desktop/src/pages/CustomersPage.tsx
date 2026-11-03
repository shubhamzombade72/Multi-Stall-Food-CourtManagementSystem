import React, { useCallback, useEffect, useState } from 'react';
import { Contact, Plus, Search } from 'lucide-react';
import { apiClient } from '../api/client';
import { apiError, dateTime, humanize, money } from '../lib/format';
import { Badge, buttonClass, Card, EmptyState, ErrorBanner, Field, inputClass, Loading, Modal, PageHeader, Pagination, statusTone } from '../components/ui';

interface Customer {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  orders_count?: number;
  total_paid?: string;
  last_order_at?: string | null;
}

type Form = { id?: number; name: string; phone: string; email: string; notes: string };

/** Customer directory (owner + cashier). Order history = all orders placed with the customer's phone number. */
export const CustomersPage: React.FC = () => {
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ last_page: 1, total: 0 });
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/customers', { params: { search: query || undefined, page, per_page: 25 } });
      setRows(res.data.data.data);
      setMeta({ last_page: res.data.data.last_page, total: res.data.data.total });
      setError(null);
    } catch (err) {
      setError(apiError(err, 'Could not load customers'));
    }
  }, [query, page]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setFormError(null);
    const body = { name: form.name, phone: form.phone, email: form.email || null, notes: form.notes || null };
    try {
      if (form.id) await apiClient.put(`/customers/${form.id}`, body);
      else await apiClient.post('/customers', body);
      setForm(null);
      await load();
    } catch (err) {
      setFormError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (c: Customer) => {
    try {
      const res = await apiClient.get(`/customers/${c.id}`);
      setDetail(res.data.data);
    } catch (err) {
      setError(apiError(err));
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="Customers"
        icon={Contact}
        subtitle="Contact details and order history. Orders are matched to a customer by phone number."
        actions={
          <button onClick={() => { setFormError(null); setForm({ name: '', phone: '', email: '', notes: '' }); }} className={buttonClass.primary}>
            <Plus className="w-4 h-4" />
            <span>Add Customer</span>
          </button>
        }
      />

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery(search.trim());
        }}
      >
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-subtle absolute left-3 top-2.5" />
          <input aria-label="Search customers" placeholder="Search name, phone or email" value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputClass} pl-9`} />
        </div>
        <button type="submit" className={buttonClass.secondary}>
          Search
        </button>
      </form>
      <ErrorBanner message={error} onRetry={load} />

      <Card className="overflow-hidden">
        {rows === null ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState title={query ? 'No customers match the search' : 'No customers saved yet'} hint="Customers can also be saved from the POS when taking an order." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-canvas text-xs uppercase text-muted">
              <tr>
                <th className="text-left px-3 py-1.5">Name</th>
                <th className="text-left px-3 py-1.5">Phone</th>
                <th className="text-left px-3 py-1.5">Email</th>
                <th className="text-right px-3 py-1.5">Orders</th>
                <th className="text-right px-3 py-1.5">Paid total</th>
                <th className="text-left px-3 py-1.5">Last order</th>
                <th className="text-right px-3 py-1.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-1.5 font-semibold">{c.name}</td>
                  <td className="px-3 py-1.5 font-mono">{c.phone}</td>
                  <td className="px-3 py-1.5 text-muted">{c.email || '—'}</td>
                  <td className="px-3 py-1.5 text-right">{c.orders_count ?? 0}</td>
                  <td className="px-3 py-1.5 text-right">{money(c.total_paid)}</td>
                  <td className="px-3 py-1.5 text-muted whitespace-nowrap">{dateTime(c.last_order_at)}</td>
                  <td className="px-3 py-1.5 text-right space-x-3 whitespace-nowrap">
                    <button onClick={() => openDetail(c)} className="text-xs font-bold text-fg">
                      History
                    </button>
                    <button
                      onClick={() => { setFormError(null); setForm({ id: c.id, name: c.name, phone: c.phone, email: c.email || '', notes: c.notes || '' }); }}
                      className="text-xs font-bold text-primary"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination page={page} lastPage={meta.last_page} total={meta.total} onPage={setPage} />
      </Card>

      {form && (
        <Modal title={form.id ? `Edit ${form.name}` : 'Add customer'} onClose={() => setForm(null)} onSubmit={submit} submitting={saving} error={formError}>
          <Field label="Name">
            <input required maxLength={100} className={inputClass} value={form.name} onChange={(e) => setForm((f) => (f ? { ...f, name: e.target.value } : f))} />
          </Field>
          <Field label="Phone">
            <input required maxLength={20} className={inputClass} value={form.phone} onChange={(e) => setForm((f) => (f ? { ...f, phone: e.target.value } : f))} />
          </Field>
          <Field label="Email (optional)">
            <input type="email" maxLength={100} className={inputClass} value={form.email} onChange={(e) => setForm((f) => (f ? { ...f, email: e.target.value } : f))} />
          </Field>
          <Field label="Notes (optional)">
            <textarea rows={2} maxLength={1000} className={inputClass} value={form.notes} onChange={(e) => setForm((f) => (f ? { ...f, notes: e.target.value } : f))} />
          </Field>
        </Modal>
      )}

      {detail && (
        <Modal title={`${detail.customer.name} · ${detail.customer.phone}`} onClose={() => setDetail(null)} wide>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="bg-canvas rounded-lg p-3">
              <p className="text-xs text-muted">Orders</p>
              <p className="text-xl font-bold">{detail.summary.orders_count}</p>
            </div>
            <div className="bg-canvas rounded-lg p-3">
              <p className="text-xs text-muted">Paid total</p>
              <p className="text-xl font-bold">{money(detail.summary.total_paid)}</p>
            </div>
            <div className="bg-canvas rounded-lg p-3">
              <p className="text-xs text-muted">Email</p>
              <p className="font-semibold truncate">{detail.customer.email || '—'}</p>
            </div>
          </div>
          {detail.customer.notes && <p className="text-sm text-muted bg-warning/10 border border-warning/40 rounded-lg p-2">{detail.customer.notes}</p>}
          {detail.orders.length === 0 ? (
            <EmptyState title="No orders with this phone number yet" />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted">
                <tr>
                  <th className="text-left py-2">Order</th>
                  <th className="text-left py-2">Date</th>
                  <th className="text-left py-2">Stalls</th>
                  <th className="text-left py-2">Status</th>
                  <th className="text-right py-2">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {detail.orders.map((o: any) => (
                  <tr key={o.id}>
                    <td className="py-2 font-mono whitespace-nowrap">{o.order_number}</td>
                    <td className="py-2 text-muted whitespace-nowrap">{dateTime(o.created_at)}</td>
                    <td className="py-2 text-xs">{[...new Set((o.items || []).map((i: any) => i.stall?.name))].join(', ')}</td>
                    <td className="py-2">
                      <Badge tone={statusTone(o.status)}>{humanize(o.status)}</Badge>
                    </td>
                    <td className="py-2 text-right">{money(o.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}
    </div>
  );
};
