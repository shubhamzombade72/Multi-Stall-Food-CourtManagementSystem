import React, { useState } from 'react';
import { apiClient } from '../api/client';
import { apiError } from '../lib/format';
import { UpiQr } from './UpiQr';
import { parseUpiUri } from '../lib/receiptModel';
import { upiConfigWarnings } from '../lib/upiStatus';
import { useSettings, type UpiCheck } from '../context/SettingsContext';

interface TestPayload {
  upi_uri: string;
  vpa: string;
  payee_name: string;
  amount: string;
  reference: string;
}

/**
 * Honest status of the merchant UPI ID, plus a controlled test: a Rs 1.00 QR (no order, no payment is created) that the
 * owner scans with a real UPI app. The owner's confirmation is stored as exactly that - an owner statement - and is never
 * presented as a bank or provider verification.
 */
export const UpiIdCheck: React.FC<{ savedVpa: string | null; check: UpiCheck | undefined; dirty: boolean }> = ({ savedVpa, check, dirty }) => {
  const { reload } = useSettings();
  const [test, setTest] = useState<TestPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const warnings = upiConfigWarnings(savedVpa, check);
  const canTest = !!savedVpa && !dirty;

  const showTest = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await apiClient.post('/settings/upi/test-qr');
      setTest(res.data.data);
    } catch (err) {
      setError(apiError(err, 'Could not create the test QR.'));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post('/settings/upi/test-confirmed');
      await reload();
      setTest(null);
      setNote('Test recorded. This is your own confirmation; it is not a bank or UPI-provider verification.');
    } catch (err) {
      setError(apiError(err, 'Could not record the test.'));
    } finally {
      setBusy(false);
    }
  };

  const failed = () => {
    setTest(null);
    setNote('Not confirmed. Do not take UPI payments until a test scan shows the correct payee. Re-check the UPI ID in your UPI app (Profile → UPI ID) and save it again.');
  };

  const q = test ? parseUpiUri(test.upi_uri) : null;

  return (
    <div data-testid="upi-id-check" className="space-y-2">
      {warnings.map((w) => (
        <p key={w.code} role="alert" data-testid={`upi-warning-${w.code}`} className={`text-xs ${w.level === 'danger' ? 'text-danger-fg' : 'text-warning-fg'}`}>
          <strong>{w.title}</strong> {w.text}
        </p>
      ))}
      {check?.test_confirmed && (
        <p data-testid="upi-test-confirmed" className="text-xs text-success-fg">
          Test scan confirmed by the owner{check.test_confirmed_at ? ` on ${new Date(check.test_confirmed_at).toLocaleString()}` : ''}. This is the owner's own confirmation, not a bank verification.
        </p>
      )}
      {note && <p role="status" data-testid="upi-test-note" className="text-xs text-muted">{note}</p>}
      {error && <p role="alert" className="text-xs text-danger-fg">{error}</p>}

      {!test && (
        <div>
          <button type="button" data-testid="upi-test-start" onClick={showTest} disabled={!canTest || busy} className="px-3 py-1.5 border border-line rounded-lg text-xs font-bold text-fg hover:bg-surface-2 disabled:opacity-50">
            {busy ? 'Preparing…' : 'Test this UPI ID (₹1.00 QR)'}
          </button>
          {!canTest && <span className="text-xs text-muted ml-2">{dirty ? 'Save the UPI ID first.' : 'Enter and save a UPI ID first.'}</span>}
        </div>
      )}

      {test && q && (
        <div data-testid="upi-test-panel" className="rounded-lg border border-line bg-canvas p-3 space-y-2">
          <p className="text-xs font-bold text-fg">Test QR - creates no order and no payment</p>
          <div className="rounded-lg border border-line p-1.5 inline-block" style={{ background: '#fff' }}>
            <UpiQr text={test.upi_uri} sizePx={180} label="UPI test QR" />
          </div>
          <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <dt className="text-muted">UPI ID</dt><dd data-testid="upi-test-vpa" className="font-mono break-all">{q.pa}</dd>
            <dt className="text-muted">Payee name</dt><dd>{q.pn}</dd>
            <dt className="text-muted">Amount</dt><dd>₹{q.am}</dd>
            <dt className="text-muted">Reference</dt><dd className="font-mono">{q.tn}</dd>
          </dl>
          <ol className="text-xs text-muted list-decimal pl-4 space-y-0.5">
            <li>On a different phone, open Google Pay, PhonePe, Paytm or BHIM and scan this QR.</li>
            <li>Check that the payee name and the ₹1.00 amount are shown and that the app lets you continue to the PIN screen.</li>
            <li>You may cancel there, or pay the ₹1.00 to yourself to also prove the money arrives.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <button type="button" data-testid="upi-test-ok" onClick={confirm} disabled={busy} className="px-3 py-1.5 bg-primary text-primary-fg rounded-lg text-xs font-bold disabled:opacity-50">
              The app showed the correct payee
            </button>
            <button type="button" data-testid="upi-test-bad" onClick={failed} disabled={busy} className="px-3 py-1.5 border border-line rounded-lg text-xs font-bold text-fg hover:bg-surface-2">
              The app showed an error
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
