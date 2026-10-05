import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function VerifyEmail() {
  useDocumentTitle("Verify email");
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setStatus("error");
      setMessage("missing verification token");
      return;
    }
    fetch(`/api/auth/verify?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then((data: { ok?: boolean; error?: string }) => {
        if (data.ok) {
          setStatus("ok");
        } else {
          setStatus("error");
          setMessage(data.error ?? "verification failed");
        }
      })
      .catch(() => {
        setStatus("error");
        setMessage("verification request failed");
      });
  }, [searchParams]);

  return (
    <div className="mx-auto max-w-md pt-12 text-center">
      <div className="scorebook-card p-6">
        {status === "loading" && <p className="text-ink-dim">Verifying your email…</p>}
        {status === "ok" && (
          <>
            <p className="font-bold text-green-800">Email verified.</p>
            <p className="mt-2 text-sm text-ink-dim">You can now sign in.</p>
            <Link
              to="/login"
              className="mt-4 inline-block rounded-md bg-accent px-4 py-2 font-bold text-accent-ink hover:opacity-90">
              Go to sign in
            </Link>
          </>
        )}
        {status === "error" && (
          <>
            <p className="text-hs-red">{message}</p>
            <Link to="/login" className="mt-4 inline-block text-sm underline">
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
