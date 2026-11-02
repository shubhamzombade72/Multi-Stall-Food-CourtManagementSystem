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
import { getApiClient } from '../../api/client';
import { formatTableLabel } from '../../utils/tableFormatter';

// One card per ready stall ticket: serving is confirmed per ticket (POST /waiter/tickets/{id}/served)
interface ReadyItem {
  ticket_item_id: number; // stall kitchen ticket id
  item_name: string;
  quantity: number;
  stall_name: string;
  table_number: string | null;
  order_number: string;
  ready_at: string;
}

const toReadyItem = (t: any): ReadyItem => ({
  ticket_item_id: t.id,
  item_name: (t.ticket_items || [])
    .map((ti: any) => `${ti.quantity}x ${ti.order_item?.item_name ?? 'Item'}`)
    .join(', '),
  quantity: (t.ticket_items || []).reduce((sum: number, ti: any) => sum + (ti.quantity || 0), 0),
  stall_name: t.stall?.name ?? 'Stall',
  table_number: t.order?.table?.table_number ?? null,
  order_number: t.order?.order_number ?? String(t.order_id),
  ready_at: t.ready_at,
});

interface Props {
  onBack: () => void;
}

export const ReadyDishesScreen: React.FC<Props> = ({ onBack }) => {
  const [readyItems, setReadyItems] = useState<ReadyItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [servingId, setServingId] = useState<number | null>(null);

  useEffect(() => {
    fetchReadyDishes();
    const interval = setInterval(fetchReadyDishes, 5000); // Poll ready dishes every 5s
    return () => clearInterval(interval);
  }, []);

  const fetchReadyDishes = async () => {
    try {
      const client = await getApiClient();
      const res = await client.get('/waiter/ready-tickets');
      if (res.data.success) {
        setReadyItems((res.data.data as any[]).map(toReadyItem));
      }
    } catch {
      // Offline: keep existing items
    } finally {
      setIsLoading(false);
    }
  };

  const handleMarkServed = async (ticketItemId: number) => {
    setServingId(ticketItemId);
    try {
      const client = await getApiClient();
      const res = await client.post(`/waiter/tickets/${ticketItemId}/served`);
      if (res.data.success) {
        setReadyItems((prev) => prev.filter((i) => i.ticket_item_id !== ticketItemId));
        Alert.alert('Delivered', 'Item marked as served to table.');
      }
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to update serving status');
    } finally {
      setServingId(null);
    }
  };

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>← Tables</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Ready Kitchen Dishes</Text>
        <TouchableOpacity onPress={fetchReadyDishes}>
          <Text style={styles.refreshIcon}>🔄</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color="#10b981" style={{ marginTop: 40 }} />
      ) : readyItems.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🍽️</Text>
          <Text style={styles.emptyTitle}>All Kitchen Orders Delivered</Text>
          <Text style={styles.emptySubtitle}>
            When kitchen prepares dishes, notifications appear here in real time.
          </Text>
        </View>
      ) : (
        <FlatList
          data={readyItems}
          keyExtractor={(item) => item.ticket_item_id.toString()}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.tableBadge}>
                  <Text style={styles.tableBadgeText}>
                    {item.table_number ? `TABLE ${formatTableLabel(item.table_number)}` : 'TAKEAWAY'}
                  </Text>
                </View>
                <Text style={styles.orderNumber}>#{item.order_number}</Text>
              </View>

              <View style={styles.dishRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dishName}>{item.item_name}</Text>
                  <Text style={styles.stallName}>From: {item.stall_name}</Text>
                </View>

                <TouchableOpacity
                  style={[
                    styles.serveButton,
                    servingId === item.ticket_item_id && styles.serveButtonDisabled,
                  ]}
                  onPress={() => handleMarkServed(item.ticket_item_id)}
                  disabled={servingId === item.ticket_item_id}
                >
                  {servingId === item.ticket_item_id ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.serveButtonText}>Mark Served ✓</Text>
                  )}
                </TouchableOpacity>
              </View>
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
  refreshIcon: {
    fontSize: 16,
    color: '#94a3b8',
    padding: 4,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 80,
    paddingHorizontal: 30,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#f8fafc',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 6,
  },
  listContent: {
    padding: 16,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#10b981',
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  tableBadge: {
    backgroundColor: '#064e3b',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tableBadgeText: {
    color: '#34d399',
    fontWeight: '800',
    fontSize: 11,
  },
  orderNumber: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  dishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dishName: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '800',
  },
  stallName: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  serveButton: {
    backgroundColor: '#10b981',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  serveButtonDisabled: {
    opacity: 0.6,
  },
  serveButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
});

