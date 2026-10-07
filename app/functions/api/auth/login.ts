import type { PagesFunction } from "@cloudflare/workers-types";
import { createSession, decoyPasswordHash, jsonResponse, setSessionCookie, verifyPassword } from "../../lib/auth";
import { clientIp, enforceHorizon, horizonRules } from "../../lib/rateLimitHorizon";

interface LoginBody {
  email?: string;
  password?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as LoginBody;
  const email = body.email?.trim().toLowerCase();
  const password = body.password;

  if (!email || !password) {
    return jsonResponse({ error: "email and password are required" }, 400);
  }

  // Charged before the PBKDF2 call, which is the expensive part: a run that is
  // already over its hourly or daily budget should not also cost 27ms of CPU per
  // attempt. Both the account and the host key are charged, so neither one host
  // spraying many accounts nor a botnet grinding one account gets a free run.
  const overHorizon = await enforceHorizon(env.DB, horizonRules("login", { acct: email, ip: clientIp(request) }));
  if (overHorizon) return overHorizon;

  const row = await env.DB.prepare("SELECT id, password_hash, verified, approved FROM accounts WHERE email = ? AND demo = 0")
    .bind(email)
    .first<{ id: string; password_hash: string | null; verified: number; approved: number }>();

  // Always run the KDF. Verifying against the decoy when no account matched keeps
  // an unknown address on the same ~27ms path as a real one, so response time
  // does not enumerate accounts. It can never match, so `valid` still decides.
  const storedHash = row?.password_hash ?? (await decoyPasswordHash());
  const valid = await verifyPassword(password, storedHash);

  if (!row?.password_hash || !valid) {
    return jsonResponse({ error: "invalid credentials" }, 401);
  }

  if (!row.verified) {
    return jsonResponse({ error: "email not verified" }, 403);
  }

  if (!row.approved) {
    return jsonResponse({ error: "account pending approval" }, 403);
  }

  const token = await createSession(row.id, env.DB);
  return jsonResponse({ ok: true }, 200, {
    headers: { "Set-Cookie": setSessionCookie(token) },
  });
};
