import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { ShieldCheck, Calendar, Store } from 'lucide-react';

export const ReportsPage: React.FC = () => {
  const [salesData, setSalesData] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [startDate, setStartDate] = useState(
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));

  const fetchReports = async () => {
    try {
      const [salesRes, logsRes] = await Promise.all([
        apiClient.get(`/reports/stall-sales?start_date=${startDate}&end_date=${endDate}`),
        apiClient.get('/reports/audit-logs'),
      ]);
      setSalesData(salesRes.data.data.stalls_performance || []);
      setAuditLogs(logsRes.data.data.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [startDate, endDate]);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Financial Reports & Audit Ledger</h2>
          <p className="text-sm text-slate-500 mt-1">Multi-day stall sales comparison and security event audit trails</p>
        </div>

        {/* Date Filter */}
        <div className="flex items-center space-x-2 bg-white p-2 rounded-xl border border-slate-200 text-xs">
          <Calendar className="w-4 h-4 text-slate-400" />
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="border-none focus:outline-none text-slate-700 font-semibold"
          />
          <span className="text-slate-400">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="border-none focus:outline-none text-slate-700 font-semibold"
          />
        </div>
      </div>

      {/* Stall Sales Performance */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-slate-900 text-lg">Stall Performance Breakdown</h3>
          <span className="text-xs text-slate-500">Period: {startDate} to {endDate}</span>
        </div>

        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="py-3 px-6">Stall Name</th>
              <th className="py-3 px-6">Stall Code</th>
              <th className="py-3 px-6">Orders Processed</th>
              <th className="py-3 px-6">Quantity Sold</th>
              <th className="py-3 px-6 text-right">Total Revenue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {salesData.length > 0 ? (
              salesData.map((row) => (
                <tr key={row.stall_id} className="hover:bg-slate-50 transition">
                  <td className="py-3.5 px-6 font-bold text-slate-900 flex items-center space-x-2">
                    <Store className="w-4 h-4 text-brand-600" />
                    <span>{row.stall_name}</span>
                  </td>
                  <td className="py-3.5 px-6 font-mono text-xs text-slate-500">{row.stall_code}</td>
                  <td className="py-3.5 px-6 font-semibold text-slate-700">{row.orders_count}</td>
                  <td className="py-3.5 px-6 font-semibold text-slate-700">{row.items_quantity_sold} portions</td>
                  <td className="py-3.5 px-6 font-extrabold text-brand-600 text-right text-base">
                    ₹{Number(row.total_revenue).toFixed(2)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-400">
                  No sales recorded in the selected date range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Security Audit Trails */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-slate-900 text-lg flex items-center space-x-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            <span>Audit Trail & Activity Log</span>
          </h3>
          <span className="text-xs text-slate-400 font-mono">Immutable Log</span>
        </div>

        <div className="divide-y divide-slate-100">
          {auditLogs.length > 0 ? (
            auditLogs.map((log) => (
              <div key={log.id} className="p-4 flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold text-slate-900 mr-2">{log.action}</span>
                  <span className="text-slate-500 font-mono">[{log.entity_type} #{log.entity_id}]</span>
                  <span className="text-slate-400 block mt-0.5">By {log.user?.name || 'System'} ({log.user?.role || 'N/A'})</span>
                </div>
                <span className="text-slate-400 font-mono">{new Date(log.created_at).toLocaleString()}</span>
              </div>
            ))
          ) : (
            <div className="p-8 text-center text-slate-400 text-sm">
              All transactions are clean. Audit events will be displayed here as critical actions occur.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
