import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { DiningTable } from '../../types';
import { getApiClient } from '../../api/client';
import { offlineStore } from '../../storage/offlineStore';
import { formatTableLabel } from '../../utils/tableFormatter';

interface Props {
  onSelectTable: (table: DiningTable) => void;
  onOpenReadyAlerts: () => void;
  readyCount: number;
}

export const TableListScreen: React.FC<Props> = ({
  onSelectTable,
  onOpenReadyAlerts,
  readyCount,
}) => {
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    loadTables();
  }, []);

  const loadTables = async () => {
    try {
      const client = await getApiClient();
      const res = await client.get('/waiter/tables');
      if (res.data.success) {
        setTables(res.data.data);
      }
    } catch {
      // Offline fallback
      const cached = await offlineStore.getCachedCatalog();
      if (cached.tables.length > 0) {
        setTables(cached.tables);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const renderTableCard = ({ item }: { item: DiningTable }) => {
    const isOccupied = item.status === 'occupied';

    return (
      <TouchableOpacity
        style={[styles.tableCard, isOccupied ? styles.tableOccupied : styles.tableAvailable]}
        onPress={() => onSelectTable(item)}
      >
        <View style={styles.tableHeader}>
          <Text style={styles.tableNumber}>{formatTableLabel(item.table_number)}</Text>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isOccupied ? '#f59e0b' : '#10b981' },
            ]}
          />
        </View>

        <Text style={styles.capacityText}>Seats: {item.capacity} Guests</Text>

        <View style={styles.badgeContainer}>
          <Text
            style={[
              styles.statusBadge,
              isOccupied ? styles.occupiedBadge : styles.availableBadge,
            ]}
          >
            {isOccupied ? 'Occupied' : 'Available'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Ready Items Banner if any */}
      {readyCount > 0 && (
        <TouchableOpacity style={styles.alertBanner} onPress={onOpenReadyAlerts}>
          <Text style={styles.alertBannerIcon}>🔔</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.alertBannerTitle}>
              {readyCount} Kitchen Dish{readyCount > 1 ? 'es' : ''} Ready for Pickup!
            </Text>
            <Text style={styles.alertBannerSubtitle}>Tap to inspect and serve to tables</Text>
          </View>
          <Text style={styles.alertBannerArrow}>➔</Text>
        </TouchableOpacity>
      )}

      {/* Tables Grid */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Dining Hall Tables</Text>
        <Text style={styles.sectionSubtitle}>Tap a table to take order or view status</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color="#ea580c" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={tables}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderTableCard}
          numColumns={2}
          columnWrapperStyle={styles.row}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => {
                setIsRefreshing(true);
                loadTables();
              }}
              tintColor="#ea580c"
            />
          }
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#059669',
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
    shadowColor: '#059669',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  alertBannerIcon: {
    fontSize: 22,
    marginRight: 10,
  },
  alertBannerTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  alertBannerSubtitle: {
    color: '#d1fae5',
    fontSize: 11,
    fontWeight: '500',
  },
  alertBannerArrow: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  sectionHeader: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#f8fafc',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  listContent: {
    paddingBottom: 30,
  },
  row: {
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  tableCard: {
    width: '48%',
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
  },
  tableAvailable: {
    borderColor: '#334155',
  },
  tableOccupied: {
    borderColor: '#f59e0b',
  },
  tableHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tableNumber: {
    fontSize: 18,
    fontWeight: '900',
    color: '#f8fafc',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  capacityText: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 6,
  },
  badgeContainer: {
    marginTop: 10,
    alignItems: 'flex-start',
  },
  statusBadge: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  availableBadge: {
    backgroundColor: '#064e3b',
    color: '#34d399',
  },
  occupiedBadge: {
    backgroundColor: '#78350f',
    color: '#fde68a',
  },
});

