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
  ListChecks,
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
        { to: '/tracking', label: 'Orders & Table Tracking', icon: ListChecks, show: isOwner || isCashier || isWaiter },
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

  const dot = state === 'online' ? 'text-st-served-fg' : state === 'offline' ? 'text-danger-fg' : 'text-muted';
  const label = state === 'online' ? 'System online' : state === 'offline' ? 'System not responding' : 'Checking system…';

  return (
    <aside className="w-52 bg-sidebar text-fg border-r border-line flex flex-col shrink-0 min-h-[calc(100vh-3rem)]">
      <nav className="p-2 flex-1 space-y-3 overflow-y-auto" aria-label="Main navigation">
        {groups.map((group) => {
          const links = group.links.filter((l) => l.show);
          if (links.length === 0) return null;
          return (
            <div key={group.title} className="space-y-0.5">
              <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-muted mb-0.5">{group.title}</p>
              {links.map((link) => {
                const Icon = link.icon;
                return (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    className={({ isActive }) =>
                      `flex items-center space-x-2 px-2 py-1.5 rounded-lg font-medium text-[13px] transition ${
                        isActive ? 'bg-primary text-primary-fg' : 'text-muted hover:text-fg hover:bg-surface-2'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{link.label}</span>
                  </NavLink>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="p-2 border-t border-line">
        <div className="bg-surface-2 rounded-lg p-2 text-xs text-muted" role="status">
          <p className="font-semibold text-fg">Food court system</p>
          <p className={`mt-0.5 font-mono ${dot}`}>● {label}</p>
          {lastChecked && <p className="mt-0.5 text-[10px] text-muted">checked {lastChecked.toLocaleTimeString()}</p>}
        </div>
      </div>
    </aside>
  );
};
