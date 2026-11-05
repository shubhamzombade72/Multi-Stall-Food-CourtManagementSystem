import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { ConnectionBanner } from './components/ConnectionBanner';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { PosPage } from './pages/PosPage';
import { OrdersPage } from './pages/OrdersPage';
import { OrderTrackingPage } from './pages/OrderTrackingPage';
import { StallsPage } from './pages/StallsPage';
import { MenuPage } from './pages/MenuPage';
import { SettlementsPage } from './pages/SettlementsPage';
import { ReportsPage } from './pages/ReportsPage';
import { StaffPage } from './pages/StaffPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { SettingsPage } from './pages/SettingsPage';
import { FoodCourtSettingsPage } from './pages/FoodCourtSettingsPage';
import { TablesPage } from './pages/TablesPage';
import { CustomersPage } from './pages/CustomersPage';
import { CashierClosingPage } from './pages/CashierClosingPage';
import { SettingsProvider } from './context/SettingsContext';
import { FirstRunPage } from './pages/FirstRunPage';
import { RecoverOwnerPage } from './pages/RecoverOwnerPage';
import { ConnectHostPage } from './pages/ConnectHostPage';
import { BackupNotice } from './components/BackupNotice';
import { PrintFailureBanner } from './components/PrintFailureBanner';

/** First screen per role (the server still authorizes every request). */
export const homeFor = (role: string): string => {
  switch (role) {
    case 'owner':
      return '/dashboard';
    case 'cashier':
      return '/pos';
    case 'kitchen_staff':
      return '/tracking';
    case 'stall_manager':
      return '/tracking';
    case 'waiter':
      return '/tracking';
    default:
      return '/settings';
  }
};

const ProtectedLayout: React.FC = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas text-fg">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <SettingsProvider>
      <div className="min-h-screen flex flex-col bg-canvas">
        <Navbar />
        <ConnectionBanner />
        <BackupNotice />
        <PrintFailureBanner />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto">
            <Routes>
              <Route path="/" element={<Navigate to={homeFor(user.role)} replace />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/pos" element={<PosPage />} />
              <Route path="/pending-bills" element={<Navigate to="/pos?mode=pending_bills" replace />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/tracking" element={<OrderTrackingPage />} />
              <Route path="/payments" element={<PaymentsPage />} />
              <Route path="/cashier-closing" element={<CashierClosingPage />} />
              <Route path="/kitchen" element={<Navigate to="/tracking" replace />} />
              <Route path="/waiter" element={<Navigate to="/tracking" replace />} />
              <Route path="/tables" element={<TablesPage />} />
              <Route path="/customers" element={<CustomersPage />} />
              <Route path="/stalls" element={<StallsPage />} />
              <Route path="/staff" element={<StaffPage />} />
              <Route path="/menu" element={<MenuPage />} />
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

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/first-run" element={<FirstRunPage />} />
          <Route path="/recover-owner" element={<RecoverOwnerPage />} />
          <Route path="/connect-host" element={<ConnectHostPage />} />
          <Route path="/*" element={<ProtectedLayout />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
};
