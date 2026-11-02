import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import {
  Store,
  Receipt,
  Utensils
} from 'lucide-react';

export const OrderTrackPage: React.FC = () => {
  const { trackingToken, orderId } = useParams<{ trackingToken?: string; orderId?: string }>();
  const activeToken = trackingToken || orderId;
  const [order, setOrder] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchOrder = async () => {
    if (!activeToken) return;
    try {
      const res = await apiClient.get(`/public/orders/track/${activeToken}`);
      if (res.data.success) {
        setOrder(res.data.data);
      }
    } catch (err) {
      console.error('Failed to fetch tracking data', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOrder();
    const timer = setInterval(fetchOrder, 4000); // 4s polling for live kitchen progress
    return () => clearInterval(timer);
  }, [activeToken]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500"></div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen p-6 flex flex-col items-center justify-center text-center">
        <h3 className="font-bold text-slate-800 text-lg">Order Not Found</h3>
        <Link to="/" className="mt-4 text-xs font-bold text-brand-600 underline">
          Return to Menu
        </Link>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ready':
        return <span className="px-3 py-1 bg-emerald-100 text-emerald-800 font-extrabold rounded-full text-xs animate-pulse">Food Ready!</span>;
      case 'partially_ready':
        return <span className="px-3 py-1 bg-blue-100 text-blue-800 font-bold rounded-full text-xs">Some Items Ready</span>;
      case 'in_preparation':
      case 'confirmed':
        return <span className="px-3 py-1 bg-amber-100 text-amber-800 font-bold rounded-full text-xs">Cooking in Kitchen...</span>;
      case 'served':
        return <span className="px-3 py-1 bg-indigo-100 text-indigo-800 font-bold rounded-full text-xs">Delivered to Table</span>;
      default:
        return <span className="px-3 py-1 bg-slate-100 text-slate-700 font-bold rounded-full text-xs">{status}</span>;
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 p-4 max-w-md mx-auto space-y-4">
      {/* Top Header Card */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-md text-center relative">
        <div className="w-14 h-14 bg-brand-50 text-brand-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
          <Utensils className="w-7 h-7" />
        </div>
        <h2 className="text-xl font-extrabold text-slate-900">Order Placed!</h2>
        <p className="text-xs text-slate-400 font-mono mt-1">Invoice #{order.order_number}</p>
        <div className="mt-3">{getStatusBadge(order.status)}</div>

        {order.table && (
          <div className="mt-4 p-3 bg-slate-50 rounded-xl text-xs flex justify-between items-center text-slate-600">
            <span>Dining Table:</span>
            <span className="font-extrabold text-slate-900 text-sm">Table {order.table.table_number}</span>
          </div>
        )}
      </div>

      {/* Dispatched Stall Tickets */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-md space-y-3">
        <h3 className="font-bold text-slate-900 text-sm flex items-center space-x-1.5">
          <Store className="w-4 h-4 text-brand-600" />
          <span>Stall Kitchen Tickets</span>
        </h3>
        <p className="text-xs text-slate-400">Your order has been split across participating stall kitchens:</p>

        <div className="space-y-2.5 pt-1">
          {order.kitchen_tickets?.map((ticket: any) => (
            <div key={ticket.id} className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-900 text-xs block">{ticket.stall?.name}</span>
                <span className="text-[10px] text-slate-400 font-mono">Ticket #{ticket.ticket_number}</span>
              </div>
              <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                ticket.status === 'ready' ? 'bg-emerald-100 text-emerald-800' :
                ticket.status === 'preparing' ? 'bg-amber-100 text-amber-800' :
                'bg-slate-200 text-slate-700'
              }`}>
                {ticket.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Item Summary */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-md space-y-3 text-xs">
        <h3 className="font-bold text-slate-900 text-sm flex items-center space-x-1.5">
          <Receipt className="w-4 h-4 text-brand-600" />
          <span>Order Breakdown</span>
        </h3>

        <div className="divide-y divide-slate-100">
          {order.items?.map((item: any) => (
            <div key={item.id} className="py-2.5 flex justify-between items-center">
              <div>
                <span className="font-bold text-slate-900">{item.item_name}</span>
                <span className="text-slate-400 block text-[11px]">{item.stall?.name} × {item.quantity}</span>
              </div>
              <span className="font-extrabold text-slate-800">₹{item.subtotal}</span>
            </div>
          ))}
        </div>

        <div className="pt-2 border-t border-slate-200 space-y-1 font-medium">
          <div className="flex justify-between text-slate-500">
            <span>Subtotal:</span>
            <span>₹{order.subtotal}</span>
          </div>
          <div className="flex justify-between text-slate-500">
            <span>GST (5%):</span>
            <span>₹{order.tax_amount}</span>
          </div>
          <div className="flex justify-between text-slate-900 font-extrabold text-sm pt-1">
            <span>Total:</span>
            <span className="text-brand-600">₹{order.total_amount}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
