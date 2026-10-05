import type { PagesFunction } from "@cloudflare/workers-types";
import { jsonResponse } from "../../lib/auth";
import { consumeToken } from "./reset";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return jsonResponse({ error: "token required" }, 400);

  // Atomic single-use consumption -- see consumeToken's note on the TOCTOU.
  const accountId = await consumeToken(env.DB, token, "verification");
  if (!accountId) return jsonResponse({ error: "invalid or expired verification link" }, 400);

  await env.DB.prepare("UPDATE accounts SET verified = 1 WHERE id = ?").bind(accountId).run();

  return jsonResponse({ ok: true, verified: true });
};
