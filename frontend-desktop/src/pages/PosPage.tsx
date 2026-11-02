import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  CheckCircle2,
  Receipt,
  Store,
  Printer
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
  const [stalls, setStalls] = useState<any[]>([]);
  const [tables, setTables] = useState<any[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [selectedStallId, setSelectedStallId] = useState<number | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<'dine_in' | 'takeaway'>('dine_in');
  const [selectedTableId, setSelectedTableId] = useState<number | ''>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Payment Modal States
  const [activePaymentOrder, setActivePaymentOrder] = useState<any | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'upi_qr' | 'card'>('cash');
  const [cashTendered, setCashTendered] = useState<number>(0);
  const [settledReceipt, setSettledReceipt] = useState<any | null>(null);

  useEffect(() => {
    loadData();
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
      console.error('Failed to load POS data', err);
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

  // Financial Calculations
  const subtotal = cart.reduce(
    (sum, item) => sum + Number(item.menuItem.price) * item.quantity,
    0
  );
  const taxAmount = subtotal * 0.05; // 5% GST
  const totalAmount = subtotal + taxAmount;

  // Filtered menu
  const filteredItems = menuItems.filter((item) => {
    const matchesStall = selectedStallId === 'all' || item.stall_id === selectedStallId;
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.stall.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStall && matchesSearch;
  });

  const handlePlaceOrder = async (autoPay: boolean = false) => {
    if (cart.length === 0) return;
    if (orderType === 'dine_in' && !selectedTableId) {
      alert('Please select a dining table for dine-in orders.');
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
        items: cart.map((ci) => ({
          menu_item_id: ci.menuItem.id,
          quantity: ci.quantity,
        })),
      };

      const res = await apiClient.post('/orders', payload);
      if (res.data.success) {
        const createdOrder = res.data.data;
        clearCart();
        loadData(); // Refresh table status

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
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Payment processing failed.');
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-slate-100">
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
                  <span className="font-extrabold text-slate-900 text-base">₹{Number(item.price).toFixed(2)}</span>
                  <div className="w-7 h-7 rounded-lg bg-slate-100 group-hover:bg-brand-500 group-hover:text-white flex items-center justify-center text-slate-600 transition">
                    <Plus className="w-4 h-4" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Cart & Checkout Column */}
      <div className="w-96 bg-white flex flex-col shrink-0 shadow-lg z-10">
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-slate-900 text-base">Consolidated Bill Cart</h3>
            {cart.length > 0 && (
              <button
                onClick={clearCart}
                className="text-xs font-semibold text-rose-500 hover:text-rose-700 flex items-center"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" />
                Clear
              </button>
            )}
          </div>

          {/* Dine-In / Takeaway Toggle */}
          <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl mb-3">
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

        {/* Cart Item List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm">
              <Receipt className="w-10 h-10 stroke-1 mb-2 text-slate-300" />
              <span>Cart is empty</span>
              <p className="text-xs text-slate-400 mt-1 text-center">Click items from any stall to add</p>
            </div>
          ) : (
            cart.map(({ menuItem, quantity }) => (
              <div key={menuItem.id} className="p-3 rounded-xl border border-slate-100 bg-slate-50/70 flex items-center justify-between">
                <div className="min-w-0 flex-1 mr-2">
                  <span className="text-[10px] font-semibold text-brand-600 block truncate">
                    {menuItem.stall.name}
                  </span>
                  <p className="text-xs font-bold text-slate-900 truncate">{menuItem.name}</p>
                  <span className="text-xs font-semibold text-slate-500">₹{Number(menuItem.price).toFixed(2)}</span>
                </div>

                <div className="flex items-center space-x-2 shrink-0">
                  <button
                    onClick={() => updateQuantity(menuItem.id, -1)}
                    className="w-6 h-6 rounded-md bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="text-xs font-bold text-slate-900 w-4 text-center">{quantity}</span>
                  <button
                    onClick={() => updateQuantity(menuItem.id, 1)}
                    className="w-6 h-6 rounded-md bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Cart Summary & Checkout */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 space-y-3">
          <div className="space-y-1.5 text-xs text-slate-600">
            <div className="flex justify-between">
              <span>Items Subtotal:</span>
              <span className="font-semibold text-slate-900">₹{subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>GST (5%):</span>
              <span className="font-semibold text-slate-900">₹{taxAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm font-extrabold text-slate-900 pt-2 border-t border-slate-200">
              <span>Total Payable:</span>
              <span className="text-brand-600 text-lg">₹{totalAmount.toFixed(2)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={() => handlePlaceOrder(false)}
              disabled={cart.length === 0 || isSubmitting}
              className="py-2.5 px-3 rounded-xl border border-slate-300 hover:bg-white text-slate-800 text-xs font-bold transition disabled:opacity-50"
            >
              Send to Kitchen
            </button>
            <button
              onClick={() => handlePlaceOrder(true)}
              disabled={cart.length === 0 || isSubmitting}
              className="py-2.5 px-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold shadow-md shadow-brand-500/20 transition disabled:opacity-50 flex items-center justify-center space-x-1"
            >
              <span>Pay & Settle</span>
            </button>
          </div>
        </div>
      </div>

      {/* Payment Settlement Modal */}
      {activePaymentOrder && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-lg">Collect Order Payment</h3>
                <p className="text-xs text-slate-400">Order #{activePaymentOrder.order_number}</p>
              </div>
              <span className="text-xl font-extrabold text-brand-600">₹{activePaymentOrder.total_amount}</span>
            </div>

            {/* Payment Method Tabs */}
            <div className="grid grid-cols-3 gap-2 bg-slate-100 p-1 rounded-xl">
              <button
                onClick={() => setPaymentMethod('cash')}
                className={`py-2 rounded-lg text-xs font-bold transition ${
                  paymentMethod === 'cash' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                💵 Cash
              </button>
              <button
                onClick={() => setPaymentMethod('upi_qr')}
                className={`py-2 rounded-lg text-xs font-bold transition ${
                  paymentMethod === 'upi_qr' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                📱 UPI QR
              </button>
              <button
                onClick={() => setPaymentMethod('card')}
                className={`py-2 rounded-lg text-xs font-bold transition ${
                  paymentMethod === 'card' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                💳 Card
              </button>
            </div>

            {/* Cash Tender Calculation */}
            {paymentMethod === 'cash' && (
              <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Cash Tendered from Customer:
                  </label>
                  <input
                    type="number"
                    value={cashTendered}
                    onChange={(e) => setCashTendered(Number(e.target.value))}
                    className="w-full py-2 px-3 rounded-lg border border-slate-200 text-lg font-bold text-slate-900"
                  />
                </div>
                <div className="flex justify-between items-center text-sm pt-2 border-t border-slate-200 font-bold">
                  <span>Change Due to Return:</span>
                  <span className={`text-base ${cashTendered >= activePaymentOrder.total_amount ? 'text-emerald-600' : 'text-rose-600'}`}>
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
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-600/20"
              >
                Confirm Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settled Receipt Modal */}
      {settledReceipt && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-100 space-y-4">
            <div className="text-center border-b border-slate-100 pb-4">
              <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-2">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <h3 className="font-bold text-slate-900 text-lg">Payment Complete</h3>
              <p className="text-xs text-slate-500 font-mono">Invoice #{settledReceipt.order.order_number}</p>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl space-y-2 text-xs font-mono">
              <div className="flex justify-between">
                <span>Total Bill:</span>
                <span className="font-bold">₹{settledReceipt.order.total_amount}</span>
              </div>
              <div className="flex justify-between">
                <span>Payment Method:</span>
                <span className="uppercase">{settledReceipt.payment.payment_method}</span>
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
                className="flex-1 py-2 px-3 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 flex items-center justify-center space-x-1"
              >
                <Printer className="w-4 h-4 mr-1" />
                Print Bill
              </button>
              <button
                onClick={() => setSettledReceipt(null)}
                className="flex-1 py-2 px-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
