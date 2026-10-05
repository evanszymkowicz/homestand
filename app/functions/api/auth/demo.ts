import type { PagesFunction } from "@cloudflare/workers-types";
import { createSession, jsonResponse, setSessionCookie } from "../../lib/auth";

export const onRequestPost: PagesFunction<Env> = async ({ env }) => {
  // Look the account up by its `demo` flag rather than repeating its id. The id
  // used to be hardcoded here and in migration 0002, and the two drifted -- the
  // anonymisation pass renamed the seeded account but not this constant, so demo
  // login 500'd with a foreign-key error on any database that didn't happen to
  // match the constant. One source of truth is the flag.
  const account = await env.DB.prepare("SELECT id FROM accounts WHERE demo = 1 LIMIT 1").first<{ id: string }>();
  if (!account) {
    return jsonResponse({ error: "demo account is not seeded" }, 500);
  }

  const token = await createSession(account.id, env.DB);
  return jsonResponse({ ok: true, demo: true }, 200, { headers: { "Set-Cookie": setSessionCookie(token) } });
};
