import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import {
  Store,
  ShoppingBag,
  Plus,
  Minus,
  Clock,
  ArrowRight,
  AlertCircle
} from 'lucide-react';

interface MenuItem {
  id: number;
  stall_id: number;
  name: string;
  description: string | null;
  price: string;
  is_veg: boolean;
  preparation_time_minutes: number;
  stallName?: string;
}

interface CartItem {
  item: MenuItem;
  stallName: string;
  quantity: number;
}

export const QrMenuPage: React.FC = () => {
  const { qrToken } = useParams<{ qrToken: string }>();
  const navigate = useNavigate();

  const [table, setTable] = useState<any | null>(null);
  const [stalls, setStalls] = useState<any[]>([]);
  const [selectedStallId, setSelectedStallId] = useState<number | 'all'>('all');
  const [vegOnly, setVegOnly] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMenu();
  }, [qrToken]);

  const loadMenu = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // If no token in URL, fetch first table for demonstration
      let tokenToUse = qrToken;
      if (!tokenToUse) {
        const tablesRes = await apiClient.get('/public/tables');
        if (tablesRes.data.data.length > 0) {
          tokenToUse = tablesRes.data.data[0].qr_token;
        }
      }

      const res = await apiClient.get(`/public/qr/${tokenToUse}`);
      if (res.data.success) {
        setTable(res.data.data.table);
        setStalls(res.data.data.stalls);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Unable to load menu. Please scan table QR again.');
    } finally {
      setIsLoading(false);
    }
  };

  const addToCart = (item: MenuItem, stallName: string) => {
    setCart((prev) => {
      const existing = prev.find((ci) => ci.item.id === item.id);
      if (existing) {
        return prev.map((ci) =>
          ci.item.id === item.id ? { ...ci, quantity: ci.quantity + 1 } : ci
        );
      }
      return [...prev, { item, stallName, quantity: 1 }];
    });
  };

  const updateQuantity = (itemId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((ci) => {
          if (ci.item.id === itemId) {
            const newQty = ci.quantity + delta;
            return newQty > 0 ? { ...ci, quantity: newQty } : null;
          }
          return ci;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const subtotal = cart.reduce((sum, ci) => sum + Number(ci.item.price) * ci.quantity, 0);
  const tax = subtotal * 0.05;
  const total = subtotal + tax;
  const totalItemCount = cart.reduce((sum, ci) => sum + ci.quantity, 0);

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0 || !table) return;

    setIsSubmitting(true);
    try {
      const payload = {
        table_id: table.id,
        order_type: 'dine_in',
        order_channel: 'qr_customer',
        customer_name: customerName || 'Dine-in Customer',
        customer_phone: customerPhone || null,
        items: cart.map((ci) => ({
          menu_item_id: ci.item.id,
          quantity: ci.quantity,
        })),
      };

      const res = await apiClient.post('/public/orders', payload);
      if (res.data.success) {
        const orderId = res.data.data.id;
        navigate(`/order/${orderId}`);
      }
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to submit order');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-900 text-white">
        <div className="w-12 h-12 bg-brand-500 rounded-2xl animate-bounce flex items-center justify-center mb-4">
          <Store className="w-6 h-6 text-white" />
        </div>
        <p className="font-semibold text-sm">Opening Food Court Menu...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50 text-center">
        <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mb-4">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h3 className="font-bold text-slate-900 text-lg">QR Verification Required</h3>
        <p className="text-sm text-slate-500 mt-2 max-w-xs">{error}</p>
        <button
          onClick={loadMenu}
          className="mt-6 px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-xl"
        >
          Try Again
        </button>
      </div>
    );
  }

  const activeStalls = selectedStallId === 'all' ? stalls : stalls.filter((s) => s.id === selectedStallId);

  return (
    <div className="min-h-screen bg-slate-100 pb-28 max-w-md mx-auto relative shadow-2xl overflow-x-hidden">
      {/* Top Table Header */}
      <header className="bg-slate-900 text-white p-5 sticky top-0 z-20 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-brand-500 flex items-center justify-center text-white font-bold">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-base leading-tight">Urban Food Court</h1>
              <p className="text-xs text-brand-400 font-medium">Table {table?.table_number} ({table?.section})</p>
            </div>
          </div>

          <button
            onClick={() => setVegOnly(!vegOnly)}
            className={`px-3 py-1 rounded-full text-xs font-bold transition flex items-center space-x-1 ${vegOnly ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-300'
              }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>Veg Only</span>
          </button>
        </div>

        {/* Stall Tabs Filter */}
        <div className="flex items-center space-x-2 overflow-x-auto mt-4 pb-1 no-scrollbar">
          <button
            onClick={() => setSelectedStallId('all')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${selectedStallId === 'all'
                ? 'bg-brand-500 text-white shadow-sm'
                : 'bg-slate-800 text-slate-400'
              }`}
          >
            All Stalls
          </button>
          {stalls.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedStallId(s.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${selectedStallId === s.id
                  ? 'bg-brand-500 text-white shadow-sm'
                  : 'bg-slate-800 text-slate-400'
                }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      </header>

      {/* Culinary Stalls & Dishes List */}
      <main className="p-4 space-y-6">
        {activeStalls.map((stall) => (
          <section key={stall.id} className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div>
                <h2 className="font-extrabold text-slate-900 text-base flex items-center space-x-1.5">
                  <span className="text-brand-600">●</span>
                  <span>{stall.name}</span>
                </h2>
                <p className="text-[11px] text-slate-400">{stall.description}</p>
              </div>
            </div>

            <div className="space-y-3">
              {stall.categories?.map((cat: any) => {
                const itemsToRender = cat.menu_items?.filter((item: MenuItem) => !vegOnly || item.is_veg) || [];
                if (itemsToRender.length === 0) return null;

                return (
                  <div key={cat.id} className="space-y-2.5">
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">{cat.name}</h3>

                    <div className="space-y-2">
                      {itemsToRender.map((dish: MenuItem) => {
                        const inCart = cart.find((ci) => ci.item.id === dish.id);
                        return (
                          <div
                            key={dish.id}
                            className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm flex items-start justify-between space-x-3"
                          >
                            <div className="flex-1">
                              <div className="flex items-center space-x-1.5 mb-1">
                                <span
                                  className={`w-2.5 h-2.5 rounded-sm border ${dish.is_veg
                                      ? 'border-emerald-600 bg-emerald-500'
                                      : 'border-rose-600 bg-rose-500'
                                    }`}
                                />
                                <span className="text-[10px] font-bold text-slate-400 uppercase">
                                  {dish.is_veg ? 'Veg' : 'Non-Veg'}
                                </span>
                              </div>

                              <h4 className="font-bold text-slate-900 text-sm leading-snug">{dish.name}</h4>
                              {dish.description && (
                                <p className="text-xs text-slate-500 mt-1 line-clamp-2">{dish.description}</p>
                              )}

                              <div className="flex items-center space-x-3 mt-2 text-xs">
                                <span className="font-extrabold text-slate-900 text-base">
                                  ₹{Number(dish.price).toFixed(2)}
                                </span>
                                <span className="text-slate-400 flex items-center text-[11px]">
                                  <Clock className="w-3 h-3 mr-0.5" />
                                  {dish.preparation_time_minutes}m
                                </span>
                              </div>
                            </div>

                            {/* Add / Quantity Control */}
                            <div className="shrink-0 pt-1">
                              {inCart ? (
                                <div className="flex items-center space-x-1.5 bg-brand-50 border border-brand-200 rounded-xl p-1">
                                  <button
                                    onClick={() => updateQuantity(dish.id, -1)}
                                    className="w-7 h-7 bg-white text-brand-600 rounded-lg flex items-center justify-center font-bold shadow-sm"
                                  >
                                    <Minus className="w-3.5 h-3.5" />
                                  </button>
                                  <span className="text-xs font-bold text-brand-900 w-5 text-center">
                                    {inCart.quantity}
                                  </span>
                                  <button
                                    onClick={() => updateQuantity(dish.id, 1)}
                                    className="w-7 h-7 bg-brand-500 text-white rounded-lg flex items-center justify-center font-bold shadow-sm"
                                  >
                                    <Plus className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => addToCart(dish, stall.name)}
                                  className="px-3.5 py-1.5 bg-brand-50 hover:bg-brand-100 text-brand-700 font-bold text-xs rounded-xl border border-brand-200 shadow-sm transition"
                                >
                                  ADD
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </main>

      {/* Floating Bottom Cart Bar */}
      {cart.length > 0 && (
        <div className="fixed bottom-4 left-4 right-4 max-w-md mx-auto z-30">
          <div
            onClick={() => setIsCartOpen(true)}
            className="bg-slate-900 text-white p-3.5 rounded-2xl shadow-2xl flex items-center justify-between cursor-pointer border border-slate-800"
          >
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-brand-500 flex items-center justify-center text-white">
                <ShoppingBag className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs text-slate-400 block">{totalItemCount} items selected</span>
                <span className="font-extrabold text-base text-white">₹{total.toFixed(2)}</span>
              </div>
            </div>

            <button className="px-4 py-2 bg-brand-500 text-white font-bold text-xs rounded-xl flex items-center space-x-1 shadow-md">
              <span>View Cart</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Checkout Drawer Modal */}
      {isCartOpen && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex flex-col justify-end">
          <div className="bg-white rounded-t-3xl max-w-md w-full mx-auto p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-extrabold text-slate-900 text-lg">Your Food Court Order</h3>
                <p className="text-xs text-brand-600 font-semibold">Table {table?.table_number}</p>
              </div>
              <button
                onClick={() => setIsCartOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold"
              >
                ✕
              </button>
            </div>

            {/* Cart Items List */}
            <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto pr-1 space-y-2">
              {cart.map(({ item, stallName, quantity }) => (
                <div key={item.id} className="pt-2 flex justify-between items-center text-xs">
                  <div>
                    <span className="text-[10px] font-bold text-brand-600 block">{stallName}</span>
                    <span className="font-bold text-slate-900 text-sm">{item.name}</span>
                    <span className="text-slate-500 block">₹{item.price} each</span>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => updateQuantity(item.id, -1)}
                      className="w-6 h-6 rounded-md bg-slate-100 text-slate-700 flex items-center justify-center font-bold"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="font-bold text-slate-900">{quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.id, 1)}
                      className="w-6 h-6 rounded-md bg-brand-500 text-white flex items-center justify-center font-bold"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Customer Contact */}
            <form onSubmit={handleSubmitOrder} className="space-y-3 pt-2 border-t border-slate-100">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Your Name</label>
                <input
                  type="text"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="e.g. Aditya"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Phone Number (Optional)</label>
                <input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="e.g. 9876543210"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold"
                />
              </div>

              {/* Bill Details */}
              <div className="bg-slate-50 p-3.5 rounded-xl space-y-1.5 text-xs text-slate-600 font-medium">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span className="font-bold text-slate-900">₹{subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>GST (5%):</span>
                  <span className="font-bold text-slate-900">₹{tax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm font-extrabold text-slate-900 pt-1 border-t border-slate-200">
                  <span>Total Payable:</span>
                  <span className="text-brand-600">₹{total.toFixed(2)}</span>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 bg-brand-500 hover:bg-brand-600 text-white font-extrabold text-sm rounded-xl shadow-lg shadow-brand-500/30 flex items-center justify-center space-x-2 transition disabled:opacity-50"
              >
                <span>{isSubmitting ? 'Placing Order...' : 'Confirm & Send to Kitchens'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
