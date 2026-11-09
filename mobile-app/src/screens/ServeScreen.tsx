import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert, RefreshControl, useWindowDimensions } from 'react-native';
import { serveColumns } from '../utils/layout';
import { fetchBoard, markItemServed } from '../api/board';
import { formatTableLabel } from '../utils/tableFormatter';
import { BoardItem, BoardOrder, isToServe, serveCards, toServeCount, waitingMinutes, withServed } from '../utils/serveBoard';

interface Props {
  /** Owner, cashier, waiter: a Mark Served button on every dish still to serve. Kitchen staff only watch. */
  canServe: boolean;
  title: string;
  subtitle?: string;
  /** Left of the title: Back for the waiter, Log Out for kitchen staff. */
  leftAction?: { label: string; onPress: () => void };
  /** Tells the parent how many dishes are still to serve (header badge, tab count). */
  onCount?: (count: number) => void;
}

const POLL_MS = 5000;

/**
 * Dishes still to serve, one card per order, the same states as the desktop's Orders & Table Tracking:
 * "Not served" (with Mark Served for those allowed to serve) and "Served". No Ready step.
 */
export const ServeScreen: React.FC<Props> = ({ canServe, title, subtitle, leftAction, onCount }) => {
  const [orders, setOrders] = useState<BoardOrder[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorText, setErrorText] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [servingId, setServingId] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  // One card per row on a phone; 2-3 side by side on a tablet in landscape
  const { width } = useWindowDimensions();
  const columns = serveColumns(width);
  const onCountRef = useRef(onCount);
  onCountRef.current = onCount;

  const load = useCallback(async () => {
    try {
      const board = await fetchBoard();
      setOrders(board);
      setStatus('ready');
      setErrorText('');
      setNow(Date.now());
      onCountRef.current?.(toServeCount(board));
    } catch (err: any) {
      // Keep what is on screen; say why instead of pretending the list is empty
      setErrorText(err?.response?.status === 403 ? 'This account cannot see the order list.' : 'Cannot reach the food court server. Showing the last list.');
      setStatus((s) => (s === 'loading' ? 'error' : s));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const cards = useMemo(() => serveCards(orders), [orders]);
  const remaining = useMemo(() => toServeCount(orders), [orders]);

  const serve = async (item: BoardItem) => {
    setServingId(item.id);
    try {
      await markItemServed(item.id, item.version);
      setOrders((prev) => {
        const next = withServed(prev, item.id);
        onCountRef.current?.(toServeCount(next));
        return next;
      });
    } catch (err: any) {
      const code = err?.response?.status;
      Alert.alert(
        'Not marked served',
        code === 409
          ? 'Someone else changed this dish a moment ago. The list has been refreshed.'
          : err?.response?.data?.message || 'Could not reach the server. Try again.'
      );
      load();
    } finally {
      setServingId(null);
    }
  };

  const renderItem = (item: BoardItem) => {
    const open = isToServe(item);
    return (
      <View key={item.id} style={styles.itemRow} testID={`serve-item-${item.id}`}>
        <Text style={styles.qty}>{item.quantity}×</Text>
        <View style={styles.itemText}>
          <Text style={[styles.itemName, !open && styles.itemNameDone]}>{item.name ?? 'Item'}</Text>
          {!!item.stall?.name && <Text style={styles.itemStall}>{item.stall.name}</Text>}
          {!!item.notes && <Text style={styles.itemNotes}>{item.notes}</Text>}
        </View>
        {!open ? (
          <View style={[styles.chip, styles.chipServed]}>
            <Text style={[styles.chipText, styles.chipServedText]}>✓ Served</Text>
          </View>
        ) : canServe ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`Mark ${item.name ?? 'item'} served`}
            style={[styles.serveBtn, servingId === item.id && styles.serveBtnBusy]}
            disabled={servingId !== null}
            onPress={() => serve(item)}
          >
            {servingId === item.id ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.serveBtnText}>Mark Served</Text>}
          </TouchableOpacity>
        ) : (
          <View style={[styles.chip, styles.chipOpen]}>
            <Text style={[styles.chipText, styles.chipOpenText]}>Not served</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        {leftAction ? (
          <TouchableOpacity style={styles.leftBtn} onPress={leftAction.onPress}>
            <Text style={styles.leftBtnText}>{leftAction.label}</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 60 }} />
        )}
        <View style={styles.titleBox}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{subtitle ?? `${remaining} dish${remaining === 1 ? '' : 'es'} to serve`}</Text>
        </View>
        <TouchableOpacity onPress={() => { setRefreshing(true); load(); }} accessibilityLabel="Refresh">
          <Text style={styles.refresh}>⟳</Text>
        </TouchableOpacity>
      </View>

      {!!errorText && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>{errorText}</Text>
        </View>
      )}

      {status === 'loading' ? (
        <ActivityIndicator size="large" color="#ea580c" style={{ marginTop: 40 }} />
      ) : cards.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🍽️</Text>
          <Text style={styles.emptyTitle}>{status === 'error' ? 'Order list unavailable' : 'Everything is served'}</Text>
          <Text style={styles.emptySubtitle}>{status === 'error' ? errorText : 'New orders appear here automatically.'}</Text>
        </View>
      ) : (
        <FlatList
          data={cards}
          key={`serve-cols-${columns}`}
          numColumns={columns}
          columnWrapperStyle={columns > 1 ? styles.gridRow : undefined}
          keyExtractor={(o) => String(o.id)}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#ea580c" />}
          renderItem={({ item: order }) => {
            const left = order.items.filter(isToServe).length;
            const mins = waitingMinutes(order.created_at, now);
            return (
              <View style={columns > 1 ? [styles.gridCell, { width: `${100 / columns}%` }] : undefined}>
              <View style={[styles.card, columns > 1 && styles.cardInGrid, left === 0 && styles.cardDone]} testID={`serve-order-${order.order_number}`}>
                <View style={styles.cardHead}>
                  <View style={[styles.badge, left === 0 && styles.badgeDone]}>
                    <Text style={[styles.badgeText, left === 0 && styles.badgeDoneText]}>
                      {order.table ? `TABLE ${formatTableLabel(order.table.table_number)}` : order.order_type === 'takeaway' ? 'TAKEAWAY' : 'COUNTER'}
                    </Text>
                  </View>
                  <Text style={styles.orderNo}>#{order.order_number}</Text>
                </View>
                <Text style={styles.cardMeta}>
                  {left === 0 ? 'All served' : `${order.items.length - left}/${order.items.length} served`} · {mins} min ago
                </Text>
                {!!order.notes && <Text style={styles.orderNotes}>Note: {order.notes}</Text>}
                {order.items.map(renderItem)}
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
  container: { flex: 1, backgroundColor: '#0f172a' },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, backgroundColor: '#1e293b', borderBottomWidth: 1, borderBottomColor: '#334155',
  },
  leftBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#0f172a' },
  leftBtnText: { color: '#38bdf8', fontWeight: '700', fontSize: 13 },
  titleBox: { flex: 1, alignItems: 'center' },
  title: { color: '#f8fafc', fontSize: 16, fontWeight: '800' },
  subtitle: { color: '#94a3b8', fontSize: 11, fontWeight: '600', marginTop: 2 },
  refresh: { fontSize: 22, color: '#94a3b8', paddingHorizontal: 6 },
  errorBar: { backgroundColor: '#7f1d1d', paddingHorizontal: 16, paddingVertical: 8 },
  errorText: { color: '#fecaca', fontSize: 12, fontWeight: '600' },
  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: 30 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: '#f8fafc', textAlign: 'center' },
  emptySubtitle: { fontSize: 12, color: '#94a3b8', textAlign: 'center', marginTop: 6 },
  list: { padding: 16, paddingBottom: 32 },
  gridRow: { marginHorizontal: -6 },
  gridCell: { paddingHorizontal: 6 },
  cardInGrid: { flex: 1 },
  card: { backgroundColor: '#1e293b', borderRadius: 16, padding: 14, marginBottom: 12, borderLeftWidth: 4, borderLeftColor: '#ea580c', borderWidth: 1, borderColor: '#334155' },
  cardDone: { borderLeftColor: '#10b981', opacity: 0.75 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { backgroundColor: '#431407', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { color: '#fdba74', fontWeight: '800', fontSize: 11 },
  badgeDone: { backgroundColor: '#064e3b' },
  badgeDoneText: { color: '#34d399' },
  orderNo: { color: '#94a3b8', fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },
  cardMeta: { color: '#94a3b8', fontSize: 11, fontWeight: '600', marginTop: 6, marginBottom: 4 },
  orderNotes: { color: '#fbbf24', fontSize: 12, fontWeight: '600', marginBottom: 4 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: '#334155' },
  qty: { color: '#f8fafc', fontSize: 15, fontWeight: '800', minWidth: 30 },
  itemText: { flex: 1 },
  itemName: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  itemNameDone: { color: '#94a3b8' },
  itemStall: { color: '#94a3b8', fontSize: 11, fontWeight: '600', marginTop: 1 },
  itemNotes: { color: '#fbbf24', fontSize: 11, marginTop: 1 },
  serveBtn: { backgroundColor: '#ea580c', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, minWidth: 112, alignItems: 'center' },
  serveBtnBusy: { opacity: 0.6 },
  serveBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  chipText: { fontSize: 12, fontWeight: '800' },
  chipServed: { backgroundColor: '#064e3b' },
  chipServedText: { color: '#34d399' },
  chipOpen: { backgroundColor: '#334155' },
  chipOpenText: { color: '#cbd5e1' },
});
