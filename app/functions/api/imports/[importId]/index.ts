import type { PagesFunction } from "@cloudflare/workers-types";
import { jsonResponse, validateSession } from "../../../lib/auth";

/** Single-import read, scoped to the caller's account. ImportDetail polls this
 * while a crawl is in flight, so the row must stay fresh for that account only. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const account = await validateSession(request, env.DB);
  if (!account) return jsonResponse({ error: "unauthenticated" }, 401);

  const row = await env.DB.prepare(
    "SELECT id, league_id, league_name, status, failure_reason, year_start, year_end, created_at FROM imports WHERE id = ? AND account_id = ?"
  )
    .bind(params.importId, account.id)
    .first<{
      id: string;
      league_id: number | null;
      league_name: string | null;
      status: string;
      failure_reason: string | null;
      year_start: number | null;
      year_end: number | null;
      created_at: string;
    }>();

  if (!row) return jsonResponse({ error: "not found" }, 404);
  return jsonResponse({ import: row });
};
