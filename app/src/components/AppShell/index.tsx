import { useCallback, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { NAV_ITEMS } from "../../lib/navigation";
import { ThemeToggle } from "../ThemeToggle";
import { ActivityButton } from "../ActivityButton";
import { ActivityDrawer } from "../ActivityDrawer";
import { BaseballDiamond } from "../BaseballDiamond";

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
  const { pathname } = useLocation();
  const activeLabel = NAV_ITEMS.find((item) =>
    item.path === "/" ? pathname === "/" : pathname.startsWith(item.path)
  )?.label ?? "—";

  return (
    <div className="scorebook-texture min-h-screen text-ink">
      <div className="scorebook-margin mx-auto max-w-5xl px-4 pb-20 pt-6 sm:px-6">
        <header className="mb-5 border-b-2 border-ink pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <BaseballDiamond className="h-8 w-8 text-hs-red" />
              <div>
                <h1 className="wordmark-piped font-brand text-5xl leading-[0.85] sm:text-6xl">Homestand</h1>
                <p className="mt-1 text-[0.65rem] font-bold tracking-[0.2em] text-ink-faint uppercase">
                  League Record Book
                </p>
              </div>
            </div>

            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-1">
                <ActivityButton onClick={() => setActivityOpen(true)} />
                <ThemeToggle />
              </div>
              <div className="scorebook-card hidden px-3 py-1.5 text-right sm:block">
                <div className="text-[0.6rem] font-bold tracking-widest text-ink-faint uppercase">
                  Viewing
                </div>
                <div className="text-sm font-bold leading-tight">{activeLabel}</div>
              </div>
              <div className="hidden text-[0.6rem] font-bold tracking-widest text-ink-faint uppercase sm:block">
                {formatToday()}
              </div>
            </div>
          </div>

          <nav className="mt-5 flex gap-1 overflow-x-auto pb-0 scrollbar-accent">
            {NAV_ITEMS.map((item) => (
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
