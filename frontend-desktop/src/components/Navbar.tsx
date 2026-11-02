import React from 'react';
import { useAuth } from '../context/AuthContext';
import { LogOut, Store, User as UserIcon } from 'lucide-react';

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();

  const getRoleBadge = (role?: string) => {
    switch (role) {
      case 'owner':
        return <span className="bg-purple-100 text-purple-700 font-semibold px-2.5 py-0.5 rounded-full text-xs">Owner / Admin</span>;
      case 'cashier':
        return <span className="bg-emerald-100 text-emerald-700 font-semibold px-2.5 py-0.5 rounded-full text-xs">Cashier</span>;
      case 'stall_manager':
        return <span className="bg-blue-100 text-blue-700 font-semibold px-2.5 py-0.5 rounded-full text-xs">Stall Manager</span>;
      case 'kitchen_staff':
        return <span className="bg-amber-100 text-amber-700 font-semibold px-2.5 py-0.5 rounded-full text-xs">Kitchen Staff</span>;
      case 'waiter':
        return <span className="bg-indigo-100 text-indigo-700 font-semibold px-2.5 py-0.5 rounded-full text-xs">Waiter</span>;
      default:
        return <span className="bg-slate-100 text-slate-700 font-semibold px-2.5 py-0.5 rounded-full text-xs">{role}</span>;
    }
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between sticky top-0 z-30 shadow-sm">
      <div className="flex items-center space-x-3">
        <div className="bg-brand-500 text-white p-2 rounded-xl shadow-sm">
          <Store className="w-5 h-5" />
        </div>
        <div>
          <h1 className="font-bold text-slate-900 tracking-tight text-lg">Urban Food Court</h1>
          <p className="text-xs text-slate-500">Multi-Stall Management System</p>
        </div>
      </div>

      <div className="flex items-center space-x-4">
        {user?.stall && (
          <div className="text-right border-r border-slate-200 pr-4">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider block">Stall</span>
            <span className="text-sm font-semibold text-slate-800">{user.stall.name}</span>
          </div>
        )}

        <div className="flex items-center space-x-3 pl-2">
          <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600">
            <UserIcon className="w-4 h-4" />
          </div>
          <div className="text-left">
            <div className="flex items-center space-x-2">
              <span className="text-sm font-semibold text-slate-900">{user?.name}</span>
              {getRoleBadge(user?.role)}
            </div>
            <span className="text-xs text-slate-500 block">{user?.email}</span>
          </div>
        </div>

        <button
          onClick={logout}
          title="Sign Out"
          className="ml-2 text-slate-400 hover:text-rose-600 p-2 rounded-lg hover:bg-rose-50 transition"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
};

