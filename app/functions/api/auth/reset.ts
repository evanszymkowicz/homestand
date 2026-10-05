import type { PagesFunction } from "@cloudflare/workers-types";
import { hashPassword, jsonResponse } from "../../lib/auth";

interface ResetBody {
  token?: string;
  password?: string;
}

/** Spends a single-use token atomically.
 *
 * SELECT-then-UPDATE is a TOCTOU: two concurrent requests with the same valid
 * token both pass the `used_at IS NULL` read and both execute. Making the
 * UPDATE itself conditional and branching on `meta.changes` means exactly one
 * caller sees changes === 1.
 *
 * Returns the account id on success, or null if the token was already spent.
 */
export async function consumeToken(
  db: D1Database,
  token: string,
  type: "verification" | "password_reset"
): Promise<string | null> {
  const result = await db
    .prepare(
      `UPDATE email_tokens SET used_at = datetime('now')
       WHERE token = ? AND type = ? AND used_at IS NULL AND expires_at > datetime('now')`
    )
    .bind(token, type)
    .run();

  if (!result.meta || result.meta.changes !== 1) return null;
  const row = await db
    .prepare("SELECT account_id FROM email_tokens WHERE token = ?")
    .bind(token)
    .first<{ account_id: string }>();
  return row?.account_id ?? null;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as ResetBody;
  const token = body.token;
  const password = body.password;
  if (!token || !password) return jsonResponse({ error: "token and password are required" }, 400);
  if (password.length < 8) return jsonResponse({ error: "password must be at least 8 characters" }, 400);

  const accountId = await consumeToken(env.DB, token, "password_reset");
  if (!accountId) return jsonResponse({ error: "invalid or expired reset link" }, 400);

  const passwordHash = await hashPassword(password);
  await env.DB.prepare("UPDATE accounts SET password_hash = ? WHERE id = ?").bind(passwordHash, accountId).run();

  // A reset is treated as a security event: kill every existing session so a
  // stolen cookie does not outlive the password it was issued under.
  await env.DB.prepare("DELETE FROM sessions WHERE account_id = ?").bind(accountId).run();

  return jsonResponse({ ok: true });
};
