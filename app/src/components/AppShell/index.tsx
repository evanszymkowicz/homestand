import { useCallback, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { NAV_ITEMS } from "../../lib/navigation";
import { ThemeToggle } from "../ThemeToggle";
import { ActivityButton } from "../ActivityButton";
import { ActivityDrawer } from "../ActivityDrawer";
import { BaseballDiamond } from "../BaseballDiamond";
import { useAuth } from "../../lib/auth/AuthContext";

export function AppShell() {
  const [activityOpen, setActivityOpen] = useState(false);
  const closeActivity = useCallback(() => setActivityOpen(false), []);
  const navigate = useNavigate();
  const { account, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="scorebook-texture min-h-screen text-ink">
      <div className="scorebook-margin mx-auto max-w-5xl px-4 pb-20 pt-6 sm:px-6">
        <header className="mb-5 border-b-2 border-ink pb-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <BaseballDiamond className="h-8 w-8 flex-none text-hs-red" />
              <h1 className="wordmark-piped font-brand text-4xl leading-[0.85] sm:text-5xl">Homestand</h1>
            </div>

            <div className="flex items-center gap-3">
              <ActivityButton onClick={() => setActivityOpen(true)} />
              <ThemeToggle />
              {account && (
                <>
                  <span className="hidden text-sm font-bold sm:inline">
                    {account.display_name || account.email}
                  </span>
                  <button onClick={handleLogout} className="text-xs font-bold text-ink-faint underline hover:text-ink">
                    Log out
                  </button>
                </>
              )}
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
