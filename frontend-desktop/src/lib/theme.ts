/**
 * Theme preference logic. React-free so node:test can import it; public/theme-init.js mirrors the same rule
 * (a classic script that runs before first paint and cannot import).
 */
export type Theme = 'light' | 'dark';

export const THEME_KEY = 'fc_theme';

export function readStoredTheme(storage: Pick<Storage, 'getItem'> | null): Theme | null {
  try {
    const v = storage?.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function resolveTheme(stored: Theme | null, prefersDark: boolean): Theme {
  return stored ?? (prefersDark ? 'dark' : 'light');
}

export function applyTheme(
  root: { setAttribute(name: string, value: string): void; style: { colorScheme: string } },
  theme: Theme,
): void {
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;
}

export function storeTheme(storage: Pick<Storage, 'setItem'> | null, theme: Theme): void {
  try {
    storage?.setItem(THEME_KEY, theme);
  } catch {
    /* storage unavailable: the choice just will not persist */
  }
}
