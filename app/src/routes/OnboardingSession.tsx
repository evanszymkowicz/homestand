import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../lib/auth/AuthContext";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

/** Where the user copies the cookie header from. Per-browser because the panel
 * names differ and the spec calls for naming them rather than hand-waving. */
const STEPS = [
  {
    browser: "Chrome or Edge",
    how: "Press F12 → Network tab → reload the page → click any request → Headers → Request Headers → cookie",
  },
  { browser: "Firefox", how: "Press F12 → Network → reload → click any request → Headers → Cookie" },
  {
    browser: "Safari",
    how: "Enable Develop in Settings → Advanced, then Web Inspector → Network → any request → Headers → Cookie",
  },
];

export function OnboardingSession() {
  useDocumentTitle("Connect your ESPN session");
  const { importId } = useParams<{ importId: string }>();
  const navigate = useNavigate();
  const { account } = useAuth();

  const [pasted, setPasted] = useState("");
  const [phase, setPhase] = useState<"idle" | "checking" | "ok">("idle");
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importId) return;
    setPhase("checking");
    setError("");
    try {
      // Validate against ESPN before storing -- a bad pair is rejected inline
      // rather than failing later inside the crawl.
      const probe = await fetch(`/api/imports/${importId}/probe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookieHeader: pasted }),
      });
      const probeData = (await probe.json()) as { ok?: boolean; teams?: number; error?: string };
      if (!probe.ok) throw new Error(probeData.error ?? "That session did not work.");

      const save = await fetch(`/api/imports/${importId}/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookieHeader: pasted }),
      });
      const saveData = (await save.json()) as { error?: string };
      if (!save.ok) throw new Error(saveData.error ?? "could not save");

      setPhase("ok");
    } catch (err) {
      setPhase("idle");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!account) return null;

  if (phase === "ok") {
    return (
      <div className="mx-auto max-w-lg">
        <div className="scorebook-card p-6 text-center">
          <p className="font-bold text-green-800">Session saved.</p>
          <p className="mt-2 text-sm text-ink-dim">
            Starting your import now. It can take a few minutes for older seasons.
          </p>
          <button
            onClick={() => navigate(`/imports/${importId}`)}
            className="mt-4 rounded-md bg-hs-red px-4 py-2 font-bold text-white hover:opacity-90">
            Watch progress
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <h2 className="font-brand text-3xl">Connect your ESPN session</h2>
      <p className="mt-2 text-sm text-ink-dim">
        Homestand reads your league the same way your browser does — with the two cookies ESPN sets when you sign in. We
        need one copy from your browser to get them.
      </p>

      <ol className="mt-5 space-y-2 text-sm">
        <li className="font-bold">1. Sign in to ESPN and open your league.</li>
        <li className="font-bold">2. Open the Network panel and find the cookie header:</li>
      </ol>
      <ul className="mt-2 space-y-2 pl-4 text-sm text-ink-dim">
        {STEPS.map(s => (
          <li key={s.browser}>
            <span className="font-bold text-ink">{s.browser}:</span> {s.how}
          </li>
        ))}
      </ul>
      <ol className="mt-3 text-sm">
        <li className="font-bold">3. Copy that whole value and paste it below.</li>
      </ol>

      <form onSubmit={submit} className="mt-5">
        <label className="block text-xs font-bold uppercase text-ink-faint">
          ESPN cookie header
          <textarea
            value={pasted}
            onChange={e => {
              setPasted(e.target.value);
              // Clear the previous attempt's verdict; a stale "invalid session"
              // next to freshly-edited input reads as a live result.
              if (error) setError("");
            }}
            required
            rows={3}
            spellCheck={false}
            placeholder="espn_s2=…; SWID={…}; …"
            className="mt-1 block w-full rounded border border-border bg-surface px-3 py-2 font-mono text-xs text-ink"
          />
        </label>

        <p className="mt-2 text-xs text-ink-faint">
          Only <code>espn_s2</code> and <code>SWID</code> are kept. Everything is encrypted before it touches our
          database, and you can delete your import at any time.
        </p>

        {error && <p className="mt-3 text-sm text-hs-red">{error}</p>}

        <button
          type="submit"
          disabled={phase === "checking"}
          className="mt-4 w-full rounded-md bg-accent px-4 py-2.5 font-bold text-accent-ink shadow-sm hover:opacity-90 disabled:opacity-50">
          {phase === "checking" ? "Checking…" : "Connect and start import"}
        </button>
      </form>

      <p className="mt-4 text-xs text-ink-faint">
        Cookies expire every so often — if your import later fails, come back and paste a fresh one.{" "}
        <Link to="/import/new" className="underline">
          Start over
        </Link>
      </p>
    </div>
  );
}
