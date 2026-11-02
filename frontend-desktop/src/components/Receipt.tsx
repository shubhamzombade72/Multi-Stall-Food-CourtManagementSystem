import React, { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { apiClient } from '../api/client';
import { printPage, logError } from '../desktop/bridge';
import type { FoodCourtSettings } from '../context/SettingsContext';

/**
 * Consolidated customer receipt, rendered from GET /billing/receipt/{orderId} (server data only:
 * line totals, tax and total are exactly what the backend stored for the order).
 */
export const ReceiptContent: React.FC<{ receipt: any; settings?: FoodCourtSettings | null }> = ({ receipt, settings }) => {
  const order = receipt.order;
  const groups: Record<string, any[]> = receipt.stall_breakdown || {};
  const payment = order.payments?.[order.payments.length - 1];
  const profile = settings?.business_profile;
  const receiptCfg = settings?.receipt;
  return (
    <div>
      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 13 }}>{(profile?.name || 'Food Court').toUpperCase()}</div>
      {profile?.address && <div style={{ textAlign: 'center' }}>{profile.address}</div>}
      {profile?.phone && <div style={{ textAlign: 'center' }}>Tel: {profile.phone}</div>}
      {receiptCfg?.show_gstin && profile?.gstin && <div style={{ textAlign: 'center' }}>GSTIN: {profile.gstin}</div>}
      {receiptCfg?.header && <div style={{ textAlign: 'center' }}>{receiptCfg.header}</div>}
      <div style={{ textAlign: 'center' }}>Consolidated Bill</div>
      <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />
      <div>Bill: {order.order_number}</div>
      <div>Date: {new Date(order.created_at).toLocaleString()}</div>
      <div>{order.table ? `Table: ${order.table.table_number}` : 'Takeaway'}</div>
      {order.customer_name && <div>Customer: {order.customer_name}</div>}
      {Object.entries(groups).map(([stall, items]) => (
        <div key={stall} style={{ marginTop: 4 }}>
          <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />
          <div style={{ fontWeight: 700 }}>{stall}</div>
          {items.map((it: any) => (
            <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>
                {it.quantity} x {it.item_name}
              </span>
              <span>{Number(it.subtotal).toFixed(2)}</span>
            </div>
          ))}
        </div>
      ))}
      <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />
      <Row label="Subtotal" value={order.subtotal} />
      <Row label="Tax" value={order.tax_amount} />
      {Number(order.discount_amount) > 0 && <Row label="Discount" value={`-${order.discount_amount}`} />}
      <Row label="TOTAL" value={order.total_amount} bold />
      {payment && (
        <>
          <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />
          <Row label={`Paid (${String(payment.payment_method).toUpperCase()})`} value={payment.amount} />
          {payment.payment_method === 'cash' && (
            <>
              <Row label="Tendered" value={payment.cash_tendered} />
              <Row label="Change" value={payment.change_returned} />
            </>
          )}
          <div>Receipt: {payment.payment_number}</div>
          <div>Cashier: {payment.cashier?.name || order.cashier?.name || '-'}</div>
        </>
      )}
      {order.payment_status !== 'paid' && <div style={{ fontWeight: 700, marginTop: 4 }}>*** UNPAID - NOT A RECEIPT ***</div>}
      <div style={{ textAlign: 'center', marginTop: 6 }}>{receiptCfg?.footer || 'Thank you!'}</div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: any; bold?: boolean }> = ({ label, value, bold }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: bold ? 700 : 400 }}>
    <span>{label}</span>
    <span>{Number(value).toFixed(2)}</span>
  </div>
);

/** Renders any content into #print-root (the only printed element) and opens the print dialog. */
export const printContent = async (node: React.ReactNode, paper: 'receipt' | 'a4' = 'receipt'): Promise<void> => {
  let host = document.getElementById('print-root');
  if (!host) {
    host = document.createElement('div');
    host.id = 'print-root';
    document.body.appendChild(host);
  }
  host.dataset.paper = paper;
  const root = createRoot(host);
  flushSync(() => root.render(node));
  try {
    await printPage(paper);
  } finally {
    root.unmount();
  }
};

/** Fetches the receipt for an order (plus the food court's receipt settings) and prints it on receipt paper. */
export const printReceipt = async (orderId: number): Promise<void> => {
  const [res, settings] = await Promise.all([
    apiClient.get(`/billing/receipt/${orderId}`),
    apiClient.get('/settings').then((r) => r.data.data as FoodCourtSettings).catch(() => null),
  ]);
  await printContent(<ReceiptContent receipt={res.data.data} settings={settings} />, 'receipt');
};

/** Button that prints the receipt for an order and reports failures inline. */
export const PrintReceiptButton: React.FC<{ orderId: number; className?: string; label?: string }> = ({ orderId, className, label }) => {
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    setBusy(true);
    try {
      await printReceipt(orderId);
    } catch (err: any) {
      logError(`Receipt print failed for order ${orderId}: ${err?.message || err}`);
      alert(err?.response?.data?.message || err?.message || 'Could not print the receipt.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" onClick={onClick} disabled={busy} className={className}>
      {busy ? 'Preparing…' : label || 'Print Receipt'}
    </button>
  );
};
