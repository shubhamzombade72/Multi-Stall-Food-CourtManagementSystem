import React, { useState, useEffect } from 'react';
import {
  useWindowDimensions,
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { DiningTable, MenuItem, Stall, OrderItemInput, OfflineQueuedOrder } from '../../types';
import { getApiClient, postOrder } from '../../api/client';
import { classifyStatus, newIdempotencyKey } from '../../offline/syncEngine';
import { offlineStore } from '../../storage/offlineStore';
import { useAuth } from '../../context/AuthContext';
import { formatTableLabel } from '../../utils/tableFormatter';
import { menuColumns } from '../../utils/layout';

interface Props {
  table: DiningTable | null;
  onBack: () => void;
  onOrderPlaced: () => void;
}

export const NewOrderScreen: React.FC<Props> = ({ table, onBack, onOrderPlaced }) => {
  // One dish per row on a phone; 2-4 side by side on wider screens, so price and + ADD stay close together
  const { width } = useWindowDimensions();
  const columns = menuColumns(width);
  const { checkOfflineQueue } = useAuth();
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [selectedStallId, setSelectedStallId] = useState<number | 'all'>('all');
  const [cart, setCart] = useState<{ [itemId: number]: OrderItemInput }>({});
  const [customerName, setCustomerName] = useState('');
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadCatalog();
  }, []);

  const loadCatalog = async () => {
    try {
      const client = await getApiClient();
      const [stallsRes, menuRes] = await Promise.all([
        client.get('/stalls'),
        client.get('/menu', { params: { available_only: 1 } }),
      ]);

      if (stallsRes.data.success && menuRes.data.success) {
        setStalls(stallsRes.data.data);
        setMenuItems(menuRes.data.data);
      }
    } catch {
      // Offline fallback
      const cached = await offlineStore.getCachedCatalog();
      setStalls(cached.stalls);
      setMenuItems(cached.menu);
    } finally {
      setIsLoading(false);
    }
  };

  const addItemToCart = (item: MenuItem) => {
    setCart((prev) => {
      const existing = prev[item.id];
      const qty = existing ? existing.quantity + 1 : 1;
      return {
        ...prev,
        [item.id]: {
          menu_item_id: item.id,
          stall_id: item.stall_id,
          name: item.name,
          quantity: qty,
          unit_price: parseFloat(item.price),
        },
      };
    });
  };

  const removeItemFromCart = (itemId: number) => {
    setCart((prev) => {
      const existing = prev[itemId];
      if (!existing) return prev;
      if (existing.quantity <= 1) {
        const copy = { ...prev };
        delete copy[itemId];
        return copy;
      }
      return {
        ...prev,
        [itemId]: { ...existing, quantity: existing.quantity - 1 },
      };
    });
  };

  const cartList = Object.values(cart);
  const totalAmount = cartList.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);

  const handleSubmitOrder = async () => {
    if (cartList.length === 0) {
      Alert.alert('Empty Cart', 'Please add items before submitting the order.');
      return;
    }

    setIsSubmitting(true);

    // One key per order for its whole life: the online attempt and every offline retry share it
    const order: OfflineQueuedOrder = {
      id: newIdempotencyKey('waiter'),
      client_timestamp: Date.now(),
      sync_status: 'pending',
      order_type: 'dine_in',
      order_channel: 'waiter_app',
      table_id: table ? table.id : null,
      customer_name: customerName || (table ? `Table ${formatTableLabel(table.table_number)}` : 'Guest Customer'),
      notes: notes,
      items: cartList.map((item) => ({
        menu_item_id: item.menu_item_id,
        quantity: item.quantity,
        name: item.name,
        unit_price: item.unit_price,
      })),
    };

    try {
      const res = await postOrder(order);
      const verdict = classifyStatus(res.status);

      if (verdict === 'ok') {
        Alert.alert(
          'Order Dispatched!',
          `Order #${res.data.data.order_number} created and split into stall kitchen tickets.`,
          [{ text: 'OK', onPress: onOrderPlaced }]
        );
      } else if (verdict === 'reject') {
        // The server refused the order (e.g. item out of stock): queueing it would not help
        Alert.alert('Order Not Accepted', res.data?.message || `Server rejected the order (HTTP ${res.status}).`);
      } else {
        await queueForSync(order, res.data?.message);
      }
    } catch (err: any) {
      // No response: offline, or the response was lost after the server committed
      await queueForSync(order, err?.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const queueForSync = async (order: OfflineQueuedOrder, reason?: string) => {
    await offlineStore.enqueueOrder({
      ...order,
      retry_count: 1,
      last_attempt_at: Date.now(),
      error_message: reason,
    });
    await checkOfflineQueue();

    Alert.alert(
      'Saved Offline: Order Queued',
      'The local server could not be reached. The order is saved on this device and will be sent automatically when the connection returns. Do NOT re-enter it.',
      [{ text: 'OK', onPress: onOrderPlaced }]
    );
  };

  const filteredItems = menuItems.filter((item) =>
    selectedStallId === 'all' ? true : item.stall_id === selectedStallId
  );

  return (
    <View style={styles.container}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>
          {table ? `Table ${formatTableLabel(table.table_number)}` : 'Walk-in Order'}
        </Text>
        <View style={styles.badgePlaceholder} />
      </View>

      {/* Stall Filter Chips */}
      <View style={styles.filterSection}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterList}>
          <TouchableOpacity
            style={[styles.filterChip, selectedStallId === 'all' && styles.filterChipActive]}
            onPress={() => setSelectedStallId('all')}
          >
            <Text
              style={[styles.filterChipText, selectedStallId === 'all' && styles.filterChipTextActive]}
            >
              All Stalls
            </Text>
          </TouchableOpacity>

          {stalls.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={[styles.filterChip, selectedStallId === s.id && styles.filterChipActive]}
              onPress={() => setSelectedStallId(s.id)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  selectedStallId === s.id && styles.filterChipTextActive,
                ]}
              >
                {s.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Menu List */}
      {isLoading ? (
        <ActivityIndicator size="large" color="#ea580c" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filteredItems}
          keyExtractor={(item) => item.id.toString()}
          key={`menu-cols-${columns}`}
          numColumns={columns}
          columnWrapperStyle={columns > 1 ? styles.menuRow : undefined}
          contentContainerStyle={styles.menuList}
          renderItem={({ item }) => {
            const inCart = cart[item.id]?.quantity || 0;
            return (
              <View style={columns > 1 ? [styles.menuCell, { width: `${100 / columns}%` }] : undefined}>
              <View style={[styles.menuItemCard, columns > 1 && styles.menuItemCardInGrid]}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <View style={styles.itemTitleRow}>
                    <View
                      style={[
                        styles.vegBadge,
                        { borderColor: item.is_veg ? '#10b981' : '#ef4444' },
                      ]}
                    >
                      <View
                        style={[
                          styles.vegDot,
                          { backgroundColor: item.is_veg ? '#10b981' : '#ef4444' },
                        ]}
                      />
                    </View>
                    <Text style={styles.itemName}>{item.name}</Text>
                  </View>
                  <Text style={styles.itemStall}>
                    {stalls.find((s) => s.id === item.stall_id)?.name || 'Food Stall'}
                  </Text>
                  <Text style={styles.itemPrice}>₹{parseFloat(item.price).toFixed(2)}</Text>
                </View>

                {/* Counter buttons */}
                {inCart > 0 ? (
                  <View style={styles.counterRow}>
                    <TouchableOpacity
                      style={styles.qtyButton}
                      onPress={() => removeItemFromCart(item.id)}
                    >
                      <Text style={styles.qtyButtonText}>-</Text>
                    </TouchableOpacity>
                    <Text style={styles.qtyText}>{inCart}</Text>
                    <TouchableOpacity
                      style={[styles.qtyButton, styles.qtyButtonPlus]}
                      onPress={() => addItemToCart(item)}
                    >
                      <Text style={styles.qtyButtonTextPlus}>+</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.addButton}
                    onPress={() => addItemToCart(item)}
                  >
                    <Text style={styles.addButtonText}>+ ADD</Text>
                  </TouchableOpacity>
                )}
              </View>
              </View>
            );
          }}
        />
      )}

      {/* Bottom Cart Drawer */}
      {cartList.length > 0 && (
        <View style={styles.cartDrawer}>
          <View style={styles.customerInputs}>
            <TextInput
              style={styles.inputField}
              placeholder="Guest Name (Optional)"
              placeholderTextColor="#64748b"
              value={customerName}
              onChangeText={setCustomerName}
            />
          </View>

          <View style={styles.cartSummaryRow}>
            <View>
              <Text style={styles.cartItemCountText}>
                {cartList.reduce((sum, i) => sum + i.quantity, 0)} Items across{' '}
                {new Set(cartList.map((i) => i.stall_id)).size} Stalls
              </Text>
              <Text style={styles.cartTotalText}>₹{totalAmount.toFixed(2)}</Text>
            </View>

            <TouchableOpacity
              style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
              onPress={handleSubmitOrder}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitButtonText}>Send to Kitchens ➔</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
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
  badgePlaceholder: {
    width: 60,
  },
  filterSection: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  filterList: {
    paddingHorizontal: 16,
    gap: 8,
  },
  filterChip: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  filterChipActive: {
    backgroundColor: '#ea580c',
    borderColor: '#ea580c',
  },
  filterChipText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
  },
  filterChipTextActive: {
    color: '#ffffff',
  },
  menuList: {
    padding: 16,
    paddingBottom: 160,
  },
  menuRow: {
    marginHorizontal: -5,
  },
  menuCell: {
    paddingHorizontal: 5,
  },
  menuItemCardInGrid: {
    flex: 1,
  },
  menuItemCard: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#334155',
  },
  itemTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  vegBadge: {
    width: 14,
    height: 14,
    borderWidth: 1.5,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  vegDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  itemName: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  itemStall: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  itemPrice: {
    color: '#ea580c',
    fontSize: 13,
    fontWeight: '800',
    marginTop: 4,
  },
  addButton: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#ea580c',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  addButtonText: {
    color: '#ea580c',
    fontWeight: '800',
    fontSize: 12,
  },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  qtyButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  qtyButtonPlus: {
    backgroundColor: '#ea580c',
    borderRadius: 8,
  },
  qtyButtonText: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '800',
  },
  qtyButtonTextPlus: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  qtyText: {
    color: '#f8fafc',
    paddingHorizontal: 8,
    fontWeight: '800',
    fontSize: 13,
  },
  cartDrawer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 10,
  },
  customerInputs: {
    marginBottom: 10,
  },
  inputField: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#f8fafc',
    fontSize: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cartSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cartItemCountText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  cartTotalText: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '900',
  },
  submitButton: {
    backgroundColor: '#ea580c',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
});

