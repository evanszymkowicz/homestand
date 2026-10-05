import type { PagesFunction } from "@cloudflare/workers-types";
import { jsonResponse, validateSession } from "../../lib/auth";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const account = await validateSession(request, env.DB);
  if (!account) {
    return jsonResponse({ error: "unauthenticated" }, 401);
  }
  return jsonResponse({ account });
};
