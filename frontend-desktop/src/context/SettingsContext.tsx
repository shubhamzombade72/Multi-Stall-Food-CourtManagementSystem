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
  tax: { rate_percent: string; editable: boolean; note: string };
}

const FALLBACK: FoodCourtSettings = {
  business_profile: { name: 'Urban Food Court', legal_name: null, address: null, phone: null, email: null, gstin: null, opening_time: null, closing_time: null },
  receipt: { header: null, footer: 'Thank you! Visit again.', show_gstin: false },
  payment_methods: { enabled: ['cash', 'upi_qr', 'card', 'split'], available: ['cash', 'upi_qr', 'card', 'split'] },
  tax: { rate_percent: '5.00', editable: false, note: '' },
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
