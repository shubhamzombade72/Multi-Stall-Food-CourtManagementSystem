import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useConnection } from '../hooks/useConnection';
import { usePendingBillsCount } from '../hooks/usePendingBillsCount';
import {
  LayoutDashboard,
  ShoppingCart,
  Store,
  UtensilsCrossed,
  CalendarCheck,
  BarChart3,
  Receipt,
  Users,
  ClipboardList,
  Settings,
  LayoutGrid,
  Contact,
  Building2,
  ListChecks,
  Clock,
  CloudDownload,
  Package,
  PackageCheck,
  Truck,
} from 'lucide-react';

export const Sidebar: React.FC = () => {
  const { user, isOwner, isCashier } = useAuth();
  const { state, lastChecked } = useConnection();
  const pendingBillsCount = usePendingBillsCount();
  const location = useLocation();
  const role = user?.role;

  const isWaiter = role === 'waiter';
  const groups: {
    title: string;
    links: { to: string; label: string; icon: React.ElementType; show: boolean; badge?: number }[];
  }[] = [
    {
      title: 'Operations',
      links: [
        { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, show: isOwner },
        { to: '/pos', label: 'Cashier POS', icon: ShoppingCart, show: isCashier || isOwner },
        {
          to: '/pos?mode=pending_bills',
          label: 'Pending Bills',
          icon: Clock,
          show: isCashier || isOwner,
          badge: pendingBillsCount,
        },
        { to: '/tracking', label: 'Orders & Table Tracking', icon: ListChecks, show: isOwner || isCashier || isWaiter || role === 'kitchen_staff' || role === 'stall_manager' },
        { to: '/tables', label: 'Floor & Tables', icon: LayoutGrid, show: isOwner || isCashier || isWaiter },
      ],
    },
    {
      title: 'Payments & Closing',
      links: [
        { to: '/orders', label: 'Orders', icon: ClipboardList, show: isOwner || isCashier },
        { to: '/payments', label: 'Receipts', icon: Receipt, show: isOwner || isCashier },
        { to: '/settlements', label: 'End-of-Day Closing & Stall Settlements', icon: CalendarCheck, show: isOwner },
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
      title: 'Central Store',
      links: [
        { to: '/store', label: 'Raw Materials', icon: Package, show: isOwner || role === 'store_staff' },
        { to: '/store/purchases', label: 'Purchases & Suppliers', icon: Truck, show: isOwner || role === 'store_staff' },
        { to: '/store/received', label: 'Stock Received', icon: PackageCheck, show: role === 'stall_manager' },
      ],
    },
    {
      title: 'Back Office',
      links: [
        { to: '/reports', label: 'Reports & Audit', icon: BarChart3, show: isOwner },
      ],
    },
    {
      title: 'System',
      links: [
        { to: '/food-court-settings', label: 'Food Court Settings', icon: Building2, show: isOwner },
        { to: '/settings', label: 'Device Settings', icon: Settings, show: true },
        { to: '/updates', label: 'Software Updates', icon: CloudDownload, show: isOwner },
      ],
    },
  ];

  const dot = state === 'online' ? 'text-st-served-fg' : state === 'offline' ? 'text-danger-fg' : 'text-muted';
  const label = state === 'online' ? 'System online' : state === 'offline' ? 'System not responding' : 'Checking system…';

  const isLinkActive = (to: string) => {
    const [toPath, toQuery] = to.split('?');
    if (toQuery) {
      return location.pathname === toPath && location.search.includes(toQuery);
    }
    if (toPath === '/pos') {
      return location.pathname === '/pos' && (!location.search || !location.search.includes('mode=pending_bills'));
    }
    return location.pathname === toPath;
  };

  return (
    <aside className="w-14 xl:w-52 bg-sidebar text-fg border-r border-line flex flex-col shrink-0 min-h-[calc(100vh-3rem)]">
      <nav className="p-2 flex-1 space-y-3 overflow-y-auto overflow-x-hidden" aria-label="Main navigation">
        {groups.map((group) => {
          const links = group.links.filter((l) => l.show);
          if (links.length === 0) return null;
          return (
            <div key={group.title} className="space-y-0.5">
              {/* Below 1280px the sidebar is an icon rail: group titles become a thin divider, labels become tooltips */}
              <p className="hidden xl:block px-2 text-[11px] font-semibold uppercase tracking-wider text-muted mb-0.5">{group.title}</p>
              <hr className="xl:hidden mx-1 mb-1 border-line" aria-hidden />
              {links.map((link) => {
                const Icon = link.icon;
                const active = isLinkActive(link.to);
                return (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    title={link.label}
                    aria-label={link.badge ? `${link.label} (${link.badge})` : link.label}
                    className={`relative flex items-center justify-center xl:justify-start xl:space-x-2 px-2 py-2 xl:py-1.5 rounded-lg font-medium text-[13px] transition ${
                      active ? 'bg-primary text-primary-fg' : 'text-muted hover:text-fg hover:bg-surface-2'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="hidden xl:inline flex-1 min-w-0 leading-tight">{link.label}</span>
                    {link.badge !== undefined && (
                      <span
                        className={`absolute -top-0.5 -right-0.5 xl:static xl:ml-auto px-1 xl:px-1.5 py-0 xl:py-0.5 rounded-full text-[9px] xl:text-[10px] font-black tracking-tight ${link.badge === 0 ? 'hidden xl:inline' : ''} ${
                          active
                            ? 'bg-primary-fg/20 text-primary-fg'
                            : link.badge > 0
                            ? 'bg-danger/10 text-danger-fg'
                            : 'bg-surface-2 text-muted'
                        }`}
                      >
                        {link.badge}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="p-2 border-t border-line">
        <div className="bg-surface-2 rounded-lg p-2 text-xs text-muted" role="status" title={label}>
          <p className="hidden xl:block font-semibold text-fg">Food court system</p>
          <p className={`mt-0.5 font-mono text-center xl:text-left ${dot}`}>
            ● <span className="hidden xl:inline">{label}</span>
          </p>
          {lastChecked && <p className="hidden xl:block mt-0.5 text-[10px] text-muted">checked {lastChecked.toLocaleTimeString()}</p>}
        </div>
      </div>
    </aside>
  );
};
