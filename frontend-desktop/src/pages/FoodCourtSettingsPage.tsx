import React, { useEffect, useState } from 'react';
import { Building2, Receipt as ReceiptIcon, Wallet, Percent, Timer } from 'lucide-react';
import { apiClient } from '../api/client';
import { useSettings, type BusinessProfile } from '../context/SettingsContext';
import { apiError, humanize } from '../lib/format';
import { Card, ErrorBanner, Field, inputClass, PageHeader, SuccessBanner } from '../components/ui';

/**
 * Owner-only food court settings: business profile, operating hours, receipt text and which of the
 * supported payment methods the counter may use, and when the tracking board flags an order as late.
 * Tax is shown read-only (owner decision pending).
 */
export const FoodCourtSettingsPage: React.FC = () => {
  const { settings, loaded, reload } = useSettings();
  const [profile, setProfile] = useState<BusinessProfile>(settings.business_profile);
  const [receipt, setReceipt] = useState(settings.receipt);
  const [methods, setMethods] = useState<string[]>(settings.payment_methods.enabled);
  const [delay, setDelay] = useState<string>(String(settings.order_tracking?.delay_minutes ?? 15));
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
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

        <Card className="p-4 space-y-3">
          <h3 className="font-semibold text-base text-fg flex items-center space-x-2">
            <Percent className="w-5 h-5" />
            <span>Tax</span>
          </h3>
          <p className="text-3xl font-bold text-fg">{settings.tax.rate_percent}%</p>
          <p className="text-sm text-muted">{settings.tax.note}</p>
          <p className="text-xs text-st-ready-fg bg-st-ready-soft border border-st-ready rounded-lg p-2">
            Not editable here. The GST rate and whether menu prices include tax must be confirmed by the owner and accountant before this can be changed.
          </p>
        </Card>
      </div>
    </div>
  );
};
