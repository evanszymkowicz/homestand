import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, type ImportRecord } from "../lib/auth/AuthContext";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function NewImport() {
  useDocumentTitle("New import");
  const navigate = useNavigate();
  const { account, addImport } = useAuth();

  const [leagueId, setLeagueId] = useState("");
  const [yearStart, setYearStart] = useState(String(new Date().getFullYear() - 2));
  const [yearEnd, setYearEnd] = useState(String(new Date().getFullYear()));
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) return;
    setStatus("loading");
    setMessage("");
    try {
      const createRes = await fetch("/api/imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leagueId: Number(leagueId),
          yearStart: Number(yearStart),
          yearEnd: Number(yearEnd),
        }),
      });
      const createData = (await createRes.json()) as {
        id?: string;
        import?: ImportRecord;
        error?: string;
      };
      if (!createRes.ok || !createData.import) throw new Error(createData.error ?? "create import failed");

      addImport(createData.import);
      // Straight to the connect step. ESPN gates password login behind a
      // captcha, so a session cookie is the only credential we can use -- don't
      // collect a password we could never use.
      navigate(`/onboarding/session/${createData.import.id}`);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="mx-auto max-w-lg">
      <h2 className="font-brand text-3xl">Create a league import</h2>
      <p className="mt-2 text-sm text-ink-dim">
        We will crawl your ESPN league history and build a private record book for it.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <label className="block text-xs font-bold uppercase text-ink-faint">
          ESPN League ID
          <input
            type="number"
            value={leagueId}
            onChange={e => setLeagueId(e.target.value)}
            required
            className="mt-1 block w-full rounded border border-border bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block text-xs font-bold uppercase text-ink-faint">
            Year start
            <input
              type="number"
              value={yearStart}
              onChange={e => setYearStart(e.target.value)}
              required
              className="mt-1 block w-full rounded border border-border bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>
          <label className="block text-xs font-bold uppercase text-ink-faint">
            Year end
            <input
              type="number"
              value={yearEnd}
              onChange={e => setYearEnd(e.target.value)}
              required
              className="mt-1 block w-full rounded border border-border bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>
        </div>
        {status === "error" && <p className="text-xs text-hs-red">{message}</p>}

        <button
          type="submit"
          disabled={status === "loading"}
          className="w-full rounded-md bg-hs-red px-4 py-2.5 font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-50">
          {status === "loading" ? "Creating…" : "Continue to connect"}
        </button>
      </form>
    </div>
  );
}
