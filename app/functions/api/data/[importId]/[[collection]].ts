import type { PagesFunction } from "@cloudflare/workers-types";
import { jsonResponse, validateSession } from "../../../lib/auth";
import { resolveCollection } from "../../../../lib/collections";

/** Authenticated, per-account read of one processed collection.
 *
 * Checks in order: a live session, that the import belongs to that session's
 * account, that it finished, and that it has not passed its retention expiry.
 * The bytes come from R2 -- the build strips dist/data -- so this is the only
 * way in and there is no unauthenticated back door.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const account = await validateSession(request, env.DB);
  if (!account) return jsonResponse({ error: "unauthenticated" }, 401);

  const raw = params.collection;
  const collection = resolveCollection(Array.isArray(raw) ? raw : [raw].filter((s): s is string => !!s));
  if (!collection) return jsonResponse({ error: "unknown collection" }, 404);

  const importRow = await env.DB.prepare("SELECT status, expires_at FROM imports WHERE id = ? AND account_id = ?")
    .bind(params.importId, account.id)
    .first<{ status: string; expires_at: string | null }>();

  // 404 rather than 403 for a foreign or unknown import, so the response does
  // not confirm that the id exists.
  if (!importRow || importRow.status !== "completed") {
    return jsonResponse({ error: "import not ready" }, 404);
  }
  if (importRow.expires_at !== null && importRow.expires_at <= new Date().toISOString()) {
    return jsonResponse({ error: "import expired" }, 410);
  }

  const object = await env.RAW_ARCHIVE.get(`processed/${params.importId}/${collection}`);
  if (!object) return jsonResponse({ error: "collection not found" }, 404);

  return new Response(object.body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // private: this varies by the caller's cookie, so it must never sit in a
      // shared CDN cache.
      "Cache-Control": "private, max-age=120",
    },
  });
};
