/**
 * Pure UPI status logic (no React): what the screens say about the merchant UPI ID and about a payment request.
 * The rules it encodes:
 *  - a well-formed UPI ID is NOT a verified one; a provider handle we do not recognise is a likely typo
 *  - a QR, an initiated payment and a customer's screenshot are all "not paid"; only a cashier's manual verification is
 *  - nothing here ever says "received" or "paid" for a request that is not paid
 */
import type { UpiCheck } from '../context/SettingsContext.tsx';

export interface UpiWarning {
  code: 'handle_unknown' | 'untested';
  level: 'danger' | 'warning';
  title: string;
  text: string;
}

/** Warnings about the SAVED merchant UPI ID (settings screen and POS panel). Empty when there is nothing to warn about. */
export function upiConfigWarnings(vpa: string | null | undefined, check: UpiCheck | undefined): UpiWarning[] {
  if (!vpa || !check || !check.syntax_valid) return [];
  const out: UpiWarning[] = [];
  if (!check.handle_known) {
    const hint = check.suggested_handle ? ` Did you mean @${check.suggested_handle}? (Nothing was changed; correct it yourself if so.)` : '';
    out.push({
      code: 'handle_unknown',
      level: 'danger',
      title: `"@${check.handle}" is not a UPI provider handle we recognise.`,
      text: `UPI apps such as Google Pay, PhonePe and Paytm will most likely say "invalid UPI ID" for it.${hint}`,
    });
  }
  if (!check.test_confirmed) {
    out.push({
      code: 'untested',
      level: 'warning',
      title: 'This UPI ID has not been tested.',
      text: 'A correctly formatted UPI ID does not prove the account exists or is active. Run the test below with a real UPI app before relying on UPI payments.',
    });
  }
  return out;
}

export interface UpiStatusView {
  label: string;
  /** true only for a payment a cashier has verified */
  paid: boolean;
  tone: 'pending' | 'initiated' | 'paid' | 'closed';
}

const LABELS: Record<string, UpiStatusView> = {
  pending: { label: 'Pending', paid: false, tone: 'pending' },
  initiated: { label: 'Initiated - not yet verified', paid: false, tone: 'initiated' },
  paid: { label: 'Paid - manually verified', paid: true, tone: 'paid' },
  failed: { label: 'Failed', paid: false, tone: 'closed' },
  cancelled: { label: 'Cancelled', paid: false, tone: 'closed' },
  superseded: { label: 'Replaced by a newer QR', paid: false, tone: 'closed' },
  refunded: { label: 'Refunded', paid: false, tone: 'closed' },
};

export const upiStatusView = (status: string | null | undefined): UpiStatusView => LABELS[String(status)] ?? { label: 'Unknown', paid: false, tone: 'closed' };
