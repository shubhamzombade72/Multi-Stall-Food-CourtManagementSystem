import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useConnection } from '../hooks/useConnection';
import {
  LayoutDashboard,
  ShoppingCart,
  Store,
  UtensilsCrossed,
  Package,
  Truck,
  CalendarCheck,
  BarChart3,
  Receipt,
  ChefHat,
  Users,
  CreditCard,
  Settings,
  ConciergeBell,
  LayoutGrid,
  Calculator,
  Contact,
  Building2,
} from 'lucide-react';

export const Sidebar: React.FC = () => {
  const { user, isOwner, isCashier } = useAuth();
  const { state, lastChecked } = useConnection();
  const role = user?.role;

  const isWaiter = role === 'waiter';
  const groups: { title: string; links: { to: string; label: string; icon: React.ElementType; show: boolean }[] }[] = [
    {
      title: 'Operations',
      links: [
        { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, show: isOwner },
        { to: '/pos', label: 'Cashier POS', icon: ShoppingCart, show: isCashier || isOwner },
        { to: '/waiter', label: 'Waiter Station', icon: ConciergeBell, show: isWaiter || isOwner },
        { to: '/orders', label: 'Orders & Receipts', icon: Receipt, show: isOwner || isCashier },
        { to: '/kitchen', label: 'Kitchen Display', icon: ChefHat, show: isOwner || role === 'kitchen_staff' || role === 'stall_manager' },
        { to: '/tables', label: 'Floor & Tables', icon: LayoutGrid, show: isOwner || isCashier || isWaiter },
      ],
    },
    {
      title: 'Payments & Closing',
      links: [
        { to: '/payments', label: 'Payment History', icon: CreditCard, show: isOwner || isCashier },
        { to: '/cashier-closing', label: 'Cashier Closing', icon: Calculator, show: isOwner || isCashier },
        { to: '/settlements', label: 'Daily Closing', icon: CalendarCheck, show: isOwner },
      ],
    },
    {
      title: 'Management',
      links: [
        { to: '/stalls', label: 'Stall Directory', icon: Store, show: isOwner || role === 'stall_manager' },
        { to: '/menu', label: 'Menu Catalog', icon: UtensilsCrossed, show: isOwner || role === 'stall_manager' },
        { to: '/customers', label: 'Customers', icon: Contact, show: isOwner || isCashier },
        { to: '/staff', label: 'Staff & Permissions', icon: Users, show: isOwner },
      ],
    },
    {
      title: 'Back Office',
      links: [
        { to: '/inventory', label: 'Stall Inventory', icon: Package, show: isOwner || role === 'stall_manager' || role === 'store_staff' },
        { to: '/purchases', label: 'Purchases & Suppliers', icon: Truck, show: isOwner || role === 'stall_manager' },
        { to: '/reports', label: 'Reports & Audit', icon: BarChart3, show: isOwner },
      ],
    },
    {
      title: 'System',
      links: [
        { to: '/food-court-settings', label: 'Food Court Settings', icon: Building2, show: isOwner },
        { to: '/settings', label: 'Device Settings', icon: Settings, show: true },
      ],
    },
  ];

  const dot = state === 'online' ? 'text-emerald-400' : state === 'offline' ? 'text-rose-400' : 'text-slate-400';
  const label = state === 'online' ? 'Server online' : state === 'offline' ? 'Server unreachable' : 'Checking server…';

  return (
    <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col shrink-0 min-h-[calc(100vh-4rem)]">
      <nav className="p-4 flex-1 space-y-4 overflow-y-auto" aria-label="Main navigation">
        {groups.map((group) => {
          const links = group.links.filter((l) => l.show);
          if (links.length === 0) return null;
          return (
            <div key={group.title} className="space-y-1">
              <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{group.title}</p>
              {links.map((link) => {
                const Icon = link.icon;
                return (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    className={({ isActive }) =>
                      `flex items-center space-x-3 px-3 py-2 rounded-xl font-medium text-sm transition ${
                        isActive ? 'bg-brand-500 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                      }`
                    }
                  >
                    <Icon className="w-5 h-5" />
                    <span>{link.label}</span>
                  </NavLink>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800">
        <div className="bg-slate-800/60 rounded-xl p-3 text-xs text-slate-400" role="status">
          <p className="font-semibold text-slate-200">Food court server</p>
          <p className={`mt-0.5 font-mono ${dot}`}>● {label}</p>
          {lastChecked && <p className="mt-0.5 text-[10px] text-slate-500">checked {lastChecked.toLocaleTimeString()}</p>}
        </div>
      </div>
    </aside>
  );
};
