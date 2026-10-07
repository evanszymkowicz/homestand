import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth/AuthContext";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function Landing() {
  useDocumentTitle("Homestand");
  const { account, loginDemo } = useAuth();
  const navigate = useNavigate();
  const tryDemo = async () => {
    await loginDemo();
    navigate("/season", { replace: true });
  };
  return (
    <div className="scorebook-texture min-h-screen bg-surface text-ink">
      <main>
        <section className="mx-auto flex min-h-[80vh] max-w-3xl flex-col justify-center px-6 pb-12 pt-20 text-center sm:pt-24">
          <h1 className="wordmark-piped font-brand text-6xl leading-[0.95] sm:text-7xl">Homestand</h1>
          <p className="mx-auto mt-5 max-w-xl text-sm font-bold uppercase tracking-widest text-ink sm:text-base">
            Gain the edge<span className="text-hs-red">.</span> Build your team
            <span className="text-hs-red">.</span> Stay ahead of the competition
            <span className="text-hs-red">.</span>
          </p>
          {!account && (
            <div className="mt-8 flex flex-col items-center gap-3">
              <button
                onClick={tryDemo}
                className="inline-block cursor-pointer rounded-md bg-hs-red px-6 py-3 font-bold text-white shadow-sm hover:opacity-90">
                Try the demo
              </button>
              <Link to="/login" className="text-sm font-bold text-ink hover:underline">
                Registration
              </Link>
            </div>
          )}
        </section>

        {/* Feature rows: image/copy swap sides each row. One aspect ratio on
            every frame so the four rows read as one design. */}
        <section aria-labelledby="features" className="border-t border-border/40 py-20">
          <h2 id="features" className="sr-only">
            What Homestand does
          </h2>
          <div className="mx-auto max-w-5xl space-y-24 px-6">
            <div className="grid items-center gap-10 sm:grid-cols-2">
              <div>
                <h3 className="text-2xl font-bold">League History</h3>
                <p className="mt-3 text-ink-dim">Every season, matchup, and box score.</p>
                <Link to="/login" className="mt-5 inline-block whitespace-nowrap text-sm font-bold text-hs-red hover:underline">
                  Explore the demo &rarr;
                </Link>
              </div>
              <div className="scorebook-card landing-shot">
                <img src="/img/landing/history.png" alt="League History" className="rounded-[2px]" loading="lazy" />
              </div>
            </div>

            <div className="grid items-center gap-10 sm:grid-cols-2">
              <div className="scorebook-card landing-shot order-2 sm:order-1">
                <img src="/img/landing/analytics.png" alt="Analytics Dashboard" className="rounded-[2px]" loading="lazy" />
              </div>
              <div className="order-1 sm:order-2">
                <h3 className="text-2xl font-bold">Analytics Dashboard</h3>
                <p className="mt-3 text-ink-dim">Performance metrics and comparative analysis in a scorebook-styled app.</p>
                <Link to="/login" className="mt-5 inline-block whitespace-nowrap text-sm font-bold text-hs-red hover:underline">
                  View the platform &rarr;
                </Link>
              </div>
            </div>

            <div className="grid items-center gap-10 sm:grid-cols-2">
              <div>
                <h3 className="text-2xl font-bold">Records</h3>
                <p className="mt-3 text-ink-dim">Standings, statistics and superlatives compiled from every week, every year.</p>
                <Link to="/login" className="mt-5 inline-block whitespace-nowrap text-sm font-bold text-hs-red hover:underline">
                  See the record book &rarr;
                </Link>
              </div>
              {/* The capture is a wide strip; centered with equal paper on both sides
                  so the frame doesn't look off-balance. */}
              <div className="scorebook-card landing-shot padded flex items-center justify-center px-3 py-2">
                <img src="/img/landing/superlatives.png" alt="Records" className="rounded-[2px]" loading="lazy" />
              </div>
            </div>

            </div>
        </section>

        <section className="border-t border-border/40 bg-surface-2/40 py-16">
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
                  <li>Admin approval</li>
                </ul>
                <Link
                  to="/login"
                  className="mt-6 block w-full rounded-md bg-hs-red px-4 py-2.5 text-center font-bold text-white shadow-sm hover:opacity-90">
                  Get started
                </Link>
              </div>

              <div className="scorebook-card p-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold">Pro</h3>
                  <span className="rounded bg-border px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider text-ink-faint">Coming soon</span>
                </div>
                <p className="mt-2 text-3xl font-bold">—</p>
                <p className="mt-1 text-sm text-ink-dim">For commissioners who want it all</p>
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
