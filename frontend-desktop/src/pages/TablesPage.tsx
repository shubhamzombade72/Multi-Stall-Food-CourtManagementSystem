import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutGrid, Plus, RefreshCw, Users } from 'lucide-react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { apiError, humanize, money } from '../lib/format';
import { Badge, buttonClass, Card, EmptyState, ErrorBanner, Field, inputClass, Loading, Modal, PageHeader, statusTone } from '../components/ui';

interface TableRow {
  id: number;
  table_number: string;
  capacity: number;
  section: string;
  status: string;
  is_active: boolean;
  qr_token?: string;
  orders?: { id: number; order_number: string; status: string; total_amount: string; payment_status: string }[];
}

type FormState = { id?: number; table_number: string; capacity: string; section: string };

/**
 * Floor & tables: live occupancy for owner, cashier and waiter (refreshes every 10 s); the owner also adds,
 * edits, moves between sections and activates/deactivates tables.
 */
export const TablesPage: React.FC = () => {
  const { isOwner } = useAuth();
  const [tables, setTables] = useState<TableRow[] | null>(null);
  const [sections, setSections] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sectionFilter, setSectionFilter] = useState('');

  const load = useCallback(async () => {
    try {
      const live = await apiClient.get('/waiter/tables');
      let rows: TableRow[] = live.data.data;
      if (isOwner) {
        // include inactive tables (and QR codes) for management
        const all = await apiClient.get('/tables', { params: { include_inactive: 1 } });
        const byId = new Map(rows.map((t) => [t.id, t]));
        rows = (all.data.data as TableRow[]).map((t) => ({ ...t, orders: byId.get(t.id)?.orders || [] }));
        const sec = await apiClient.get('/tables/sections');
        setSections(sec.data.data);
      } else {
        setSections([...new Set(rows.map((t) => t.section))].sort());
      }
      setTables(rows);
      setError(null);
    } catch (err) {
      setError(apiError(err, 'Could not load tables'));
    }
  }, [isOwner]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const grouped = useMemo(() => {
    const out: Record<string, TableRow[]> = {};
    (tables || [])
      .filter((t) => !sectionFilter || t.section === sectionFilter)
      .forEach((t) => {
        (out[t.section] ||= []).push(t);
      });
    return out;
  }, [tables, sectionFilter]);

  const counts = useMemo(() => {
    const active = (tables || []).filter((t) => t.is_active);
    return {
      total: active.length,
      occupied: active.filter((t) => t.status === 'occupied').length,
      available: active.filter((t) => t.status === 'available').length,
      reserved: active.filter((t) => t.status === 'reserved').length,
    };
  }, [tables]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setFormError(null);
    const body = { table_number: form.table_number.trim(), capacity: Number(form.capacity), section: form.section.trim() || undefined };
    try {
      if (form.id) await apiClient.put(`/tables/${form.id}`, body);
      else await apiClient.post('/tables', body);
      setForm(null);
      await load();
    } catch (err) {
      setFormError(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (t: TableRow) => {
    if (!confirm(`${t.is_active ? 'Deactivate' : 'Activate'} table ${t.table_number}?`)) return;
    try {
      await apiClient.put(`/tables/${t.id}`, { is_active: !t.is_active });
      await load();
    } catch (err) {
      setError(apiError(err));
    }
  };

  const setStatus = async (t: TableRow, status: string) => {
    try {
      await apiClient.put(`/tables/${t.id}/status`, { status });
      await load();
    } catch (err) {
      setError(apiError(err));
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="Floor & Tables"
        icon={LayoutGrid}
        subtitle={`${counts.total} active tables · ${counts.occupied} occupied · ${counts.available} available · ${counts.reserved} reserved`}
        actions={
          <>
            <select aria-label="Filter by section" value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)} className="px-3 py-2 rounded-lg border border-line text-sm">
              <option value="">All sections</option>
              {sections.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <button onClick={load} className={buttonClass.secondary} aria-label="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
            {isOwner && (
              <button onClick={() => { setFormError(null); setForm({ table_number: '', capacity: '4', section: sectionFilter || '' }); }} className={buttonClass.primary}>
                <Plus className="w-4 h-4" />
                <span>Add Table</span>
              </button>
            )}
          </>
        }
      />
      <ErrorBanner message={error} onRetry={load} />

      {tables === null ? (
        <Loading />
      ) : Object.keys(grouped).length === 0 ? (
        <Card>
          <EmptyState title="No tables yet" hint={isOwner ? 'Add the first table with “Add Table”.' : undefined} />
        </Card>
      ) : (
        Object.entries(grouped).map(([section, rows]) => (
          <section key={section} className="space-y-3">
            <h3 className="text-sm font-bold text-muted uppercase tracking-wider">{section}</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {rows.map((t) => {
                const open = t.orders?.[0];
                return (
                  <Card key={t.id} className={`p-4 space-y-2 ${t.is_active ? '' : 'opacity-60'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-bold text-fg" data-table={t.table_number}>
                        {t.table_number}
                      </span>
                      <Badge tone={t.is_active ? statusTone(t.status) : 'slate'}>{t.is_active ? humanize(t.status) : 'Inactive'}</Badge>
                    </div>
                    <p className="text-xs text-muted flex items-center">
                      <Users className="w-3 h-3 mr-1" />
                      Seats {t.capacity}
                    </p>
                    {open ? (
                      <div className="text-xs bg-canvas rounded-lg p-2 border border-line">
                        <p className="font-mono font-semibold">{open.order_number}</p>
                        <p className="text-muted">
                          {humanize(open.status)} · {money(open.total_amount)} · {open.payment_status === 'paid' ? 'Paid' : 'Unpaid'}
                        </p>
                        {(t.orders?.length || 0) > 1 && <p className="text-warning-fg">+{(t.orders?.length || 0) - 1} more open order(s)</p>}
                      </div>
                    ) : (
                      <p className="text-xs text-muted">No open order</p>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {t.is_active && !open && t.status !== 'available' && (
                        <button onClick={() => setStatus(t, 'available')} className="text-xs font-bold text-success-fg">
                          Mark available
                        </button>
                      )}
                      {t.is_active && !open && t.status === 'available' && (
                        <button onClick={() => setStatus(t, 'reserved')} className="text-xs font-bold text-info-fg">
                          Reserve
                        </button>
                      )}
                      {isOwner && (
                        <>
                          <button
                            onClick={() => { setFormError(null); setForm({ id: t.id, table_number: t.table_number, capacity: String(t.capacity), section: t.section }); }}
                            className="text-xs font-bold text-primary"
                          >
                            Edit
                          </button>
                          <button onClick={() => toggleActive(t)} className="text-xs font-bold text-danger-fg">
                            {t.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                        </>
                      )}
                    </div>
                    {isOwner && t.qr_token && <p className="text-[10px] text-muted font-mono truncate" title="QR ordering code">QR: {t.qr_token}</p>}
                  </Card>
                );
              })}
            </div>
          </section>
        ))
      )}

      {form && (
        <Modal title={form.id ? `Edit table ${form.table_number}` : 'Add table'} onClose={() => setForm(null)} onSubmit={submit} submitting={saving} error={formError}>
          <Field label="Table number">
            <input required maxLength={20} className={inputClass} value={form.table_number} onChange={(e) => setForm((f) => (f ? { ...f, table_number: e.target.value } : f))} />
          </Field>
          <Field label="Seats">
            <input required type="number" min={1} max={50} className={inputClass} value={form.capacity} onChange={(e) => setForm((f) => (f ? { ...f, capacity: e.target.value } : f))} />
          </Field>
          <Field label="Section / floor" hint="Pick an existing section or type a new one. Empty = Main Hall.">
            <input list="table-sections" maxLength={50} className={inputClass} value={form.section} onChange={(e) => setForm((f) => (f ? { ...f, section: e.target.value } : f))} />
            <datalist id="table-sections">
              {sections.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
        </Modal>
      )}
    </div>
  );
};
