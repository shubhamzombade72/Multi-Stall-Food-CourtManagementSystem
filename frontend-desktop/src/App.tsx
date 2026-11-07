import React from 'react';
import { startUnsavedWorkReporting } from './lib/unsavedWork';
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
import { UpdatesPage } from './pages/UpdatesPage';
import { FoodCourtSettingsPage } from './pages/FoodCourtSettingsPage';
import { TablesPage } from './pages/TablesPage';
import { CustomersPage } from './pages/CustomersPage';
import { SettingsProvider } from './context/SettingsContext';
import { FirstRunPage } from './pages/FirstRunPage';
import { RecoverOwnerPage } from './pages/RecoverOwnerPage';
import { ConnectHostPage } from './pages/ConnectHostPage';
import { BackupNotice } from './components/BackupNotice';
import { PrintFailureBanner } from './components/PrintFailureBanner';
import { PinLoginPage } from './pages/PinLoginPage';
import { PinSetupPage } from './pages/PinSetupPage';
import { StorePage } from './pages/StorePage';
import { StorePurchasesPage } from './pages/StorePurchasesPage';
import { StoreReceivedPage } from './pages/StoreReceivedPage';

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
    case 'store_staff':
      return '/store';
    default:
      return '/settings';
  }
};

const FullPageSpinner: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center bg-canvas text-fg">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
  </div>
);

/**
 * While the PC is locked (or is proving who is at the keyboard) no route exists: this replaces the whole router, so
 * no address can reach a screen behind the PIN.
 */
const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { status, errorMessage, retry } = useAuth();
  switch (status) {
    case 'INITIALIZING':
      return <FullPageSpinner />;
    case 'PIN_REQUIRED':
    case 'PIN_VERIFICATION':
      return <PinLoginPage />;
    case 'ACCOUNT_RECOVERY':
      return <LoginPage />;
    case 'ERROR':
      return (
        <div className="min-h-screen bg-canvas flex flex-col justify-center items-center p-4">
          <div role="alert" className="w-full max-w-md bg-surface rounded-lg shadow-2xl p-6 border border-line text-center space-y-4">
            <p className="text-fg text-sm">{errorMessage || 'Something went wrong while signing in.'}</p>
            <button type="button" onClick={retry} className="py-2 px-6 bg-primary hover:bg-primary/90 text-primary-fg font-semibold rounded-lg transition">
              Try again
            </button>
          </div>
        </div>
      );
    default:
      return <>{children}</>;
  }
};

const ProtectedLayout: React.FC = () => {
  const { user, status } = useAuth();

  if (status === 'PIN_SETUP') {
    return <PinSetupPage />;
  }

  if (!user || status !== 'AUTHENTICATED') {
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
              <Route path="/kitchen" element={<Navigate to="/tracking" replace />} />
              <Route path="/waiter" element={<Navigate to="/tracking" replace />} />
              <Route path="/tables" element={<TablesPage />} />
              <Route path="/customers" element={<CustomersPage />} />
              <Route path="/stalls" element={<StallsPage />} />
              <Route path="/staff" element={<StaffPage />} />
              <Route path="/menu" element={<MenuPage />} />
              <Route path="/settlements" element={<SettlementsPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/store" element={user.role === 'owner' || user.role === 'store_staff' ? <StorePage /> : <Navigate to="/" replace />} />
              <Route path="/store/purchases" element={user.role === 'owner' || user.role === 'store_staff' ? <StorePurchasesPage /> : <Navigate to="/" replace />} />
              <Route path="/store/received" element={user.role === 'stall_manager' ? <StoreReceivedPage /> : <Navigate to="/" replace />} />
              <Route path="/food-court-settings" element={<FoodCourtSettingsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/updates" element={user.role === 'owner' ? <UpdatesPage /> : <Navigate to="/" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </SettingsProvider>
  );
};

export const App: React.FC = () => {
  React.useEffect(() => startUnsavedWorkReporting(), []);
  return (
    <AuthProvider>
      <HashRouter>
        <AuthGate>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/first-run" element={<FirstRunPage />} />
            {/* The sign-in and setup screens link to /recover; /recover-owner stays for anything using the old path */}
            <Route path="/recover" element={<RecoverOwnerPage />} />
            <Route path="/recover-owner" element={<RecoverOwnerPage />} />
            <Route path="/connect-host" element={<ConnectHostPage />} />
            <Route path="/*" element={<ProtectedLayout />} />
          </Routes>
        </AuthGate>
      </HashRouter>
    </AuthProvider>
  );
};
