import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import {
  Search,
  Plus,
  Minus,
  CheckCircle2,
  Receipt,
  Store,
  Printer,
  Clock,
  ArrowRight,
  RefreshCw,
  CreditCard,
  QrCode,
  Banknote
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

export const PosPage: React.FC = () => {
  const [posMode, setPosMode] = useState<'new_order' | 'pending_bills'>('new_order');
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
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'upi_qr' | 'card'>('cash');
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

  // Financial Calculations for New Order Cart
  const subtotal = cart.reduce(
    (sum, item) => sum + Number(item.menuItem.price) * item.quantity,
    0
  );
  const tax = subtotal * 0.05;
  const total = subtotal + tax;

  const handleCreateOrder = async (autoPay: boolean = false) => {
    if (cart.length === 0) return;
    if (orderType === 'dine_in' && !selectedTableId) {
      alert('Please select a dining table for Dine-In orders.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        table_id: orderType === 'dine_in' ? selectedTableId : null,
        order_type: orderType,
        order_channel: 'cashier_pos',
        customer_name: 'Walk-in Cashier Order',
        customer_phone: null,
        idempotency_key: 'cashier_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        items: cart.map((ci) => ({
          menu_item_id: ci.menuItem.id,
          quantity: ci.quantity,
        })),
      };

      const res = await apiClient.post('/orders', payload);
      if (res.data.success) {
        const createdOrder = res.data.data;
        clearCart();
        loadData();
        loadPendingBills();

        if (autoPay) {
          setActivePaymentOrder(createdOrder);
          setCashTendered(Number(createdOrder.total_amount));
        } else {
          alert(`Order #${createdOrder.order_number} confirmed and split to stall kitchens!`);
        }
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to place order.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmPayment = async () => {
    if (!activePaymentOrder) return;
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
      alert(err.response?.data?.message || 'Payment processing failed.');
    }
  };

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

                    <button
                      onClick={() => {
                        setActivePaymentOrder(bill);
                        setCashTendered(Number(bill.total_amount));
                      }}
                      className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-extrabold shadow-sm flex items-center space-x-1.5 transition"
                    >
                      <span>Settle Bill</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
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
                    type="text"
                    placeholder="Search food, beverages, or stalls..."
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
                  <span>GST (5%):</span>
                  <span className="font-semibold text-slate-800">₹{tax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm font-extrabold text-slate-900 pt-1.5 border-t border-slate-200">
                  <span>Grand Total:</span>
                  <span className="text-brand-600 text-base">₹{total.toFixed(2)}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  disabled={cart.length === 0 || isSubmitting}
                  onClick={() => handleCreateOrder(false)}
                  className="py-2.5 px-3 rounded-xl border border-slate-300 font-bold text-xs text-slate-700 hover:bg-white transition disabled:opacity-50"
                >
                  Send to Kitchen
                </button>
                <button
                  disabled={cart.length === 0 || isSubmitting}
                  onClick={() => handleCreateOrder(true)}
                  className="py-2.5 px-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-extrabold text-xs shadow-md shadow-brand-500/20 transition disabled:opacity-50"
                >
                  Instant Pay ➔
                </button>
              </div>

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
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('cash')}
                  className={`p-3 rounded-xl border text-xs font-bold flex flex-col items-center space-y-1.5 transition ${
                    paymentMethod === 'cash'
                      ? 'border-brand-500 bg-brand-50 text-brand-700 shadow-sm'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Banknote className="w-5 h-5 text-emerald-600" />
                  <span>Cash</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod('upi_qr')}
                  className={`p-3 rounded-xl border text-xs font-bold flex flex-col items-center space-y-1.5 transition ${
                    paymentMethod === 'upi_qr'
                      ? 'border-brand-500 bg-brand-50 text-brand-700 shadow-sm'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <QrCode className="w-5 h-5 text-indigo-600" />
                  <span>UPI QR</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod('card')}
                  className={`p-3 rounded-xl border text-xs font-bold flex flex-col items-center space-y-1.5 transition ${
                    paymentMethod === 'card'
                      ? 'border-brand-500 bg-brand-50 text-brand-700 shadow-sm'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <CreditCard className="w-5 h-5 text-blue-600" />
                  <span>Card POS</span>
                </button>
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

            <div className="flex space-x-3 pt-2">
              <button
                onClick={() => setActivePaymentOrder(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmPayment}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-md shadow-emerald-600/20"
              >
                Confirm Payment & Settle
              </button>
            </div>
          </div>
        </div>
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
              <button
                onClick={() => window.print()}
                className="flex-1 py-2.5 px-3 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 flex items-center justify-center space-x-1 hover:bg-slate-50"
              >
                <Printer className="w-4 h-4 mr-1" />
                <span>Print Bill</span>
              </button>
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
