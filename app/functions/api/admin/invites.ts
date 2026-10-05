import type { PagesFunction } from "@cloudflare/workers-types";
import { generateSessionToken, jsonResponse, requireAdmin } from "../../lib/auth";

interface InviteBody {
  email?: string;
  expiresInHours?: number;
}

const DEFAULT_INVITE_TTL_HOURS = 7 * 24;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!requireAdmin(request, env.ADMIN_API_KEY)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const body = (await request.json()) as InviteBody;
  const email = body.email?.trim().toLowerCase() || null;
  const expiresInHours = Math.min(Math.max(1, Math.floor(body.expiresInHours ?? DEFAULT_INVITE_TTL_HOURS)), 30 * 24);
  const token = await generateSessionToken();
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

  await env.DB.prepare("INSERT INTO invites (token, email, expires_at) VALUES (?, ?, ?)")
    .bind(token, email, expiresAt)
    .run();

  return jsonResponse({ token, email, expiresAt });
};
