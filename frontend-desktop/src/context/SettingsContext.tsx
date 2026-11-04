import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiClient } from '../api/client';

export interface BusinessProfile {
  name: string;
  legal_name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  opening_time: string | null;
  closing_time: string | null;
}

export interface FoodCourtSettings {
  business_profile: BusinessProfile;
  receipt: { header: string | null; footer: string | null; show_gstin: boolean };
  payment_methods: { enabled: string[]; available: string[] };
  /** GST configuration (Food Court Settings is the only source of the rate). */
  tax: { enabled: boolean; rate_percent: string; mode: 'exclusive' | 'inclusive'; apply_to: 'all'; editable: boolean; item_level_supported: boolean };
  /** D10: minutes after which an order with unserved food is shown as delayed (owner-editable 1–120). */
  order_tracking?: { delay_minutes: number };
  /** Merchant UPI ID for the per-bill payment QR (owner-editable; readable by every signed-in user). */
  upi?: { enabled: boolean; vpa: string | null };
}

const FALLBACK: FoodCourtSettings = {
  business_profile: { name: 'Urban Food Court', legal_name: null, address: null, phone: null, email: null, gstin: null, opening_time: null, closing_time: null },
  receipt: { header: null, footer: 'Thank you! Visit again.', show_gstin: false },
  payment_methods: { enabled: ['cash', 'upi_qr', 'card', 'split'], available: ['cash', 'upi_qr', 'card', 'split'] },
  // Placeholder until the server's settings arrive: no GST is estimated, and no rate is assumed
  tax: { enabled: false, rate_percent: '0.00', mode: 'exclusive', apply_to: 'all', editable: false, item_level_supported: false },
  order_tracking: { delay_minutes: 15 },
  upi: { enabled: false, vpa: null },
};

const SettingsContext = createContext<{ settings: FoodCourtSettings; loaded: boolean; reload: () => Promise<void> }>({
  settings: FALLBACK,
  loaded: false,
  reload: async () => {},
});

/** Food court settings from the server, loaded once after sign-in and refreshed after the owner saves. */
export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<FoodCourtSettings>(FALLBACK);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await apiClient.get('/settings');
      setSettings(res.data.data);
      setLoaded(true);
    } catch {
      // Keep the last known (or fallback) settings; the connection banner reports outages
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return <SettingsContext.Provider value={{ settings, loaded, reload }}>{children}</SettingsContext.Provider>;
};

export const useSettings = () => useContext(SettingsContext);
