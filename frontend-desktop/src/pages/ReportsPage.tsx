import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../api/client';
import { printContent } from '../components/Receipt';
import { useSettings } from '../context/SettingsContext';
import { downloadCsv, toCsv, type CsvColumn } from '../lib/csv';
import { apiError, daysAgo, humanize, isoDate } from '../lib/format';
import { ArrowDown, ArrowUp, BarChart3, Calendar, Download, Printer, Search } from 'lucide-react';

type Tab =
  | 'sales'
  | 'orders'
  | 'payments'
  | 'stalls'
  | 'menu'
  | 'cashiers'
  | 'cashier_closings'
  | 'closings'
  | 'purchases'
  | 'inventory'
  | 'stock'
  | 'staff'
  | 'logins'
  | 'audit';

interface Column<T> extends CsvColumn<T> {
  align?: 'left' | 'right';
  numeric?: boolean;
}

interface ReportDef {
  label: string;
  title: string;
  columns: Column<any>[];
  /** uses the stall filter */
  stall?: boolean;
  /** single-day report (uses the end date) */
  singleDay?: boolean;
  note?: string;
  load: (p: { start: string; end: string; stallId: string; action: string }) => Promise<any[]>;
}

const amt = (v: unknown) => Number(v || 0).toFixed(2);
const when = (v: string) => (v ? new Date(v).toLocaleString('en-IN') : '');
const get = async (url: string, params: object) => (await apiClient.get(url, { params })).data.data;

const LOGIN_ACTIONS = 'login_success,login_failed,login_blocked_inactive,logout,access_denied';

const REPORTS: Record<Tab, ReportDef> = {
  sales: {
    label: 'Daily Sales',
    title: 'Daily sales',
    note: 'Paid amounts are what customers paid (subtotal + tax). Orders includes unpaid and cancelled orders.',
    columns: [
      { header: 'Date', value: (r) => r.day },
      { header: 'Orders', value: (r) => r.orders_count, align: 'right', numeric: true },
      { header: 'Cancelled', value: (r) => r.cancelled_count, align: 'right', numeric: true },
      { header: 'Paid orders', value: (r) => r.paid_count, align: 'right', numeric: true },
      { header: 'Paid subtotal (₹)', value: (r) => amt(r.paid_subtotal), align: 'right', numeric: true },
      { header: 'Tax (₹)', value: (r) => amt(r.paid_tax), align: 'right', numeric: true },
      { header: 'Paid total (₹)', value: (r) => amt(r.paid_total), align: 'right', numeric: true },
    ],
    load: async ({ start, end }) => (await get('/reports/sales-summary', { start_date: start, end_date: end })).days,
  },
  orders: {
    label: 'Orders',
    title: 'Order report',
    stall: true,
    note: 'Latest 200 orders in the range. Use Orders & Receipts for full search and paging.',
    columns: [
      { header: 'Order', value: (r) => r.order_number },
      { header: 'Time', value: (r) => when(r.created_at) },
      { header: 'Channel', value: (r) => humanize(r.order_channel) },
      { header: 'Table', value: (r) => r.table?.table_number || 'Takeaway' },
      { header: 'Customer', value: (r) => r.customer_name || '' },
      { header: 'Status', value: (r) => humanize(r.status) },
      { header: 'Payment', value: (r) => humanize(r.payment_status) },
      { header: 'Total (₹)', value: (r) => amt(r.total_amount), align: 'right', numeric: true },
    ],
    load: async ({ start, end, stallId }) => (await get('/orders', { date_from: start, date_to: end, stall_id: stallId || undefined, per_page: 200 })).data,
  },
  payments: {
    label: 'Payments',
    title: 'Payments by method',
    columns: [
      { header: 'Method', value: (r) => humanize(r.payment_method) },
      { header: 'Payments', value: (r) => r.payments_count, align: 'right', numeric: true },
      { header: 'Amount (₹)', value: (r) => amt(r.total_amount), align: 'right', numeric: true },
    ],
    load: async ({ start, end }) => (await get('/reports/payment-summary', { start_date: start, end_date: end })).by_method,
  },
  stalls: {
    label: 'Stall Sales',
    title: 'Stall-wise sales (paid orders)',
    columns: [
      { header: 'Stall', value: (r) => r.stall_name },
      { header: 'Code', value: (r) => r.stall_code },
      { header: 'Orders', value: (r) => r.orders_count, align: 'right', numeric: true },
      { header: 'Quantity sold', value: (r) => r.items_quantity_sold, align: 'right', numeric: true },
      { header: 'Item revenue (₹)', value: (r) => amt(r.total_revenue), align: 'right', numeric: true },
    ],
    load: async ({ start, end }) => (await get('/reports/stall-sales', { start_date: start, end_date: end })).stalls_performance,
  },
  menu: {
    label: 'Products',
    title: 'Product performance (paid orders)',
    columns: [
      { header: 'Item', value: (r) => r.item_name },
      { header: 'Stall', value: (r) => r.stall_name },
      { header: 'Quantity sold', value: (r) => r.quantity_sold, align: 'right', numeric: true },
      { header: 'Revenue (₹)', value: (r) => amt(r.revenue), align: 'right', numeric: true },
    ],
    load: async ({ start, end }) => (await get('/reports/menu-performance', { start_date: start, end_date: end })).items,
  },
  cashiers: {
    label: 'Cashiers',
    title: 'Cashier activity',
    singleDay: true,
    columns: [
      { header: 'Cashier', value: (r) => r.cashier_name },
      { header: 'Method', value: (r) => humanize(r.payment_method) },
      { header: 'Payments', value: (r) => r.payments_count, align: 'right', numeric: true },
      { header: 'Amount (₹)', value: (r) => amt(r.total_amount), align: 'right', numeric: true },
    ],
    load: async ({ end }) => (await get('/reports/cashier-activity', { date: end })).rows,
  },
  cashier_closings: {
    label: 'Cashier Closings',
    title: 'Cashier closings',
    columns: [
      { header: 'Date', value: (r) => String(r.business_date).slice(0, 10) },
      { header: 'Cashier', value: (r) => r.cashier?.name },
      { header: 'Payments', value: (r) => r.payments_count, align: 'right', numeric: true },
      { header: 'Expected cash (₹)', value: (r) => amt(r.expected_cash), align: 'right', numeric: true },
      { header: 'Counted (₹)', value: (r) => amt(r.counted_cash), align: 'right', numeric: true },
      { header: 'Variance (₹)', value: (r) => amt(r.variance), align: 'right', numeric: true },
      { header: 'Non-cash (₹)', value: (r) => amt(r.non_cash_total), align: 'right', numeric: true },
      { header: 'Note', value: (r) => r.notes || '' },
    ],
    load: async ({ start, end }) => (await get('/cashier-closings', { date_from: start, date_to: end, per_page: 200 })).data,
  },
  closings: {
    label: 'Daily Closings',
    title: 'Daily closing history',
    columns: [
      { header: 'Date', value: (r) => String(r.closing_date).slice(0, 10) },
      { header: 'Orders', value: (r) => r.total_orders_count, align: 'right', numeric: true },
      { header: 'Gross (₹)', value: (r) => amt(r.total_gross_sales), align: 'right', numeric: true },
      { header: 'Net (₹)', value: (r) => amt(r.total_net_sales), align: 'right', numeric: true },
      { header: 'Cash (₹)', value: (r) => amt(r.total_cash_collected), align: 'right', numeric: true },
      { header: 'Digital (₹)', value: (r) => amt(r.total_digital_collected), align: 'right', numeric: true },
      {
        header: 'Stall payouts recorded',
        value: (r) =>
          (r.settlements || []).map((s: any) => `${s.stall?.code}: ${s.settlement_status === 'paid' ? `paid ${amt(s.settlement_amount)}` : 'pending'}`).join('; '),
      },
    ],
    load: async () => (await get('/settlements/closings', { per_page: 100 })).data,
  },
  purchases: {
    label: 'Purchases',
    title: 'Purchases by supplier',
    stall: true,
    columns: [
      { header: 'Supplier', value: (r) => r.supplier_name },
      { header: 'Stall', value: (r) => r.stall_name },
      { header: 'Purchase orders', value: (r) => r.purchase_orders, align: 'right', numeric: true },
      { header: 'Open', value: (r) => r.open_orders, align: 'right', numeric: true },
      { header: 'Received (₹)', value: (r) => amt(r.received_total), align: 'right', numeric: true },
      { header: 'Open value (₹)', value: (r) => amt(r.open_total), align: 'right', numeric: true },
    ],
    load: async ({ start, end, stallId }) => (await get('/reports/purchases', { start_date: start, end_date: end, stall_id: stallId || undefined })).suppliers,
  },
  inventory: {
    label: 'Inventory',
    title: 'Current stock and value (at last purchase cost)',
    stall: true,
    note: 'Stock value = current stock × last purchase unit cost. Current figures, not tied to the date range.',
    columns: [
      { header: 'Stall', value: (r) => r.stall_name },
      { header: 'Item', value: (r) => r.name },
      { header: 'Stock', value: (r) => `${Number(r.current_stock)} ${r.unit}`, align: 'right' },
      { header: 'Alert at', value: (r) => Number(r.minimum_alert_stock), align: 'right', numeric: true },
      { header: 'Unit cost (₹)', value: (r) => amt(r.unit_cost), align: 'right', numeric: true },
      { header: 'Value (₹)', value: (r) => amt(r.stock_value), align: 'right', numeric: true },
      { header: 'Low', value: (r) => (r.is_low ? 'LOW' : '') },
    ],
    load: async ({ stallId }) => (await get('/reports/inventory', { stall_id: stallId || undefined })).items,
  },
  stock: {
    label: 'Stock Movements',
    title: 'Stock movement ledger',
    stall: true,
    note: 'Latest 200 movements in the range.',
    columns: [
      { header: 'Time', value: (r) => when(r.created_at) },
      { header: 'Stall', value: (r) => r.stall?.name },
      { header: 'Item', value: (r) => r.inventory_item?.name },
      { header: 'Type', value: (r) => humanize(r.movement_type) },
      { header: 'Qty', value: (r) => Number(r.quantity), align: 'right', numeric: true },
      { header: 'Before', value: (r) => Number(r.previous_stock), align: 'right', numeric: true },
      { header: 'After', value: (r) => Number(r.new_stock), align: 'right', numeric: true },
      { header: 'By', value: (r) => r.performed_by?.name || '' },
      { header: 'Reason', value: (r) => r.reason || '' },
    ],
    load: async ({ start, end, stallId }) => (await get('/inventory/movements', { date_from: start, date_to: end, stall_id: stallId || undefined, per_page: 200 })).data,
  },
  staff: {
    label: 'Staff Activity',
    title: 'Staff activity (audited actions)',
    columns: [
      { header: 'Staff', value: (r) => r.name },
      { header: 'Role', value: (r) => humanize(r.role) },
      { header: 'Active', value: (r) => (r.is_active ? 'Yes' : 'No') },
      { header: 'Actions', value: (r) => r.actions, align: 'right', numeric: true },
      { header: 'Sign-ins', value: (r) => r.logins, align: 'right', numeric: true },
      { header: 'Denied requests', value: (r) => r.denied_requests, align: 'right', numeric: true },
      { header: 'Last activity', value: (r) => when(r.last_activity_at) },
    ],
    load: async ({ start, end }) => (await get('/reports/staff-activity', { start_date: start, end_date: end })).staff,
  },
  logins: {
    label: 'Login & Access',
    title: 'Sign-in history and denied requests',
    note: 'Latest 200 entries in the range.',
    columns: [
      { header: 'Time', value: (r) => when(r.created_at) },
      { header: 'Event', value: (r) => humanize(r.action) },
      { header: 'User', value: (r) => r.user?.name || r.new_values?.email || '—' },
      { header: 'Role', value: (r) => humanize(r.user?.role || r.new_values?.role || '') },
      { header: 'Detail', value: (r) => (r.action === 'access_denied' ? r.entity_id : r.new_values?.reason || '') },
      { header: 'IP', value: (r) => r.ip_address || '' },
    ],
    load: async ({ start, end }) => (await get('/reports/audit-logs', { action: LOGIN_ACTIONS, date_from: start, date_to: end, per_page: 200 })).data,
  },
  audit: {
    label: 'Audit Log',
    title: 'Audit log',
    note: 'Latest 200 entries in the range. Filter by action (comma-separated), e.g. order_cancelled, payment_created, settings_updated, stock_movement_created.',
    columns: [
      { header: 'Time', value: (r) => when(r.created_at) },
      { header: 'User', value: (r) => `${r.user?.name || 'System'} (${r.user?.role || '-'})` },
      { header: 'Action', value: (r) => r.action },
      { header: 'Entity', value: (r) => `${r.entity_type} #${r.entity_id}` },
      { header: 'Stall', value: (r) => r.stall?.name || '' },
      { header: 'Change', value: (r) => (r.new_values ? JSON.stringify(r.new_values).slice(0, 120) : '') },
    ],
    load: async ({ start, end, action }) => (await get('/reports/audit-logs', { action: action || undefined, date_from: start, date_to: end, per_page: 200 })).data,
  },
};

/** Reports built only from server records. No profit, commission or settlement figure is computed here. */
export const ReportsPage: React.FC = () => {
  const { settings } = useSettings();
  const [tab, setTab] = useState<Tab>('sales');
  const [startDate, setStartDate] = useState(daysAgo(6));
  const [endDate, setEndDate] = useState(isoDate());
  const [stalls, setStalls] = useState<any[]>([]);
  const [stallId, setStallId] = useState('');
  const [action, setAction] = useState('');
  const [appliedAction, setAppliedAction] = useState('');
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);

  const report = REPORTS[tab];

  useEffect(() => {
    apiClient.get('/stalls', { params: { include_inactive: 1 } }).then((r) => setStalls(r.data.data)).catch(() => undefined);
  }, []);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(null);
    report
      .load({ start: startDate, end: endDate, stallId, action: appliedAction })
      .then((data) => alive && setRows(data || []))
      .catch((err) => {
        if (!alive) return;
        setRows([]);
        setError(apiError(err, 'Failed to load report'));
      });
    return () => {
      alive = false;
    };
  }, [tab, startDate, endDate, stallId, appliedAction]);

  useEffect(() => {
    setSort(null);
    setFilter('');
  }, [tab]);

  // client-side search and column sorting over the loaded rows
  const visible = useMemo(() => {
    let out = rows || [];
    const q = filter.trim().toLowerCase();
    if (q) out = out.filter((r) => report.columns.some((c) => String(c.value(r) ?? '').toLowerCase().includes(q)));
    if (sort) {
      const c = report.columns[sort.col];
      out = [...out].sort((a, b) => {
        const va = c.value(a);
        const vb = c.value(b);
        const cmp = c.numeric ? Number(va) - Number(vb) : String(va ?? '').localeCompare(String(vb ?? ''));
        return cmp * sort.dir;
      });
    }
    return out;
  }, [rows, filter, sort, report]);

  const title = `${report.title} · ${report.singleDay ? endDate : tab === 'inventory' || tab === 'closings' ? 'current' : `${startDate} to ${endDate}`}`;
  const exportCsv = () => downloadCsv(`${tab}-report-${endDate}.csv`, toCsv(visible, report.columns));
  const print = () =>
    printContent(
      <div>
        <h2 style={{ fontSize: 14, fontWeight: 700 }}>
          {settings.business_profile.name} · {title}
        </h2>
        <p style={{ fontSize: 10 }}>Printed {new Date().toLocaleString('en-IN')}</p>
        <ReportTable columns={report.columns} rows={visible} />
      </div>,
      'a4'
    );

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center space-x-2">
            <BarChart3 className="w-6 h-6" />
            <span>Reports & Audit</span>
          </h2>
          <p className="text-sm text-slate-500 mt-1">All figures come from recorded orders, payments, purchases and stock movements. No commission or settlement formula is applied.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {report.stall && (
            <select aria-label="Stall filter" value={stallId} onChange={(e) => setStallId(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white">
              <option value="">All stalls</option>
              {stalls.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <div className="flex items-center space-x-2 bg-white p-2 rounded-xl border border-slate-200 text-xs">
            <Calendar className="w-4 h-4 text-slate-400" />
            {!report.singleDay && (
              <>
                <input aria-label="Start date" type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} className="border-none focus:outline-none font-semibold" />
                <span className="text-slate-400">to</span>
              </>
            )}
            <input aria-label="End date" type="date" value={endDate} min={report.singleDay ? undefined : startDate} onChange={(e) => setEndDate(e.target.value)} className="border-none focus:outline-none font-semibold" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist">
        {(Object.keys(REPORTS) as Tab[]).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${tab === key ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}
          >
            {REPORTS[key].label}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-bold text-slate-900">{title}</h3>
            {report.note && <p className="text-xs text-slate-500">{report.note}</p>}
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            {tab === 'audit' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setAppliedAction(action.trim());
                }}
              >
                <input aria-label="Audit action filter" placeholder="action, e.g. order_cancelled" value={action} onChange={(e) => setAction(e.target.value)} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs w-56" />
              </form>
            )}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
              <input aria-label="Search report rows" placeholder="Search rows" value={filter} onChange={(e) => setFilter(e.target.value)} className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs w-44" />
            </div>
            <button onClick={exportCsv} disabled={visible.length === 0} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold flex items-center disabled:opacity-40">
              <Download className="w-3.5 h-3.5 mr-1" />
              CSV
            </button>
            <button onClick={print} disabled={visible.length === 0} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold flex items-center disabled:opacity-40">
              <Printer className="w-3.5 h-3.5 mr-1" />
              Print
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          {rows === null ? (
            <p className="py-10 text-center text-sm text-slate-400" role="status">
              Loading…
            </p>
          ) : (
            <ReportTable
              columns={report.columns}
              rows={visible}
              screen
              sort={sort}
              onSort={(col) => setSort((s) => (s && s.col === col ? (s.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 }))}
            />
          )}
        </div>
        {rows !== null && <p className="px-4 py-2 text-xs text-slate-400 border-t border-slate-100">{visible.length} row(s)</p>}
      </div>
    </div>
  );
};

const ReportTable: React.FC<{
  columns: Column<any>[];
  rows: any[];
  screen?: boolean;
  sort?: { col: number; dir: 1 | -1 } | null;
  onSort?: (col: number) => void;
}> = ({ columns, rows, screen, sort, onSort }) => (
  <table className={screen ? 'w-full text-sm' : ''}>
    <thead className={screen ? 'bg-slate-50 text-slate-500 text-xs uppercase' : ''}>
      <tr>
        {columns.map((c, i) => (
          <th key={c.header} className={screen ? `py-2.5 px-4 whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'}` : ''}>
            {screen && onSort ? (
              <button onClick={() => onSort(i)} className="inline-flex items-center uppercase">
                {c.header}
                {sort?.col === i && (sort.dir === 1 ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />)}
              </button>
            ) : (
              c.header
            )}
          </th>
        ))}
      </tr>
    </thead>
    <tbody className={screen ? 'divide-y divide-slate-100' : ''}>
      {rows.length === 0 ? (
        <tr>
          <td colSpan={columns.length} className={screen ? 'py-8 text-center text-slate-400' : ''}>
            No data for this period.
          </td>
        </tr>
      ) : (
        rows.map((row, ri) => (
          <tr key={ri}>
            {columns.map((c) => (
              <td key={c.header} className={screen ? `py-2 px-4 ${c.align === 'right' ? 'text-right' : ''}` : ''}>
                {String(c.value(row) ?? '')}
              </td>
            ))}
          </tr>
        ))
      )}
    </tbody>
  </table>
);
