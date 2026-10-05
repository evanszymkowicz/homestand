import type { PagesFunction } from "@cloudflare/workers-types";
import { jsonResponse, validateSession } from "../../../lib/auth";
import { encryptValue } from "../../../lib/crypto";
import { parseEspnSession } from "../../../../lib/espnSession";

interface CredentialsBody {
  /** A whole `Cookie:` header from espn.com -- the one-paste path. */
  cookieHeader?: string;
  /** Discrete values, kept for anyone who copied just these two. */
  espnS2?: string;
  swid?: string;
}

/** Generous ceilings, not real-world lengths. Each value is encrypted into a
 * single D1 TEXT column, so without a cap one authenticated POST can write
 * megabytes of attacker-controlled ciphertext and the free tier lets them
 * recreate the import. ESPN's own values are far below these. */
const MAX = { cookieHeader: 8192, espnS2: 2048, swid: 128 } as const;

function overLimit(body: CredentialsBody): string | null {
  for (const [field, max] of Object.entries(MAX) as [keyof typeof MAX, number][]) {
    const value = body[field];
    if (typeof value === "string" && value.length > max) return `${field} exceeds ${max} characters`;
  }
  return null;
}

export const onRequestPost: PagesFunction<Env> = async context => {
  const { request, env, params } = context;
  const account = await validateSession(request, env.DB);
  if (!account) return jsonResponse({ error: "unauthenticated" }, 401);

  const importId = params.importId as string;
  const body = (await request.json()) as CredentialsBody;

  const tooBig = overLimit(body);
  if (tooBig) return jsonResponse({ error: tooBig }, 400);

  // One paste beats hunting two cookies, so a `Cookie:` header wins if present.
  const parsed = body.cookieHeader ? parseEspnSession(body.cookieHeader) : null;
  const espnS2 = parsed?.espnS2 ?? body.espnS2?.trim();
  const swid = parsed?.swid ?? body.swid?.trim();

  if (!espnS2 || !swid) {
    return jsonResponse({ error: "need both espn_s2 and SWID — paste your whole ESPN cookie string" }, 400);
  }

  // Scoped in the query rather than read-then-compare, so the handler never
  // reads a row it does not own.
  const importRow = await env.DB.prepare("SELECT id FROM imports WHERE id = ? AND account_id = ?")
    .bind(importId, account.id)
    .first<{ id: string }>();
  if (!importRow) return jsonResponse({ error: "import not found" }, 404);

  const key = env.CREDENTIALS_ENCRYPTION_KEY;
  const encryptedEspnS2 = await encryptValue(espnS2, key);
  const encryptedSwid = await encryptValue(swid, key);

  await env.DB.prepare(
    `INSERT INTO espn_credentials (import_id, encrypted_espn_s2, encrypted_swid)
       VALUES (?, ?, ?)
       ON CONFLICT(import_id) DO UPDATE SET
         encrypted_espn_s2 = excluded.encrypted_espn_s2,
         encrypted_swid = excluded.encrypted_swid,
         updated_at = datetime('now')`
  )
    .bind(importId, encryptedEspnS2, encryptedSwid)
    .run();

  return jsonResponse({ ok: true });
};
