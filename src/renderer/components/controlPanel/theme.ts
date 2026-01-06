import { useEffect, useMemo, useState } from 'react';
import type { ThemeMode } from './types';

const STORAGE_KEY = 'pet:control-panel:theme';

const readStoredTheme = (): ThemeMode => {
  if (typeof window === 'undefined') return 'light';
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === 'dark' ? 'dark' : 'light';
};

const applyThemeToDom = (theme: ThemeMode) => {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
};

export const useThemeMode = () => {
  const [theme, setTheme] = useState<ThemeMode>(() => readStoredTheme());

  useEffect(() => {
    applyThemeToDom(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const toggle = useMemo(
    () => () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark')),
    [],
  );

  return {
    theme,
    setTheme,
    toggle,
  };
};
