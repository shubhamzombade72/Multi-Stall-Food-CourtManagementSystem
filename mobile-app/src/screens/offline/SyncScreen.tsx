import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { OfflineQueuedOrder } from '../../types';
import { offlineStore } from '../../storage/offlineStore';
import { syncOfflineOrders } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

interface Props {
  onBack: () => void;
}

export const SyncScreen: React.FC<Props> = ({ onBack }) => {
  const { checkOfflineQueue } = useAuth();
  const [queue, setQueue] = useState<OfflineQueuedOrder[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ current: number; total: number } | null>(null);

  useEffect(() => {
    loadQueue();
  }, []);

  const loadQueue = async () => {
    const items = await offlineStore.getQueue();
    setQueue(items);
  };

  const handleStartSync = async () => {
    if (queue.length === 0) {
      Alert.alert('Queue Empty', 'There are no pending offline orders to synchronize.');
      return;
    }

    setIsSyncing(true);
    setSyncProgress({ current: 0, total: queue.length });

    const result = await syncOfflineOrders((current, total) => {
      setSyncProgress({ current, total });
    });

    setIsSyncing(false);
    setSyncProgress(null);
    await checkOfflineQueue();
    await loadQueue();

    Alert.alert(
      'Sync Complete',
      `Successfully synced: ${result.successCount} orders.\nFailures: ${result.failureCount}`
    );
  };

  const handleClearQueue = () => {
    Alert.alert(
      'Clear Offline Orders?',
      'Are you sure you want to delete unsynced local orders? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            await offlineStore.clearQueue();
            await checkOfflineQueue();
            await loadQueue();
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Offline Order Queue</Text>
        <TouchableOpacity onPress={handleClearQueue}>
          <Text style={styles.clearBtnText}>Clear</Text>
        </TouchableOpacity>
      </View>

      {/* Sync Status Banner */}
      <View style={styles.statusBar}>
        <View>
          <Text style={styles.queueCountText}>{queue.length} Local Orders Stored</Text>
          <Text style={styles.queueSubtext}>
            Captured while offline • Ready for server sync
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.syncButton, isSyncing && styles.syncButtonDisabled]}
          onPress={handleStartSync}
          disabled={isSyncing}
        >
          {isSyncing ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.syncButtonText}>Sync Now ⚡</Text>
          )}
        </TouchableOpacity>
      </View>

      {syncProgress && (
        <View style={styles.progressBar}>
          <Text style={styles.progressText}>
            Syncing order {syncProgress.current} of {syncProgress.total}...
          </Text>
        </View>
      )}

      {/* Queue List */}
      {queue.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>☁️</Text>
          <Text style={styles.emptyTitle}>Offline Queue is Clean</Text>
          <Text style={styles.emptySubtitle}>
            All waiter and counter orders are fully synced to the central edge server.
          </Text>
        </View>
      ) : (
        <FlatList
          data={queue}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={styles.orderCard}>
              <View style={styles.orderCardHeader}>
                <View>
                  <Text style={styles.orderCardTitle}>
                    {item.customer_name || 'Walk-in'} (
                    {item.table_id ? `Table ${item.table_id}` : 'Takeaway'})
                  </Text>
                  <Text style={styles.orderCardTime}>
                    {new Date(item.client_timestamp).toLocaleTimeString()}
                  </Text>
                </View>
                <View
                  style={[
                    styles.syncStatusBadge,
                    item.sync_status === 'failed' && { backgroundColor: '#7f1d1d' },
                    item.sync_status === 'syncing' && { backgroundColor: '#1e3a8a' },
                    item.sync_status === 'pending' && { backgroundColor: '#78350f' },
                  ]}
                >
                  <Text style={styles.syncStatusBadgeText}>{item.sync_status.toUpperCase()}</Text>
                </View>
              </View>

              <View style={styles.itemList}>
                {item.items.map((it, idx) => (
                  <Text key={idx} style={styles.itemLine}>
                    • {it.quantity}x {it.name} (₹{it.unit_price * it.quantity})
                  </Text>
                ))}
              </View>

              {item.error_message && (
                <Text style={styles.errorText}>Reason: {item.error_message}</Text>
              )}
            </View>
          )}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#0f172a',
  },
  backButtonText: {
    color: '#38bdf8',
    fontWeight: '700',
    fontSize: 13,
  },
  topBarTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
  },
  clearBtnText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '700',
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    margin: 16,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  queueCountText: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '800',
  },
  queueSubtext: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  syncButton: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  syncButtonDisabled: {
    opacity: 0.6,
  },
  syncButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  progressBar: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 8,
    backgroundColor: '#1e3a8a',
    borderRadius: 8,
    alignItems: 'center',
  },
  progressText: {
    color: '#93c5fd',
    fontSize: 12,
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 80,
    paddingHorizontal: 30,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 10,
  },
  emptyTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptySubtitle: {
    color: '#94a3b8',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 6,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  orderCard: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  orderCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  orderCardTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '800',
  },
  orderCardTime: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  syncStatusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  syncStatusBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '900',
  },
  itemList: {
    marginTop: 4,
    gap: 3,
  },
  itemLine: {
    color: '#cbd5e1',
    fontSize: 12,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 11,
    marginTop: 6,
    fontStyle: 'italic',
  },
});

