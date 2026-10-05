import { useCallback, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { NAV_ITEMS } from "../../lib/navigation";
import { ThemeToggle } from "../ThemeToggle";
import { ActivityButton } from "../ActivityButton";
import { ActivityDrawer } from "../ActivityDrawer";

export function AppShell() {
  const [activityOpen, setActivityOpen] = useState(false);
  const closeActivity = useCallback(() => setActivityOpen(false), []);
  return (
    <div className="min-h-screen bg-bg text-ink">
      <div className="mx-auto max-w-5xl px-4 pb-20 pt-8 sm:px-6">
        <header className="mb-6 flex items-center gap-3 border-b-2 border-ink pb-4">
          <h1 className="font-brand text-4xl leading-none sm:text-5xl">Homestand</h1>
          <div className="ml-auto flex items-center gap-1">
            <ActivityButton onClick={() => setActivityOpen(true)} />
            <ThemeToggle />
          </div>
        </header>

        <div className="mb-7 border-b border-border">
          <nav className="scrollbar-accent flex gap-1 overflow-x-auto pb-2">
            {NAV_ITEMS.map((item, i) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/"}
                className={({ isActive }) =>
                  `border-b-2 py-2 ${i === 0 ? "pr-3" : "px-3"} text-sm font-semibold whitespace-nowrap ${
                    isActive ? "border-accent text-ink" : "border-transparent text-ink-faint hover:text-ink"
                  }`
                }>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <main>
          <Outlet />
        </main>

        <footer className="mt-10 pt-4 text-center text-xs text-ink-faint">
          &copy; {new Date().getFullYear()}{" "}
          <a href="https://ews-tech.pages.dev/" target="_blank" rel="noopener noreferrer" className="hover:text-ink">
            Evan Szymkowicz
          </a>
        </footer>
      </div>

      <ActivityDrawer open={activityOpen} onClose={closeActivity} />
    </div>
  );
}
