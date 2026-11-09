import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Store, Plus, Phone, Pencil, Power, Search, Trash2 } from 'lucide-react';
import { statusChip } from '../lib/status';
import { Pagination, inputClass } from '../components/ui';
import { OwnerPicker } from '../components/OwnerPicker';
import { BulkCheckbox, BulkDeleteDialog, BulkToolbar, useBulkDelete } from '../components/BulkDelete';
import { clampPage, pageCount, pageSlice, pageState, pruneSelection, selectAllFiltered, toggleId, togglePage, type BulkSummary } from '../lib/bulkSelection';

const PAGE_SIZE = 12;

export const StallsPage: React.FC = () => {
  const { user, isOwner } = useAuth();
  const [stalls, setStalls] = useState<any[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [ownerId, setOwnerId] = useState<number | null>(null);
  const [owners, setOwners] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  // Bulk selection lives here, outside the paged slice, so it survives page changes
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const fetchStalls = async () => {
    try {
      const res = await apiClient.get('/stalls', { params: isOwner ? { include_inactive: 1 } : {} });
      if (res.data.success) {
        setStalls(isOwner ? res.data.data : res.data.data.filter((s: any) => s.id === user?.stall_id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchOwners = async () => {
    if (!isOwner) return;
    try {
      const res = await apiClient.get('/stall-owners');
      if (res.data.success) setOwners(res.data.data);
    } catch (err) {
      console.error(err);
    }
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.put(`/stalls/${editing.id}`, {
        name: editing.name,
        description: editing.description,
        contact_phone: editing.contact_phone,
        ...(isOwner ? { stall_owner_id: editing.stall_owner_id ?? null } : {}),
      });
      setEditing(null);
      fetchStalls();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to update stall');
    }
  };

  const toggleActive = async (stall: any) => {
    if (!confirm(`${stall.is_active ? 'Deactivate' : 'Activate'} ${stall.name}? ${stall.is_active ? 'Its items can no longer be ordered.' : ''}`)) return;
    try {
      await apiClient.put(`/stalls/${stall.id}`, { is_active: !stall.is_active });
      fetchStalls();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to change stall status');
    }
  };

  useEffect(() => {
    fetchStalls();
    fetchOwners();
  }, []);

  const q = search.trim().toLowerCase();
  const filtered = stalls.filter(
    (s) =>
      (statusFilter === 'all' || (statusFilter === 'active') === !!s.is_active) &&
      (!q || `${s.name} ${s.code} ${s.description ?? ''}`.toLowerCase().includes(q)),
  );
  const currentPage = clampPage(page, filtered.length, PAGE_SIZE);
  const pageRows = pageSlice(filtered, currentPage, PAGE_SIZE);
  const pageIds = pageRows.map((s) => s.id as number);

  const onBulkFinished = useCallback((summary: BulkSummary) => {
    const gone = new Set(summary.deletedIds);
    setSelected((prev) => new Set([...prev].filter((id) => !gone.has(id))));
    fetchStalls();
  }, []);
  // Single and multi-stall delete share one dialog: the server first says which stalls can be deleted for good; the rest can be deactivated from it
  const refresh = useRef(fetchStalls);
  refresh.current = fetchStalls;
  const deleteOptions = useMemo(
    () => ({
      previewEndpoint: '/stalls/deletion-preview',
      deactivate: async (id: number) => {
        await apiClient.put(`/stalls/${id}`, { is_active: false });
      },
      onDeactivated: () => void refresh.current(),
    }),
    [],
  );
  const bulk = useBulkDelete('/stalls/bulk-delete', onBulkFinished, deleteOptions);

  // Rows that disappeared (deleted elsewhere / filtered data refresh) cannot stay selected
  useEffect(() => {
    setSelected((prev) => (prev.size ? pruneSelection(prev, stalls.map((s) => s.id)) : prev));
  }, [stalls]);

  const handleCreateStall = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiClient.post('/stalls', {
        name,
        code,
        description,
        contact_phone: phone,
        stall_owner_id: ownerId,
      });
      if (res.data.success) {
        setShowAddModal(false);
        setName('');
        setCode('');
        setDescription('');
        setPhone('');
        setOwnerId(null);
        fetchStalls();
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to create stall');
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-fg tracking-tight">Food Court Stall Directory</h2>
          <p className="text-sm text-muted mt-1">Independent culinary stalls operating within the food court</p>
        </div>
        {isOwner && (
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-fg font-medium text-sm rounded-lg shadow-sm transition flex items-center space-x-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Stall</span>
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-surface p-3 rounded-lg border border-line shadow-sm">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="w-4 h-4 text-subtle absolute left-3 top-2.5" />
          <input
            type="text"
            aria-label="Search stalls"
            placeholder="Search stall name, code or description..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className={`${inputClass} pl-9`}
          />
        </div>
        {isOwner && (
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as 'all' | 'active' | 'inactive');
              setPage(1);
            }}
            className="py-1.5 px-3 rounded-lg border border-line bg-surface text-fg text-sm font-medium"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        )}
      </div>

      {isOwner && (
        <BulkToolbar
          noun="Stalls"
          selectedCount={selected.size}
          filteredCount={filtered.length}
          pageState={pageState(selected, pageIds)}
          onTogglePage={() => setSelected((s) => togglePage(s, pageIds))}
          onSelectAllFiltered={() => setSelected(selectAllFiltered(filtered.map((s) => s.id)))}
          onClear={() => setSelected(new Set())}
          onDelete={() => bulk.open([...selected])}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="stall-grid">
        {pageRows.map((stall) => (
          <div key={stall.id} data-testid="stall-card" className={`bg-surface rounded-lg border p-4 shadow-sm flex flex-col justify-between ${selected.has(stall.id) ? 'border-primary' : 'border-line'}`}>
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2">
                  {isOwner && <BulkCheckbox state={selected.has(stall.id)} onChange={() => setSelected((s) => toggleId(s, stall.id))} label={`Select ${stall.name}`} testId="stall-select" />}
                  <div className="p-2.5 bg-primary/10 text-primary rounded-lg">
                    <Store className="w-6 h-6" />
                  </div>
                </div>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${statusChip(stall.is_active ? 'active' : 'inactive')}`}>
                  {stall.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <h3 className="font-semibold text-base text-fg">{stall.name}</h3>
              <span className="text-xs font-mono text-muted block mb-2">{stall.code}</span>
              <p className="text-xs text-muted line-clamp-2">{stall.description || 'No description provided.'}</p>
              {isOwner && (
                <p className="text-xs text-muted mt-2" data-testid="stall-owner-line">
                  <span className="font-semibold">Stall owner:</span> {stall.owner?.name || <span className="text-warning-fg">not assigned (needed for owner-wise payouts)</span>}
                </p>
              )}
              {Array.isArray(stall.users) && (
                <p className="text-xs text-muted mt-2">
                  <span className="font-semibold">Manager:</span>{' '}
                  {stall.users.length ? stall.users.map((m: any) => `${m.name}${m.is_active ? '' : ' (inactive)'}`).join(', ') : <span className="text-warning-fg">not assigned (Staff & Permissions)</span>}
                </p>
              )}
            </div>

            <div className="mt-6 pt-4 border-t border-line flex items-center justify-between text-xs text-muted">
              <span className="flex items-center">
                <Phone className="w-3.5 h-3.5 mr-1" />
                {stall.contact_phone || 'N/A'}
              </span>
              <span className="font-semibold text-fg">{stall.categories?.length || 0} Categories</span>
            </div>
            <div className="mt-3 flex justify-end space-x-3 text-xs font-bold">
              <button onClick={() => setEditing({ ...stall })} className="text-primary inline-flex items-center">
                <Pencil className="w-3 h-3 mr-1" />
                Edit
              </button>
              {isOwner && (
                <button onClick={() => toggleActive(stall)} className={`inline-flex items-center ${stall.is_active ? 'text-danger-fg' : 'text-success-fg'}`}>
                  <Power className="w-3 h-3 mr-1" />
                  {stall.is_active ? 'Deactivate' : 'Activate'}
                </button>
              )}
              {isOwner && (
                <button onClick={() => bulk.open([stall.id])} className="text-danger-fg inline-flex items-center" data-testid="stall-delete" aria-label={`Delete ${stall.name}`}>
                  <Trash2 className="w-3 h-3 mr-1" />
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
        {pageRows.length === 0 && <p className="md:col-span-3 text-center text-sm text-muted py-8">No stalls match.</p>}
      </div>
      <div className="bg-surface rounded-lg border border-line">
        <Pagination page={currentPage} lastPage={pageCount(filtered.length, PAGE_SIZE)} total={filtered.length} onPage={setPage} />
      </div>

      {isOwner && (
        <BulkDeleteDialog
          state={bulk.state}
          noun="Stalls"
          confirmLabel="Delete Selected Stalls"
          warning="Permanent deletion removes the stall together with its menu categories and dishes and cannot be undone. Stalls with orders, kitchen tickets, settlements, payouts, stock, purchases, staff, suppliers or inventory are never deleted; they are listed with the reason."
          onCancel={bulk.close}
          onConfirm={bulk.confirm}
          onDeactivate={bulk.deactivate}
          onRetry={bulk.retryPreview}
        />
      )}

      {editing && (
        <div className="fixed inset-0 !m-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={saveEdit} className="bg-surface rounded-lg max-w-md w-full p-4 shadow-2xl space-y-3 max-h-[calc(100vh-2rem)] overflow-y-auto">
            <h3 className="font-semibold text-base text-fg">Edit {editing.code}</h3>
            <input required aria-label="Stall name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-line text-sm" />
            <input aria-label="Contact phone" value={editing.contact_phone || ''} onChange={(e) => setEditing({ ...editing, contact_phone: e.target.value })} placeholder="Contact phone" className="w-full px-3 py-2 rounded-lg border border-line text-sm" />
            {isOwner && <OwnerPicker owners={owners} value={editing.stall_owner_id} onChange={(id) => setEditing({ ...editing, stall_owner_id: id })} onOwnerAdded={(o) => setOwners((prev) => [...prev, o])} />}
            <textarea aria-label="Description" value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={2} className="w-full px-3 py-2 rounded-lg border border-line text-sm" />
            <div className="flex space-x-2 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="flex-1 py-2 text-xs font-bold text-muted rounded-lg border border-line">Cancel</button>
              <button type="submit" className="flex-1 py-2 text-xs font-bold text-primary-fg bg-primary hover:bg-primary/90 rounded-lg">Save</button>
            </div>
          </form>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 !m-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <form onSubmit={handleCreateStall} className="bg-surface rounded-lg max-w-md w-full p-4 shadow-2xl space-y-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
            <h3 className="font-semibold text-base text-fg">Add New Stall to Food Court</h3>
            <div>
              <label className="block text-xs font-semibold text-fg mb-1">Stall Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Taco Town"
                className="w-full px-3 py-2 rounded-lg border border-line text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-fg mb-1">Stall Code (Unique identifier)</label>
              <input
                type="text"
                required
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g., STALL-TACO"
                className="w-full px-3 py-2 rounded-lg border border-line text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-fg mb-1">Contact Phone</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 00000"
                className="w-full px-3 py-2 rounded-lg border border-line text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-fg mb-1">Stall owner (who settlement money is paid to)</label>
              <OwnerPicker owners={owners} value={ownerId} onChange={setOwnerId} onOwnerAdded={(o) => setOwners((prev) => [...prev, o])} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-fg mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 rounded-lg border border-line text-sm"
              />
            </div>
            <div className="flex space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="flex-1 py-2 text-xs font-bold text-muted rounded-lg border border-line"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2 text-xs font-bold text-primary-fg bg-primary hover:bg-primary/90 rounded-lg"
              >
                Create Stall
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
