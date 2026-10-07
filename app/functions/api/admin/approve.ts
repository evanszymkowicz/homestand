import type { PagesFunction } from "@cloudflare/workers-types";
import { jsonResponse, requireAdmin } from "../../lib/auth";

// POST { email } -> marks the account approved so it can log in.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!requireAdmin(request, env.ADMIN_API_KEY)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  const { email } = (await request.json()) as { email?: string };
  if (!email) return jsonResponse({ error: "email required" }, 400);
  const res = await env.DB.prepare("UPDATE accounts SET approved = 1 WHERE email = ?")
    .bind(email.trim().toLowerCase())
    .run();
  return jsonResponse({ ok: true, approved: res.meta?.changes ?? 0 });
};
