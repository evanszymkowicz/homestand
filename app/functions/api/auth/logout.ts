import type { PagesFunction } from "@cloudflare/workers-types";
import { clearSessionCookie, deleteSession, getSessionToken, jsonResponse } from "../../lib/auth";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const token = getSessionToken(request);
  if (token) {
    await deleteSession(token, env.DB);
  }
  return jsonResponse({ ok: true }, 200, {
    headers: { "Set-Cookie": clearSessionCookie() },
  });
};
