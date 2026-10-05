import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth, type ImportRecord } from "../lib/auth/AuthContext";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

const POLL_MS = 3000;

const STATUS_COPY: Record<string, string> = {
  pending: "Queued. Waiting for the crawl to start.",
  running: "Crawling ESPN and normalizing your history.",
  completed: "Ready. This league is loaded in the dashboard.",
  failed: "The crawl failed — most often an expired ESPN session cookie.",
};

export function ImportDetail() {
  useDocumentTitle("Import");
  const { id } = useParams<{ id: string }>();
  const { account } = useAuth();
  const [importRec, setImportRec] = useState<ImportRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!account || !id) return;

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const res = await fetch(`/api/imports/${id}`, {
          signal: controller.signal,
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error(`could not load import (${res.status})`);
        const data = (await res.json()) as { import?: ImportRecord; error?: string };
        if (data.error) throw new Error(data.error);
        if (!data.import) throw new Error("not found");

        setImportRec(data.import);
        setError("");
        // Clear loading on the first successful read regardless of status --
        // this page exists to display the pending/running states, so holding
        // the spinner would hide exactly what it is polling for.
        setLoading(false);

        if (data.import.status === "pending" || data.import.status === "running") {
          timer = setTimeout(poll, POLL_MS);
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        // Without this a single transient failure strands the page on
        // "Loading…" forever, since the spinner renders before the error.
        setLoading(false);
      }
    };

    void poll();

    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [account, id]);

  if (loading) return <p className="text-ink-dim">Loading…</p>;
  if (error && !importRec) return <p className="text-hs-red">{error}</p>;
  if (!importRec) return <p>Import not found.</p>;

  // The polled row is the fresh one; the AuthContext copy is a mount-time
  // snapshot and would pin the status to whatever it was on first load.
  const status = importRec.status;

  return (
    <div>
      <h2 className="font-brand text-3xl">Import</h2>
      {error && <p className="mt-2 text-xs text-hs-red">Last refresh failed: {error}</p>}
      <dl className="mt-4 space-y-1 text-sm text-ink-dim">
        <div>
          <dt className="font-bold text-ink">League ID</dt>
          <dd>{importRec.league_id ?? "—"}</dd>
        </div>
        <div>
          <dt className="font-bold text-ink">Status</dt>
          <dd>
            {status}
            <span className="ml-2 text-ink-faint">{STATUS_COPY[status] ?? "Unknown state."}</span>
          </dd>
        </div>
        <div>
          <dt className="font-bold text-ink">Years</dt>
          <dd>
            {importRec.year_start ?? "—"}–{importRec.year_end ?? "—"}
          </dd>
        </div>
      </dl>

      {status !== "completed" && (
        <div className="mt-6 rounded border border-border bg-surface-2 p-4">
          {/* No automated login exists -- ESPN captcha-gates it -- so a session
              cookie is required to crawl at all, and the only fix for a stale one
              is a fresh paste. Saying "try again" would be a lie. */}
          <p className="text-sm text-ink-dim">
            {status === "failed"
              ? "Your ESPN session cookie has probably expired. Paste a fresh one and we'll re-run the import."
              : "We need your ESPN session cookie before the crawl can start."}
          </p>
          <Link
            to={`/onboarding/session/${importRec.id}`}
            className="mt-3 inline-block rounded-md bg-accent px-4 py-2 text-sm font-bold text-accent-ink hover:opacity-90">
            {status === "failed" ? "Paste a fresh cookie" : "Connect ESPN session"}
          </Link>
        </div>
      )}
    </div>
  );
}
