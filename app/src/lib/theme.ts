export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** system -> light -> dark -> system */
const THEME_CYCLE: Theme[] = ["system", "light", "dark"];

export function parseStoredTheme(raw: string | null): Theme {
  return raw === "light" || raw === "dark" ? raw : "system";
}

export function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  return theme === "system" ? (prefersDark ? "dark" : "light") : theme;
}

export function nextTheme(theme: Theme): Theme {
  return THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length];
}
