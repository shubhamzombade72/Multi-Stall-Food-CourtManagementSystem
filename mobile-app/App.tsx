import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { LoginScreen } from './src/screens/LoginScreen';
import { TableListScreen } from './src/screens/waiter/TableListScreen';
import { NewOrderScreen } from './src/screens/waiter/NewOrderScreen';
import { ServeScreen } from './src/screens/ServeScreen';
import { SyncScreen } from './src/screens/offline/SyncScreen';
import { DiningTable } from './src/types';
import { fetchBoard } from './src/api/board';
import { toServeCount } from './src/utils/serveBoard';

type WaiterScreen = 'tables' | 'new_order' | 'to_serve' | 'sync';

const AppNavigator: React.FC = () => {
  const { user, token, isLoading, logout, offlineQueueCount, isOnline } = useAuth();
  const [waiterScreen, setWaiterScreen] = useState<WaiterScreen>('tables');
  const [selectedTable, setSelectedTable] = useState<DiningTable | null>(null);
  // Dishes still to serve (same order board as the desktop's Orders & Table Tracking; no Ready step)
  const [toServe, setToServe] = useState<number>(0);

  useEffect(() => {
    if (user?.role === 'waiter' || user?.role === 'owner') {
      const check = async () => {
        try {
          setToServe(toServeCount(await fetchBoard()));
        } catch {
          // Offline: keep the last count
        }
      };

      check();
      const interval = setInterval(check, 8000);
      return () => clearInterval(interval);
    }
  }, [user]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#ea580c" />
      </View>
    );
  }

  // Not Authenticated -> Login
  if (!token || !user) {
    return <LoginScreen />;
  }

  // Kitchen staff / stall manager: watch their own stall's dishes (the server scopes the list). Serving is done by
  // the owner, cashier and waiters, as on the desktop.
  if (user.role === 'kitchen_staff' || user.role === 'stall_manager') {
    return (
      <ServeScreen
        canServe={false}
        title={user.stall?.name || 'Kitchen'}
        subtitle={`${user.name} · orders for this stall`}
        leftAction={{ label: 'Log Out', onPress: logout }}
      />
    );
  }

  // Roles without a mobile interface yet (cashier, store staff) use the desktop application
  if (user.role !== 'waiter' && user.role !== 'owner') {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.waiterName}>{user.name}</Text>
        <Text style={[styles.statusLabel, { marginVertical: 12, textAlign: 'center', paddingHorizontal: 24 }]}>
          The "{user.role}" role is not available in the mobile app yet. Please use the desktop application.
        </Text>
        <TouchableOpacity onPress={logout}>
          <Text style={[styles.statusLabel, { color: '#38bdf8', fontWeight: '700' }]}>Log Out</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Waiter Role -> Waiter Terminal with Offline Support
  return (
    <View style={styles.safeArea}>
      {/* Waiter Navigation Bar */}
      <View style={styles.waiterHeader}>
        <View>
          <Text style={styles.waiterName}>{user.name}</Text>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.onlineIndicator,
                { backgroundColor: isOnline ? '#10b981' : '#ef4444' },
              ]}
            />
            <Text style={styles.statusLabel}>{isOnline ? 'Online (LAN)' : 'Offline Mode'}</Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          {/* Offline Sync Queue Pill */}
          {offlineQueueCount > 0 && (
            <TouchableOpacity
              style={styles.offlineQueuePill}
              onPress={() => setWaiterScreen('sync')}
            >
              <Text style={styles.offlineQueueText}>⚡ {offlineQueueCount} queued</Text>
            </TouchableOpacity>
          )}

          {/* Dishes still to serve */}
          {toServe > 0 && (
            <TouchableOpacity
              style={styles.readyPill}
              onPress={() => setWaiterScreen('to_serve')}
            >
              <Text style={styles.readyPillText}>🍽️ {toServe} to serve</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
            <Text style={styles.logoutBtnText}>Exit</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Screen Router */}
      <View style={styles.screenContainer}>
        {waiterScreen === 'tables' && (
          <TableListScreen
            readyCount={toServe}
            onOpenReadyAlerts={() => setWaiterScreen('to_serve')}
            onSelectTable={(table) => {
              setSelectedTable(table);
              setWaiterScreen('new_order');
            }}
          />
        )}

        {waiterScreen === 'new_order' && (
          <NewOrderScreen
            table={selectedTable}
            onBack={() => {
              setSelectedTable(null);
              setWaiterScreen('tables');
            }}
            onOrderPlaced={() => {
              setSelectedTable(null);
              setWaiterScreen('tables');
            }}
          />
        )}

        {waiterScreen === 'to_serve' && (
          <ServeScreen
            canServe
            title="To Serve"
            leftAction={{ label: '← Tables', onPress: () => setWaiterScreen('tables') }}
            onCount={setToServe}
          />
        )}

        {waiterScreen === 'sync' && (
          <SyncScreen onBack={() => setWaiterScreen('tables')} />
        )}
      </View>

      {/* Bottom Bar for Waiter Terminal */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.bottomTab, waiterScreen === 'tables' && styles.bottomTabActive]}
          onPress={() => setWaiterScreen('tables')}
        >
          <Text style={styles.bottomTabIcon}>🪑</Text>
          <Text
            style={[
              styles.bottomTabText,
              waiterScreen === 'tables' && styles.bottomTabTextActive,
            ]}
          >
            Tables
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bottomTab, waiterScreen === 'new_order' && styles.bottomTabActive]}
          onPress={() => {
            setSelectedTable(null);
            setWaiterScreen('new_order');
          }}
        >
          <Text style={styles.bottomTabIcon}>➕</Text>
          <Text
            style={[
              styles.bottomTabText,
              waiterScreen === 'new_order' && styles.bottomTabTextActive,
            ]}
          >
            New Order
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bottomTab, waiterScreen === 'to_serve' && styles.bottomTabActive]}
          onPress={() => setWaiterScreen('to_serve')}
        >
          <Text style={styles.bottomTabIcon}>🛎️</Text>
          <Text
            style={[
              styles.bottomTabText,
              waiterScreen === 'to_serve' && styles.bottomTabTextActive,
            ]}
          >
            To Serve ({toServe})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bottomTab, waiterScreen === 'sync' && styles.bottomTabActive]}
          onPress={() => setWaiterScreen('sync')}
        >
          <Text style={styles.bottomTabIcon}>🔄</Text>
          <Text
            style={[
              styles.bottomTabText,
              waiterScreen === 'sync' && styles.bottomTabTextActive,
            ]}
          >
            Sync ({offlineQueueCount})
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// Android draws edge-to-edge (SDK 57 / RN 0.86): every screen sits inside the device's safe area
export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
        <StatusBar style="light" />
        <AuthProvider>
          <AppNavigator />
        </AuthProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  waiterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  waiterName: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '800',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  onlineIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  statusLabel: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  offlineQueuePill: {
    backgroundColor: '#0369a1',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  offlineQueueText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },
  readyPill: {
    backgroundColor: '#059669',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  readyPillText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },
  logoutBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  logoutBtnText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '700',
  },
  screenContainer: {
    flex: 1,
  },
  bottomBar: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingVertical: 8,
    paddingBottom: 12,
  },
  bottomTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomTabActive: {
    opacity: 1,
  },
  bottomTabIcon: {
    fontSize: 18,
  },
  bottomTabText: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  bottomTabTextActive: {
    color: '#ea580c',
  },
});

