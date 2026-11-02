import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
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

      if (stallsRes.data.data.length > 0) {
        setStallId(user?.stall_id || stallsRes.data.data[0].id);
      }
      if (catRes.data.data.length > 0) {
        setCategoryId(catRes.data.data[0].id);
      }
    } catch (err) {
      console.error('Failed to load menu data', err);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openCreateModal = () => {
    setEditingItem(null);
    setStallId(user?.stall_id || (stalls[0]?.id ?? ''));
    setCategoryId(categories[0]?.id ?? '');
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

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Menu Catalog & Dish Pricing</h2>
          <p className="text-sm text-slate-500 mt-1">Manage food recipes, prices, and kitchen live availability</p>
        </div>

        {canManage && (
          <button
            onClick={openCreateModal}
            className="px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white font-bold text-xs rounded-xl shadow-sm transition flex items-center space-x-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Dish</span>
          </button>
        )}
      </div>

      <div className="flex items-center space-x-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search dish or category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <select
          value={selectedStall}
          onChange={(e) => setSelectedStall(e.target.value)}
          className="py-2 px-3 rounded-xl border border-slate-200 text-sm font-medium"
        >
          <option value="all">All Stalls ({stalls.length})</option>
          {stalls.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="py-3 px-6">Dish Name</th>
              <th className="py-3 px-6">Stall Owner</th>
              <th className="py-3 px-6">Category</th>
              <th className="py-3 px-6">Price</th>
              <th className="py-3 px-6">Dietary</th>
              <th className="py-3 px-6">Prep Time</th>
              <th className="py-3 px-6 text-center">Availability</th>
              {canManage && <th className="py-3 px-6 text-right">Edit</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredItems.map((item) => (
              <tr key={item.id} className="hover:bg-slate-50 transition">
                <td className="py-3.5 px-6 font-bold text-slate-900">{item.name}</td>
                <td className="py-3.5 px-6 text-xs text-brand-600 font-semibold">{item.stall?.name}</td>
                <td className="py-3.5 px-6 text-xs text-slate-500">{item.category?.name}</td>
                <td className="py-3.5 px-6 font-extrabold text-slate-900">₹{Number(item.price).toFixed(2)}</td>
                <td className="py-3.5 px-6">
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                      item.is_veg ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {item.is_veg ? '🌱 Veg' : '🍗 Non-Veg'}
                  </span>
                </td>
                <td className="py-3.5 px-6 text-xs text-slate-500 flex items-center">
                  <Clock className="w-3.5 h-3.5 mr-1 text-slate-400" />
                  {item.preparation_time_minutes}m
                </td>
                <td className="py-3.5 px-6 text-center">
                  <button
                    onClick={() => toggleAvailability(item.id)}
                    className={`px-3 py-1 rounded-xl text-xs font-bold transition inline-flex items-center space-x-1 ${
                      item.is_available
                        ? 'bg-emerald-100 hover:bg-emerald-200 text-emerald-800'
                        : 'bg-slate-200 hover:bg-slate-300 text-slate-600'
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
                  <td className="py-3.5 px-6 text-right">
                    <button
                      onClick={() => openEditModal(item)}
                      className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 transition"
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
      </div>

      {/* CREATE / EDIT DISH MODAL */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-base">
                {editingItem ? 'Edit Dish & Price' : 'Add New Menu Item'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {isOwner && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Stall</label>
                    <select
                      value={stallId}
                      onChange={(e) => setStallId(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-medium"
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
                  <label className="block text-xs font-bold text-slate-700 mb-1">Category</label>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-medium"
                    required
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Dish Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Gourmet Veg Supreme Pizza"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-semibold"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Price (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={price}
                    onChange={(e) => setPrice(Number(e.target.value))}
                    placeholder="250.00"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Prep Time (min)</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={prepTime}
                    onChange={(e) => setPrepTime(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Description (Optional)</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ingredients or preparation style"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs"
                />
              </div>

              <div className="flex items-center space-x-6 py-1">
                <label className="flex items-center space-x-2 text-xs font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isVeg}
                    onChange={(e) => setIsVeg(e.target.checked)}
                    className="rounded text-brand-500 focus:ring-brand-500"
                  />
                  <span>Vegetarian 🌱</span>
                </label>

                <label className="flex items-center space-x-2 text-xs font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isAvailable}
                    onChange={(e) => setIsAvailable(e.target.checked)}
                    className="rounded text-brand-500 focus:ring-brand-500"
                  />
                  <span>Live in Menu (In Stock)</span>
                </label>
              </div>

              <div className="flex space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold shadow-md shadow-brand-500/20"
                >
                  {editingItem ? 'Update Dish' : 'Add Dish'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
