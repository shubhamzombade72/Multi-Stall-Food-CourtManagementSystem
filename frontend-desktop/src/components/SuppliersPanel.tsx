import React, { useCallback, useEffect, useState } from 'react';
import { Mail, Phone, Search } from 'lucide-react';
import { apiClient } from '../api/client';
import { apiError, dateOnly, humanize, money } from '../lib/format';
import { Badge, buttonClass, Card, EmptyState, ErrorBanner, Field, inputClass, Loading, Modal, statusTone } from './ui';

interface Supplier {
  id: number;
  stall_id: number;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  is_active: boolean;
  stall?: { id: number; name: string };
  purchase_orders_count?: number;
  received_total?: string | null;
}

/**
 * Supplier directory for the owner (all stalls) and stall managers (own stall): search, status filter,
 * edit, activate/deactivate and per-supplier purchase history. `version` changes when a supplier is added
 * elsewhere on the page, which reloads the list.
 */
export const SuppliersPanel: React.FC<{ stalls: { id: number; name: string }[]; version: number; canManage: boolean }> = ({ stalls, version, canManage }) => {
  const [rows, setRows] = useState<Supplier[] | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [stallId, setStallId] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<any | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get('/suppliers', { params: { include_inactive: 1, search: query || undefined, stall_id: stallId || undefined } });
      setRows(res.data.data);
      setError(null);
    } catch (err) {
      setError(apiError(err, 'Could not load suppliers'));
    }
  }, [query, stallId]);

  useEffect(() => {
    load();
  }, [load, version]);

  const visible = (rows || []).filter((s) => status === 'all' || (status === 'active' ? s.is_active : !s.is_active));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setFormError(null);
    try {
      await apiClient.put(`/suppliers/${editing.id}`, {
        name: editing.name,
        contact_person: editing.contact_person || null,
        phone: editing.phone || null,
        email: editing.email || null,
        address: editing.address || null,
      });
      setEditing(null);
      await load();
    } catch (err) {
      setFormError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (s: Supplier) => {
    if (!confirm(`${s.is_active ? 'Deactivate' : 'Activate'} ${s.name}? ${s.is_active ? 'It will not be offered for new purchase orders.' : ''}`)) return;
    try {
      await apiClient.put(`/suppliers/${s.id}`, { is_active: !s.is_active });
      await load();
    } catch (err) {
      setError(apiError(err));
    }
  };

  const openHistory = async (s: Supplier) => {
    try {
      setHistory((await apiClient.get(`/suppliers/${s.id}`)).data.data);
    } catch (err) {
      setError(apiError(err));
    }
  };

  const set = (k: keyof Supplier) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setEditing((s) => (s ? { ...s, [k]: e.target.value } : s));

  return (
    <div className="space-y-4">
      <form
        className="flex items-center gap-2 flex-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search.trim());
        }}
      >
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-muted absolute left-3 top-2.5" />
          <input aria-label="Search suppliers" placeholder="Search name, contact or phone" value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputClass} pl-9`} />
        </div>
        {stalls.length > 1 && (
          <select aria-label="Filter suppliers by stall" value={stallId} onChange={(e) => setStallId(e.target.value)} className="px-3 py-2 rounded-lg border border-line text-sm">
            <option value="">All stalls</option>
            {stalls.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <select aria-label="Filter suppliers by status" value={status} onChange={(e) => setStatus(e.target.value as any)} className="px-3 py-2 rounded-lg border border-line text-sm">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
        <button type="submit" className={buttonClass.secondary}>
          Search
        </button>
      </form>
      <ErrorBanner message={error} onRetry={load} />

      {rows === null ? (
        <Loading />
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState title="No suppliers match" hint='Use "Add Supplier" to register a vendor for a stall.' />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((sup) => (
            <Card key={sup.id} className={`p-5 space-y-3 ${sup.is_active ? '' : 'opacity-60'}`}>
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-bold text-fg text-sm">{sup.name}</h4>
                <Badge tone={sup.is_active ? 'green' : 'slate'}>{sup.is_active ? 'Active' : 'Inactive'}</Badge>
              </div>
              <p className="text-[11px] text-muted">{sup.stall?.name}</p>
              <div className="text-xs text-muted space-y-1.5">
                {sup.contact_person && <p>Contact: {sup.contact_person}</p>}
                {sup.phone && (
                  <p className="flex items-center">
                    <Phone className="w-3.5 h-3.5 mr-1 text-muted" />
                    {sup.phone}
                  </p>
                )}
                {sup.email && (
                  <p className="flex items-center">
                    <Mail className="w-3.5 h-3.5 mr-1 text-muted" />
                    {sup.email}
                  </p>
                )}
                {sup.address && <p className="text-[11px] text-muted">{sup.address}</p>}
              </div>
              <p className="text-xs text-muted">
                {sup.purchase_orders_count ?? 0} purchase order(s) · received {money(sup.received_total)}
              </p>
              <div className="flex gap-3 pt-1">
                <button onClick={() => openHistory(sup)} className="text-xs font-bold text-fg">
                  History
                </button>
                {canManage && (
                  <>
                    <button onClick={() => { setFormError(null); setEditing({ ...sup }); }} className="text-xs font-bold text-primary">
                      Edit
                    </button>
                    <button onClick={() => toggle(sup)} className="text-xs font-bold text-danger-fg">
                      {sup.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <Modal title={`Edit ${editing.name}`} onClose={() => setEditing(null)} onSubmit={save} submitting={saving} error={formError}>
          <Field label="Name">
            <input required className={inputClass} value={editing.name} onChange={set('name')} />
          </Field>
          <Field label="Contact person">
            <input className={inputClass} value={editing.contact_person || ''} onChange={set('contact_person')} />
          </Field>
          <Field label="Phone">
            <input className={inputClass} value={editing.phone || ''} onChange={set('phone')} />
          </Field>
          <Field label="Email">
            <input type="email" className={inputClass} value={editing.email || ''} onChange={set('email')} />
          </Field>
          <Field label="Address">
            <textarea rows={2} className={inputClass} value={editing.address || ''} onChange={set('address')} />
          </Field>
        </Modal>
      )}

      {history && (
        <Modal title={`${history.supplier.name} · purchase history`} onClose={() => setHistory(null)} wide>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="bg-surface-2 rounded-lg p-3">
              <p className="text-xs text-muted">Purchase orders</p>
              <p className="text-xl font-bold">{history.summary.purchase_orders}</p>
            </div>
            <div className="bg-surface-2 rounded-lg p-3">
              <p className="text-xs text-muted">Received value</p>
              <p className="text-xl font-bold">{money(history.summary.received_total)}</p>
            </div>
            <div className="bg-surface-2 rounded-lg p-3">
              <p className="text-xs text-muted">Open orders</p>
              <p className="text-xl font-bold">{history.summary.open_orders}</p>
            </div>
          </div>
          {history.purchases.length === 0 ? (
            <EmptyState title="No purchase orders with this supplier yet" />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted">
                <tr>
                  <th className="text-left py-2">PO</th>
                  <th className="text-left py-2">Date</th>
                  <th className="text-left py-2">Items</th>
                  <th className="text-left py-2">Status</th>
                  <th className="text-right py-2">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {history.purchases.map((po: any) => (
                  <tr key={po.id}>
                    <td className="py-2 font-mono whitespace-nowrap">{po.purchase_number}</td>
                    <td className="py-2 whitespace-nowrap">{dateOnly(po.order_date)}</td>
                    <td className="py-2 text-xs">{po.items.map((i: any) => `${i.inventory_item?.name} ×${Number(i.quantity)}`).join(', ')}</td>
                    <td className="py-2">
                      <Badge tone={statusTone(po.status)}>{humanize(po.status)}</Badge>
                    </td>
                    <td className="py-2 text-right">{money(po.total_amount)}</td>
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
