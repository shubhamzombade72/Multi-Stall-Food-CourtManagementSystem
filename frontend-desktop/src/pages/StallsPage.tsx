import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Store, Plus, Phone, Pencil, Power } from 'lucide-react';

export const StallsPage: React.FC = () => {
  const { user, isOwner } = useAuth();
  const [stalls, setStalls] = useState<any[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [editing, setEditing] = useState<any | null>(null);

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

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.put(`/stalls/${editing.id}`, {
        name: editing.name,
        description: editing.description,
        contact_phone: editing.contact_phone,
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
  }, []);

  const handleCreateStall = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiClient.post('/stalls', {
        name,
        code,
        description,
        contact_phone: phone,
      });
      if (res.data.success) {
        setShowAddModal(false);
        setName('');
        setCode('');
        setDescription('');
        setPhone('');
        fetchStalls();
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to create stall');
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Food Court Stall Directory</h2>
          <p className="text-sm text-slate-500 mt-1">Independent culinary stalls operating within the food court</p>
        </div>
        {isOwner && (
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white font-medium text-sm rounded-xl shadow-sm transition flex items-center space-x-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Stall</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {stalls.map((stall) => (
          <div key={stall.id} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="p-2.5 bg-brand-50 text-brand-600 rounded-xl">
                  <Store className="w-6 h-6" />
                </div>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${stall.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
                  {stall.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <h3 className="font-bold text-slate-900 text-lg">{stall.name}</h3>
              <span className="text-xs font-mono text-slate-400 block mb-2">{stall.code}</span>
              <p className="text-xs text-slate-500 line-clamp-2">{stall.description || 'No description provided.'}</p>
              {Array.isArray(stall.users) && (
                <p className="text-xs text-slate-600 mt-2">
                  <span className="font-semibold">Manager:</span>{' '}
                  {stall.users.length ? stall.users.map((m: any) => `${m.name}${m.is_active ? '' : ' (inactive)'}`).join(', ') : <span className="text-amber-700">not assigned (Staff & Permissions)</span>}
                </p>
              )}
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span className="flex items-center">
                <Phone className="w-3.5 h-3.5 mr-1" />
                {stall.contact_phone || 'N/A'}
              </span>
              <span className="font-semibold text-slate-700">{stall.categories?.length || 0} Categories</span>
            </div>
            <div className="mt-3 flex justify-end space-x-3 text-xs font-bold">
              <button onClick={() => setEditing({ ...stall })} className="text-brand-600 inline-flex items-center">
                <Pencil className="w-3 h-3 mr-1" />
                Edit
              </button>
              {isOwner && (
                <button onClick={() => toggleActive(stall)} className={`inline-flex items-center ${stall.is_active ? 'text-rose-600' : 'text-emerald-700'}`}>
                  <Power className="w-3 h-3 mr-1" />
                  {stall.is_active ? 'Deactivate' : 'Activate'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50 p-4">
          <form onSubmit={saveEdit} className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-3">
            <h3 className="font-bold text-slate-900 text-lg">Edit {editing.code}</h3>
            <input required aria-label="Stall name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm" />
            <input aria-label="Contact phone" value={editing.contact_phone || ''} onChange={(e) => setEditing({ ...editing, contact_phone: e.target.value })} placeholder="Contact phone" className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm" />
            <textarea aria-label="Description" value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={2} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm" />
            <div className="flex space-x-2 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="flex-1 py-2 text-xs font-bold text-slate-600 rounded-xl border border-slate-200">Cancel</button>
              <button type="submit" className="flex-1 py-2 text-xs font-bold text-white bg-brand-500 hover:bg-brand-600 rounded-xl">Save</button>
            </div>
          </form>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <form onSubmit={handleCreateStall} className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="font-bold text-slate-900 text-lg">Add New Stall to Food Court</h3>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Stall Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Taco Town"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Stall Code (Unique identifier)</label>
              <input
                type="text"
                required
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g., STALL-TACO"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Contact Phone</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 00000"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm"
              />
            </div>
            <div className="flex space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="flex-1 py-2 text-xs font-bold text-slate-600 rounded-xl border border-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2 text-xs font-bold text-white bg-brand-500 hover:bg-brand-600 rounded-xl"
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
