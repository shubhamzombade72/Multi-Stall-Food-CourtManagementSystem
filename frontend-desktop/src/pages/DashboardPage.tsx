import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import {
  DollarSign,
  ShoppingBag,
  Store,
  Layers,
  ArrowUpRight,
  TrendingUp,
  Clock
} from 'lucide-react';
import { Link } from 'react-router-dom';

export const DashboardPage: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchStats = async () => {
    try {
      const res = await apiClient.get('/reports/dashboard');
      if (res.data.success) {
        setData(res.data.data);
      }
    } catch (err) {
      console.error('Failed to load dashboard stats', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 10000); // 10s auto-refresh
    return () => clearInterval(interval);
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500"></div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Food Court Executive Overview</h2>
          <p className="text-sm text-slate-500 mt-1">Real-time consolidated operations across all culinary stalls</p>
        </div>
        <div className="flex space-x-3">
          <Link
            to="/pos"
            className="px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white font-medium text-sm rounded-xl shadow-sm transition flex items-center space-x-1.5"
          >
            <span>Open Cashier POS</span>
            <ArrowUpRight className="w-4 h-4" />
          </Link>
          <Link
            to="/settlements"
            className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium text-sm rounded-xl transition"
          >
            End-of-Day Closing
          </Link>
        </div>
      </div>

      {/* Top 4 KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Today's Revenue</span>
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900">₹{data?.today_revenue || '0.00'}</div>
          <p className="text-xs text-emerald-600 flex items-center mt-2 font-medium">
            <TrendingUp className="w-3.5 h-3.5 mr-1" />
            Centralized collections
          </p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Orders Today</span>
            <div className="p-2 bg-brand-50 text-brand-600 rounded-xl">
              <ShoppingBag className="w-5 h-5" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900">{data?.today_orders_count || 0}</div>
          <p className="text-xs text-slate-500 mt-2">Dine-in + Takeaway</p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Active In-Flight Orders</span>
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900">{data?.active_orders_count || 0}</div>
          <p className="text-xs text-blue-600 mt-2 font-medium">Currently in kitchen / serving</p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Table Occupancy</span>
            <div className="p-2 bg-purple-50 text-purple-600 rounded-xl">
              <Layers className="w-5 h-5" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900">{data?.occupied_tables || '0/0'}</div>
          <p className="text-xs text-slate-500 mt-2">{data?.total_stalls || 0} Active Stalls</p>
        </div>
      </div>

      {/* Stall Sales Breakdown */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="font-bold text-slate-900 text-lg">Stall-wise Sales Distribution Today</h3>
            <p className="text-xs text-slate-500 mt-0.5">Individual culinary revenue performance</p>
          </div>
          <Link to="/reports" className="text-brand-600 hover:text-brand-700 text-xs font-semibold flex items-center">
            <span>Detailed Analytics</span>
            <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
          </Link>
        </div>

        {data?.stall_sales && data.stall_sales.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {data.stall_sales.map((s: any) => (
              <div key={s.id} className="p-5 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-2.5">
                    <div className="p-2 bg-white rounded-lg border border-slate-200 text-slate-700 shadow-sm">
                      <Store className="w-4 h-4 text-brand-600" />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm">{s.name}</h4>
                      <span className="text-[11px] text-slate-400 font-mono">{s.code}</span>
                    </div>
                  </div>
                </div>
                <div className="text-xl font-bold text-slate-900 mt-2">₹{Number(s.total_sales).toFixed(2)}</div>
                <div className="flex items-center justify-between text-xs text-slate-500 mt-2 pt-2 border-t border-slate-200/60">
                  <span>Items Prepared</span>
                  <span className="font-semibold text-slate-700">{s.total_items} portions</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-slate-400 text-sm">
            No completed sales recorded yet today. Orders will appear here in real-time.
          </div>
        )}
      </div>

      {/* Recent Orders Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-slate-900 text-lg">Recent Order Activity</h3>
          <Link to="/orders" className="text-brand-600 hover:text-brand-700 text-xs font-semibold flex items-center">
            <span>View All Orders</span>
            <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="py-3 px-6">Order Number</th>
                <th className="py-3 px-6">Table / Type</th>
                <th className="py-3 px-6">Channel</th>
                <th className="py-3 px-6">Total Amount</th>
                <th className="py-3 px-6">Kitchen Status</th>
                <th className="py-3 px-6">Payment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data?.recent_orders && data.recent_orders.length > 0 ? (
                data.recent_orders.map((ord: any) => (
                  <tr key={ord.id} className="hover:bg-slate-50/80 transition">
                    <td className="py-3.5 px-6 font-mono font-medium text-slate-900">{ord.order_number}</td>
                    <td className="py-3.5 px-6">
                      {ord.table ? (
                        <span className="font-semibold text-slate-800">{ord.table.table_number}</span>
                      ) : (
                        <span className="text-slate-500">Takeaway</span>
                      )}
                    </td>
                    <td className="py-3.5 px-6">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-medium">
                        {ord.order_channel}
                      </span>
                    </td>
                    <td className="py-3.5 px-6 font-semibold text-slate-900">₹{ord.total_amount}</td>
                    <td className="py-3.5 px-6">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                        ord.status === 'ready' ? 'bg-emerald-100 text-emerald-700' :
                        ord.status === 'partially_ready' ? 'bg-blue-100 text-blue-700' :
                        ord.status === 'in_preparation' ? 'bg-amber-100 text-amber-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {ord.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-6">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                        ord.payment_status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                      }`}>
                        {ord.payment_status}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    No orders placed yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
