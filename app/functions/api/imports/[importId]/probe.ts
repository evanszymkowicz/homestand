import type { PagesFunction } from "@cloudflare/workers-types";
import { jsonResponse, validateSession } from "../../../lib/auth";

import { buildUrl, redactSwid, requestView } from "../../../../lib/espn/espnClient";
import { parseEspnSession } from "../../../../lib/espnSession";
import { enforceRateLimit, probeKey, type RateLimiter } from "../../../lib/rateLimit";
import { enforceHorizon, horizonRules } from "../../../lib/rateLimitHorizon";

interface ProbeBody {
  /** A whole `Cookie:` header from espn.com -- the one-paste path. */
  cookieHeader?: string;
  espnS2?: string;
  swid?: string;
  leagueId?: number;
  year?: number;
}

export const onRequestPost: PagesFunction<Env> = async context => {
  const { request, env, params } = context;
  const account = await validateSession(request, env.DB);
  if (!account) return jsonResponse({ error: "unauthenticated" }, 401);

  const importId = params.importId as string;
  const importRow = await env.DB.prepare("SELECT account_id, league_id FROM imports WHERE id = ?")
    .bind(importId)
    .first<{ account_id: string; league_id: number | null }>();
  if (!importRow || importRow.account_id !== account.id) {
    return jsonResponse({ error: "import not found" }, 404);
  }

  // Each probe costs a paid call against the caller's own ESPN session, so this
  // bounds both the credential oracle and how hard we lean on ESPN.
  const limited = await enforceRateLimit(env.PROBE_LIMITER as unknown as RateLimiter, [probeKey(request, account.id)]);
  if (limited) return limited;

  // A daily budget matters more here than a per-minute one: each probe is a real
  // request to ESPN from this service's IP, so this bounds how hard we lean on
  // ESPN as well as how hard one account can lean on the oracle.
  const overHorizon = await enforceHorizon(env.DB, horizonRules("probe", { acct: account.id }));
  if (overHorizon) return overHorizon;

  const body = (await request.json()) as ProbeBody;
  // One paste beats hunting two cookies, so a `Cookie:` header wins if present.
  const parsed = body.cookieHeader ? parseEspnSession(body.cookieHeader) : null;
  const espnS2 = parsed?.espnS2 ?? body.espnS2?.trim();
  const swid = parsed?.swid ?? body.swid?.trim();
  const leagueId = body.leagueId ?? importRow.league_id;
  const year = body.year ?? new Date().getFullYear();

  if (!espnS2 || !swid) {
    return jsonResponse({ error: "espn_s2 and SWID are required — paste your whole ESPN cookie string" }, 400);
  }
  // Both end up inside an ESPN URL path, so constrain them to the shapes the
  // API actually accepts rather than passing raw request data through.
  // The `typeof` check comes first because Number.isInteger is not a type guard
  // for TS -- on its own it cannot narrow `leagueId`'s `number | null`, which is
  // why this used to need `as number` casts on every comparison below.
  if (typeof leagueId !== "number" || !Number.isInteger(leagueId) || leagueId <= 0) {
    return jsonResponse({ error: "league_id must be a positive integer" }, 400);
  }
  if (typeof year !== "number" || !Number.isInteger(year) || year < 2000 || year > 2100) {
    return jsonResponse({ error: "year must be an integer between 2000 and 2100" }, 400);
  }
  if (body.cookieHeader && body.cookieHeader.length > 8192) {
    return jsonResponse({ error: "cookie header is too long" }, 400);
  }
  if (espnS2.length > 2048 || swid.length > 128) {
    return jsonResponse({ error: "session cookie value is too long" }, 400);
  }

  const cookies = { espn_s2: espnS2, SWID: swid };
  const url = buildUrl(year, "mTeam", leagueId);
  const result = await requestView(url, cookies, "mTeam");

  if (result.statusCode === 401 || result.statusCode === 403) {
    return jsonResponse({ error: "invalid or expired ESPN session" }, 401);
  }
  if (result.statusCode !== 200 || !result.content) {
    return jsonResponse({ error: "ESPN probe failed", detail: redactSwid(result.note) }, 502);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(result.content);
  } catch {
    return jsonResponse({ error: "ESPN returned invalid JSON" }, 502);
  }

  const teams = Array.isArray(payload)
    ? (payload[0] as Record<string, unknown>)?.teams
    : (payload as Record<string, unknown>)?.teams;
  if (!Array.isArray(teams) || teams.length === 0) {
    return jsonResponse({ error: "ESPN probe returned no teams" }, 502);
  }

  return jsonResponse({ ok: true, teams: teams.length });
};
