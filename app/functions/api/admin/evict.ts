import type { PagesFunction } from "@cloudflare/workers-types";
import { jsonResponse, requireAdmin } from "../../lib/auth";

const FREE_TIER_TTL_DAYS = 30;

/** Evicts idle free-tier accounts. Driven hourly by the `cron/` Worker, which
 *
 * Two guards, because a blanket `tier = 'free' AND created_at < cutoff` is a
 * foot-gun: it would destroy an account mid-crawl, and it reports the same
 * response for "deleted nothing" and "deleted everything".
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!requireAdmin(request, env.ADMIN_API_KEY)) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const cutoff = new Date(Date.now() - FREE_TIER_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Report what would go first, and skip anyone with a crawl in flight.
  const doomed = await env.DB.prepare(
    `SELECT a.id, a.email FROM accounts a
       WHERE a.tier = 'free' AND a.created_at < ?
         AND NOT EXISTS (
           SELECT 1 FROM imports i
           WHERE i.account_id = a.id AND i.status IN ('pending', 'running')
         )`
  )
    .bind(cutoff)
    .all<{ id: string; email: string }>();
  const rows = doomed.results ?? [];

  if (rows.length === 0) return jsonResponse({ ok: true, evicted: 0, cutoff });

  const deleted = await env.DB.prepare(
    `DELETE FROM accounts
       WHERE tier = 'free' AND created_at < ?
         AND NOT EXISTS (
           SELECT 1 FROM imports i
           WHERE i.account_id = accounts.id AND i.status IN ('pending', 'running')
         )`
  )
    .bind(cutoff)
    .run();

  return jsonResponse({
    ok: true,
    evicted: deleted.meta?.changes ?? 0,
    cutoff,
    // Emails only -- never credentials, never import ids.
    evictedEmails: rows.map(r => r.email),
  });
};
