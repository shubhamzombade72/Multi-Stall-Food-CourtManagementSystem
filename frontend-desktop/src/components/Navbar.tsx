import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { NotificationBell } from './NotificationBell';
import { ThemeToggle } from './ThemeToggle';
import { LogOut, User as UserIcon } from 'lucide-react';
import logoImg from '../assets/logo.jpg';

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const { settings } = useSettings();

  const getRoleBadge = (role?: string) => {
    switch (role) {
      case 'owner':
        return <span className="bg-primary/10 text-primary border border-primary/30 font-semibold px-2 py-0.5 rounded-full text-[11px]">Owner / Admin</span>;
      case 'cashier':
        return <span className="bg-surface-2 text-fg border border-line font-semibold px-2 py-0.5 rounded-full text-[11px]">Cashier</span>;
      case 'stall_manager':
        return <span className="bg-surface-2 text-fg border border-line font-semibold px-2 py-0.5 rounded-full text-[11px]">Stall Manager</span>;
      case 'kitchen_staff':
        return <span className="bg-surface-2 text-fg border border-line font-semibold px-2 py-0.5 rounded-full text-[11px]">Kitchen Staff</span>;
      case 'waiter':
        return <span className="bg-surface-2 text-fg border border-line font-semibold px-2 py-0.5 rounded-full text-[11px]">Waiter</span>;
      case 'store_staff':
        return <span className="bg-surface-2 text-fg border border-line font-semibold px-2 py-0.5 rounded-full text-[11px]">Store Staff</span>;
      default:
        return <span className="bg-surface-2 text-fg border border-line font-semibold px-2 py-0.5 rounded-full text-[11px]">{role}</span>;
    }
  };

  return (
    <header className="h-12 bg-surface border-b border-line px-4 flex items-center justify-between sticky top-0 z-30 shadow-sm">
      <div className="flex items-center space-x-3">
        <div className="w-8 h-8 rounded-lg overflow-hidden border border-line flex items-center justify-center bg-canvas">
          <img src={logoImg} alt="Logo" className="w-full h-full object-cover" />
        </div>
        <div>
          <h1 className="font-bold text-fg tracking-tight text-base leading-tight">{settings.business_profile.name}</h1>
          <p className="text-xs text-muted">मंगलमूर्ती POS</p>
        </div>
      </div>

      <div className="flex items-center space-x-4">
        <ThemeToggle />
        <NotificationBell />
        {user?.stall && (
          <div className="text-right border-r border-line pr-4">
            <span className="text-[11px] font-medium text-muted uppercase tracking-wider block">Stall</span>
            <span className="text-sm font-semibold text-fg">{user.stall.name}</span>
          </div>
        )}

        <div className="flex items-center space-x-3 pl-2">
          <div className="w-8 h-8 rounded-full bg-surface-2 border border-line flex items-center justify-center text-muted">
            <UserIcon className="w-4 h-4" />
          </div>
          <div className="text-left">
            <div className="flex items-center space-x-2">
              <span className="text-sm font-semibold text-fg">{user?.name}</span>
              {getRoleBadge(user?.role)}
            </div>
            <span className="text-xs text-muted block">{user?.email}</span>
          </div>
        </div>

        <button
          onClick={logout}
          title="Sign Out"
          className="ml-2 text-muted hover:text-danger-fg p-2 rounded-lg hover:bg-surface-2 transition"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
};

