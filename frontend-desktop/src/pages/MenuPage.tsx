import React, { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { apiError } from '../lib/format';
import { Field, inputClass, Modal, Pagination } from '../components/ui';
import { BulkCheckbox, BulkDeleteDialog, BulkToolbar, useBulkDelete } from '../components/BulkDelete';
import { clampPage, pageCount, pageSlice, pageState, pruneSelection, selectAllFiltered, toggleId, togglePage, type BulkSummary } from '../lib/bulkSelection';

const PAGE_SIZE = 25;
import {
  CheckCircle2,
  XCircle,
  Search,
  Clock,
  Plus,
  Edit2
} from 'lucide-react';

export const MenuPage: React.FC = () => {
  const { user, isOwner } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [stalls, setStalls] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedStall, setSelectedStall] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // Bulk selection lives outside the paged slice, so it survives page changes
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);

  // Form Fields
  const [stallId, setStallId] = useState<number | ''>('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState<number | ''>('');
  const [isVeg, setIsVeg] = useState(true);
  const [prepTime, setPrepTime] = useState<number>(15);
  const [isAvailable, setIsAvailable] = useState(true);

  const fetchData = async () => {
    try {
      const [stallsRes, itemsRes, catRes] = await Promise.all([
        apiClient.get('/stalls'),
        apiClient.get('/menu'),
        apiClient.get('/menu-categories'),
      ]);
      setStalls(stallsRes.data.data);
      setItems(itemsRes.data.data);
      setCategories(catRes.data.data);

      // Defaults only: a reload (e.g. after adding a category) must not overwrite what the user selected
      if (stallsRes.data.data.length > 0) {
        setStallId((cur) => cur || user?.stall_id || stallsRes.data.data[0].id);
      }
      if (catRes.data.data.length > 0) {
        setCategoryId((cur) => cur || catRes.data.data[0].id);
      }
    } catch (err) {
      console.error('Failed to load menu data', err);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // window.prompt() is not available in Electron, so categories are added through a modal
  const [catForm, setCatForm] = useState<{ stall_id: number | ''; name: string } | null>(null);
  const [catError, setCatError] = useState<string | null>(null);

  const addCategory = () => {
    setCatError(null);
    setCatForm({ stall_id: user?.stall_id || (selectedStall !== 'all' ? Number(selectedStall) : stalls[0]?.id ?? ''), name: '' });
  };

  const submitCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catForm) return;
    try {
      await apiClient.post('/menu-categories', { stall_id: catForm.stall_id, name: catForm.name.trim() });
      setCatForm(null);
      fetchData();
    } catch (err) {
      setCatError(apiError(err, 'Failed to add category'));
    }
  };

  const uploadImage = async (file: File | undefined) => {
    if (!file || !editingItem) return;
    const form = new FormData();
    form.append('image', file);
    try {
      const res = await apiClient.post(`/menu/${editingItem.id}/image`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setEditingItem(res.data.data);
      fetchData();
    } catch (err: any) {
      const errors = err.response?.data?.errors;
      alert(errors ? Object.values(errors).flat().join(' ') : err.response?.data?.message || 'Image upload failed');
    }
  };

  const openCreateModal = () => {
    setEditingItem(null);
    const initialStall = user?.stall_id || (stalls[0]?.id ?? '');
    setStallId(initialStall);
    setCategoryId(categories.find((c) => c.stall_id === initialStall)?.id ?? '');
    setName('');
    setDescription('');
    setPrice('');
    setIsVeg(true);
    setPrepTime(15);
    setIsAvailable(true);
    setShowModal(true);
  };

  const openEditModal = (item: any) => {
    setEditingItem(item);
    setStallId(item.stall_id);
    setCategoryId(item.category_id);
    setName(item.name);
    setDescription(item.description || '');
    setPrice(Number(item.price));
    setIsVeg(item.is_veg);
    setPrepTime(item.preparation_time_minutes || 15);
    setIsAvailable(item.is_available);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stallId || !categoryId || !name || price === '') {
      alert('Please fill out all required fields');
      return;
    }

    try {
      const payload = {
        stall_id: stallId,
        category_id: categoryId,
        name,
        description,
        price: Number(price),
        is_veg: isVeg,
        preparation_time_minutes: prepTime,
        is_available: isAvailable,
      };

      if (editingItem) {
        const res = await apiClient.put(`/menu/${editingItem.id}`, payload);
        if (res.data.success) {
          alert('Menu item updated successfully!');
          setShowModal(false);
          fetchData();
        }
      } else {
        const res = await apiClient.post('/menu', payload);
        if (res.data.success) {
          alert('Menu item added successfully!');
          setShowModal(false);
          fetchData();
        }
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to save menu item');
    }
  };

  const toggleAvailability = async (id: number) => {
    try {
      const res = await apiClient.post(`/menu/${id}/toggle`);
      if (res.data.success) {
        setItems((prev) =>
          prev.map((item) => (item.id === id ? { ...item, is_available: !item.is_available } : item))
        );
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to toggle item availability');
    }
  };

  const filteredItems = items.filter((item) => {
    const matchesStall = selectedStall === 'all' || String(item.stall_id) === selectedStall;
    const matchesSearch =
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.category?.name.toLowerCase().includes(search.toLowerCase());
    return matchesStall && matchesSearch;
  });

  const canManage = isOwner || user?.role === 'stall_manager';

  const currentPage = clampPage(page, filteredItems.length, PAGE_SIZE);
  const pageRows = pageSlice(filteredItems, currentPage, PAGE_SIZE);
  const pageIds = pageRows.map((i) => i.id as number);

  const onBulkFinished = useCallback((summary: BulkSummary) => {
    const gone = new Set(summary.deletedIds);
    setSelected((prev) => new Set([...prev].filter((id) => !gone.has(id))));
    fetchData();
  }, []);
  const bulk = useBulkDelete('/menu/bulk-delete', onBulkFinished);

  // Rows that no longer exist cannot stay selected
  useEffect(() => {
    setSelected((prev) => (prev.size ? pruneSelection(prev, items.map((i) => i.id)) : prev));
  }, [items]);

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-fg tracking-tight">Menu Catalog & Dish Pricing</h2>
          <p className="text-sm text-muted mt-1">Manage food recipes, prices, and kitchen live availability</p>
        </div>

        {canManage && (
          <div className="flex space-x-2">
            <button
              onClick={addCategory}
              className="px-4 py-2 bg-surface border border-line hover:bg-surface-2 text-fg font-bold text-xs rounded-lg transition"
            >
              + Category
            </button>
            <button
              onClick={openCreateModal}
              className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-fg font-bold text-xs rounded-lg shadow-sm transition flex items-center space-x-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Add New Dish</span>
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center space-x-3 bg-surface p-4 rounded-lg border border-line shadow-sm">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-subtle absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search dish or category..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-line text-sm focus:outline-none focus:ring-2 focus:ring-focus"
          />
        </div>
        <select
          value={selectedStall}
          onChange={(e) => {
            setSelectedStall(e.target.value);
            setPage(1);
          }}
          className="py-2 px-3 rounded-lg border border-line text-sm font-medium"
        >
          <option value="all">All Stalls ({stalls.length})</option>
          {stalls.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {isOwner && (
        <BulkToolbar
          noun="Items"
          selectedCount={selected.size}
          filteredCount={filteredItems.length}
          pageState={pageState(selected, pageIds)}
          onTogglePage={() => setSelected((s) => togglePage(s, pageIds))}
          onSelectAllFiltered={() => setSelected(selectAllFiltered(filteredItems.map((i) => i.id)))}
          onClear={() => setSelected(new Set())}
          onDelete={() => bulk.open([...selected])}
        />
      )}

      <div className="bg-surface rounded-lg border border-line overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-canvas text-muted text-xs uppercase tracking-wider">
            <tr>
              {isOwner && (
                <th className="py-2 px-3 w-8">
                  <BulkCheckbox state={pageState(selected, pageIds)} onChange={() => setSelected((s) => togglePage(s, pageIds))} label="Select all dishes on this page" testId="menu-select-page" />
                </th>
              )}
              <th className="py-2 px-3">Dish Name</th>
              <th className="py-2 px-3">Stall Owner</th>
              <th className="py-2 px-3">Category</th>
              <th className="py-2 px-3">Price</th>
              <th className="py-2 px-3">Dietary</th>
              <th className="py-2 px-3">Prep Time</th>
              <th className="py-2 px-3 text-center">Availability</th>
              {canManage && <th className="py-2 px-3 text-right">Edit</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {pageRows.map((item) => (
              <tr key={item.id} data-testid="menu-row" className={`hover:bg-surface-2 transition ${selected.has(item.id) ? 'bg-primary/5' : ''}`}>
                {isOwner && (
                  <td className="py-2 px-3">
                    <BulkCheckbox state={selected.has(item.id)} onChange={() => setSelected((s) => toggleId(s, item.id))} label={`Select ${item.name}`} testId="menu-select" />
                  </td>
                )}
                <td className="py-2 px-3 font-bold text-fg">{item.name}</td>
                <td className="py-2 px-3 text-xs text-primary font-semibold">{item.stall?.name}</td>
                <td className="py-2 px-3 text-xs text-muted">{item.category?.name}</td>
                <td className="py-2 px-3 font-extrabold text-fg">₹{Number(item.price).toFixed(2)}</td>
                <td className="py-2 px-3">
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                      item.is_veg ? 'bg-st-served-soft text-st-served-fg' : 'bg-danger/10 text-danger-fg'
                    }`}
                  >
                    {item.is_veg ? '🌱 Veg' : '🍗 Non-Veg'}
                  </span>
                </td>
                <td className="py-2 px-3 text-xs text-muted">
                  <span className="inline-flex items-center">
                    <Clock className="w-3.5 h-3.5 mr-1 text-subtle" />
                    {item.preparation_time_minutes}m
                  </span>
                </td>
                <td className="py-2 px-3 text-center">
                  <button
                    onClick={() => toggleAvailability(item.id)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition inline-flex items-center space-x-1 ${
                      item.is_available
                        ? 'bg-st-served-soft hover:opacity-80 text-st-served-fg'
                        : 'bg-surface-2 hover:bg-line text-muted'
                    }`}
                  >
                    {item.is_available ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>In Stock</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Sold Out</span>
                      </>
                    )}
                  </button>
                </td>
                {canManage && (
                  <td className="py-2 px-3 text-right">
                    <button
                      onClick={() => openEditModal(item)}
                      className="p-1.5 rounded-lg border border-line hover:bg-surface-2 text-muted transition"
                      title="Edit Dish & Price"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={currentPage} lastPage={pageCount(filteredItems.length, PAGE_SIZE)} total={filteredItems.length} onPage={setPage} />
      </div>

      {isOwner && (
        <BulkDeleteDialog
          state={bulk.state}
          noun="Items"
          confirmLabel="Delete Selected Items"
          warning="Dishes that appear on past orders are never deleted - they stay and are listed with the reason (mark them Sold Out instead). This cannot be undone."
          onCancel={bulk.close}
          onConfirm={bulk.confirm}
        />
      )}

      {/* CREATE / EDIT DISH MODAL */}
      {showModal && (
        <div className="fixed inset-0 !m-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg max-w-md w-full p-4 shadow-2xl border border-line space-y-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="font-semibold text-base text-fg">
                {editingItem ? 'Edit Dish & Price' : 'Add New Menu Item'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-muted hover:text-fg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {isOwner && (
                  <div>
                    <label className="block text-xs font-bold text-fg mb-1">Stall</label>
                    <select
                      aria-label="Dish stall"
                      value={stallId}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        setStallId(next);
                        setCategoryId(categories.find((c) => c.stall_id === next)?.id ?? '');
                      }}
                      className="w-full px-3 py-2 border border-line rounded-lg text-xs font-medium"
                      required
                    >
                      {stalls.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className={!isOwner ? 'col-span-2' : ''}>
                  <label className="block text-xs font-bold text-fg mb-1">Category</label>
                  <select
                    aria-label="Dish category"
                    value={categoryId}
                    onChange={(e) => setCategoryId(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-line rounded-lg text-xs font-medium"
                    required
                  >
                    <option value="">Select category</option>
                    {categories
                      .filter((c) => c.stall_id === stallId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {editingItem && (
                <div className="flex items-center space-x-3">
                  {editingItem.image_url ? (
                    <img src={editingItem.image_url} alt="" className="w-14 h-14 rounded-lg object-cover border border-line" />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-surface-2 border border-line" />
                  )}
                  <label className="text-xs font-bold text-primary cursor-pointer">
                    Upload photo (JPG/PNG/WebP, max 2 MB)
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => uploadImage(e.target.files?.[0])} />
                  </label>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-fg mb-1">Dish Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Gourmet Veg Supreme Pizza"
                  className="w-full px-3 py-2 border border-line rounded-lg text-xs font-semibold"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-fg mb-1">Price (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={price}
                    onChange={(e) => setPrice(Number(e.target.value))}
                    placeholder="250.00"
                    className="w-full px-3 py-2 border border-line rounded-lg text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-fg mb-1">Prep Time (min)</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={prepTime}
                    onChange={(e) => setPrepTime(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-line rounded-lg text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-fg mb-1">Description (Optional)</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ingredients or preparation style"
                  className="w-full px-3 py-2 border border-line rounded-lg text-xs"
                />
              </div>

              <div className="flex items-center space-x-6 py-1">
                <label className="flex items-center space-x-2 text-xs font-bold text-fg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isVeg}
                    onChange={(e) => setIsVeg(e.target.checked)}
                    className="rounded text-primary focus:ring-focus"
                  />
                  <span>Vegetarian 🌱</span>
                </label>

                <label className="flex items-center space-x-2 text-xs font-bold text-fg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isAvailable}
                    onChange={(e) => setIsAvailable(e.target.checked)}
                    className="rounded text-primary focus:ring-focus"
                  />
                  <span>Live in Menu (In Stock)</span>
                </label>
              </div>

              <div className="flex space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-2 rounded-lg border border-line text-xs font-semibold text-muted hover:bg-surface-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-fg text-xs font-bold shadow-md shadow-primary/20"
                >
                  {editingItem ? 'Update Dish' : 'Add Dish'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {catForm && (
        <Modal title="New menu category" onClose={() => setCatForm(null)} onSubmit={submitCategory} submitLabel="Add category" error={catError}>
          {isOwner ? (
            <Field label="Stall">
              <select aria-label="Category stall" required value={catForm.stall_id} onChange={(e) => setCatForm((f) => (f ? { ...f, stall_id: Number(e.target.value) } : f))} className={inputClass}>
                {stalls.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <p className="text-sm text-muted">Stall: {stalls.find((s) => s.id === catForm.stall_id)?.name}</p>
          )}
          <Field label="Category name">
            <input required autoFocus maxLength={100} aria-label="Category name" value={catForm.name} onChange={(e) => setCatForm((f) => (f ? { ...f, name: e.target.value } : f))} className={inputClass} />
          </Field>
        </Modal>
      )}
    </div>
  );
};
