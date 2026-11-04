import React, { useEffect, useState } from 'react';
import { Building2, Receipt as ReceiptIcon, Wallet, Percent, Timer, QrCode } from 'lucide-react';
import { isValidVpa } from '../lib/receiptModel';
import { calculateTax, formatRate } from '../lib/tax';
import { apiClient } from '../api/client';
import { useSettings, type BusinessProfile } from '../context/SettingsContext';
import { apiError, humanize } from '../lib/format';
import { Card, ErrorBanner, Field, inputClass, PageHeader, SuccessBanner } from '../components/ui';

/**
 * Owner-only food court settings: business profile, operating hours, receipt text and which of the
 * supported payment methods the counter may use, and when the tracking board flags an order as late.
 * GST (on/off, rate, inclusive/exclusive) is configured here and is the only source of the rate for every screen.
 */
export const FoodCourtSettingsPage: React.FC = () => {
  const { settings, loaded, reload } = useSettings();
  const [profile, setProfile] = useState<BusinessProfile>(settings.business_profile);
  const [receipt, setReceipt] = useState(settings.receipt);
  const [methods, setMethods] = useState<string[]>(settings.payment_methods.enabled);
  const [delay, setDelay] = useState<string>(String(settings.order_tracking?.delay_minutes ?? 15));
  const [gstEnabled, setGstEnabled] = useState<boolean>(settings.tax.enabled);
  const [gstRate, setGstRate] = useState<string>(settings.tax.rate_percent);
  const [gstMode, setGstMode] = useState<'exclusive' | 'inclusive'>(settings.tax.mode);
  const [upiEnabled, setUpiEnabled] = useState<boolean>(settings.upi?.enabled ?? false);
  const [upiId, setUpiId] = useState<string>(settings.upi?.vpa ?? '');
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setGstEnabled(settings.tax.enabled);
    setGstRate(settings.tax.rate_percent);
    setGstMode(settings.tax.mode);
    setUpiEnabled(settings.upi?.enabled ?? false);
    setUpiId(settings.upi?.vpa ?? '');
    setProfile(settings.business_profile);
    setReceipt(settings.receipt);
    setMethods(settings.payment_methods.enabled);
    setDelay(String(settings.order_tracking?.delay_minutes ?? 15));
  }, [settings]);

  const save = async (key: string, body: object, label: string) => {
    setSaving(key);
    setError(null);
    setSuccess(null);
    try {
      await apiClient.put(`/settings/${key}`, body);
      await reload();
      setSuccess(`${label} saved.`);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setSaving(null);
    }
  };

  const gstRateTrimmed = gstRate.trim();
  const gstRateValid = /^\d{1,2}(\.\d{1,2})?$/.test(gstRateTrimmed) && Number(gstRateTrimmed) <= 40;
  const gstError = !gstRateValid ? 'Enter the GST rate as a number from 0 to 40 with at most 2 decimals, e.g. 5 or 12.5.' : null;
  const gstExample = gstRateValid ? calculateTax('100.00', { enabled: gstEnabled, rate_percent: gstRateTrimmed, mode: gstMode }) : null;

  const upiTrimmed = upiId.trim();
  const upiFormatError = upiTrimmed !== '' && !isValidVpa(upiTrimmed) ? 'Enter a valid UPI ID such as name@bank (letters, digits, dot, dash or underscore, then @ and the provider handle).' : null;
  const upiMissing = upiEnabled && upiTrimmed === '' ? 'Enter the merchant UPI ID before turning on UPI QR payments.' : null;
  const upiError = upiFormatError || upiMissing;
  const upiMethodOff = !settings.payment_methods.enabled.includes('upi_qr');

  const delayValue = Number(delay);
  const delayValid = Number.isInteger(delayValue) && delayValue >= 1 && delayValue <= 120;

  const set = (k: keyof BusinessProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setProfile((p) => ({ ...p, [k]: e.target.value === '' ? null : e.target.value }));

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <PageHeader title="Food Court Settings" icon={Building2} subtitle="Business profile, receipts, payment methods and order tracking. Changes are recorded in the audit log." />
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />
      {!loaded && <p className="text-sm text-muted">Loading saved settings…</p>}

      <Card className="p-4">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save('business_profile', { ...profile, name: profile.name || '' }, 'Business profile');
          }}
        >
          <h3 className="font-semibold text-base text-fg flex items-center space-x-2">
            <Building2 className="w-5 h-5" />
            <span>Business profile & operating hours</span>
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Food court name">
              <input required className={inputClass} value={profile.name || ''} onChange={set('name')} />
            </Field>
            <Field label="Legal / registered name">
              <input className={inputClass} value={profile.legal_name || ''} onChange={set('legal_name')} />
            </Field>
            <Field label="Phone">
              <input className={inputClass} value={profile.phone || ''} onChange={set('phone')} />
            </Field>
            <Field label="Email">
              <input type="email" className={inputClass} value={profile.email || ''} onChange={set('email')} />
            </Field>
            <Field label="GSTIN" hint="15 characters, as registered. Shown on receipts only if enabled below.">
              <input className={`${inputClass} font-mono uppercase`} maxLength={15} value={profile.gstin || ''} onChange={(e) => setProfile((p) => ({ ...p, gstin: e.target.value.toUpperCase() || null }))} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Opens at">
                <input type="time" className={inputClass} value={profile.opening_time || ''} onChange={set('opening_time')} />
              </Field>
              <Field label="Closes at">
                <input type="time" className={inputClass} value={profile.closing_time || ''} onChange={set('closing_time')} />
              </Field>
            </div>
          </div>
          <Field label="Address">
            <textarea rows={2} className={inputClass} value={profile.address || ''} onChange={set('address')} />
          </Field>
          <button type="submit" disabled={saving !== null} className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-fg font-semibold text-sm rounded-lg disabled:opacity-50">
            {saving === 'business_profile' ? 'Saving…' : 'Save business profile'}
          </button>
        </form>
      </Card>

      <Card className="p-4">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save('receipt', receipt, 'Receipt settings');
          }}
        >
          <h3 className="font-semibold text-base text-fg flex items-center space-x-2">
            <ReceiptIcon className="w-5 h-5" />
            <span>Receipt</span>
          </h3>
          <Field label="Header line" hint="Printed under the food court name, e.g. a branch name.">
            <input className={inputClass} maxLength={200} value={receipt.header || ''} onChange={(e) => setReceipt((r) => ({ ...r, header: e.target.value || null }))} />
          </Field>
          <Field label="Footer line">
            <input className={inputClass} maxLength={300} value={receipt.footer || ''} onChange={(e) => setReceipt((r) => ({ ...r, footer: e.target.value || null }))} />
          </Field>
          <label className="flex items-center space-x-2 text-sm">
            <input type="checkbox" checked={receipt.show_gstin} onChange={(e) => setReceipt((r) => ({ ...r, show_gstin: e.target.checked }))} />
            <span>Print GSTIN on receipts</span>
          </label>
          <p className="text-xs text-muted">The receipt printer itself is chosen per computer under Settings → Printers.</p>
          <button type="submit" disabled={saving !== null} className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-fg font-semibold text-sm rounded-lg disabled:opacity-50">
            {saving === 'receipt' ? 'Saving…' : 'Save receipt settings'}
          </button>
        </form>
      </Card>

      <Card className="p-4">
        <form
          className="space-y-4"
          data-testid="gst-settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!gstError) save('tax', { enabled: gstEnabled, rate_percent: gstRateTrimmed, mode: gstMode, apply_to: 'all' }, 'GST settings');
          }}
        >
          <h3 className="font-semibold text-base text-fg flex items-center space-x-2">
            <Percent className="w-5 h-5" />
            <span>Tax & GST Settings</span>
          </h3>
          <label className="flex items-center space-x-2 text-sm">
            <input data-testid="gst-enabled" type="checkbox" checked={gstEnabled} onChange={(e) => setGstEnabled(e.target.checked)} />
            <span>Enable GST (when off, no GST is added to any bill)</span>
          </label>
          <div className={`grid grid-cols-2 gap-4 ${gstEnabled ? '' : 'opacity-50'}`}>
            <Field label="GST Rate (%)" hint="0 to 40, up to 2 decimals. Applies to new bills only.">
              <input
                data-testid="gst-rate"
                inputMode="decimal"
                className={`${inputClass} max-w-[10rem]`}
                value={gstRate}
                disabled={!gstEnabled}
                onChange={(e) => setGstRate(e.target.value)}
                aria-invalid={gstError ? true : undefined}
              />
            </Field>
            <Field label="GST Calculation Type">
              <div className="space-y-1 text-sm">
                <label className="flex items-center space-x-2">
                  <input data-testid="gst-mode-exclusive" type="radio" name="gst-mode" disabled={!gstEnabled} checked={gstMode === 'exclusive'} onChange={() => setGstMode('exclusive')} />
                  <span>GST Exclusive (added on top of item prices)</span>
                </label>
                <label className="flex items-center space-x-2">
                  <input data-testid="gst-mode-inclusive" type="radio" name="gst-mode" disabled={!gstEnabled} checked={gstMode === 'inclusive'} onChange={() => setGstMode('inclusive')} />
                  <span>GST Inclusive (already inside item prices)</span>
                </label>
              </div>
            </Field>
          </div>
          <Field label="Apply GST To">
            <select data-testid="gst-apply-to" className={`${inputClass} max-w-xs`} value="all" disabled={!gstEnabled} onChange={() => undefined}>
              <option value="all">All Items</option>
              <option value="individual" disabled>
                Individual Items (not available)
              </option>
            </select>
            <p className="text-xs text-muted mt-1">Menu items have no tax setting of their own yet, so GST applies to all items.</p>
          </Field>
          {gstError && (
            <p role="alert" data-testid="gst-validation" className="text-xs text-danger-fg">
              {gstError}
            </p>
          )}
          {gstExample && (
            <p data-testid="gst-example" className="text-xs text-muted bg-canvas rounded-lg p-2">
              Example for a ₹100.00 item total: {gstExample.tax_mode === 'none' ? 'no GST is added, total ₹100.00.' : gstExample.tax_mode === 'inclusive' ? `GST included (${formatRate(gstRateTrimmed)}%) is ₹${gstExample.tax_amount}, total stays ₹${gstExample.total_amount}.` : `GST (${formatRate(gstRateTrimmed)}%) is ₹${gstExample.tax_amount}, total ₹${gstExample.total_amount}.`}
            </p>
          )}
          <p className="text-xs text-muted">Changing this affects new bills immediately. Bills already created keep the rate and mode they were created with, and so do their receipts and reports. Changes are recorded in the audit log.</p>
          <button type="submit" disabled={saving !== null || !!gstError} className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-fg font-semibold text-sm rounded-lg disabled:opacity-50">
            {saving === 'tax' ? 'Saving…' : 'Save GST settings'}
          </button>
        </form>
      </Card>

      <Card className="p-4">
        <form
          className="space-y-4"
          data-testid="upi-settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!upiError) save('upi', { enabled: upiEnabled, vpa: upiTrimmed === '' ? null : upiTrimmed }, 'UPI settings');
          }}
        >
          <h3 className="font-semibold text-base text-fg flex items-center space-x-2">
            <QrCode className="w-5 h-5" />
            <span>UPI QR payments</span>
          </h3>
          <Field label="UPI ID / Merchant VPA" hint="Customers' payments go to this UPI ID. It is printed on bills next to the QR, so enter the account you want to be paid into.">
            <input
              data-testid="upi-id"
              className={`${inputClass} font-mono max-w-sm`}
              placeholder="e.g. mangalmurti@upi"
              autoComplete="off"
              spellCheck={false}
              maxLength={320}
              value={upiId}
              onChange={(e) => setUpiId(e.target.value)}
              aria-invalid={upiFormatError ? true : undefined}
            />
          </Field>
          <label className="flex items-center space-x-2 text-sm">
            <input data-testid="upi-enabled" type="checkbox" checked={upiEnabled} onChange={(e) => setUpiEnabled(e.target.checked)} />
            <span>Enable UPI QR payments (a payment QR with the bill amount is shown at the counter and printed on bills)</span>
          </label>
          {upiError && (
            <p role="alert" data-testid="upi-validation" className="text-xs text-danger-fg">
              {upiError}
            </p>
          )}
          {upiMethodOff && upiEnabled && (
            <p className="text-xs text-warning-fg">"UPI / QR" is switched off under Payment methods. Turn it on and save there first.</p>
          )}
          <p className="text-xs text-muted">
            A QR is a payment request only. A bill stays unpaid until the cashier checks the money in the UPI app or bank statement and records the bank reference.
            {!settings.upi?.enabled && ' UPI QR payments are currently off: no QR is shown or printed.'}
          </p>
          <button type="submit" disabled={saving !== null || !!upiError} className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-fg font-semibold text-sm rounded-lg disabled:opacity-50">
            {saving === 'upi' ? 'Saving…' : 'Save UPI settings'}
          </button>
        </form>
      </Card>

      <Card className="p-4">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (delayValid) save('order_tracking', { delay_minutes: delayValue }, 'Order tracking');
          }}
        >
          <h3 className="font-semibold text-base text-fg flex items-center space-x-2">
            <Timer className="w-5 h-5" />
            <span>Order tracking</span>
          </h3>
          <Field label="Late-order warning after (minutes)" hint="Orders with food still to serve after this many minutes are flagged as delayed on the tracking board (1–120).">
            <input
              type="number"
              data-testid="delay-minutes"
              required
              min={1}
              max={120}
              step={1}
              className={`${inputClass} max-w-[10rem]`}
              value={delay}
              onChange={(e) => setDelay(e.target.value)}
            />
          </Field>
          <button type="submit" disabled={saving !== null || !delayValid} className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-fg font-semibold text-sm rounded-lg disabled:opacity-50">
            {saving === 'order_tracking' ? 'Saving…' : 'Save order tracking'}
          </button>
        </form>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save('payment_methods', { enabled: methods }, 'Payment methods');
            }}
          >
            <h3 className="font-semibold text-base text-fg flex items-center space-x-2">
              <Wallet className="w-5 h-5" />
              <span>Payment methods at the counter</span>
            </h3>
            {settings.payment_methods.available.map((m) => (
              <label key={m} className="flex items-center space-x-2 text-sm">
                <input
                  type="checkbox"
                  checked={methods.includes(m)}
                  onChange={(e) => setMethods((cur) => (e.target.checked ? [...cur, m] : cur.filter((x) => x !== m)))}
                />
                <span>{m === 'upi_qr' ? 'UPI / QR' : humanize(m)}</span>
              </label>
            ))}
            <p className="text-xs text-muted">A payment always settles the full bill. Partial payments and refunds need an owner policy first.</p>
            <button type="submit" disabled={saving !== null || methods.length === 0} className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-fg font-semibold text-sm rounded-lg disabled:opacity-50">
              {saving === 'payment_methods' ? 'Saving…' : 'Save payment methods'}
            </button>
          </form>
        </Card>

      </div>
    </div>
  );
};
