import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth/AuthContext";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function Landing() {
  useDocumentTitle("Homestand");
  const { account } = useAuth();
  return (
    <div className="min-h-screen bg-paper text-ink">
      <main>
        <section className="mx-auto max-w-3xl px-6 pb-12 pt-20 text-center sm:pt-24">
          <h1 className="wordmark-piped font-brand text-6xl leading-[0.95] sm:text-7xl">Homestand</h1>
          <p className="mx-auto mt-5 max-w-xl text-sm font-bold uppercase tracking-[0.25em] text-ink-faint sm:text-base">
            Gain the edge<span className="text-hs-red">.</span> Build your team
            <span className="text-hs-red">.</span> Stay ahead of the competition
            <span className="text-hs-red">.</span>
          </p>
          {!account && (
            <div className="mt-8 flex flex-col items-center gap-3">
              <Link
                to="/login"
                className="inline-block rounded-md bg-hs-red px-6 py-3 font-bold text-white shadow-sm hover:opacity-90">
                Try the demo
              </Link>
              <Link to="/login" className="text-sm font-bold text-ink hover:underline">
                Sign in
              </Link>
            </div>
          )}
        </section>

        <section className="border-t border-border/40 bg-paper-dark/40 py-16">
          <div className="mx-auto max-w-5xl px-6">
            <div className="grid gap-8 sm:grid-cols-3">
              <div>
                <h3 className="font-bold">League History</h3>
                <p className="mt-2 text-sm text-ink-dim">Import every season, matchup, and box score.</p>
              </div>
              <div>
                <h3 className="font-bold">Analytics Dashboard</h3>
                <p className="mt-2 text-sm text-ink-dim">
                  Standings, records, and superlatives in a scorebook-styled app.
                </p>
              </div>
              <div>
                <h3 className="font-bold">Invite-only Access</h3>
                <p className="mt-2 text-sm text-ink-dim">
                  Accounts are created with a valid invitation token. No open registration.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-border/40 bg-paper-dark/40 py-16">
          <div className="mx-auto max-w-5xl px-6">
            <h2 className="text-center text-2xl font-bold">Pricing</h2>
            <div className="mt-10 grid gap-6 sm:grid-cols-2">
              <div className="scorebook-card p-6">
                <h3 className="text-lg font-bold">Free</h3>
                <p className="mt-2 text-3xl font-bold">$0</p>
                <p className="mt-1 text-sm text-ink-dim">1 league, 30-day access</p>
                <ul className="mt-4 space-y-2 text-sm text-ink-dim">
                  <li>Demo account access</li>
                  <li>Basic standings and records</li>
                  <li>Community invite</li>
                </ul>
                <Link
                  to="/login"
                  className="mt-6 block w-full rounded-md bg-accent px-4 py-2.5 text-center font-bold text-accent-ink shadow-sm hover:opacity-90">
                  Get started
                </Link>
              </div>

              <div className="scorebook-card p-6 opacity-60">
                <h3 className="text-lg font-bold">Pro</h3>
                <p className="mt-2 text-3xl font-bold">—</p>
                <p className="mt-1 text-sm text-ink-dim">Coming soon</p>
                <ul className="mt-4 space-y-2 text-sm text-ink-dim">
                  <li>Unlimited imports</li>
                  <li>Extended retention</li>
                  <li>Advanced analytics</li>
                </ul>
                <span className="mt-6 block w-full rounded-md bg-border px-4 py-2.5 text-center text-sm font-bold text-ink-faint">
                  Not available yet
                </span>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/40 py-6 text-center text-xs text-ink-faint">
        <span className="scorebook-stat text-hs-red">&copy; {new Date().getFullYear()}</span>{" "}
        <a href="https://ews-tech.pages.dev/" target="_blank" rel="noopener noreferrer" className="hover:text-ink">
          Evan Szymkowicz
        </a>
      </footer>
    </div>
  );
}
