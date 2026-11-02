import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard,
  ShoppingCart,
  Store,
  UtensilsCrossed,
  Package,
  CalendarCheck,
  BarChart3,
  Receipt
} from 'lucide-react';

export const Sidebar: React.FC = () => {
  const { user, isOwner, isCashier } = useAuth();

  const navLinks = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, show: isOwner },
    { to: '/pos', label: 'Cashier POS', icon: ShoppingCart, show: isCashier },
    { to: '/orders', label: 'Orders & Receipts', icon: Receipt, show: true },
    { to: '/stalls', label: 'Stall Directory', icon: Store, show: isOwner },
    { to: '/menu', label: 'Menu Catalog', icon: UtensilsCrossed, show: isOwner || user?.role === 'stall_manager' },
    { to: '/inventory', label: 'Stall Inventory', icon: Package, show: isOwner || user?.role === 'stall_manager' || user?.role === 'store_staff' },
    { to: '/settlements', label: 'EOD & Settlements', icon: CalendarCheck, show: isOwner },
    { to: '/reports', label: 'Analytics & Audit', icon: BarChart3, show: isOwner },
  ];

  return (
    <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col shrink-0 min-h-[calc(100vh-4rem)]">
      <div className="p-4 flex-1 space-y-1">
        <p className="px-3 text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Main Navigation</p>
        {navLinks.filter(l => l.show).map((link) => {
          const Icon = link.icon;
          return (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `flex items-center space-x-3 px-3 py-2.5 rounded-xl font-medium text-sm transition ${
                  isActive
                    ? 'bg-brand-500 text-white shadow-md'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`
              }
            >
              <Icon className="w-5 h-5" />
              <span>{link.label}</span>
            </NavLink>
          );
        })}
      </div>

      <div className="p-4 border-t border-slate-800">
        <div className="bg-slate-800/60 rounded-xl p-3 text-xs text-slate-400">
          <p className="font-semibold text-slate-200">Local Food Court Node</p>
          <p className="mt-0.5 text-emerald-400 font-mono">● PostgreSQL 17 Online</p>
        </div>
      </div>
    </aside>
  );
};

