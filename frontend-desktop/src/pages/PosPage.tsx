import React, { useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import { PrintReceiptButton } from '../components/Receipt';
import { useSettings } from '../context/SettingsContext';
import { apiError } from '../lib/format';
import { Modal, Field, inputClass } from '../components/ui';
import {
  Search,
  Plus,
  Minus,
  CheckCircle2,
  Receipt,
  Store,
  Clock,
  ArrowRight,
  RefreshCw,
  CreditCard,
  QrCode,
  Banknote,
  Wallet
} from 'lucide-react';

interface MenuItem {
  id: number;
  stall_id: number;
  name: string;
  price: string;
  is_veg: boolean;
  is_available: boolean;
  stall: { id: number; name: string; code: string };
  category: { id: number; name: string };
}

interface CartItem {
  menuItem: MenuItem;
  quantity: number;
}

const newOrderKey = () => 'cashier_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

const METHOD_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  cash: { label: 'Cash', icon: Banknote, color: 'text-emerald-600' },
  upi_qr: { label: 'UPI QR', icon: QrCode, color: 'text-indigo-600' },
  card: { label: 'Card POS', icon: CreditCard, color: 'text-blue-600' },
  split: { label: 'Split', icon: Wallet, color: 'text-slate-600' },
};

export const PosPage: React.FC = () => {
  const { settings } = useSettings();
  const enabledMethods = settings.payment_methods.enabled;
  const taxRate = Number(settings.tax.rate_percent) / 100;
  const [posMode, setPosMode] = useState<'new_order' | 'pending_bills'>('new_order');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerHint, setCustomerHint] = useState<string | null>(null);
  const [saveCustomer, setSaveCustomer] = useState(false);
  const [orderNotes, setOrderNotes] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [cancelBill, setCancelBill] = useState<any | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  // One key per cart: a retry after a timeout replays the same order instead of creating a second one
  const orderKey = useRef(newOrderKey());
  const searchInput = useRef<HTMLInputElement>(null);
  const [stalls, setStalls] = useState<any[]>([]);
  const [tables, setTables] = useState<any[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [selectedStallId, setSelectedStallId] = useState<number | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<'dine_in' | 'takeaway'>('dine_in');
  const [selectedTableId, setSelectedTableId] = useState<number | ''>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Pending Bills State
  const [pendingBills, setPendingBills] = useState<any[]>([]);
  const [pendingSearch, setPendingSearch] = useState('');
  const [isLoadingPending, setIsLoadingPending] = useState(false);

  // Payment Modal States
  const [activePaymentOrder, setActivePaymentOrder] = useState<any | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [cashTendered, setCashTendered] = useState<number>(0);
  const [settledReceipt, setSettledReceipt] = useState<any | null>(null);

  useEffect(() => {
    loadData();
    loadPendingBills();
    const interval = setInterval(loadPendingBills, 8000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const [stallsRes, tablesRes, menuRes] = await Promise.all([
        apiClient.get('/stalls'),
        apiClient.get('/tables'),
        apiClient.get('/menu?available_only=1'),
      ]);
      setStalls(stallsRes.data.data);
      setTables(tablesRes.data.data);
      setMenuItems(menuRes.data.data);
      if (tablesRes.data.data.length > 0) {
        setSelectedTableId(tablesRes.data.data[0].id);
      }
    } catch (err) {
      console.error('Failed to load POS catalog data', err);
    }
  };

  const loadPendingBills = async () => {
    setIsLoadingPending(true);
    try {
      const res = await apiClient.get('/billing/pending');
      if (res.data.success) {
        setPendingBills(res.data.data);
      }
    } catch (err) {
      console.error('Failed to load pending bills', err);
    } finally {
      setIsLoadingPending(false);
    }
  };

  const addToCart = (item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((ci) => ci.menuItem.id === item.id);
      if (existing) {
        return prev.map((ci) =>
          ci.menuItem.id === item.id ? { ...ci, quantity: ci.quantity + 1 } : ci
        );
      }
      return [...prev, { menuItem: item, quantity: 1 }];
    });
  };

  const updateQuantity = (itemId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((ci) => {
          if (ci.menuItem.id === itemId) {
            const newQty = ci.quantity + delta;
            return newQty > 0 ? { ...ci, quantity: newQty } : null;
          }
          return ci;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const clearCart = () => setCart([]);

  // A changed order is a different order: new key. An unchanged retry keeps the key (no duplicate).
  useEffect(() => {
    orderKey.current = newOrderKey();
  }, [cart, orderType, selectedTableId, customerName, customerPhone, orderNotes]);

  // Display estimate only: the server prices the order with the configured tax rule
  const subtotal = cart.reduce(
    (sum, item) => sum + Number(item.menuItem.price) * item.quantity,
    0
  );
  const tax = subtotal * taxRate;
  const total = subtotal + tax;

  /** Fill the customer name from the directory when a known phone number is entered. */
  const lookupCustomer = async () => {
    setCustomerHint(null);
    if (customerPhone.replace(/\D/g, '').length < 6) return;
    try {
      const res = await apiClient.get('/customers/lookup', { params: { phone: customerPhone } });
      const found = res.data.data;
      if (found) {
        setCustomerName(found.name);
        setCustomerHint(`Returning customer: ${found.name}`);
        setSaveCustomer(false);
      } else {
        setCustomerHint('New customer');
      }
    } catch {
      // lookup is a convenience; ordering still works
    }
  };

  const openPayment = (order: any) => {
    setPayError(null);
    setPaymentMethod((enabledMethods[0] as any) || 'cash');
    setCashTendered(Number(order.total_amount));
    setActivePaymentOrder(order);
  };

  const handleCreateOrder = async (autoPay: boolean = false) => {
    if (cart.length === 0 || isSubmitting) return;
    if (orderType === 'dine_in' && !selectedTableId) {
      setNotice({ ok: false, text: 'Select a dining table for a dine-in order.' });
      return;
    }

    setIsSubmitting(true);
    setNotice(null);
    try {
      const payload = {
        table_id: orderType === 'dine_in' ? selectedTableId : null,
        order_type: orderType,
        order_channel: 'cashier_pos',
        customer_name: customerName.trim() || null,
        customer_phone: customerPhone.trim() || null,
        notes: orderNotes.trim() || null,
        idempotency_key: orderKey.current,
        items: cart.map((ci) => ({
          menu_item_id: ci.menuItem.id,
          quantity: ci.quantity,
        })),
      };

      const res = await apiClient.post('/orders', payload);
      if (res.data.success) {
        const createdOrder = res.data.data;
        if (saveCustomer && customerName.trim() && customerPhone.trim()) {
          await apiClient.post('/customers', { name: customerName.trim(), phone: customerPhone.trim() }).catch(() => undefined);
        }
        clearCart();
        setCustomerName('');
        setCustomerPhone('');
        setCustomerHint(null);
        setSaveCustomer(false);
        setOrderNotes('');
        loadData();
        loadPendingBills();

        if (autoPay) {
          openPayment(createdOrder);
        } else {
          setNotice({ ok: true, text: `Order ${createdOrder.order_number} sent to ${createdOrder.kitchen_tickets?.length ?? 0} stall kitchen(s).` });
        }
      }
    } catch (err: any) {
      // The cart keeps its idempotency key, so pressing the button again cannot duplicate the order
      setNotice({ ok: false, text: apiError(err, 'Failed to place order. Retrying is safe.') });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmPayment = async () => {
    if (!activePaymentOrder || isPaying) return;
    setIsPaying(true);
    setPayError(null);
    try {
      const res = await apiClient.post('/billing/pay', {
        order_id: activePaymentOrder.id,
        payment_method: paymentMethod,
        amount: Number(activePaymentOrder.total_amount),
        cash_tendered: paymentMethod === 'cash' ? cashTendered : Number(activePaymentOrder.total_amount),
      });

      if (res.data.success) {
        setSettledReceipt(res.data.data);
        setActivePaymentOrder(null);
        loadData();
        loadPendingBills();
      }
    } catch (err: any) {
      setPayError(apiError(err, 'Payment processing failed.'));
      loadPendingBills();
    } finally {
      setIsPaying(false);
    }
  };

  const submitCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelBill) return;
    setCancelError(null);
    try {
      await apiClient.post(`/orders/${cancelBill.id}/cancel`, { reason: cancelReason.trim() });
      setNotice({ ok: true, text: `Order ${cancelBill.order_number} cancelled.` });
      setCancelBill(null);
      setCancelReason('');
      loadPendingBills();
      loadData();
    } catch (err) {
      setCancelError(apiError(err));
    }
  };

  // Keyboard shortcuts: F2 search, F4 send to kitchen, F8 send & pay, F9 toggle pending bills, Esc close dialogs
  const shortcuts = useRef<(e: KeyboardEvent) => void>(() => undefined);
  shortcuts.current = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (activePaymentOrder && !isPaying) setActivePaymentOrder(null);
      else if (settledReceipt) setSettledReceipt(null);
      else if (cancelBill) setCancelBill(null);
      return;
    }
    if (activePaymentOrder || settledReceipt || cancelBill) return;
    if (e.key === 'F2') {
      e.preventDefault();
      setPosMode('new_order');
      setTimeout(() => searchInput.current?.focus(), 0);
    } else if (e.key === 'F4' && posMode === 'new_order') {
      e.preventDefault();
      handleCreateOrder(false);
    } else if (e.key === 'F8' && posMode === 'new_order') {
      e.preventDefault();
      handleCreateOrder(true);
    } else if (e.key === 'F9') {
      e.preventDefault();
      setPosMode((m) => (m === 'new_order' ? 'pending_bills' : 'new_order'));
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => shortcuts.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const filteredItems = menuItems.filter((item) => {
    const matchesStall = selectedStallId === 'all' || item.stall_id === selectedStallId;
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.stall.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.category.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStall && matchesSearch;
  });

  const filteredPendingBills = pendingBills.filter((bill) => {
    const term = pendingSearch.toLowerCase();
    const matchesNumber = bill.order_number.toLowerCase().includes(term);
    const matchesTable = bill.table ? String(bill.table.table_number).includes(term) : false;
    const matchesCustomer = bill.customer_name ? bill.customer_name.toLowerCase().includes(term) : false;
    return matchesNumber || matchesTable || matchesCustomer;
  });

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden bg-slate-100">
      {/* Top POS Mode Navigation Bar */}
      <div className="bg-slate-900 px-6 py-2.5 flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setPosMode('new_order')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center space-x-2 ${
              posMode === 'new_order'
                ? 'bg-brand-500 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Plus className="w-4 h-4" />
            <span>Create New Counter Order</span>
          </button>

          <button
            onClick={() => {
              setPosMode('pending_bills');
              loadPendingBills();
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center space-x-2 ${
              posMode === 'pending_bills'
                ? 'bg-brand-500 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Receipt className="w-4 h-4" />
            <span>Pending Table Bills</span>
            <span className="ml-1.5 px-2 py-0.5 rounded-full text-[10px] font-black bg-white/20 text-white">
              {pendingBills.length}
            </span>
          </button>
        </div>

        <div className="flex items-center space-x-3 text-xs">
          <button
            onClick={loadPendingBills}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Refresh Pending Orders"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingPending ? 'animate-spin text-brand-400' : ''}`} />
          </button>
          <span className="text-slate-400 font-mono">
            {pendingBills.length} Unpaid Bill{pendingBills.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* POS Screen Content */}
      {posMode === 'pending_bills' ? (
        /* ================= PENDING TABLE BILLS VIEW ================= */
        <div className="flex-1 p-6 overflow-y-auto space-y-4">
          <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search by order #, table #, or guest name..."
                value={pendingSearch}
                onChange={(e) => setPendingSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <p className="text-xs text-slate-500 font-medium">
              Click <span className="font-bold text-slate-800">Settle Bill</span> to collect payment from guests and print receipt
            </p>
          </div>

          {filteredPendingBills.length === 0 ? (
            <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 max-w-md mx-auto mt-12 space-y-3">
              <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="font-bold text-slate-900 text-base">All Table Bills Settled</h3>
              <p className="text-xs text-slate-500">
                There are no outstanding table or takeaway orders awaiting payment.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredPendingBills.map((bill) => (
                <div
                  key={bill.id}
                  className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm hover:border-brand-500 transition flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="px-2.5 py-1 rounded-lg text-xs font-extrabold bg-slate-900 text-white">
                          {bill.table ? `Table ${bill.table.table_number}` : 'Takeaway'}
                        </span>
                        <span className="text-xs font-mono font-bold text-slate-500">
                          #{bill.order_number}
                        </span>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase bg-amber-100 text-amber-800">
                        {bill.status}
                      </span>
                    </div>

                    <div className="text-xs text-slate-500 flex items-center justify-between">
                      <span className="flex items-center">
                        <Clock className="w-3.5 h-3.5 mr-1 text-slate-400" />
                        {new Date(bill.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-600">
                        Via: {bill.order_channel === 'qr_customer' ? '📱 Table QR' : bill.order_channel === 'waiter_app' ? '🧑‍🍳 Waiter App' : '🖥️ Counter POS'}
                      </span>
                    </div>

                    {/* Stalls badges */}
                    <div className="flex flex-wrap gap-1">
                      {bill.kitchen_tickets?.map((t: any) => (
                        <span
                          key={t.id}
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200"
                        >
                          {t.stall?.code || 'STALL'}: {t.status}
                        </span>
                      ))}
                    </div>

                    {/* Items List */}
                    <div className="bg-slate-50 p-2.5 rounded-xl space-y-1 text-xs">
                      {bill.items?.map((it: any) => (
                        <div key={it.id} className="flex justify-between text-slate-700">
                          <span>{it.quantity}× {it.item_name}</span>
                          <span className="font-semibold text-slate-900">₹{it.subtotal}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Bill Total & Settle Button */}
                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                    <div>
                      <span className="text-[11px] text-slate-400 block font-medium">Total Payable</span>
                      <span className="text-lg font-black text-slate-900">₹{Number(bill.total_amount).toFixed(2)}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      {!bill.kitchen_tickets?.some((t: any) => ['preparing', 'ready', 'picked_up'].includes(t.status)) && (
                        <button
                          onClick={() => {
                            setCancelError(null);
                            setCancelReason('');
                            setCancelBill(bill);
                          }}
                          className="px-3 py-2.5 text-rose-600 hover:bg-rose-50 rounded-xl text-xs font-bold"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        onClick={() => openPayment(bill)}
                        data-settle-order={bill.order_number}
                        className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-extrabold shadow-sm flex items-center space-x-1.5 transition"
                      >
                        <span>Settle Bill</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* ================= NEW COUNTER ORDER VIEW ================= */
        <div className="flex flex-1 overflow-hidden">
          {/* Left Menu & Catalog Column */}
          <div className="flex-1 flex flex-col min-w-0 border-r border-slate-200 bg-white">
            {/* Top Controls: Search & Stall Filters */}
            <div className="p-4 border-b border-slate-200 space-y-3 bg-white">
              <div className="flex items-center space-x-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    ref={searchInput}
                    type="text"
                    aria-label="Search menu"
                    placeholder="Search food, beverages, or stalls… (F2)"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>

              {/* Stall Selector Tabs */}
              <div className="flex items-center space-x-2 overflow-x-auto pb-1">
                <button
                  onClick={() => setSelectedStallId('all')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
                    selectedStallId === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  All Stalls ({menuItems.length})
                </button>
                {stalls.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedStallId(s.id)}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center space-x-1.5 ${
                      selectedStallId === s.id
                        ? 'bg-brand-500 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    <Store className="w-3.5 h-3.5" />
                    <span>{s.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Menu Items Grid */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredItems.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => addToCart(item)}
                    data-menu-item={item.name}
                    className="p-3.5 rounded-2xl border border-slate-200/90 hover:border-brand-500 bg-white hover:shadow-md cursor-pointer transition flex flex-col justify-between group"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-semibold text-brand-600 truncate max-w-[120px]">
                          {item.stall.name}
                        </span>
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            item.is_veg ? 'bg-emerald-500' : 'bg-rose-500'
                          }`}
                          title={item.is_veg ? 'Vegetarian' : 'Non-Vegetarian'}
                        />
                      </div>
                      <h4 className="font-bold text-slate-900 text-sm leading-snug group-hover:text-brand-600 transition">
                        {item.name}
                      </h4>
                      <p className="text-xs text-slate-400 mt-1 line-clamp-2">{item.category.name}</p>
                    </div>

                    <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-100">
                      <span className="font-extrabold text-slate-900 text-sm">
                        ₹{Number(item.price).toFixed(2)}
                      </span>
                      <button className="w-7 h-7 rounded-lg bg-slate-100 group-hover:bg-brand-500 group-hover:text-white flex items-center justify-center transition">
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Consolidated Cart Column */}
          <div className="w-96 flex flex-col bg-white shrink-0 border-l border-slate-200">
            {/* Order Type & Table Selection */}
            <div className="p-4 border-b border-slate-200 space-y-3">
              <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
                <button
                  onClick={() => setOrderType('dine_in')}
                  className={`py-1.5 rounded-lg text-xs font-semibold transition ${
                    orderType === 'dine_in'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Dine-In
                </button>
                <button
                  onClick={() => setOrderType('takeaway')}
                  className={`py-1.5 rounded-lg text-xs font-semibold transition ${
                    orderType === 'takeaway'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Takeaway
                </button>
              </div>

              {/* Table Selector */}
              {orderType === 'dine_in' && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    Select Dining Table
                  </label>
                  <select
                    aria-label="Dining table"
                    value={selectedTableId}
                    onChange={(e) => setSelectedTableId(Number(e.target.value))}
                    className="w-full py-1.5 px-3 rounded-xl border border-slate-200 text-xs font-medium focus:ring-2 focus:ring-brand-500"
                  >
                    {tables.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.table_number} ({t.section}) - {t.status === 'occupied' ? 'Occupied' : 'Free'}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Customer (optional): a known phone number fills the name from the customer directory */}
              <div className="grid grid-cols-2 gap-2">
                <input
                  aria-label="Customer phone"
                  placeholder="Customer phone"
                  value={customerPhone}
                  maxLength={20}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  onBlur={lookupCustomer}
                  className="py-1.5 px-3 rounded-xl border border-slate-200 text-xs"
                />
                <input
                  aria-label="Customer name"
                  placeholder="Customer name"
                  value={customerName}
                  maxLength={100}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="py-1.5 px-3 rounded-xl border border-slate-200 text-xs"
                />
              </div>
              {customerHint && (
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>{customerHint}</span>
                  {customerHint === 'New customer' && (
                    <label className="flex items-center space-x-1">
                      <input type="checkbox" checked={saveCustomer} onChange={(e) => setSaveCustomer(e.target.checked)} />
                      <span>Save to customers</span>
                    </label>
                  )}
                </div>
              )}
              <input
                aria-label="Order notes"
                placeholder="Order notes (optional)"
                value={orderNotes}
                maxLength={500}
                onChange={(e) => setOrderNotes(e.target.value)}
                className="w-full py-1.5 px-3 rounded-xl border border-slate-200 text-xs"
              />
            </div>

            {/* Cart Items List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2">
                  <Store className="w-10 h-10 opacity-30" />
                  <p className="text-xs font-medium">Cart is empty. Select items to order.</p>
                </div>
              ) : (
                cart.map((ci) => (
                  <div
                    key={ci.menuItem.id}
                    className="p-3 bg-slate-50 rounded-xl flex items-center justify-between border border-slate-100"
                  >
                    <div className="flex-1 min-w-0 pr-2">
                      <h5 className="font-bold text-slate-900 text-xs truncate">{ci.menuItem.name}</h5>
                      <span className="text-[10px] text-brand-600 font-semibold">{ci.menuItem.stall.name}</span>
                      <div className="text-xs font-bold text-slate-900 mt-1">
                        ₹{(Number(ci.menuItem.price) * ci.quantity).toFixed(2)}
                      </div>
                    </div>

                    <div className="flex items-center space-x-1.5 bg-white border border-slate-200 rounded-lg p-0.5">
                      <button
                        onClick={() => updateQuantity(ci.menuItem.id, -1)}
                        className="w-6 h-6 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="text-xs font-bold w-5 text-center">{ci.quantity}</span>
                      <button
                        onClick={() => updateQuantity(ci.menuItem.id, 1)}
                        className="w-6 h-6 rounded flex items-center justify-center text-slate-600 hover:bg-slate-100"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Cart Footer & Financial Summary */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 space-y-3">
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-500">
                  <span>Subtotal:</span>
                  <span className="font-semibold text-slate-800">₹{subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>GST ({Number(settings.tax.rate_percent)}%, est.):</span>
                  <span className="font-semibold text-slate-800">₹{tax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm font-extrabold text-slate-900 pt-1.5 border-t border-slate-200">
                  <span>Grand Total:</span>
                  <span className="text-brand-600 text-base">₹{total.toFixed(2)}</span>
                </div>
              </div>

              {notice && (
                <div role={notice.ok ? 'status' : 'alert'} className={`text-[11px] rounded-lg p-2 ${notice.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'}`}>
                  {notice.text}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  disabled={cart.length === 0 || isSubmitting}
                  onClick={() => handleCreateOrder(false)}
                  className="py-2.5 px-3 rounded-xl border border-slate-300 font-bold text-xs text-slate-700 hover:bg-white transition disabled:opacity-50"
                >
                  {isSubmitting ? 'Sending…' : 'Send to Kitchen (F4)'}
                </button>
                <button
                  disabled={cart.length === 0 || isSubmitting}
                  onClick={() => handleCreateOrder(true)}
                  className="py-2.5 px-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold text-xs shadow-md shadow-brand-500/20 transition disabled:opacity-50"
                >
                  Send & Pay (F8) ➔
                </button>
              </div>
              <p className="text-[10px] text-slate-400 text-center">F2 search · F9 pending bills · Esc close</p>

              {cart.length > 0 && (
                <button
                  onClick={clearCart}
                  className="w-full text-center text-[11px] text-slate-400 hover:text-rose-600 pt-1 transition"
                >
                  Clear Cart
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= PAYMENT MODAL ================= */}
      {activePaymentOrder && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-lg">Consolidated Bill Settlement</h3>
                <p className="text-xs text-slate-500 font-mono">
                  Order #{activePaymentOrder.order_number} • {activePaymentOrder.table ? `Table ${activePaymentOrder.table.table_number}` : 'Takeaway'}
                </p>
              </div>
              <button
                onClick={() => setActivePaymentOrder(null)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Bill Summary */}
            <div className="bg-slate-50 p-4 rounded-xl space-y-2 text-xs">
              <div className="flex justify-between">
                <span>Total Bill Amount:</span>
                <span className="font-bold text-slate-900 text-base">₹{Number(activePaymentOrder.total_amount).toFixed(2)}</span>
              </div>
              <div className="text-[11px] text-slate-400">
                Covers {activePaymentOrder.items?.length || 0} dishes across participating kitchens
              </div>
            </div>

            {/* Payment Method Selector */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-2">Select Tender Method</label>
              {/* Only the methods the owner enabled in Food Court Settings */}
              <div className="grid grid-cols-3 gap-2">
                {enabledMethods.map((m) => {
                  const meta = METHOD_META[m] || METHOD_META.split;
                  const Icon = meta.icon;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPaymentMethod(m)}
                      aria-pressed={paymentMethod === m}
                      className={`p-3 rounded-xl border text-xs font-bold flex flex-col items-center space-y-1.5 transition ${
                        paymentMethod === m ? 'border-brand-500 bg-brand-50 text-brand-700 shadow-sm' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className={`w-5 h-5 ${meta.color}`} />
                      <span>{meta.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Cash Tender Calculation */}
            {paymentMethod === 'cash' && (
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-2">
                <label className="block text-xs font-bold text-slate-700">Cash Received from Guest</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-400 font-bold text-sm">₹</span>
                  <input
                    type="number"
                    step="1"
                    value={cashTendered || ''}
                    onChange={(e) => setCashTendered(Number(e.target.value))}
                    className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    placeholder="e.g. 500"
                  />
                </div>
                <div className="flex justify-between items-center text-xs pt-2 border-t border-slate-200 font-bold">
                  <span>Change to Return:</span>
                  <span className={`text-sm ${cashTendered >= activePaymentOrder.total_amount ? 'text-emerald-700 font-black' : 'text-rose-600'}`}>
                    ₹{Math.max(0, cashTendered - Number(activePaymentOrder.total_amount)).toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            {payError && (
              <div role="alert" className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                {payError}
              </div>
            )}
            <div className="flex space-x-3 pt-2">
              <button
                onClick={() => setActivePaymentOrder(null)}
                disabled={isPaying}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmPayment}
                disabled={isPaying || (paymentMethod === 'cash' && cashTendered < Number(activePaymentOrder.total_amount))}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-md shadow-emerald-600/20 disabled:opacity-50"
              >
                {isPaying ? 'Processing…' : 'Confirm Payment & Settle'}
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelBill && (
        <Modal title={`Cancel order ${cancelBill.order_number}`} onClose={() => setCancelBill(null)} onSubmit={submitCancel} submitLabel="Cancel order" error={cancelError}>
          <p className="text-sm text-slate-600">All stall tickets for this order are cancelled. Orders already being prepared cannot be cancelled.</p>
          <Field label="Reason (recorded in the audit log)">
            <input required autoFocus minLength={3} maxLength={255} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className={inputClass} />
          </Field>
        </Modal>
      )}

      {/* ================= SETTLED RECEIPT MODAL ================= */}
      {settledReceipt && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="text-center border-b border-slate-100 pb-4">
              <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-2">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <h3 className="font-bold text-slate-900 text-lg">Bill Settled Successfully</h3>
              <p className="text-xs text-slate-500 font-mono">Invoice #{settledReceipt.order.order_number}</p>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl space-y-2 text-xs font-mono">
              <div className="flex justify-between">
                <span>Total Amount:</span>
                <span className="font-bold">₹{settledReceipt.order.total_amount}</span>
              </div>
              <div className="flex justify-between">
                <span>Payment Method:</span>
                <span className="uppercase font-bold text-slate-700">{settledReceipt.payment.payment_method}</span>
              </div>
              {settledReceipt.change_returned > 0 && (
                <div className="flex justify-between text-emerald-700 font-bold pt-1 border-t border-slate-200">
                  <span>Change Returned:</span>
                  <span>₹{Number(settledReceipt.change_returned).toFixed(2)}</span>
                </div>
              )}
            </div>

            <div className="flex space-x-2 pt-2">
              <PrintReceiptButton
                orderId={settledReceipt.order.id}
                label="Print Receipt"
                className="flex-1 py-2.5 px-3 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 flex items-center justify-center space-x-1 hover:bg-slate-50"
              />
              <button
                onClick={() => setSettledReceipt(null)}
                className="flex-1 py-2.5 px-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
