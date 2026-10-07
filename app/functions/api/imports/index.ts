import type { PagesFunction } from "@cloudflare/workers-types";
import { jsonResponse, validateSession } from "../../lib/auth";

interface CreateImportBody {
  leagueId?: number;
  leagueName?: string;
  yearStart?: number;
  yearEnd?: number;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const account = await validateSession(request, env.DB);
  if (!account) return jsonResponse({ error: "unauthenticated" }, 401);

  const body = (await request.json()) as CreateImportBody;
  if (!body.leagueId) {
    return jsonResponse({ error: "leagueId is required" }, 400);
  }

  // S2: free tier accounts are limited to 1 import.
  if (account.tier === "free") {
    const count = await env.DB.prepare("SELECT COUNT(*) as c FROM imports WHERE account_id = ?")
      .bind(account.id)
      .first<{ c: number }>();
    if (count && count.c >= 1) {
      return jsonResponse({ error: "free tier accounts are limited to 1 import" }, 403);
    }
  }

  const id = crypto.randomUUID();
  const yearEnd = body.yearEnd ?? new Date().getFullYear();
  const yearStart = body.yearStart ?? yearEnd;

  await env.DB.prepare(
    "INSERT INTO imports (id, account_id, league_id, league_name, status, year_start, year_end, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      id,
      account.id,
      body.leagueId,
      body.leagueName ?? null,
      "pending",
      yearStart,
      yearEnd,
      // Free tier gets the 30-day TTL the landing page advertises.
      account.tier === "free" ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null
    )
    .run();

  // Return the full row so the client can add it to the import list without
  // refetching.
  const created = await env.DB.prepare(
    "SELECT id, league_id, league_name, status, year_start, year_end, expires_at, created_at FROM imports WHERE id = ?"
  )
    .bind(id)
    .first<Record<string, unknown>>();

  return jsonResponse({ import: created, id }, 201);
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const account = await validateSession(request, env.DB);
  if (!account) return jsonResponse({ error: "unauthenticated" }, 401);

  const rows = await env.DB.prepare(
    "SELECT id, league_id, league_name, status, failure_reason, year_start, year_end, expires_at, created_at FROM imports WHERE account_id = ? ORDER BY created_at DESC"
  )
    .bind(account.id)
    .all<{
      id: string;
      league_id: number;
      league_name: string | null;
      status: string;
      failure_reason: string | null;
      year_start: number;
      year_end: number;
      expires_at: string | null;
      created_at: string;
    }>();

  return jsonResponse({ imports: rows.results ?? [] });
};
