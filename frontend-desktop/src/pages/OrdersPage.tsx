import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { Search, Eye } from 'lucide-react';

export const OrdersPage: React.FC = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [search, setSearch] = useState('');

  const fetchOrders = async () => {
    try {
      const res = await apiClient.get('/orders');
      if (res.data.success) {
        setOrders(res.data.data.data);
      }
    } catch (err) {
      console.error('Failed to load orders', err);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const filteredOrders = orders.filter((ord) => {
    const matchesStatus = filterStatus === 'all' || ord.status === filterStatus;
    const matchesSearch =
      ord.order_number.toLowerCase().includes(search.toLowerCase()) ||
      (ord.customer_name && ord.customer_name.toLowerCase().includes(search.toLowerCase()));
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Order Central Monitoring</h2>
          <p className="text-sm text-slate-500 mt-1">Multi-stall parent orders and itemized ticket lifecycles</p>
        </div>
      </div>

      <div className="flex items-center space-x-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Search by order # or customer name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="py-2 px-3 rounded-xl border border-slate-200 text-sm font-medium focus:ring-2 focus:ring-brand-500"
        >
          <option value="all">All Statuses</option>
          <option value="confirmed">Confirmed</option>
          <option value="partially_ready">Partially Ready</option>
          <option value="ready">Ready</option>
          <option value="served">Served</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="py-3 px-6">Order Number</th>
              <th className="py-3 px-6">Time</th>
              <th className="py-3 px-6">Table / Type</th>
              <th className="py-3 px-6">Channel</th>
              <th className="py-3 px-6">Stall Tickets</th>
              <th className="py-3 px-6">Total Amount</th>
              <th className="py-3 px-6">Status</th>
              <th className="py-3 px-6 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredOrders.length > 0 ? (
              filteredOrders.map((ord) => (
                <tr key={ord.id} className="hover:bg-slate-50 transition">
                  <td className="py-3.5 px-6 font-mono font-semibold text-slate-900">{ord.order_number}</td>
                  <td className="py-3.5 px-6 text-xs text-slate-500">{new Date(ord.created_at).toLocaleTimeString()}</td>
                  <td className="py-3.5 px-6">
                    {ord.table ? <span className="font-bold text-slate-800">{ord.table.table_number}</span> : 'Takeaway'}
                  </td>
                  <td className="py-3.5 px-6">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-medium">
                      {ord.order_channel}
                    </span>
                  </td>
                  <td className="py-3.5 px-6">
                    <div className="flex flex-wrap gap-1">
                      {ord.kitchen_tickets?.map((t: any) => (
                        <span key={t.id} className="text-[11px] px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-medium border border-slate-200">
                          {t.stall?.code || 'STALL'}: {t.status}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-3.5 px-6 font-bold text-slate-900">₹{ord.total_amount}</td>
                  <td className="py-3.5 px-6">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                      ord.status === 'ready' || ord.status === 'completed'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      {ord.status}
                    </span>
                  </td>
                  <td className="py-3.5 px-6 text-right">
                    <button
                      onClick={() => setSelectedOrder(ord)}
                      className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 transition"
                      title="Inspect Order Details"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-400">
                  No orders matching the criteria.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Inspect Order Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-lg">Order #{selectedOrder.order_number}</h3>
                <p className="text-xs text-slate-400">Created: {new Date(selectedOrder.created_at).toLocaleString()}</p>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Split Kitchen Tickets Section */}
            <div>
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                Stall Kitchen Tickets (Dispatched)
              </h4>
              <div className="space-y-2">
                {selectedOrder.kitchen_tickets?.map((t: any) => (
                  <div key={t.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex justify-between items-center text-xs">
                    <div>
                      <span className="font-bold text-slate-900 block">{t.stall?.name}</span>
                      <span className="text-slate-500 font-mono">Ticket #{t.ticket_number}</span>
                    </div>
                    <span className="px-2 py-0.5 rounded-full font-semibold uppercase bg-brand-100 text-brand-800 text-[10px]">
                      {t.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Itemized Order List */}
            <div>
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Item Breakdown</h4>
              <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
                {selectedOrder.items?.map((item: any) => (
                  <div key={item.id} className="p-3 flex justify-between items-center text-xs bg-white">
                    <div>
                      <span className="font-bold text-slate-900">{item.item_name}</span>
                      <span className="text-slate-400 block">{item.stall?.name} × {item.quantity}</span>
                    </div>
                    <span className="font-bold text-slate-800">₹{item.subtotal}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Financial Summary */}
            <div className="bg-slate-50 p-4 rounded-xl space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span className="font-medium">₹{selectedOrder.subtotal}</span>
              </div>
              <div className="flex justify-between">
                <span>Tax (GST 5%):</span>
                <span className="font-medium">₹{selectedOrder.tax_amount}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-slate-900 pt-1 border-t border-slate-200">
                <span>Total Amount:</span>
                <span className="text-brand-600">₹{selectedOrder.total_amount}</span>
              </div>
            </div>

            <button
              onClick={() => setSelectedOrder(null)}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
