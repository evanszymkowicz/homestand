import type { PagesFunction } from "@cloudflare/workers-types";
import { generateSessionToken, hashPassword, jsonResponse, verifyTurnstile } from "../../lib/auth";
import { sendEmail } from "../../lib/email";

interface SignupBody {
  email?: string;
  password?: string;
  inviteToken?: string;
  turnstileToken?: string;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as SignupBody;
  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  const inviteToken = body.inviteToken?.trim();
  const turnstileToken = body.turnstileToken?.trim();

  if (!email || !isValidEmail(email)) {
    return jsonResponse({ error: "valid email is required" }, 400);
  }
  if (!password || password.length < 8) {
    return jsonResponse({ error: "password must be at least 8 characters" }, 400);
  }
  if (!inviteToken) {
    return jsonResponse({ error: "invite token is required" }, 400);
  }

  const turnstileOk = await verifyTurnstile(turnstileToken ?? "", env.TURNSTILE_SECRET_KEY ?? "");
  if (!turnstileOk) {
    return jsonResponse({ error: "turnstile challenge failed" }, 400);
  }

  const invite = await env.DB.prepare(
    `SELECT token FROM invites
       WHERE token = ?
         AND (email IS NULL OR LOWER(email) = LOWER(?))
         AND used_by_account_id IS NULL
         AND expires_at > datetime('now')`
  )
    .bind(inviteToken, email)
    .first<{ token: string }>();

  if (!invite) {
    return jsonResponse({ error: "invalid or expired invite token" }, 400);
  }

  const existing = await env.DB.prepare("SELECT id FROM accounts WHERE email = ?").bind(email).first<{ id: string }>();
  if (existing) {
    return jsonResponse({ error: "email already registered" }, 409);
  }

  const accountId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const displayName = email.split("@")[0];

  // ponytail: email verification is required before first login. Do not set verified=1 here.
  await env.DB.prepare(
    "INSERT INTO accounts (id, email, password_hash, display_name, verified, tier, demo) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(accountId, email, passwordHash, displayName, 0, "free", 0)
    .run();

  await env.DB.prepare("UPDATE invites SET used_by_account_id = ? WHERE token = ?").bind(accountId, inviteToken).run();

  const verifyToken = await generateSessionToken();
  const verifyExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    "INSERT INTO email_tokens (token, account_id, type, expires_at) VALUES (?, ?, 'verification', ?)"
  )
    .bind(verifyToken, accountId, verifyExpiry)
    .run();

  const verifyUrl = new URL(request.url);
  verifyUrl.pathname = `/verify`;
  verifyUrl.search = `?token=${encodeURIComponent(verifyToken)}`;
  await sendEmail(
    email,
    "Verify your Homestand email",
    `Open this link to verify your email: ${verifyUrl.toString()}\n\nIf you didn’t sign up, ignore this.`
  );

  return jsonResponse({ ok: true, requiresVerification: true });
};
