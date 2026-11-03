import { useCallback, useEffect, useState } from 'react';
import { applyTheme, readStoredTheme, resolveTheme, storeTheme, type Theme } from '../lib/theme';

const prefersDark = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;

const current = (): Theme => resolveTheme(readStoredTheme(typeof localStorage === 'undefined' ? null : localStorage), prefersDark());

/** Current theme plus a one-click toggle that persists to localStorage['fc_theme']. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(current);

  useEffect(() => {
    applyTheme(document.documentElement, theme);
  }, [theme]);

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    storeTheme(typeof localStorage === 'undefined' ? null : localStorage, next);
    setTheme(next);
  }, [theme]);

  return { theme, toggle };
}
