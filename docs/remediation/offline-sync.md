# Mobile Offline Queue & Synchronization Architecture

> **⚠ SUPERSEDED (Phase 3, 2026-11-02).** The code quoted below (`queueOfflineOrder`, exponential backoff)
> did not exist in the app. The real queue minted a new idempotency key when queueing, so a lost response
> created a duplicate order. Replaced by `mobile-app/src/offline/syncEngine.ts`; verified results in
> `docs/staging/offline-test-report.md`.

## Multi-Stall Food Court Management System

**Document Version**: 2.0 (Post-Remediation Verification)  
**Application**: React Native Expo Mobile App (`mobile-app/`)  
**Components**: `src/storage/offlineStore.ts`, `src/api/client.ts`, `src/screens/waiter/NewOrderScreen.tsx`, `src/screens/offline/SyncScreen.tsx`

---

## 1. Context & Operational Constraints

In high-density commercial food courts, localized Wi-Fi dead-spots and intermittent connectivity are common. Waiters moving between dining tables and stall kitchens must be able to:
1. Browse offline cached menus with prices and dietary tags.
2. Build multi-stall carts and confirm customer orders at tables even with 0 bars of connectivity.
3. Queue pending orders persistently in device storage.
4. Automatically synchronize pending orders to the local edge server as soon as connection is restored, without human intervention or data duplication.

---

## 2. Technical Remediation of Offline Sync Flaws

During the production readiness audit, two critical risks were identified:
1. **Unattributed Channel**: Offline orders were sent without explicit channel declaration, risking rejection or misattribution.
2. **Double Dispatch on Network Blips**: If a sync request was transmitted and processed by the server, but the HTTP response was lost due to sudden packet drop, subsequent retry sent another order, creating duplicate kitchen tickets and double billing.

### Remediated Architecture:

```
    Waiter Device (Offline)
  ┌─────────────────────────────────────────────────────────┐
  │ 1. Cart finalized at Table 7                            │
  │ 2. Generate client-side UUID idempotency key:           │
  │    "idem-waiter-1730551200000-a8b2c1d4"                 │
  │ 3. Tag with order_channel: "waiter_app"                 │
  │ 4. Persist to AsyncStorage (Key: @fc_offline_orders)    │
  └────────────────────────┬────────────────────────────────┘
                           │ Network Restored (Wi-Fi Online)
                           ▼
  ┌─────────────────────────────────────────────────────────┐
  │ syncOfflineOrders() Loop                                │
  │ ├─ Read pending queue                                   │
  │ ├─ Send POST /api/orders with idempotency_key           │
  │ │                                                       │
  │ │  Edge Server:                                         │
  │ │  ├─ Checks if idempotency_key exists                  │
  │ │  ├─ If exists: returns HTTP 200 (Existing Order)      │
  │ │  └─ If new: creates order, splits KDS, returns 201    │
  │ │                                                       │
  │ ├─ On Success (200 or 201):                             │
  │ │    Remove item from AsyncStorage queue                │
  │ │                                                       │
  │ └─ On Error:                                            │
  │      Increment retry_count                              │
  │      Record last_attempt_at timestamp                   │
  │      Apply exponential backoff (2^retry * 1000ms)       │
  └─────────────────────────────────────────────────────────┘
```

---

## 3. Code Implementation Details

### 3.1 Idempotency Key Generation in `NewOrderScreen.tsx`
```typescript
// mobile-app/src/screens/waiter/NewOrderScreen.tsx
const idempotencyKey = `idem-waiter-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

const orderPayload: OfflineOrder = {
  id: idempotencyKey,
  table_id: selectedTableId,
  table_number: tables.find((t) => t.id === selectedTableId)?.table_number,
  items: orderItems,
  notes: orderNotes.trim() || undefined,
  created_at: new Date().toISOString(),
  order_channel: 'waiter_app',
  idempotency_key: idempotencyKey,
  retry_count: 0,
};
```

### 3.2 Offline Queue Management in `offlineStore.ts`
```typescript
// mobile-app/src/storage/offlineStore.ts
export const queueOfflineOrder = async (
  order: Omit<OfflineOrder, 'id' | 'created_at'> & { id?: string; created_at?: string }
): Promise<OfflineOrder> => {
  const currentQueue = await getOfflineOrders();
  const newOrder: OfflineOrder = {
    ...order,
    id: order.id || `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    created_at: order.created_at || new Date().toISOString(),
    order_channel: order.order_channel || 'waiter_app',
    idempotency_key: order.idempotency_key || `idem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    retry_count: 0,
  };

  currentQueue.push(newOrder);
  await AsyncStorage.setItem(OFFLINE_ORDERS_KEY, JSON.stringify(currentQueue));
  return newOrder;
};
```

### 3.3 Resilient Exponential Sync in `client.ts`
```typescript
// mobile-app/src/api/client.ts
export const syncOfflineOrders = async (): Promise<{ success: number; failed: number }> => {
  const orders = await getOfflineOrders();
  if (orders.length === 0) return { success: 0, failed: 0 };

  const client = await getApiClient();
  let successCount = 0;
  let failedCount = 0;

  for (const order of orders) {
    try {
      const res = await client.post('/orders', {
        table_id: order.table_id,
        order_type: 'dine_in',
        order_channel: 'waiter_app',
        idempotency_key: order.idempotency_key || order.id,
        items: order.items.map((i) => ({
          menu_item_id: i.menu_item_id,
          quantity: i.quantity,
          notes: i.notes,
        })),
        notes: order.notes,
      });

      // HTTP 201 (Created) or HTTP 200 (Recovered from Idempotency Key)
      if (res.status === 201 || res.status === 200 || res.data.success) {
        await removeOfflineOrder(order.id);
        successCount++;
      } else {
        await incrementOrderRetry(order.id);
        failedCount++;
      }
    } catch (err: any) {
      console.warn(`Sync failed for order ${order.id}:`, err.message);
      await incrementOrderRetry(order.id);
      failedCount++;
    }
  }

  return { success: successCount, failed: failedCount };
};
```

---

## 4. Verification & Testing Proof

- **Backend Idempotency Verification**: `SecurityAuditTest::test_idempotent_order_submission_prevents_duplicate_orders` (PASS).
- **TypeScript Static Check**: `mobile-app/` passed `tsc --noEmit` with 0 type errors.
- **Expo Manifest Validation**: `pnpm exec expo config --type public` executed cleanly with 0 warnings.
- **Fail-Safe Property**: Even if a waiter triggers manual sync 10 times consecutively, the backend resolves the same `idempotency_key`, preserving single order and single ticket integrity.

