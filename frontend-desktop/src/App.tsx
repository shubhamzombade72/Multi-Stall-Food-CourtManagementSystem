import React, { useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { ConnectionBanner } from './components/ConnectionBanner';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { PosPage } from './pages/PosPage';
import { OrdersPage } from './pages/OrdersPage';
import { StallsPage } from './pages/StallsPage';
import { MenuPage } from './pages/MenuPage';
import { InventoryPage } from './pages/InventoryPage';
import { SettlementsPage } from './pages/SettlementsPage';
import { ReportsPage } from './pages/ReportsPage';
import { PurchasesPage } from './pages/PurchasesPage';
import { KitchenPage } from './pages/KitchenPage';
import { StaffPage } from './pages/StaffPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { SettingsPage } from './pages/SettingsPage';
import { FoodCourtSettingsPage } from './pages/FoodCourtSettingsPage';
import { TablesPage } from './pages/TablesPage';
import { CustomersPage } from './pages/CustomersPage';
import { WaiterPage } from './pages/WaiterPage';
import { CashierClosingPage } from './pages/CashierClosingPage';
import { SettingsProvider } from './context/SettingsContext';
import { getDesktopConfig, isApiConfigured, setDesktopConfig } from './api/client';
import { desktop, isDesktopApp } from './desktop/bridge';
import { FirstRunPage } from './pages/FirstRunPage';
import { ServerStartFailedPage } from './pages/ServerStartFailedPage';

/** First screen per role (the server still authorizes every request). */
export const homeFor = (role: string): string => {
  switch (role) {
    case 'owner':
      return '/dashboard';
    case 'cashier':
      return '/pos';
    case 'kitchen_staff':
      return '/kitchen';
    case 'stall_manager':
      return '/kitchen';
    case 'store_staff':
      return '/inventory';
    case 'waiter':
      return '/waiter';
    default:
      return '/settings';
  }
};

const ProtectedLayout: React.FC = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <SettingsProvider>
      <div className="min-h-screen flex flex-col bg-slate-50">
        <Navbar />
        <ConnectionBanner />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto">
            <Routes>
              <Route path="/" element={<Navigate to={homeFor(user.role)} replace />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/pos" element={<PosPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/payments" element={<PaymentsPage />} />
              <Route path="/cashier-closing" element={<CashierClosingPage />} />
              <Route path="/kitchen" element={<KitchenPage />} />
              <Route path="/waiter" element={<WaiterPage />} />
              <Route path="/tables" element={<TablesPage />} />
              <Route path="/customers" element={<CustomersPage />} />
              <Route path="/stalls" element={<StallsPage />} />
              <Route path="/staff" element={<StaffPage />} />
              <Route path="/menu" element={<MenuPage />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/purchases" element={<PurchasesPage />} />
              <Route path="/settlements" element={<SettlementsPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/food-court-settings" element={<FoodCourtSettingsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </SettingsProvider>
  );
};

/**
 * The desktop app starts its own server on this PC, so normally this gate is invisible. It only steps in
 * when no server is available: a failed start of the built-in server (error screen with Try again), or a
 * development run with nothing configured (Server Setup screen). It never guesses an address.
 */
const ServerSetupGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [configured, setConfigured] = useState(() => !isDesktopApp() || isApiConfigured());
  const [startError, setStartError] = useState<string | null>(() => getDesktopConfig()?.error ?? null);
  if (!configured) {
    if (startError) {
      return (
        <ServerStartFailedPage
          error={startError}
          onRetry={async () => {
            const cfg = await desktop()!.getConfig();
            setDesktopConfig(cfg);
            setStartError(cfg.error);
            setConfigured(isApiConfigured());
          }}
        />
      );
    }
    return <SettingsPage standalone setupRequired onConfigured={() => setConfigured(isApiConfigured())} />;
  }
  return <>{children}</>;
};

export const App: React.FC = () => {
  return (
    <ServerSetupGate>
    <AuthProvider>
      {/* Hash routing works both from a web server and from file:// inside the Electron app */}
      <HashRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/first-run" element={<FirstRunPage />} />
          <Route path="/connection" element={<SettingsPage standalone />} />
          <Route path="/*" element={<ProtectedLayout />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
    </ServerSetupGate>
  );
};
