import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { TurnstileWidget } from "../components/TurnstileWidget";
import { useAuth } from "../lib/auth/AuthContext";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

type Tab = "login" | "signup";

export function Login() {
  useDocumentTitle("Sign in");
  const navigate = useNavigate();
  const { loginDemo, loading: authLoading } = useAuth();

  const [tab, setTab] = useState<Tab>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleDemo = async () => {
    setError(null);
    await loginDemo();
    navigate("/season", { replace: true });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "login failed");
      navigate("/season", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!turnstileToken) {
      setError("Please complete the Turnstile challenge.");
      return;
    }
    if (password !== password2) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, turnstileToken }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "signup failed");
      navigate("/season", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="scorebook-texture min-h-screen bg-surface text-ink">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12 text-center">
        <div className="scorebook-card p-6">
          <h1 className="wordmark-piped font-brand text-5xl">Homestand</h1>
          <p className="mt-2 text-sm text-ink-dim">Premium fantasy baseball analytics.</p>

          {/* -mb-[2px] pulls the active tab's rule onto the container's, so the
              two never stack into a 3px double line (same trick as AppShell). */}
          <div className="mt-6 flex border-b border-border">
            <button
              type="button"
              onClick={() => setTab("login")}
              className={`flex-1 px-4 py-2 text-sm font-bold ${
                tab === "login" ? "-mb-[2px] border-b-2 border-hs-red text-ink" : "text-ink-faint"
              }`}>
              Log in
            </button>
            <button
              type="button"
              onClick={() => setTab("signup")}
              className={`flex-1 px-4 py-2 text-sm font-bold ${
                tab === "signup" ? "-mb-[2px] border-b-2 border-hs-red text-ink" : "text-ink-faint"
              }`}>
              Sign up
            </button>
          </div>

          {/* ink-dim, not red: --hs-red is 3.00:1 on this surface in dark mode,
              under AA for 12px text. */}
          {error && <p className="mt-3 text-xs text-ink-dim">{error}</p>}

        {tab === "login" ? (
          <form onSubmit={handleLogin} className="mt-4 space-y-3 text-left">
            <label className="block text-sm font-bold text-ink-dim">
              Email
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="mt-1 block w-full rounded border border-border bg-surface px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="block text-sm font-bold text-ink-dim">
              Password
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="mt-1 block w-full rounded border border-border bg-surface px-3 py-2 text-sm text-ink"
              />
            </label>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-hs-red px-4 py-2.5 font-bold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
              {loading ? "Loading…" : "Log in"}
            </button>

            <div className="text-center">
              <button
                type="button"
                className="text-xs font-bold text-ink-faint underline transition hover:text-hs-red"
                onClick={async () => {
                  if (!email) {
                    setError("enter your email first");
                    return;
                  }
                  const res = await fetch("/api/auth/reset-request", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email }),
                  });
                  if (res.ok) {
                    setError("reset email sent");
                  } else {
                    setError("reset request failed");
                  }
                }}>
                Forgot password?
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSignup} className="mt-4 space-y-3 text-left">
            <p className="text-xs text-ink-faint">Sign up, verify your email, and your account goes live after approval.</p>
            <label className="block text-sm font-bold text-ink-dim">
              Email
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="mt-1 block w-full rounded border border-border bg-surface px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="block text-sm font-bold text-ink-dim">
              Password
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={8}
                className="mt-1 block w-full rounded border border-border bg-surface px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="block text-sm font-bold text-ink-dim">
              Confirm password
              <input
                type="password"
                value={password2}
                onChange={e => setPassword2(e.target.value)}
                required
                minLength={8}
                className="mt-1 block w-full rounded border border-border bg-surface px-3 py-2 text-sm text-ink"
              />
            </label>
            <TurnstileWidget onVerify={setTurnstileToken} onError={() => setTurnstileToken("")} />
            <button
              type="submit"
              disabled={loading || !turnstileToken}
              className="w-full rounded-md bg-hs-red px-4 py-2.5 font-bold text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
              {loading ? "Loading…" : "Sign up"}
            </button>
          </form>
        )}

          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs font-bold text-ink-faint uppercase">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <button
            onClick={handleDemo}
            disabled={authLoading || loading}
            className="w-full rounded-md border border-hs-red px-4 py-2.5 text-sm font-bold text-hs-red transition hover:bg-hs-red hover:text-white disabled:cursor-not-allowed disabled:opacity-50">
            {authLoading ? "Loading…" : "Try the demo"}
          </button>
        </div>

        <p className="mt-8 text-center text-xs text-ink-faint">
          <span className="scorebook-stat text-hs-red">&copy; {new Date().getFullYear()}</span> Evan Szymkowicz
        </p>
      </div>
    </div>
  );
}
