import type { PagesFunction } from "@cloudflare/workers-types";
import { generateSessionToken, jsonResponse } from "../../lib/auth";
import { sendEmail } from "../../lib/email";
import { enforceRateLimit, resetKey, type RateLimiter } from "../../lib/rateLimit";

interface ResetBody {
  email?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as ResetBody;
  const email = body.email?.trim().toLowerCase();
  if (!email) return jsonResponse({ error: "email is required" }, 400);

  // Keyed on the recipient, not the caller: the abuse is "hammer one victim's
  // inbox". Charged before the account lookup so it applies to unknown
  // addresses too -- and a 429 here reveals nothing about whether the account
  // exists, which the rest of this handler is careful to preserve.
  const limited = await enforceRateLimit(env.RESET_LIMITER as unknown as RateLimiter, [resetKey(email)]);
  if (limited) return limited;

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
    email,
    "Reset your Homestand password",
    `Open this link within the next hour to reset your password: ${url.toString()}\n\nIf you did not request this, ignore this.`
  );

  return jsonResponse({ ok: true });
};
