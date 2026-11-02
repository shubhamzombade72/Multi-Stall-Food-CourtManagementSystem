import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { CheckCircle2, XCircle, Search, Clock } from 'lucide-react';

export const MenuPage: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [stalls, setStalls] = useState<any[]>([]);
  const [selectedStall, setSelectedStall] = useState<string>('all');
  const [search, setSearch] = useState('');

  const fetchData = async () => {
    try {
      const [stallsRes, itemsRes] = await Promise.all([
        apiClient.get('/stalls'),
        apiClient.get('/menu'),
      ]);
      setStalls(stallsRes.data.data);
      setItems(itemsRes.data.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const toggleAvailability = async (id: number) => {
    try {
      const res = await apiClient.post(`/menu/${id}/toggle`);
      if (res.data.success) {
        setItems((prev) =>
          prev.map((item) => (item.id === id ? { ...item, is_available: !item.is_available } : item))
        );
      }
    } catch (err) {
      console.error('Failed to toggle item availability', err);
    }
  };

  const filteredItems = items.filter((item) => {
    const matchesStall = selectedStall === 'all' || String(item.stall_id) === selectedStall;
    const matchesSearch =
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.category?.name.toLowerCase().includes(search.toLowerCase());
    return matchesStall && matchesSearch;
  });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Menu Catalog & Dish Availability</h2>
          <p className="text-sm text-slate-500 mt-1">Manage food recipes, prices, and kitchen live availability</p>
        </div>
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
              <th className="py-3 px-6 text-right">Availability</th>
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
                <td className="py-3.5 px-6 text-right">
                  <button
                    onClick={() => toggleAvailability(item.id)}
                    className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center space-x-1 ml-auto ${
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
