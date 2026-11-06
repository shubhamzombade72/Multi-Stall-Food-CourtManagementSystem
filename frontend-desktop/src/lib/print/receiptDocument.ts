import { encodeQr } from '../qr.ts';
import { RECEIPT_CREDIT, receiptHeader, receiptTaxLines, upiSection } from '../receiptModel.ts';
import type { PrintBlock, PrintDocument } from './types.ts';

interface SettingsLike {
  business_profile?: { name?: string | null; address?: string | null; phone?: string | null; gstin?: string | null } | null;
  receipt?: { header?: string | null; footer?: string | null; show_gstin?: boolean } | null;
}

const two = (v: unknown): string => Number(v).toFixed(2);

/** Matrix rows as '0'/'1' strings, the form the print document carries. */
export const qrRows = (text: string): string[] => encodeQr(text).modules.map((row) => row.map((dark) => (dark ? '1' : '0')).join(''));

/**
 * The customer receipt (or unpaid bill) as a print document. Built from the same server payload and the same helpers
 * (receiptHeader, receiptTaxLines, upiSection) as the on-screen ReceiptContent, so the figures, the header from the
 * Business Profile, the tax lines from the bill's own snapshot and the UPI payload are identical in preview, print,
 * and reprint. Nothing here is hardcoded: no rates, no business details, no UPI ID.
 */
export function buildReceiptDocument(receipt: any, settings?: SettingsLike | null): PrintDocument {
  const order = receipt.order;
  const groups: Record<string, any[]> = receipt.stall_breakdown || {};
  const payment = order.payments?.[order.payments.length - 1];
  const [businessName, ...details] = receiptHeader(settings as any);
  const upi = upiSection(receipt);
  const b: PrintBlock[] = [];

  b.push({ t: 'text', text: businessName, align: 'center', bold: true });
  for (const line of details) b.push({ t: 'text', text: line, align: 'center' });
  b.push({ t: 'text', text: 'Consolidated Bill', align: 'center' });
  b.push({ t: 'rule' });
  b.push({ t: 'text', text: `Bill: ${order.order_number}` });
  b.push({ t: 'text', text: `Date: ${new Date(order.created_at).toLocaleString()}` });
  b.push({ t: 'text', text: order.table ? `Table: ${order.table.table_number}` : 'Takeaway' });
  if (order.customer_name) b.push({ t: 'text', text: `Customer: ${order.customer_name}` });

  // Items stay grouped per stall, but the stall name is deliberately not printed on the customer bill.
  for (const items of Object.values(groups)) {
    b.push({ t: 'rule' });
    for (const it of items) b.push({ t: 'row', left: `${it.quantity} x ${it.item_name}`, right: two(it.subtotal) });
  }
  b.push({ t: 'rule' });
  for (const line of receiptTaxLines(order)) b.push({ t: 'row', left: line.label, right: two(line.value) });
  if (Number(order.discount_amount) > 0) b.push({ t: 'row', left: 'Discount', right: `-${order.discount_amount}` });
  b.push({ t: 'row', left: 'TOTAL', right: two(order.total_amount), bold: true });

  if (payment) {
    b.push({ t: 'rule' });
    b.push({ t: 'row', left: `Paid (${String(payment.payment_method).toUpperCase()})`, right: two(payment.amount) });
    if (payment.payment_method === 'cash') {
      b.push({ t: 'row', left: 'Tendered', right: two(payment.cash_tendered) });
      b.push({ t: 'row', left: 'Change', right: two(payment.change_returned) });
    }
    b.push({ t: 'text', text: `Receipt: ${payment.payment_number}` });
    if (payment.payment_method === 'upi_qr' && payment.transaction_reference) b.push({ t: 'text', text: `UPI Ref: ${payment.transaction_reference}` });
    b.push({ t: 'text', text: `Cashier: ${payment.cashier?.name || order.cashier?.name || '-'}` });
  }

  if (upi) {
    b.push({ t: 'rule' });
    if (upi.title) b.push({ t: 'text', text: upi.title, align: 'center', bold: true });
    b.push({ t: 'qr', data: upi.qrText, modules: qrRows(upi.qrText) });
    if (upi.vpaLine) b.push({ t: 'text', text: upi.vpaLine, align: 'center' });
    b.push({ t: 'text', text: upi.amountLine, align: 'center', bold: true });
    b.push({ t: 'text', text: upi.referenceLine, align: 'center' });
    if (upi.instructionLine) b.push({ t: 'text', text: upi.instructionLine, align: 'center' });
  }

  if (order.payment_status !== 'paid') b.push({ t: 'text', text: '*** UNPAID - NOT A RECEIPT ***', bold: true });
  b.push({ t: 'text', text: settings?.receipt?.footer || 'Thank you!', align: 'center' });
  b.push({ t: 'text', text: RECEIPT_CREDIT, align: 'center' });
  b.push({ t: 'feed', lines: 1 });

  return { kind: 'receipt', title: `Receipt ${order.order_number}`, blocks: b };
}

/** One receipt print per paid/unpaid state, so paying a bill that was printed as a bill is a different print. */
export const receiptDedupeKey = (orderId: number, paymentStatus: string): string => `receipt:${orderId}:${paymentStatus === 'paid' ? 'paid' : 'bill'}`;
