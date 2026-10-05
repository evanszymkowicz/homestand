import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function ResetPassword() {
  useDocumentTitle("Reset password");
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setStatus("error");
      setMessage("missing reset token");
      return;
    }
    setStatus("loading");
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "reset failed");
      setStatus("ok");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  if (!token) {
    return (
      <div className="mx-auto max-w-md pt-12 text-center text-ink-dim">
        <p>Reset link is missing a token.</p>
        <Link to="/login" className="mt-3 inline-block underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md pt-12">
      <div className="scorebook-card p-6">
        <h2 className="font-brand text-3xl">Reset your password</h2>
        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
          <label className="block text-xs font-bold uppercase text-ink-faint">
            New password
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={8}
              className="mt-1 block w-full rounded border border-border bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>
          <button
            type="submit"
            disabled={status === "loading"}
            className="w-full rounded-md bg-accent px-4 py-2.5 font-bold text-accent-ink shadow-sm hover:opacity-90 disabled:opacity-50">
            {status === "loading" ? "Saving…" : "Save password"}
          </button>
        </form>

        {status === "ok" && (
          <>
            <p className="mt-3 text-green-800">Password updated.</p>
            <Link to="/login" className="mt-2 inline-block underline">
              Sign in
            </Link>
          </>
        )}
        {status === "error" && <p className="mt-3 text-hs-red">{message}</p>}
      </div>
    </div>
  );
}
