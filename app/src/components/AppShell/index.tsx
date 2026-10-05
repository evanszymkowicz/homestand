import { useCallback, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { NAV_ITEMS } from "../../lib/navigation";
import { ThemeToggle } from "../ThemeToggle";
import { ActivityButton } from "../ActivityButton";
import { ActivityDrawer } from "../ActivityDrawer";
import { BaseballDiamond } from "../BaseballDiamond";
import { useAuth } from "../../lib/auth/AuthContext";

function formatToday() {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date());
}

export function AppShell() {
  const [activityOpen, setActivityOpen] = useState(false);
  const closeActivity = useCallback(() => setActivityOpen(false), []);
  const navigate = useNavigate();
  const { account, imports, currentImportId, selectImport, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="scorebook-texture min-h-screen text-ink">
      <div className="scorebook-margin mx-auto max-w-5xl px-4 pb-20 pt-6 sm:px-6">
        <header className="mb-5 border-b-2 border-ink pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <BaseballDiamond className="h-8 w-8 text-hs-red" />
              <div>
                <h1 className="wordmark-piped font-brand text-5xl leading-[0.85] sm:text-6xl">Homestand</h1>
                <p className="mt-1 text-[0.6rem] font-bold tracking-[0.15em] text-ink-faint uppercase">
                  Gain the edge<span className="text-hs-red">.</span> Build your team
                  <span className="text-hs-red">.</span> Stay ahead of the competition
                  <span className="text-hs-red">.</span>
                </p>
              </div>
            </div>

            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-1">
                <ActivityButton onClick={() => setActivityOpen(true)} />
                <ThemeToggle />
              </div>
              {account && (
                <div className="flex items-center gap-2">
                  <span className="hidden text-sm font-bold sm:inline">
                    {account.display_name || account.email}
                    {account.demo ? (
                      <span className="ml-1.5 rounded bg-hs-highlight-soft px-1.5 py-0.5 text-[0.6rem] text-hs-ink uppercase">
                        Demo
                      </span>
                    ) : null}
                  </span>
                  <button onClick={handleLogout} className="text-xs font-bold text-ink-faint underline hover:text-ink">
                    Log out
                  </button>
                </div>
              )}
              {account && (
                <div className="flex items-center gap-2">
                  {imports.length > 0 && (
                    <select
                      aria-label="League import"
                      className="rounded border border-border bg-surface px-2 py-1 text-sm"
                      value={currentImportId ?? ""}
                      onChange={e => selectImport(e.target.value)}>
                      {/* currentImportId is null until an import completes; show
                          every import so the list is never silently empty. */}
                      {imports.map(imp => (
                        <option key={imp.id} value={imp.id}>
                          {imp.league_name ?? `League ${imp.league_id ?? "?"}`}
                          {imp.status === "completed" ? "" : ` (${imp.status})`}
                        </option>
                      ))}
                    </select>
                  )}
                  {/* Ungated: an account with zero imports needs a way to
                      create its first one. */}
                  <Link to="/import/new" className="text-xs font-bold text-ink-faint underline hover:text-ink">
                    New import
                  </Link>
                </div>
              )}
              <div className="hidden text-[0.6rem] font-bold tracking-widest text-ink-faint uppercase sm:block">
                {formatToday()}
              </div>
            </div>
          </div>

          <nav className="mt-5 flex gap-1 overflow-x-auto pb-0 scrollbar-accent">
            {NAV_ITEMS.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/"}
                className={({ isActive }) =>
                  `relative border-x border-t px-3.5 py-2 text-sm font-bold transition-colors ${
                    isActive
                      ? "-mb-[2px] border-ink border-b-2 border-b-surface bg-surface text-ink"
                      : "border-transparent text-ink-faint hover:text-ink"
                  }`
                }>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </header>

        <main>
          <Outlet />
        </main>

        <footer className="mt-12 border-t border-border pt-4 text-center text-xs text-ink-faint">
          <span className="scorebook-stat text-hs-red">&copy; {new Date().getFullYear()}</span>{" "}
          <a href="https://ews-tech.pages.dev/" target="_blank" rel="noopener noreferrer" className="hover:text-ink">
            Evan Szymkowicz
          </a>
        </footer>
      </div>

      <ActivityDrawer open={activityOpen} onClose={closeActivity} />
    </div>
  );
}
