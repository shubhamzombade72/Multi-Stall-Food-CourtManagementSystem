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
import { statusChip } from '../lib/status';

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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-fg tracking-tight">Food Court Executive Overview</h2>
          <p className="text-sm text-muted mt-1">Real-time consolidated operations across all culinary stalls</p>
        </div>
      </div>

      {/* Top 4 KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-surface p-4 rounded-lg border border-line shadow-sm">
          <div className="flex items-center justify-between text-muted mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Today's Revenue</span>
            <div className="p-2 bg-st-served-soft text-st-served-fg rounded-lg">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <div className="text-xl font-bold text-fg">₹{data?.today_revenue || '0.00'}</div>
          <p className="text-xs text-success-fg flex items-center mt-2 font-medium">
            <TrendingUp className="w-3.5 h-3.5 mr-1" />
            Centralized collections
          </p>
        </div>

        <div className="bg-surface p-4 rounded-lg border border-line shadow-sm">
          <div className="flex items-center justify-between text-muted mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Orders Today</span>
            <div className="p-2 bg-primary/10 text-primary rounded-lg">
              <ShoppingBag className="w-5 h-5" />
            </div>
          </div>
          <div className="text-xl font-bold text-fg">{data?.today_orders_count || 0}</div>
          <p className="text-xs text-muted mt-2">Dine-in + Takeaway</p>
        </div>

        <div className="bg-surface p-4 rounded-lg border border-line shadow-sm">
          <div className="flex items-center justify-between text-muted mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Active In-Flight Orders</span>
            <div className="p-2 bg-info/10 text-info-fg rounded-lg">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <div className="text-xl font-bold text-fg">{data?.active_orders_count || 0}</div>
          <p className="text-xs text-info-fg mt-2 font-medium">Currently in kitchen / serving</p>
        </div>

        <div className="bg-surface p-4 rounded-lg border border-line shadow-sm">
          <div className="flex items-center justify-between text-muted mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Table Occupancy</span>
            <div className="p-2 bg-st-kitchen-soft text-st-kitchen-fg rounded-lg">
              <Layers className="w-5 h-5" />
            </div>
          </div>
          <div className="text-xl font-bold text-fg">{data?.occupied_tables || '0/0'}</div>
          <p className="text-xs text-muted mt-2">{data?.total_stalls || 0} Active Stalls</p>
        </div>
      </div>

      {/* Operations: every figure below is read from the server; nothing is estimated */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Link to="/pos?mode=pending_bills" className="bg-surface p-3 rounded-lg border border-line shadow-sm hover:border-primary/40">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Pending Bills</span>
          <div className="text-xl font-bold text-danger-fg mt-1">{data?.pending_bills?.count ?? 0}</div>
          <p className="text-xs text-muted mt-1">₹{Number(data?.pending_bills?.amount || 0).toFixed(2)} awaiting payment</p>
        </Link>
        <div className="bg-surface p-3 rounded-lg border border-line shadow-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Completed Orders Today</span>
          <div className="text-xl font-bold text-success-fg mt-1">{data?.completed_orders_count ?? 0}</div>
          <p className="text-xs text-muted mt-1">Orders fully fulfilled</p>
        </div>
        <Link to="/settlements" className="bg-surface p-3 rounded-lg border border-line shadow-sm hover:border-primary/40">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">End-of-Day Closing & Settlements</span>
          <div className={`text-lg font-bold mt-1 ${data?.closing_today ? 'text-success-fg' : 'text-warning-fg'}`}>
            {data?.closing_today ? 'Closed' : 'Open'}
          </div>
          <p className="text-xs text-muted mt-1">{data?.closing_today ? `Closed at ${new Date(data.closing_today.created_at).toLocaleTimeString()}` : 'Not yet closed today'}</p>
        </Link>
        <div className="bg-surface p-3 rounded-lg border border-line shadow-sm">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Payments Today</span>
          {(data?.payment_methods_today || []).length === 0 ? (
            <p className="text-sm text-muted mt-2">No payments yet</p>
          ) : (
            <ul className="text-xs mt-2 space-y-1">
              {data.payment_methods_today.map((p: any) => (
                <li key={p.payment_method} className="flex justify-between">
                  <span className="uppercase font-semibold">{p.payment_method}</span>
                  <span>
                    {p.count} · ₹{Number(p.total).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-surface rounded-lg border border-line p-3 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-base text-fg">Staff</h3>
            <Link to="/staff" className="text-xs font-semibold text-primary">Manage</Link>
          </div>
          <ul className="text-sm space-y-1">
            {(data?.staff_by_role || []).map((r: any) => (
              <li key={r.role} className="flex justify-between">
                <span className="capitalize">{String(r.role).replace('_', ' ')}</span>
                <span className="text-muted">
                  {r.active} active / {r.total}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-surface rounded-lg border border-line p-3 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-base text-fg">Recent Activity</h3>
            <Link to="/reports" className="text-xs font-semibold text-primary">Audit log</Link>
          </div>
          <ul className="text-xs space-y-1.5 max-h-56 overflow-y-auto">
            {(data?.recent_activity || []).map((a: any) => (
              <li key={a.id}>
                <span className="text-muted">{new Date(a.created_at).toLocaleTimeString()}</span>{' '}
                <span className="font-semibold">{a.user?.name || 'System'}</span> {String(a.action).replace(/_/g, ' ')}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Stall Sales Breakdown */}
      <div className="bg-surface rounded-lg border border-line p-4 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-base text-fg">Stall-wise Sales Distribution Today</h3>
            <p className="text-xs text-muted mt-0.5">Individual culinary revenue performance</p>
          </div>
          <Link to="/reports" className="text-primary hover:text-primary/80 text-xs font-semibold flex items-center">
            <span>Detailed Analytics</span>
            <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
          </Link>
        </div>

        {data?.stall_sales && data.stall_sales.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {data.stall_sales.map((s: any) => (
              <div key={s.id} className="p-3 rounded-lg bg-canvas border border-line">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-2.5">
                    <div className="p-2 bg-surface rounded-lg border border-line text-fg shadow-sm">
                      <Store className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-bold text-fg text-sm">{s.name}</h4>
                      <span className="text-[11px] text-muted font-mono">{s.code}</span>
                    </div>
                  </div>
                </div>
                <div className="text-xl font-bold text-fg mt-2">₹{Number(s.total_sales).toFixed(2)}</div>
                <div className="flex items-center justify-between text-xs text-muted mt-2 pt-2 border-t border-line">
                  <span>Items Prepared</span>
                  <span className="font-semibold text-fg">{s.total_items} portions</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 text-center text-muted text-sm">
            No completed sales recorded yet today. Orders will appear here in real-time.
          </div>
        )}
      </div>

      {/* Recent Orders Table */}
      <div className="bg-surface rounded-lg border border-line overflow-hidden shadow-sm">
        <div className="p-4 border-b border-line flex items-center justify-between">
          <h3 className="font-semibold text-base text-fg">Recent Order Activity</h3>
          <Link to="/orders" className="text-primary hover:text-primary/80 text-xs font-semibold flex items-center">
            <span>View All Orders</span>
            <ArrowUpRight className="w-3.5 h-3.5 ml-1" />
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas text-muted text-xs uppercase tracking-wider">
              <tr>
                <th className="py-2 px-3">Order Number</th>
                <th className="py-2 px-3">Table / Type</th>
                <th className="py-2 px-3">Channel</th>
                <th className="py-2 px-3">Total Amount</th>
                <th className="py-2 px-3">Kitchen Status</th>
                <th className="py-2 px-3">Payment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data?.recent_orders && data.recent_orders.length > 0 ? (
                data.recent_orders.map((ord: any) => (
                  <tr key={ord.id} className="hover:bg-surface-2 transition">
                    <td className="py-2 px-3 font-mono font-medium text-fg whitespace-nowrap">{ord.order_number}</td>
                    <td className="py-2 px-3">
                      {ord.table ? (
                        <span className="font-semibold text-fg">{ord.table.table_number}</span>
                      ) : (
                        <span className="text-muted">Takeaway</span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-surface-2 text-fg font-medium">
                        {ord.order_channel}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-semibold text-fg">₹{ord.total_amount}</td>
                    <td className="py-2 px-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusChip(ord.status)}`}>
                        {ord.status}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusChip(ord.payment_status)}`}>
                        {ord.payment_status}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted">
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
