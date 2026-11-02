import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { ApiKitchenTicket, StallKitchenTicket, normalizeTicket } from '../../types';
import { getApiClient } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { formatTableLabel } from '../../utils/tableFormatter';

export const KdsScreen: React.FC = () => {
  const { user, logout } = useAuth();
  const [tickets, setTickets] = useState<StallKitchenTicket[]>([]);
  const [filterStatus, setFilterStatus] = useState<'active' | 'completed'>('active');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);

  useEffect(() => {
    fetchTickets();
    const interval = setInterval(fetchTickets, 4000); // Poll kitchen orders every 4s
    return () => clearInterval(interval);
  }, [filterStatus]);

  const fetchTickets = async () => {
    try {
      const client = await getApiClient();
      const res = await client.get('/kitchen/tickets');
      if (res.data.success) {
        setTickets((res.data.data as ApiKitchenTicket[]).map(normalizeTicket));
      }
    } catch (e) {
      // Ignore network errors on polling
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleUpdateTicketStatus = async (ticketId: number, status: 'preparing' | 'ready') => {
    setActionLoadingId(ticketId);
    try {
      const client = await getApiClient();
      const res = await client.put(`/kitchen/tickets/${ticketId}/status`, { status });
      if (res.data.success) {
        setTickets((prev) =>
          prev.map((t) => (t.id === ticketId ? { ...t, status: status } : t))
        );
      }
    } catch (err: any) {
      Alert.alert('Status Update Failed', err.response?.data?.message || 'Server error');
    } finally {
      setActionLoadingId(null);
    }
  };

  const ACTIVE = ['pending', 'accepted', 'preparing'];
  const DONE = ['ready', 'picked_up'];

  const displayedTickets = tickets.filter((t) =>
    filterStatus === 'active' ? ACTIVE.includes(t.status) : DONE.includes(t.status)
  );

  return (
    <View style={styles.container}>
      {/* KDS Header */}
      <View style={styles.topHeader}>
        <View>
          <Text style={styles.stallTitle}>
            {user?.stall?.name || 'Kitchen Display System'}
          </Text>
          <Text style={styles.stallSubtitle}>
            Stall Station #{user?.stall?.stall_number || 'KDS'} • {user?.name}
          </Text>
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
          <Text style={styles.logoutBtnText}>Log Out</Text>
        </TouchableOpacity>
      </View>

      {/* Filter Tabs */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, filterStatus === 'active' && styles.tabActive]}
          onPress={() => setFilterStatus('active')}
        >
          <Text
            style={[styles.tabText, filterStatus === 'active' && styles.tabTextActive]}
          >
            🔥 Active Cooking (
            {tickets.filter((t) => ACTIVE.includes(t.status)).length}
            )
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, filterStatus === 'completed' && styles.tabActive]}
          onPress={() => setFilterStatus('completed')}
        >
          <Text
            style={[styles.tabText, filterStatus === 'completed' && styles.tabTextActive]}
          >
            ✓ Ready / Served (
            {tickets.filter((t) => DONE.includes(t.status)).length}
            )
          </Text>
        </TouchableOpacity>
      </View>

      {/* Ticket Cards */}
      {isLoading ? (
        <ActivityIndicator size="large" color="#f59e0b" style={{ marginTop: 40 }} />
      ) : displayedTickets.length === 0 ? (
        <View style={styles.emptyView}>
          <Text style={styles.emptyEmoji}>👨‍🍳</Text>
          <Text style={styles.emptyTitle}>
            {filterStatus === 'active' ? 'No active orders in queue' : 'No completed tickets'}
          </Text>
          <Text style={styles.emptySubtitle}>
            New customer orders will pop up instantly on this screen.
          </Text>
        </View>
      ) : (
        <FlatList
          data={displayedTickets}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.ticketList}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => {
                setIsRefreshing(true);
                fetchTickets();
              }}
              tintColor="#f59e0b"
            />
          }
          renderItem={({ item }) => {
            const isPending = item.status === 'pending' || item.status === 'accepted';
            const isPreparing = item.status === 'preparing';
            const isReady = item.status === 'ready';

            return (
              <View
                style={[
                  styles.ticketCard,
                  isPending && styles.ticketCardPending,
                  isPreparing && styles.ticketCardPreparing,
                  isReady && styles.ticketCardReady,
                ]}
              >
                {/* Header */}
                <View style={styles.ticketHeader}>
                  <View>
                    <Text style={styles.ticketNumber}>Ticket #{item.ticket_number}</Text>
                    <Text style={styles.orderRef}>
                      Order #{item.order?.order_number || item.order_id} •{' '}
                      {item.order?.table
                        ? `Table ${formatTableLabel(item.order.table.table_number)}`
                        : 'Takeaway'}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.statusPill,
                      isPending && { backgroundColor: '#78350f' },
                      isPreparing && { backgroundColor: '#1e3a8a' },
                      isReady && { backgroundColor: '#064e3b' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusPillText,
                        isPending && { color: '#fbbf24' },
                        isPreparing && { color: '#60a5fa' },
                        isReady && { color: '#34d399' },
                      ]}
                    >
                      {item.status.toUpperCase()}
                    </Text>
                  </View>
                </View>

                {/* Items */}
                <View style={styles.itemsContainer}>
                  {item.items.map((subItem) => (
                    <View key={subItem.id} style={styles.itemRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemNameText}>
                          {subItem.quantity}x {subItem.item_name}
                        </Text>
                        {subItem.special_instructions && (
                          <Text style={styles.instructionsText}>
                            Note: {subItem.special_instructions}
                          </Text>
                        )}
                      </View>

                      {/* Readiness is tracked per stall ticket; the API has no per-item status endpoint */}
                      {subItem.status === 'ready' && (
                        <Text style={styles.itemReadyBadge}>Ready ✓</Text>
                      )}
                    </View>
                  ))}
                </View>

                {/* Ticket Action Buttons */}
                <View style={styles.actionRow}>
                  {isPending && (
                    <TouchableOpacity
                      style={styles.startPrepBtn}
                      onPress={() => handleUpdateTicketStatus(item.id, 'preparing')}
                      disabled={actionLoadingId === item.id}
                    >
                      <Text style={styles.startPrepBtnText}>▶ Start Preparation</Text>
                    </TouchableOpacity>
                  )}

                  {isPreparing && (
                    <TouchableOpacity
                      style={styles.allReadyBtn}
                      onPress={() => handleUpdateTicketStatus(item.id, 'ready')}
                      disabled={actionLoadingId === item.id}
                    >
                      <Text style={styles.allReadyBtnText}>✓ All Items Ready</Text>
                    </TouchableOpacity>
                  )}

                  {isReady && (
                    <View style={styles.servedBtn}>
                      <Text style={styles.servedBtnText}>Waiting for waiter pickup</Text>
                    </View>
                  )}
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#090d16',
  },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  stallTitle: {
    color: '#f9fafb',
    fontSize: 18,
    fontWeight: '900',
  },
  stallSubtitle: {
    color: '#9ca3af',
    fontSize: 11,
    marginTop: 2,
    fontWeight: '600',
  },
  logoutBtn: {
    backgroundColor: '#374151',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  logoutBtnText: {
    color: '#f3f4f6',
    fontSize: 12,
    fontWeight: '700',
  },
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
    gap: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#1f2937',
  },
  tabActive: {
    backgroundColor: '#f59e0b',
  },
  tabText: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '700',
  },
  tabTextActive: {
    color: '#111827',
  },
  emptyView: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 80,
    paddingHorizontal: 30,
  },
  emptyEmoji: {
    fontSize: 50,
    marginBottom: 10,
  },
  emptyTitle: {
    color: '#f3f4f6',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptySubtitle: {
    color: '#9ca3af',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 6,
  },
  ticketList: {
    padding: 16,
    gap: 12,
  },
  ticketCard: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#374151',
  },
  ticketCardPending: {
    borderColor: '#f59e0b',
  },
  ticketCardPreparing: {
    borderColor: '#3b82f6',
  },
  ticketCardReady: {
    borderColor: '#10b981',
  },
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  ticketNumber: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
  },
  orderRef: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '900',
  },
  itemsContainer: {
    gap: 8,
    marginBottom: 14,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  itemNameText: {
    color: '#f9fafb',
    fontSize: 15,
    fontWeight: '800',
  },
  instructionsText: {
    color: '#fbbf24',
    fontSize: 11,
    marginTop: 2,
    fontStyle: 'italic',
  },
  itemReadyBtn: {
    backgroundColor: '#064e3b',
    borderWidth: 1,
    borderColor: '#10b981',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  itemReadyBtnText: {
    color: '#34d399',
    fontSize: 11,
    fontWeight: '700',
  },
  itemReadyBadge: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: '800',
  },
  actionRow: {
    marginTop: 4,
  },
  startPrepBtn: {
    backgroundColor: '#d97706',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  startPrepBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  allReadyBtn: {
    backgroundColor: '#059669',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  allReadyBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  servedBtn: {
    backgroundColor: '#374151',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  servedBtnText: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '700',
  },
});

