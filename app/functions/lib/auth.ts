import type { D1Database } from "@cloudflare/workers-types";

export const SESSION_COOKIE = "homestand_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export interface Account {
  id: string;
  email: string;
  display_name: string | null;
  verified: number;
  tier: "free" | "subscriber" | "admin";
  demo: number;
}

function bytesToBase64url(bytes: Uint8Array): string {
  const bin = Array.from(bytes, b => String.fromCharCode(b)).join("");
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const bin = atob(padded);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Constant-time bearer-token check for the admin endpoints. Length is compared
 * first, which leaks only the key's length -- not its contents. */
export function secretEquals(candidate: string | null, expected: string | undefined): boolean {
  if (!expected || !candidate) return false;
  const a = new TextEncoder().encode(candidate);
  const b = new TextEncoder().encode(expected);
  // Pad to the longer so a length mismatch still burns the comparison loop.
  const len = Math.max(a.length, b.length);
  const pa = new Uint8Array(len);
  const pb = new Uint8Array(len);
  pa.set(a);
  pb.set(b);
  return timingSafeEqual(pa, pb);
}

/** Extracts and checks an `Authorization: Bearer ...` header. Fails closed when
 * the expected key is unset, so a missing secret disables the endpoint rather
 * than opening it. */
export function requireAdmin(request: Request, adminKey: string | undefined): boolean {
  const header = request.headers.get("Authorization") ?? "";
  return secretEquals(header.replace(/^Bearer\s+/i, ""), adminKey);
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToBase64url(new Uint8Array(digest));
}

export async function generateSessionToken(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64url(bytes);
}

export async function createSession(accountId: string, db: D1Database): Promise<string> {
  const token = await generateSessionToken();
  const tokenHash = await sha256(token);
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  await db
    .prepare("INSERT INTO sessions (id, account_id, token_hash, expires_at) VALUES (?, ?, ?, ?)")
    .bind(sessionId, accountId, tokenHash, expiresAt)
    .run();

  return token;
}

export function getSessionToken(request: Request): string | null {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function validateSession(request: Request, db: D1Database): Promise<Account | null> {
  const token = getSessionToken(request);
  if (!token) return null;
  const tokenHash = await sha256(token);

  const row = await db
    .prepare(
      `SELECT a.id, a.email, a.display_name, a.verified, a.tier, a.demo
       FROM sessions s
       JOIN accounts a ON a.id = s.account_id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now')`
    )
    .bind(tokenHash)
    .first<Account>();

  return row ?? null;
}

export async function deleteSession(token: string, db: D1Database): Promise<void> {
  const tokenHash = await sha256(token);
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
}

export function setSessionCookie(token: string): string {
  const expires = new Date(Date.now() + SESSION_TTL_MS).toUTCString();
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expires}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function jsonResponse(body: unknown, status = 200, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_KEYLEN_BYTES = 32;

// ponytail: PBKDF2-SHA256 instead of argon2 because Web Crypto is native in Workers.
// Upgrade to argon2 if a lightweight wasm binding becomes worthwhile.
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    PBKDF2_KEYLEN_BYTES * 8
  );
  const combined = new Uint8Array([...salt, ...new Uint8Array(derived)]);
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${bytesToBase64url(combined)}`;
}

// A real PBKDF2 hash over a value nobody knows, built once per isolate.
//
// Without it, a login attempt for an address with no account skips the KDF
// entirely and returns in ~12ms where a real account takes ~27ms -- a trivially
// measurable account-enumeration oracle. Callers verify against this so both
// paths pay the same cost. It is a genuine hash, so verifyPassword does the same
// amount of work against it as against any other; it just never matches.
let decoyHashPromise: Promise<string> | undefined;

export function decoyPasswordHash(): Promise<string> {
  decoyHashPromise ??= hashPassword(crypto.randomUUID());
  return decoyHashPromise;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "pbkdf2_sha256") return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations)) return false;
  const combined = base64urlToBytes(parts[2]);
  if (combined.length !== PBKDF2_SALT_BYTES + PBKDF2_KEYLEN_BYTES) return false;
  const salt = combined.slice(0, PBKDF2_SALT_BYTES);
  const expected = combined.slice(PBKDF2_SALT_BYTES);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    expected.length * 8
  );
  return timingSafeEqual(new Uint8Array(derived), expected);
}

export async function verifyTurnstile(token: string, secret: string): Promise<boolean> {
  if (!token || !secret) return false;
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token }),
  });
  const data = (await res.json()) as { success?: boolean };
  return data.success === true;
}
