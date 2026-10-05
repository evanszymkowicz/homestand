import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { setImportContext } from "../data";

export interface Account {
  id: string;
  email: string;
  display_name: string | null;
  verified: number;
  tier: "free" | "subscriber" | "admin";
  demo: number;
}

export interface ImportRecord {
  id: string;
  league_id: number | null;
  league_name: string | null;
  status: "pending" | "running" | "completed" | "failed";
  year_start: number | null;
  year_end: number | null;
  created_at: string;
}

/** A tenant context is only safe to point at an import the proxy will actually
 * serve. Pointing at `pending` turns every collection into a 404. */
function pickTenant(imports: ImportRecord[]): string | null {
  return imports.find(i => i.status === "completed")?.id ?? null;
}

interface AuthState {
  account: Account | null;
  loading: boolean;
  imports: ImportRecord[];
  currentImportId: string | null;
  selectImport: (id: string) => void;
  addImport: (imp: ImportRecord) => void;
  loginDemo: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

async function fetchMe(): Promise<Account | null> {
  const res = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`auth check failed: ${res.status}`);
  const data = (await res.json()) as { account: Account };
  return data.account;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [imports, setImports] = useState<ImportRecord[]>([]);
  const [currentImportId, setCurrentImportId] = useState<string | null>(null);

  /** Drops every trace of the previous account. Without this, logging out and
   * back in as someone else leaks the old account's league names and leaves
   * data.ts pointing at the old tenant with its cache populated. */
  const resetTenant = useCallback(() => {
    setImports([]);
    setCurrentImportId(null);
    setImportContext(null);
  }, []);

  const applyImports = useCallback((next: ImportRecord[]) => {
    const tenant = pickTenant(next);
    setImports(next);
    setCurrentImportId(tenant);
    setImportContext(tenant);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await fetchMe();
      setAccount(me);
      if (!me) {
        resetTenant();
        return;
      }
      const res = await fetch("/api/imports", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`imports failed: ${res.status}`);
      const { imports } = (await res.json()) as { imports: ImportRecord[] };
      applyImports(imports);
    } catch {
      setAccount(null);
      resetTenant();
    }
  }, [applyImports, resetTenant]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const loginDemo = useCallback(async () => {
    const res = await fetch("/api/auth/demo", {
      method: "POST",
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error("demo login failed");
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    setAccount(null);
    resetTenant();
  }, [resetTenant]);

  const selectImport = useCallback((id: string) => {
    if (!id) return;
    setCurrentImportId(id);
    setImportContext(id);
  }, []);

  const addImport = useCallback((imp: ImportRecord) => {
    setImports(prev => [imp, ...prev]);
    // A fresh import is `pending`; it only becomes the tenant once completed,
    // which `refresh()` picks up on the next poll.
    if (imp.status === "completed") {
      setCurrentImportId(imp.id);
      setImportContext(imp.id);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ account, loading, imports, currentImportId, selectImport, addImport, loginDemo, logout }),
    [account, loading, imports, currentImportId, selectImport, addImport, loginDemo, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
