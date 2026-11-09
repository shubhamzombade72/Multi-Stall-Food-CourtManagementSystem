import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, ClipboardCheck, Package, Pencil, Plus, Trash2, Undo2, Upload } from 'lucide-react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { apiError, dateTime, humanize, money } from '../lib/format';
import { Badge, Card, EmptyState, ErrorBanner, Field, Loading, Modal, PageHeader, Pagination, SuccessBanner, buttonClass, compactInputClass, inputClass } from '../components/ui';

export const STORE_UNITS = ['kg', 'g', 'l', 'ml', 'pcs', 'packet'];

interface StoreItem {
  id: number;
  name: string;
  unit: string;
  current_stock: string;
  minimum_alert_stock: string;
  unit_cost: string;
  is_active: boolean;
}

type ActionKind = 'issue' | 'return' | 'waste' | 'count';

const ACTION_TITLE: Record<ActionKind, string> = {
  issue: 'Issue to stall',
  return: 'Return from stall',
  waste: 'Record waste',
  count: 'Physical count',
};

const num = (v: string | number) => Number(Number(v).toFixed(3));
const isLow = (i: StoreItem) => Number(i.current_stock) <= Number(i.minimum_alert_stock);

/** The one central raw material store: stock, issues to stalls, waste, counts and the full history. Everything is entered by hand. */
export const StorePage: React.FC = () => {
  const { isOwner } = useAuth();
  const [items, setItems] = useState<StoreItem[] | null>(null);
  const [stalls, setStalls] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<StoreItem> & { opening_stock?: string } | null>(null);
  const [action, setAction] = useState<{ kind: ActionKind; item: StoreItem } | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  const load = async () => {
    try {
      const res = await apiClient.get('/store/items', { params: { search: search || undefined, low_stock_only: lowOnly ? 1 : undefined, include_inactive: showInactive ? 1 : undefined } });
      setItems(res.data.data);
      setError(null);
    } catch (err) {
      setItems([]);
      setError(apiError(err, 'Failed to load raw materials'));
    }
  };

  useEffect(() => {
    load();
  }, [search, lowOnly, showInactive]);

  useEffect(() => {
    apiClient.get('/stalls').then((r) => setStalls(r.data.data)).catch(() => undefined);
  }, []);

  const afterChange = async (message: string) => {
    setNotice(message);
    setEditing(null);
    setAction(null);
    setHistoryKey((k) => k + 1);
    await load();
  };

  const totalValue = (items || []).reduce((sum, i) => sum + Number(i.current_stock) * Number(i.unit_cost), 0);
  const lowCount = (items || []).filter((i) => i.is_active && isLow(i)).length;

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="Raw Materials"
        subtitle="Central store. Stock issued to a stall counts as used by that stall."
        icon={Package}
        actions={
          <button className={buttonClass.primary} onClick={() => setEditing({ name: '', unit: 'kg', minimum_alert_stock: '0', unit_cost: '0', opening_stock: '0' })}>
            <Plus className="w-4 h-4" />
            <span>Add raw material</span>
          </button>
        }
      />
      <ErrorBanner message={error} onRetry={load} />
      <SuccessBanner message={notice} />
      {isOwner && <MoveToStoreBanner onDone={afterChange} />}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Items</span>
          <div className="text-xl font-bold text-fg mt-1">{items?.length ?? 0}</div>
        </Card>
        <Card className="p-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Low stock</span>
          <div className={`text-xl font-bold mt-1 ${lowCount ? 'text-danger-fg' : 'text-success-fg'}`}>{lowCount}</div>
        </Card>
        <Card className="p-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Stock value (last purchase price)</span>
          <div className="text-xl font-bold text-fg mt-1">{money(totalValue)}</div>
        </Card>
      </div>

      <Card>
        <div className="p-3 border-b border-line flex flex-wrap gap-3 items-center">
          <input aria-label="Search raw materials" placeholder="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputClass} max-w-xs`} />
          <label className="text-sm text-muted flex items-center gap-1.5">
            <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
            Low stock only
          </label>
          <label className="text-sm text-muted flex items-center gap-1.5">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
        </div>
        {items === null ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState title="No raw materials found" hint="Add your first raw material to start tracking stock." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-canvas text-muted text-xs uppercase">
                <tr>
                  <th className="py-2 px-3 text-left">Raw material</th>
                  <th className="py-2 px-3 text-right">Stock</th>
                  <th className="py-2 px-3 text-right">Alert at</th>
                  <th className="py-2 px-3 text-right">Last price</th>
                  <th className="py-2 px-3 text-right">Value</th>
                  <th className="py-2 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((i) => (
                  <tr key={i.id} className={i.is_active ? '' : 'opacity-60'}>
                    <td className="py-2 px-3 font-semibold text-fg">
                      {i.name}
                      {!i.is_active && (
                        <span className="ml-2">
                          <Badge tone="void">Inactive</Badge>
                        </span>
                      )}
                      {i.is_active && isLow(i) && (
                        <span className="ml-2 inline-flex items-center text-xs text-danger-fg">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          Low
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {num(i.current_stock)} {i.unit}
                    </td>
                    <td className="py-2 px-3 text-right">{num(i.minimum_alert_stock)}</td>
                    <td className="py-2 px-3 text-right">{money(i.unit_cost)}</td>
                    <td className="py-2 px-3 text-right">{money(Number(i.current_stock) * Number(i.unit_cost))}</td>
                    <td className="py-2 px-3">
                      <div className="flex justify-end gap-1 flex-wrap">
                        <IconAction label={`Issue ${i.name} to a stall`} text="Issue" icon={ArrowDownToLine} disabled={!i.is_active} onClick={() => setAction({ kind: 'issue', item: i })} />
                        <IconAction label={`Return ${i.name} from a stall`} text="Return" icon={Undo2} onClick={() => setAction({ kind: 'return', item: i })} />
                        <IconAction label={`Record waste of ${i.name}`} text="Waste" icon={Trash2} onClick={() => setAction({ kind: 'waste', item: i })} />
                        <IconAction label={`Count ${i.name}`} text="Count" icon={ClipboardCheck} onClick={() => setAction({ kind: 'count', item: i })} />
                        <IconAction label={`Edit ${i.name}`} text="Edit" icon={Pencil} onClick={() => setEditing(i)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <StockHistory key={historyKey} stalls={stalls} items={items || []} />

      {editing && <ItemModal item={editing} onClose={() => setEditing(null)} onSaved={afterChange} />}
      {action && <ActionModal kind={action.kind} item={action.item} stalls={stalls} onClose={() => setAction(null)} onSaved={afterChange} />}
    </div>
  );
};

const IconAction: React.FC<{ label: string; text: string; icon: React.ElementType; disabled?: boolean; onClick: () => void }> = ({ label, text, icon: Icon, disabled, onClick }) => (
  <button aria-label={label} disabled={disabled} onClick={onClick} className="px-2 py-1 rounded border border-line text-xs font-semibold text-fg hover:bg-surface-2 disabled:opacity-40 flex items-center gap-1">
    <Icon className="w-3 h-3" />
    {text}
  </button>
);

const ItemModal: React.FC<{ item: Partial<StoreItem> & { opening_stock?: string }; onClose: () => void; onSaved: (m: string) => void }> = ({ item, onClose, onSaved }) => {
  const isNew = !item.id;
  const [form, setForm] = useState({
    name: item.name || '',
    unit: item.unit || 'kg',
    minimum_alert_stock: String(num(item.minimum_alert_stock || 0)),
    unit_cost: String(Number(item.unit_cost || 0)),
    opening_stock: item.opening_stock || '0',
    is_active: item.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const units = STORE_UNITS.includes(form.unit) ? STORE_UNITS : [form.unit, ...STORE_UNITS];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        await apiClient.post('/store/items', form);
      } else {
        const { opening_stock: _ignored, ...changes } = form;
        await apiClient.put(`/store/items/${item.id}`, changes);
      }
      onSaved(isNew ? `${form.name} added` : `${form.name} updated`);
    } catch (err) {
      setError(apiError(err, 'Could not save'));
      setSaving(false);
    }
  };

  return (
    <Modal title={isNew ? 'Add raw material' : `Edit ${item.name}`} onClose={onClose} onSubmit={submit} submitting={saving} error={error}>
      <Field label="Name">
        <input required maxLength={255} className={inputClass} value={form.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Unit" hint={isNew ? undefined : 'Locked once stock history exists.'}>
          <select aria-label="Unit" className={inputClass} value={form.unit} onChange={(e) => set({ unit: e.target.value })}>
            {units.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Alert when at or below">
          <input required type="number" min="0" step="0.001" className={inputClass} value={form.minimum_alert_stock} onChange={(e) => set({ minimum_alert_stock: e.target.value })} />
        </Field>
        <Field label="Price per unit (₹)">
          <input required type="number" min="0" step="0.01" className={inputClass} value={form.unit_cost} onChange={(e) => set({ unit_cost: e.target.value })} />
        </Field>
        {isNew && (
          <Field label="Opening stock">
            <input required type="number" min="0" step="0.001" className={inputClass} value={form.opening_stock} onChange={(e) => set({ opening_stock: e.target.value })} />
          </Field>
        )}
      </div>
      {!isNew && (
        <label className="text-sm text-fg flex items-center gap-2">
          <input type="checkbox" checked={form.is_active} onChange={(e) => set({ is_active: e.target.checked })} />
          Active (inactive items keep their history but can't be issued or bought)
        </label>
      )}
    </Modal>
  );
};

const ActionModal: React.FC<{ kind: ActionKind; item: StoreItem; stalls: any[]; onClose: () => void; onSaved: (m: string) => void }> = ({ kind, item, stalls, onClose, onSaved }) => {
  const [stallId, setStallId] = useState('');
  const [quantity, setQuantity] = useState(kind === 'count' ? String(num(item.current_stock)) : '');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsStall = kind === 'issue' || kind === 'return';
  const reasonRequired = kind !== 'issue' && kind !== 'count';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body =
        kind === 'count'
          ? { counted_stock: quantity, reason: reason || undefined }
          : { quantity, reason: reason || undefined, ...(needsStall ? { stall_id: Number(stallId) } : {}) };
      await apiClient.post(`/store/items/${item.id}/${kind}`, body);
      onSaved(`${ACTION_TITLE[kind]}: ${item.name} saved`);
    } catch (err) {
      setError(apiError(err, 'Could not save'));
      setSaving(false);
    }
  };

  return (
    <Modal title={`${ACTION_TITLE[kind]}: ${item.name}`} onClose={onClose} onSubmit={submit} submitting={saving} error={error}>
      <p className="text-sm text-muted">
        In store now: {num(item.current_stock)} {item.unit}
      </p>
      {needsStall && (
        <Field label="Stall">
          <select aria-label="Stall" required className={inputClass} value={stallId} onChange={(e) => setStallId(e.target.value)}>
            <option value="">Select stall</option>
            {stalls.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label={kind === 'count' ? `Counted quantity (${item.unit})` : `Quantity (${item.unit})`} hint={kind === 'count' ? 'The difference from the app figure is saved in the history.' : undefined}>
        <input required type="number" min={kind === 'count' ? '0' : '0.001'} step="0.001" className={inputClass} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </Field>
      <Field label={reasonRequired ? 'Reason' : 'Note (optional)'}>
        <input required={reasonRequired} maxLength={255} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
};

/** Asks the server whether old per-stall stock is waiting to be moved. Hidden when there is nothing to move. */
const MoveToStoreBanner: React.FC<{ onDone: (m: string) => void }> = ({ onDone }) => {
  const [preview, setPreview] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get('/store/import').then((r) => setPreview(r.data.data)).catch(() => undefined);
  }, []);

  if (!preview || (preview.pending_items === 0 && preview.pending_suppliers === 0)) return null;

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.post('/store/import');
      const d = res.data.data;
      setPreview({ pending_items: 0, pending_suppliers: 0 });
      setOpen(false);
      onDone(`Moved ${d.items_moved} old stock record(s) and ${d.suppliers_moved} supplier(s) into the central store.`);
    } catch (err) {
      setError(apiError(err, 'Could not move the old stock'));
      setSaving(false);
    }
  };

  return (
    <div className="p-3 rounded-lg border border-line bg-surface flex items-center justify-between gap-3 flex-wrap">
      <p className="text-sm text-fg">
        Old per-stall records are waiting: {preview.pending_items} stock item(s) and {preview.pending_suppliers} supplier(s).
      </p>
      <button className={buttonClass.secondary} onClick={() => setOpen(true)}>
        <Upload className="w-4 h-4" />
        <span>Review and move</span>
      </button>
      {open && (
        <Modal title="Move old stock to the central store" onClose={() => setOpen(false)} onSubmit={run} submitLabel="Move now" submitting={saving} error={error} wide>
          <p className="text-sm text-muted">Items with the same name and unit are merged and their quantities added. The old records stay unchanged as history. This can't be undone, but running it again never counts anything twice.</p>
          <div className="overflow-x-auto max-h-64">
            <table className="w-full text-sm">
              <thead className="text-muted text-xs uppercase">
                <tr>
                  <th className="py-1 px-2 text-left">Raw material</th>
                  <th className="py-1 px-2 text-right">Total to add</th>
                  <th className="py-1 px-2 text-right">Price used</th>
                  <th className="py-1 px-2 text-left">From stalls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(preview.groups || []).map((g: any) => (
                  <tr key={`${g.name}|${g.unit}`}>
                    <td className="py-1 px-2">{g.name}</td>
                    <td className="py-1 px-2 text-right whitespace-nowrap">
                      {num(g.quantity)} {g.unit}
                    </td>
                    <td className="py-1 px-2 text-right">{money(g.unit_cost)}</td>
                    <td className="py-1 px-2">{(g.stalls || []).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(preview.warnings || []).length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Please check</p>
              <ul className="text-sm text-warning-fg list-disc pl-5">
                {preview.warnings.map((w: string) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
};

const MOVEMENT_TYPES = ['opening_stock', 'purchase_inward', 'issue_to_stall', 'return_from_stall', 'waste_loss', 'stock_count'];

const StockHistory: React.FC<{ stalls: any[]; items: StoreItem[] }> = ({ stalls, items }) => {
  const [rows, setRows] = useState<any[] | null>(null);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [type, setType] = useState('');
  const [itemId, setItemId] = useState('');
  const [stallId, setStallId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    apiClient
      .get('/store/movements', { params: { page, per_page: 20, movement_type: type || undefined, store_item_id: itemId || undefined, stall_id: stallId || undefined } })
      .then((r) => {
        const d = r.data.data;
        setRows(d.data);
        setLastPage(d.last_page);
        setTotal(d.total);
        setError(null);
      })
      .catch((err) => {
        setRows([]);
        setError(apiError(err, 'Failed to load stock history'));
      });
  }, [page, type, itemId, stallId]);

  const filter = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    setter(e.target.value);
    setPage(1);
  };

  return (
    <Card>
      <div className="p-3 border-b border-line flex flex-wrap gap-2 items-center justify-between">
        <h3 className="font-semibold text-base text-fg">Stock history</h3>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Filter history by type" className={compactInputClass} value={type} onChange={filter(setType)}>
            <option value="">All types</option>
            {MOVEMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </select>
          <select aria-label="Filter history by raw material" className={compactInputClass} value={itemId} onChange={filter(setItemId)}>
            <option value="">All raw materials</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <select aria-label="Filter history by stall" className={compactInputClass} value={stallId} onChange={filter(setStallId)}>
            <option value="">All stalls</option>
            {stalls.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ErrorBanner message={error} />
      {rows === null ? <Loading /> : rows.length === 0 ? <EmptyState title="No stock history yet" /> : <MovementTable rows={rows} />}
      <Pagination page={page} lastPage={lastPage} total={total} onPage={setPage} />
    </Card>
  );
};

const STALL_VIEW_LABEL: Record<string, string> = { issue_to_stall: 'Received from store', return_from_stall: 'Returned to store' };

/** `stallView` shows each row as the stall sees it: an issue is stock coming in, and the store's own stock figure stays hidden. */
export const MovementTable: React.FC<{ rows: any[]; stallView?: boolean }> = ({ rows, stallView }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead className="bg-canvas text-muted text-xs uppercase">
        <tr>
          <th className="py-2 px-3 text-left">Time</th>
          <th className="py-2 px-3 text-left">Type</th>
          <th className="py-2 px-3 text-left">Raw material</th>
          <th className="py-2 px-3 text-left">Stall</th>
          <th className="py-2 px-3 text-right">Change</th>
          {!stallView && <th className="py-2 px-3 text-right">Stock after</th>}
          <th className="py-2 px-3 text-right">Value</th>
          <th className="py-2 px-3 text-left">By</th>
          <th className="py-2 px-3 text-left">Note</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((m) => {
          const change = stallView ? -Number(m.quantity) : Number(m.quantity);
          return (
          <tr key={m.id}>
            <td className="py-2 px-3 whitespace-nowrap">{dateTime(m.created_at)}</td>
            <td className="py-2 px-3">{(stallView && STALL_VIEW_LABEL[m.movement_type]) || humanize(m.movement_type)}</td>
            <td className="py-2 px-3">{m.item?.name}</td>
            <td className="py-2 px-3">{m.stall?.name || '—'}</td>
            <td className={`py-2 px-3 text-right whitespace-nowrap font-semibold ${change < 0 ? 'text-danger-fg' : 'text-success-fg'}`}>
              {change > 0 ? '+' : ''}
              {num(change)} {m.item?.unit}
            </td>
            {!stallView && <td className="py-2 px-3 text-right">{num(m.new_stock)}</td>}
            <td className="py-2 px-3 text-right">{money(m.value)}</td>
            <td className="py-2 px-3">{m.performed_by?.name}</td>
            <td className="py-2 px-3 text-muted">{m.reason || ''}</td>
          </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);
