import React, { useEffect, useRef, useState } from 'react';
import { statusChip } from '../lib/status';
import { apiClient } from '../api/client';
import { PrintReceiptButton, ReceiptPreviewButton } from '../components/Receipt';
import { UpiQr } from '../components/UpiQr';
import { isValidVpa } from '../lib/receiptModel';
import { calculateTax, taxLines } from '../lib/tax';
import { useSettings } from '../context/SettingsContext';
import { apiError } from '../lib/format';
import { sound } from '../lib/sound/index';
import { PrintOrderKotButton } from '../components/PrintKotButtons';
import { upiConfigWarnings, upiStatusView } from '../lib/upiStatus';
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
  cash: { label: 'Cash', icon: Banknote, color: 'text-success-fg' },
  upi_qr: { label: 'UPI QR', icon: QrCode, color: 'text-info-fg' },
  card: { label: 'Card POS', icon: CreditCard, color: 'text-info-fg' },
  split: { label: 'Split', icon: Wallet, color: 'text-muted' },
};

export const PosPage: React.FC = () => {
  const { settings } = useSettings();
  const enabledMethods = settings.payment_methods.enabled;
  const [posMode, setPosMode] = useState<'new_order' | 'pending_bills'>('new_order');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerHint, setCustomerHint] = useState<string | null>(null);
  const [saveCustomer, setSaveCustomer] = useState(false);
  const [orderNotes, setOrderNotes] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [kotOrderId, setKotOrderId] = useState<number | null>(null); // last order sent to the kitchen, for the paper-KOT button
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
  // UPI QR: a payment REQUEST for this bill. The bill stays unpaid until the cashier verifies the money.
  const [upiRequest, setUpiRequest] = useState<{ reference: string; vpa: string; amount: string; upi_uri: string; status: string } | null>(null);
  const [upiNonce, setUpiNonce] = useState(0); // bumped to ask the server for a fresh QR after a failed/cancelled one
  const [upiBusy, setUpiBusy] = useState(false);
  const [upiLoading, setUpiLoading] = useState(false);
  const [upiError, setUpiError] = useState<string | null>(null);
  const [upiUtr, setUpiUtr] = useState('');
  const [upiVerified, setUpiVerified] = useState(false);
  const upiConfigured = !!(settings.upi?.enabled && settings.upi.vpa && isValidVpa(settings.upi.vpa));
  const upiMode = paymentMethod === 'upi_qr' && upiConfigured;
  // The bank reference (UTR) is optional; if the cashier types one it must be 6-40 letters/digits.
  const upiUtrValid = upiUtr.trim() === '' || /^[A-Za-z0-9]{6,40}$/.test(upiUtr.trim());

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

  // Display estimate only: the server prices the order. Same rules and same Food Court Settings as the server
  // (GST on/off, rate, inclusive/exclusive), so the cart, the payment amount and the receipt agree.
  const itemsTotal = cart.reduce(
    (sum, item) => sum + Number(item.menuItem.price) * item.quantity,
    0
  );
  const estimate = calculateTax(itemsTotal, settings.tax);
  const estimateLines = taxLines(estimate);
  const total = Number(estimate.total_amount);

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
    setUpiRequest(null);
    setUpiError(null);
    setUpiUtr('');
    setUpiVerified(false);
    setPaymentMethod((enabledMethods[0] as any) || 'cash');
    setCashTendered(Number(order.total_amount));
    setActivePaymentOrder(order);
  };

  // Generate (or reuse) the QR for the bill being paid. The server computes the amount from the order itself.
  const payingOrderId = activePaymentOrder?.id;
  const upiVpa = settings.upi?.vpa;
  useEffect(() => {
    if (!payingOrderId || !upiMode) {
      setUpiRequest(null);
      return;
    }
    let cancelled = false;
    setUpiLoading(true);
    setUpiError(null);
    apiClient
      .post(`/billing/orders/${payingOrderId}/upi-request`)
      .then((res) => !cancelled && setUpiRequest(res.data.data))
      .catch((err) => {
        if (cancelled) return;
        setUpiRequest(null);
        setUpiError(apiError(err, 'Could not create the UPI QR for this bill.'));
      })
      .finally(() => !cancelled && setUpiLoading(false));
    return () => {
      cancelled = true;
    };
  }, [payingOrderId, upiMode, upiVpa, upiNonce]);

  // Record what happened with the QR. These are notes only: none of them marks the bill paid.
  const markUpi = async (status: 'initiated' | 'failed' | 'cancelled') => {
    if (!upiRequest || upiBusy) return;
    setUpiBusy(true);
    setUpiError(null);
    try {
      const res = await apiClient.post(`/billing/upi-requests/${upiRequest.reference}/status`, { status });
      if (status === 'initiated') {
        setUpiRequest(res.data.data);
      } else {
        // Closed without payment: that QR can never settle this bill; show a brand-new one (new reference)
        setUpiRequest(null);
        setUpiVerified(false);
        setUpiUtr('');
        setUpiNonce((n) => n + 1);
      }
    } catch (err) {
      setUpiError(apiError(err, 'Could not update the UPI request.'));
    } finally {
      setUpiBusy(false);
    }
  };

  const handleCreateOrder = async (autoPay: boolean = false) => {
    if (cart.length === 0 || isSubmitting) return;
    if (orderType === 'dine_in' && !selectedTableId) {
      setNotice({ ok: false, text: 'Select a dining table for a dine-in order.' });
      return;
    }

    setIsSubmitting(true);
    setNotice(null);
    setKotOrderId(null);
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
          setKotOrderId(createdOrder.id);
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
        ...(upiMode && upiRequest
          ? { upi_reference: upiRequest.reference, payment_verified: upiVerified, ...(upiUtr.trim() ? { transaction_reference: upiUtr.trim() } : {}) }
          : {}),
      });

      if (res.data.success) {
        setSettledReceipt(res.data.data);
        setActivePaymentOrder(null);
        // Same key as the owner's "payment" notification, so one payment is one chime on any screen
        void sound.play('payment_success', { key: `payment:${res.data.data?.payment?.id ?? activePaymentOrder.id}` });
        loadData();
        loadPendingBills();
      }
    } catch (err: any) {
      setPayError(apiError(err, 'Payment processing failed.'));
      void sound.play('payment_failed');
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
    <div className="flex flex-col h-[calc(100vh-3rem)] overflow-hidden bg-surface-2">
      {/* Top POS Mode Navigation Bar */}
      <div className="bg-surface px-4 py-1.5 flex items-center justify-between border-b border-line">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setPosMode('new_order')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center space-x-2 ${
              posMode === 'new_order'
                ? 'bg-primary text-primary-fg shadow-md'
                : 'text-muted hover:text-fg hover:bg-surface-2'
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
            className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center space-x-2 ${
              posMode === 'pending_bills'
                ? 'bg-primary text-primary-fg shadow-md'
                : 'text-muted hover:text-fg hover:bg-surface-2'
            }`}
          >
            <Receipt className="w-4 h-4" />
            <span>Pending Table Bills</span>
            <span className={`ml-1.5 px-2 py-0.5 rounded-full text-[10px] font-black ${posMode === 'pending_bills' ? 'bg-primary-fg/20 text-primary-fg' : 'bg-surface-2 text-fg'}`}>
              {pendingBills.length}
            </span>
          </button>
        </div>

        <div className="flex items-center space-x-3 text-xs">
          <button
            onClick={loadPendingBills}
            className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-surface-2 transition"
            title="Refresh Pending Orders"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingPending ? 'animate-spin text-primary' : ''}`} />
          </button>
          <span className="text-muted font-mono">
            {pendingBills.length} Unpaid Bill{pendingBills.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* POS Screen Content */}
      {posMode === 'pending_bills' ? (
        /* ================= PENDING TABLE BILLS VIEW ================= */
        <div className="flex-1 p-4 overflow-y-auto space-y-4">
          <div className="flex items-center justify-between bg-surface p-4 rounded-lg border border-line shadow-sm">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-subtle absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search by order #, table #, or guest name..."
                value={pendingSearch}
                onChange={(e) => setPendingSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-lg border border-line text-xs font-medium focus:outline-none focus:ring-2 focus:ring-focus"
              />
            </div>
            <p className="text-xs text-muted font-medium">
              Click <span className="font-bold text-fg">Settle Bill</span> to collect payment from guests and print receipt
            </p>
          </div>

          {filteredPendingBills.length === 0 ? (
            <div className="bg-surface rounded-lg px-4 py-8 text-center border border-line max-w-md mx-auto mt-8 space-y-3">
              <div className="w-16 h-16 bg-st-served-soft text-st-served-fg rounded-lg flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="font-semibold text-base text-fg">All Table Bills Settled</h3>
              <p className="text-xs text-muted">
                There are no outstanding table or takeaway orders awaiting payment.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredPendingBills.map((bill) => (
                <div
                  key={bill.id}
                  className="bg-surface rounded-lg p-3 border border-line shadow-sm hover:border-primary transition flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span className="px-2.5 py-1 rounded-lg text-xs font-extrabold bg-surface-2 text-fg border border-line">
                          {bill.table ? `Table ${bill.table.table_number}` : 'Takeaway'}
                        </span>
                        <span className="text-xs font-mono font-bold text-muted">
                          #{bill.order_number}
                        </span>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${statusChip(bill.status)}`}>
                        {bill.status}
                      </span>
                    </div>

                    <div className="text-xs text-muted flex items-center justify-between">
                      <span className="flex items-center">
                        <Clock className="w-3.5 h-3.5 mr-1 text-subtle" />
                        {new Date(bill.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-[11px] font-semibold text-muted">
                        Via: {bill.order_channel === 'qr_customer' ? '📱 Table QR' : bill.order_channel === 'waiter_app' ? '🧑‍🍳 Waiter App' : '🖥️ Counter POS'}
                      </span>
                    </div>

                    {/* Stalls badges */}
                    <div className="flex flex-wrap gap-1">
                      {bill.kitchen_tickets?.map((t: any) => (
                        <span
                          key={t.id}
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${statusChip(t.status)}`}
                        >
                          {t.stall?.code || 'STALL'}: {t.status}
                        </span>
                      ))}
                    </div>

                    {/* Items List */}
                    <div className="bg-canvas p-2.5 rounded-lg space-y-1 text-xs">
                      {bill.items?.map((it: any) => (
                        <div key={it.id} className="flex justify-between text-fg">
                          <span>{it.quantity}× {it.item_name}</span>
                          <span className="font-semibold text-fg">₹{it.subtotal}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Bill Total & Settle Button */}
                  <div className="mt-4 pt-3 border-t border-line flex items-center justify-between">
                    <div>
                      <span className="text-[11px] text-muted block font-medium">Total Payable</span>
                      <span className="text-2xl font-black text-fg tabular-nums">₹{Number(bill.total_amount).toFixed(2)}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      {!bill.kitchen_tickets?.some((t: any) => ['preparing', 'ready', 'picked_up'].includes(t.status)) && (
                        <button
                          onClick={() => {
                            setCancelError(null);
                            setCancelReason('');
                            setCancelBill(bill);
                          }}
                          className="px-3 py-2 text-danger-fg hover:bg-danger/10 rounded-lg text-xs font-bold"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        onClick={() => openPayment(bill)}
                        data-settle-order={bill.order_number}
                        className="px-4 py-2 bg-success-fg hover:opacity-90 text-surface rounded-lg text-xs font-extrabold shadow-sm flex items-center space-x-1.5 transition"
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
          <div className="flex-1 flex flex-col min-w-0 border-r border-line bg-surface">
            {/* Top Controls: Search & Stall Filters */}
            <div className="p-4 border-b border-line space-y-3 bg-surface">
              <div className="flex items-center space-x-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-subtle absolute left-3 top-3" />
                  <input
                    ref={searchInput}
                    type="text"
                    aria-label="Search menu"
                    placeholder="Search food, beverages, or stalls… (F2)"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 rounded-lg border border-line text-sm focus:outline-none focus:ring-2 focus:ring-focus"
                  />
                </div>
              </div>

              {/* Stall Selector Tabs */}
              <div className="flex items-center space-x-2 overflow-x-auto pb-1">
                <button
                  onClick={() => setSelectedStallId('all')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                    selectedStallId === 'all'
                      ? 'bg-primary text-primary-fg'
                      : 'bg-surface-2 text-muted hover:bg-line'
                  }`}
                >
                  All Stalls ({menuItems.length})
                </button>
                {stalls.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedStallId(s.id)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition flex items-center space-x-1.5 ${
                      selectedStallId === s.id
                        ? 'bg-primary text-primary-fg shadow-sm'
                        : 'bg-surface-2 text-muted hover:bg-line'
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
                    className="p-3 min-h-[40px] rounded-lg border border-line hover:border-primary bg-surface hover:shadow-md cursor-pointer transition flex flex-col justify-between group"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-semibold text-primary truncate max-w-[120px]">
                          {item.stall.name}
                        </span>
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            item.is_veg ? 'bg-success-fg' : 'bg-danger'
                          }`}
                          title={item.is_veg ? 'Vegetarian' : 'Non-Vegetarian'}
                        />
                      </div>
                      <h4 className="font-bold text-fg text-sm leading-snug group-hover:text-primary transition">
                        {item.name}
                      </h4>
                      <p className="text-xs text-muted mt-1 line-clamp-2">{item.category.name}</p>
                    </div>

                    <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-line">
                      <span className="font-extrabold text-fg text-sm">
                        ₹{Number(item.price).toFixed(2)}
                      </span>
                      <button className="w-7 h-7 rounded-lg bg-surface-2 group-hover:bg-primary group-hover:text-primary-fg flex items-center justify-center transition">
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Consolidated Cart Column */}
          <div className="w-96 flex flex-col bg-surface shrink-0 border-l border-line">
            {/* Order Type & Table Selection */}
            <div className="p-4 border-b border-line space-y-3">
              <div className="grid grid-cols-2 gap-2 bg-surface-2 p-1 rounded-lg">
                <button
                  onClick={() => setOrderType('dine_in')}
                  className={`py-1.5 rounded-lg text-xs font-semibold transition ${
                    orderType === 'dine_in'
                      ? 'bg-surface text-fg shadow-sm'
                      : 'text-muted hover:text-fg'
                  }`}
                >
                  Dine-In
                </button>
                <button
                  onClick={() => setOrderType('takeaway')}
                  className={`py-1.5 rounded-lg text-xs font-semibold transition ${
                    orderType === 'takeaway'
                      ? 'bg-surface text-fg shadow-sm'
                      : 'text-muted hover:text-fg'
                  }`}
                >
                  Takeaway
                </button>
              </div>

              {/* Table Selector */}
              {orderType === 'dine_in' && (
                <div>
                  <label className="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">
                    Select Dining Table
                  </label>
                  <select
                    aria-label="Dining table"
                    value={selectedTableId}
                    onChange={(e) => setSelectedTableId(Number(e.target.value))}
                    className="w-full py-1.5 px-3 rounded-lg border border-line text-xs font-medium focus:ring-2 focus:ring-focus"
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
                  className="py-1.5 px-3 rounded-lg border border-line text-xs"
                />
                <input
                  aria-label="Customer name"
                  placeholder="Customer name"
                  value={customerName}
                  maxLength={100}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="py-1.5 px-3 rounded-lg border border-line text-xs"
                />
              </div>
              {customerHint && (
                <div className="flex items-center justify-between text-[11px] text-muted">
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
                className="w-full py-1.5 px-3 rounded-lg border border-line text-xs"
              />
            </div>

            {/* Cart Items List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-muted space-y-2">
                  <Store className="w-10 h-10 opacity-30" />
                  <p className="text-xs font-medium">Cart is empty. Select items to order.</p>
                </div>
              ) : (
                cart.map((ci) => (
                  <div
                    key={ci.menuItem.id}
                    className="p-3 bg-canvas rounded-lg flex items-center justify-between border border-line"
                  >
                    <div className="flex-1 min-w-0 pr-2">
                      <h5 className="font-bold text-fg text-xs truncate">{ci.menuItem.name}</h5>
                      <span className="text-[10px] text-primary font-semibold">{ci.menuItem.stall.name}</span>
                      <div className="text-xs font-bold text-fg mt-1">
                        ₹{(Number(ci.menuItem.price) * ci.quantity).toFixed(2)}
                      </div>
                    </div>

                    <div className="flex items-center space-x-1.5 bg-surface border border-line rounded-lg p-0.5">
                      <button
                        onClick={() => updateQuantity(ci.menuItem.id, -1)}
                        className="w-6 h-6 rounded flex items-center justify-center text-muted hover:bg-surface-2"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="text-xs font-bold w-5 text-center">{ci.quantity}</span>
                      <button
                        onClick={() => updateQuantity(ci.menuItem.id, 1)}
                        className="w-6 h-6 rounded flex items-center justify-center text-muted hover:bg-surface-2"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Cart Footer & Financial Summary */}
            <div className="p-4 border-t border-line bg-canvas space-y-3">
              <div className="space-y-1.5 text-xs">
                {estimateLines.map((line) => (
                  <div key={line.label} data-testid="cart-tax-line" className="flex justify-between text-muted">
                    <span>{line.label}:</span>
                    <span className="font-semibold text-fg">₹{line.value}</span>
                  </div>
                ))}
                <div className="flex justify-between items-baseline text-sm font-extrabold text-fg pt-1.5 border-t border-line">
                  <span>Grand Total:</span>
                  <span className="text-primary text-2xl font-black tabular-nums">₹{total.toFixed(2)}</span>
                </div>
              </div>

              {notice && (
                <div role={notice.ok ? 'status' : 'alert'} className={`text-[11px] rounded-lg p-2 ${notice.ok ? 'bg-st-served-soft text-st-served-fg' : 'bg-danger/10 text-danger-fg'}`}>
                  {notice.text}
                </div>
              )}
              {notice?.ok && kotOrderId && (
                <div className="flex flex-wrap gap-2">
                  <PrintOrderKotButton orderId={kotOrderId} label="Print KOTs" className="px-3 py-1.5 border border-line rounded-lg text-xs font-bold text-fg hover:bg-surface-2" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  disabled={cart.length === 0 || isSubmitting}
                  onClick={() => handleCreateOrder(false)}
                  className="py-2 px-3 rounded-lg border border-line font-bold text-xs text-fg hover:bg-surface transition disabled:opacity-50"
                >
                  {isSubmitting ? 'Sending…' : 'Send to Kitchen (F4)'}
                </button>
                <button
                  disabled={cart.length === 0 || isSubmitting}
                  onClick={() => handleCreateOrder(true)}
                  className="py-2 px-3 rounded-lg bg-primary hover:bg-primary/90 text-primary-fg font-extrabold text-xs shadow-md shadow-primary/20 transition disabled:opacity-50"
                >
                  Send & Pay (F8) ➔
                </button>
              </div>
              <p className="text-[10px] text-muted text-center">F2 search · F9 pending bills · Esc close</p>

              {cart.length > 0 && (
                <button
                  onClick={clearCart}
                  className="w-full text-center text-[11px] text-muted hover:text-danger-fg pt-1 transition"
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
        <div className="fixed inset-0 !m-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4">
          {/* Header and action buttons stay put; only the middle scrolls, so the dialog never overflows the window */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Consolidated bill settlement"
            className="bg-surface rounded-xl w-full max-w-md max-h-[calc(100vh-1.5rem)] flex flex-col shadow-2xl border border-line overflow-hidden"
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h3 className="font-semibold text-base text-fg leading-tight">Consolidated Bill Settlement</h3>
                <p className="mt-0.5 text-xs text-muted font-mono break-all">
                  Order #{activePaymentOrder.order_number} • {activePaymentOrder.table ? `Table ${activePaymentOrder.table.table_number}` : 'Takeaway'}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setActivePaymentOrder(null)}
                className="shrink-0 -mr-1 -mt-1 w-8 h-8 rounded-lg text-muted hover:text-fg hover:bg-surface-2 text-base font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-5 py-4 space-y-4">
            {/* Bill Summary */}
            <div className="bg-canvas px-4 py-3 rounded-lg border border-line">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-bold text-fg">Total Bill Amount</span>
                <span className="text-2xl font-black text-primary tabular-nums">₹{Number(activePaymentOrder.total_amount).toFixed(2)}</span>
              </div>
              <div className="mt-1 text-[11px] text-muted">
                Covers {activePaymentOrder.items?.length || 0} dishes across participating kitchens
              </div>
            </div>

            {/* Payment Method Selector */}
            <div>
              <label className="block text-xs font-bold text-fg mb-2">Select Tender Method</label>
              {/* Only the methods the owner enabled in Food Court Settings */}
              {/* One even row for up to 4 methods (a 3-column grid left the 4th button orphaned on its own row) */}
              <div className={`grid gap-2 ${enabledMethods.length >= 4 ? 'grid-cols-2 sm:grid-cols-4' : enabledMethods.length === 3 ? 'grid-cols-3' : enabledMethods.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {enabledMethods.map((m) => {
                  const meta = METHOD_META[m] || METHOD_META.split;
                  const Icon = meta.icon;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPaymentMethod(m)}
                      aria-pressed={paymentMethod === m}
                      className={`px-2 py-3 min-w-0 rounded-lg border text-xs font-bold flex flex-col items-center justify-center gap-1.5 transition ${
                        paymentMethod === m ? 'border-primary bg-primary/10 text-primary shadow-sm ring-1 ring-primary' : 'border-line text-muted hover:bg-surface-2'
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
              <div className="bg-canvas p-4 rounded-lg border border-line space-y-2">
                <label className="block text-xs font-bold text-fg">Cash Received from Guest</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-muted font-bold text-sm">₹</span>
                  <input
                    type="number"
                    step="1"
                    value={cashTendered || ''}
                    onChange={(e) => setCashTendered(Number(e.target.value))}
                    className="w-full pl-8 pr-3 py-2 border border-line rounded-lg text-sm font-bold text-fg focus:outline-none focus:ring-2 focus:ring-focus"
                    placeholder="e.g. 500"
                  />
                </div>
                <div className="flex justify-between items-center text-xs pt-2 border-t border-line font-bold">
                  <span>Change to Return:</span>
                  <span className={`text-base tabular-nums ${cashTendered >= activePaymentOrder.total_amount ? 'text-success-fg font-black' : 'text-danger-fg'}`}>
                    ₹{Math.max(0, cashTendered - Number(activePaymentOrder.total_amount)).toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            {paymentMethod === 'upi_qr' && !upiConfigured && (
              <div data-testid="upi-not-configured" className="bg-canvas p-3 rounded-lg border border-line text-xs text-muted">
                UPI QR is not set up, so no payment QR can be shown. Ask the owner to add the UPI ID and enable UPI QR payments in Food Court Settings.
                You can still record a UPI payment you have already received.
              </div>
            )}

            {/* UPI QR: a payment request for exactly this bill. It is NOT proof of payment. */}
            {upiMode && (
              <div data-testid="upi-panel" className="bg-canvas p-4 rounded-lg border border-line space-y-4">
                {upiConfigWarnings(settings.upi?.vpa, settings.upi?.check).map((w) => (
                  <p key={w.code} role="alert" data-testid={`upi-pos-warning-${w.code}`} className={`text-[11px] leading-snug ${w.level === 'danger' ? 'text-danger-fg' : 'text-warning-fg'}`}>
                    <strong>{w.title}</strong> {w.text}
                  </p>
                ))}
                {upiLoading && <p className="text-xs text-muted text-center">Generating UPI QR…</p>}
                {upiError && (
                  <p role="alert" data-testid="upi-error" className="text-xs text-danger-fg">
                    {upiError}
                  </p>
                )}
                {upiRequest && (
                  <>
                    <div className="flex flex-col items-center gap-3">
                      <p className="text-xs font-bold text-fg text-center">Customer scans this QR to pay</p>
                      {/* Fixed black-on-white square with its own quiet zone: stays sharp and scannable in every theme */}
                      <div className="rounded-lg border border-line p-1.5 shadow-sm" style={{ background: '#fff', maxWidth: '100%' }}>
                        <UpiQr text={upiRequest.upi_uri} sizePx={200} />
                      </div>
                    </div>

                    <dl className="rounded-lg border border-line bg-surface divide-y divide-line text-xs">
                      <div className="flex items-baseline justify-between gap-3 px-3 py-2">
                        <dt className="text-muted shrink-0">UPI ID</dt>
                        <dd data-testid="upi-panel-vpa" className="font-mono font-semibold text-fg break-all text-right">{upiRequest.vpa}</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3 px-3 py-2">
                        <dt className="text-muted shrink-0">Payable amount</dt>
                        <dd data-testid="upi-panel-amount" className="text-base font-black text-primary tabular-nums">₹{Number(upiRequest.amount).toFixed(2)}</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3 px-3 py-2">
                        <dt className="text-muted shrink-0">Order reference</dt>
                        <dd data-testid="upi-panel-ref" className="font-mono text-fg break-all text-right">{upiRequest.reference}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-3 px-3 py-2">
                        <dt className="text-muted shrink-0">Payment status</dt>
                        <dd data-testid="upi-panel-status" data-status={upiRequest.status} className="inline-flex items-center gap-1.5 rounded-full border border-st-ready bg-st-ready-soft px-2 py-0.5 text-[11px] font-bold text-st-ready-fg">
                          <span aria-hidden="true">●</span> {upiStatusView(upiRequest.status).label}
                        </dd>
                      </div>
                    </dl>

                    <div className="text-[11px] leading-snug text-st-ready-fg bg-st-ready-soft border border-st-ready rounded-lg p-2.5">
                      <strong>Payment is still PENDING.</strong> A scanned or shown QR, an opened UPI app, or a customer's screenshot is not proof of payment. Open the merchant UPI app or bank statement, find
                      a credit of exactly ₹{Number(upiRequest.amount).toFixed(2)}, then tick the confirmation below. You can also note its UPI transaction / UTR number.
                    </div>

                    <div className="flex flex-wrap gap-2" data-testid="upi-lifecycle">
                      {upiRequest.status === 'pending' && (
                        <button type="button" data-testid="upi-mark-initiated" onClick={() => markUpi('initiated')} disabled={upiBusy} className="px-2.5 py-1.5 border border-line rounded-lg text-[11px] font-bold text-fg hover:bg-surface-2 disabled:opacity-50">
                          Customer started paying
                        </button>
                      )}
                      <button type="button" data-testid="upi-mark-failed" onClick={() => markUpi('failed')} disabled={upiBusy} className="px-2.5 py-1.5 border border-line rounded-lg text-[11px] font-bold text-fg hover:bg-surface-2 disabled:opacity-50">
                        Payment failed - new QR
                      </button>
                      <button type="button" data-testid="upi-mark-cancelled" onClick={() => markUpi('cancelled')} disabled={upiBusy} className="px-2.5 py-1.5 border border-line rounded-lg text-[11px] font-bold text-fg hover:bg-surface-2 disabled:opacity-50">
                        Customer cancelled - new QR
                      </button>
                    </div>

                    <Field label="UPI transaction / UTR number (optional)">
                      <input
                        data-testid="upi-utr"
                        className={`${inputClass} font-mono tracking-wide`}
                        value={upiUtr}
                        onChange={(e) => setUpiUtr(e.target.value.replace(/\s/g, ''))}
                        placeholder="Optional, e.g. 412345678901"
                        aria-invalid={!upiUtrValid}
                        autoComplete="off"
                        inputMode="text"
                        maxLength={40}
                      />
                    </Field>

                    <label className="flex items-start gap-2.5 rounded-lg border border-line bg-surface p-3 text-xs leading-snug text-fg cursor-pointer">
                      <input data-testid="upi-verified" type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={upiVerified} onChange={(e) => setUpiVerified(e.target.checked)} />
                      <span>I have verified that ₹{Number(upiRequest.amount).toFixed(2)} was received in the merchant account for this bill. (Recorded as a manual verification by me; this is not an automatic bank confirmation.)</span>
                    </label>
                  </>
                )}
              </div>
            )}

            {payError && (
              <div role="alert" className="p-2.5 rounded-lg bg-danger/10 border border-danger/30 text-danger-fg text-xs">
                {payError}
              </div>
            )}
            </div>

            <div className="grid grid-cols-[1fr_2fr] gap-3 border-t border-line bg-surface px-5 py-3">
              <button
                type="button"
                onClick={() => setActivePaymentOrder(null)}
                disabled={isPaying}
                className="py-2.5 rounded-lg border border-line text-xs font-semibold text-muted hover:bg-surface-2 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmPayment}
                disabled={
                  isPaying ||
                  (paymentMethod === 'cash' && cashTendered < Number(activePaymentOrder.total_amount)) ||
                  (upiMode && (!upiRequest || !upiUtrValid || !upiVerified))
                }
                className="py-2.5 rounded-lg bg-success-fg hover:opacity-90 text-surface text-xs font-extrabold shadow-md shadow-success/20 disabled:opacity-50"
              >
                {isPaying ? 'Processing…' : 'Confirm Payment & Settle'}
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelBill && (
        <Modal title={`Cancel order ${cancelBill.order_number}`} onClose={() => setCancelBill(null)} onSubmit={submitCancel} submitLabel="Cancel order" error={cancelError}>
          <p className="text-sm text-muted">All stall tickets for this order are cancelled. Orders already being prepared cannot be cancelled.</p>
          <Field label="Reason (recorded in the audit log)">
            <input required autoFocus minLength={3} maxLength={255} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className={inputClass} />
          </Field>
        </Modal>
      )}

      {/* ================= SETTLED RECEIPT MODAL ================= */}
      {settledReceipt && (
        <div className="fixed inset-0 !m-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-lg max-w-sm w-full p-4 shadow-2xl border border-line space-y-4">
            <div className="text-center border-b border-line pb-4">
              <div className="w-12 h-12 bg-st-served-soft text-st-served-fg rounded-full flex items-center justify-center mx-auto mb-2">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <h3 className="font-semibold text-base text-fg">Bill Settled Successfully</h3>
              <p className="text-xs text-muted font-mono">Invoice #{settledReceipt.order.order_number}</p>
            </div>

            <div className="bg-canvas p-4 rounded-lg space-y-2 text-xs font-mono">
              <div className="flex justify-between">
                <span>Total Amount:</span>
                <span className="text-base font-black text-fg">₹{settledReceipt.order.total_amount}</span>
              </div>
              <div className="flex justify-between">
                <span>Payment Method:</span>
                <span className="uppercase font-bold text-fg">{settledReceipt.payment.payment_method}</span>
              </div>
              {settledReceipt.change_returned > 0 && (
                <div className="flex justify-between text-success-fg font-bold pt-1 border-t border-line">
                  <span>Change Returned:</span>
                  <span>₹{Number(settledReceipt.change_returned).toFixed(2)}</span>
                </div>
              )}
            </div>

            <div className="flex space-x-2 pt-2">
              <ReceiptPreviewButton
                orderId={settledReceipt.order.id}
                label="Preview"
                className="flex-1 py-2 px-3 border border-line rounded-lg text-xs font-bold text-fg flex items-center justify-center space-x-1 hover:bg-surface-2"
              />
              <PrintReceiptButton
                orderId={settledReceipt.order.id}
                label="Print Receipt"
                className="flex-1 py-2 px-3 border border-line rounded-lg text-xs font-bold text-fg flex items-center justify-center space-x-1 hover:bg-surface-2"
              />
              <PrintOrderKotButton
                orderId={settledReceipt.order.id}
                label="Print KOTs"
                className="flex-1 py-2 px-3 border border-line rounded-lg text-xs font-bold text-fg flex items-center justify-center space-x-1 hover:bg-surface-2"
              />
              <button
                onClick={() => setSettledReceipt(null)}
                className="flex-1 py-2 px-3 bg-primary hover:opacity-90 text-primary-fg rounded-lg text-xs font-bold"
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
