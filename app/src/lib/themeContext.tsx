import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { nextTheme, parseStoredTheme, resolveTheme, type ResolvedTheme, type Theme } from "./theme";

export type { Theme, ResolvedTheme };

const STORAGE_KEY = "homestand-theme";
const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Storage can throw in privacy modes — same guard activityDrawer.ts wraps
 * sessionStorage with; the theme falls back to system rather than crashing
 * the provider's first render. */
function readStoredTheme(): Theme {
  try {
    return parseStoredTheme(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "system";
  }
}

function writeStoredTheme(theme: Theme): void {
  try {
    // "system" is stored as absence, per the spec's "absent value = system".
    if (theme === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // In-memory state still applies for this session.
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  const [prefersDark, setPrefersDark] = useState(() => matchMedia(DARK_MEDIA_QUERY).matches);

  useEffect(() => {
    const mq = matchMedia(DARK_MEDIA_QUERY);
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme = useMemo(() => resolveTheme(theme, prefersDark), [theme, prefersDark]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    writeStoredTheme(next);
  }, []);

  const cycleTheme = useCallback(() => setTheme(nextTheme(theme)), [theme, setTheme]);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, cycleTheme }),
    [theme, resolvedTheme, setTheme, cycleTheme]
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}
