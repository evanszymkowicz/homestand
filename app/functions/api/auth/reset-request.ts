import type { PagesFunction } from "@cloudflare/workers-types";
import { generateSessionToken, jsonResponse } from "../../lib/auth";
import { sendEmail } from "../../lib/email";
import { enforceHorizon, horizonRules } from "../../lib/rateLimitHorizon";

interface ResetBody {
  email?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as ResetBody;
  const email = body.email?.trim().toLowerCase();
  if (!email) return jsonResponse({ error: "email is required" }, 400);

  const overHorizon = await enforceHorizon(env.DB, horizonRules("reset", { email }));
  if (overHorizon) return overHorizon;

  const account = await env.DB.prepare("SELECT id,verified FROM accounts WHERE email = ? AND demo = 0")
    .bind(email)
    .first<{ id: string; verified: number }>();

  // Always return ok to avoid leaking whether the account exists.
  if (!account || !account.verified) {
    return jsonResponse({ ok: true });
  }

  const token = await generateSessionToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO email_tokens (token, account_id, type, expires_at) VALUES (?, ?, 'password_reset', ?)"
  )
    .bind(token, account.id, expiresAt)
    .run();

  const url = new URL(request.url);
  url.pathname = "/reset-password";
  url.search = `?token=${encodeURIComponent(token)}`;
  await sendEmail(
    env,
    email,
    "Reset your Homestand password",
    `Open this link within the next hour to reset your password: ${url.toString()}\n\nIf you did not request this, ignore this.`
  );

  return jsonResponse({ ok: true });
};
