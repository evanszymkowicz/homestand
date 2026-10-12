# Auth migration — senior review & phased plan

**Date:** 2026-10-12
**Branch:** `feature/clerk-auth`
**References:** `context/clerk-auth-feasibility.md` (the notes under review)

## Feasibility

**Clerk is feasible only with a custom domain.** Without DNS control, the email-code alternative
is the recommendation. Both paths preserve the two hard constraints: pre-signup approval and the
ESPN cookie-paste import flow.

## Review of the notes

### Right
- Enterprise Connections is the wrong feature. Correct.
- The ESPN-email analysis is correct and verified in code.
- D1 `accounts`, the approval gate, demo, and the `probe` rate limiter must stay. Correct.
- Effort (~2–4 days) and the bot-protection false-positive risk are sound.

### Gaps the plan must close
1. **The approval gate is underspecified.** The design below makes it concrete.
2. **Session ownership is never named.** Decision D1 below.
3. **Clerk custom domain / cookie behavior is omitted.** This is the deciding constraint — D6.
4. **The demo path has no design.** Decision D4.
5. **"Delete ~450 lines" is optimistic.** The 2–4 day estimate stands; the line-count framing is
   misleading.
6. **The `probe` rate limiter becomes load-bearing.** Worth a line so it isn't accidentally deleted.

## Architectural decisions

**D1 — Clerk owns sessions for real users (Path A only).** Standard pattern. `authenticateRequest()`
replaces `validateSession()` at each endpoint — same one-call shape, small diff.

**D2 — D1 `accounts` keeps `tier` / `demo` / `email` / `display_name`; add `clerk_user_id TEXT UNIQUE`**
(Path A) **or keep `approved` unchanged** (Path B). The authorization + app-state store.

**D3 — Pre-signup approval.**
- **Path A:** Clerk "Require invitations" allowlist (free on Hobby). `approve.sh` calls
  `clerkClient.allowlistIdentifiers.create({ identifier: email })`. The D1 `approved` column is dead.
- **Path B:** keep the current `approved` flag + `approve.sh` exactly as-is. The gate lives in our
  D1, not in the auth provider.

**D4 — Demo.**
- **Path A:** in Clerk. `sessions.createSession` is testing-only per Clerk's docs; production uses
  Sign-in Tokens (redirect flow), making the one-click button heavier. The demo Clerk user is seeded
  in the dashboard.
- **Path B:** keep `/api/auth/demo` as-is. One-click, no change.

**D5 — Clerk keys are secrets, not vars** (Path A only). `CLERK_PUBLISHABLE_KEY`,
`CLERK_SECRET_KEY`, `CLERK_JWT_KEY` go in `wrangler secret put`.

**D6 — Custom domain for Clerk is a hard production requirement.** This is the deciding constraint.
From Clerk's own architecture docs:

> "Because, in production, FAPI is hosted on a subdomain of your application (e.g.,
> `clerk.example.com`) via a CNAME record, your app's frontend and FAPI are on the same site."

> "it is not secure enough for production use… the `__clerk_db_jwt` object is not used in production
> instances and the same-site cookie (`__client`) is used instead."

**Consequence: no DNS control means no production Clerk.** `homestand.pages.dev` is a Cloudflare
subdomain — we cannot CNAME a Clerk FAPI onto it.

## The decision this forces

**Path A — get a domain.** Register one, set a CNAME to Clerk, proceed with the phases below.
This is the only path that makes Clerk work in production.

**Path B — stay on `pages.dev`, skip Clerk.** Delete `hashPassword`, `verifyPassword`,
`decoyPasswordHash`, the reset endpoints, and the `sessions` table's password machinery (~200 lines).
Keep our own `__session` cookie and the D1 horizon limiter. Send a one-time code or link from the
existing Gmail SMTP path. No vendor, no DNS, no third party holding credentials. Pre-signup
approval stays exactly as it is today. Demo stays one-click. ESPN cookie-paste is untouched either
way.

`ponytail: Path B deletes more code and adds no dependency; Path A buys a vendor relationship to
solve a problem we do not have yet (zero real signups).`

**Not viable:** Clerk on `pages.dev` in production.

## Phased execution plan

Each commit ≤5 files. Branch: `feature/clerk-auth`.

### Path A — Clerk + custom domain

#### Phase A0 — Plan (1 file)
- `context/clerk-migration-plan.md`

#### Phase A1 — Foundation (3 files)
- `app/package.json` — add `@clerk/clerk-react`
- `app/migrations/0013_clerk_user_id.sql` — add `clerk_user_id TEXT UNIQUE`, drop `approved`
- `functions/lib/clerk.ts` — `createClerkClient`, `authenticate(request)` → `{ userId } | null`,
  `requireAccount(db, userId)` → upsert + return D1 account

#### Phase A2 — Protect the API (5 files)
- `functions/api/auth/me.ts` — rewrite on Clerk
- `functions/api/imports/index.ts` — swap `validateSession` → `requireAccount`
- `functions/api/imports/[importId]/index.ts` — swap
- `functions/api/imports/[importId]/probe.ts` — swap, keep rate limit
- `functions/api/imports/[importId]/credentials.ts` — swap

#### Phase A3 — Data proxy (1 file)
- `functions/api/data/[importId]/[[collection]].ts` — swap

#### Phase A4 — Frontend provider + context (4 files)
- `src/main.tsx` — `<ClerkProvider>` with publishableKey
- `src/lib/auth/AuthContext.tsx` — rewrite on `useUser()` / `useAuth()`, keep tenant state
- `src/components/AuthGuard.tsx` — Clerk loading state
- `src/routes/Login.tsx` — `<SignIn/>` + allowlist-pending handling

#### Phase A5 — Delete legacy auth (2 commits)
- **5a (4 files):** delete `src/routes/VerifyEmail.tsx`, `src/routes/ResetPassword.tsx`,
  `functions/api/auth/verify.ts`, `functions/api/auth/reset-request.ts`
- **5b (4 files):** delete `functions/api/auth/reset.ts`, `functions/api/auth/login.ts`,
  `functions/api/auth/signup.ts`, `functions/api/auth/logout.ts`

#### Phase A6 — Cleanup (3 files)
- `functions/lib/auth.ts` — strip password/session/Turnstile, keep shared helpers
  (`requireSameOrigin`, `requireAdmin`, `jsonResponse`)
- `src/App.tsx` — remove verify/reset routes
- `approve.sh` — rework to call Clerk allowlist BAPI

#### Phase A7 — Demo in Clerk (1 file)
- `functions/api/auth/demo.ts` — Sign-in Token flow for the seeded demo Clerk user

#### Phase A8 — Record decisions (1 file)
- `context/clerk-migration-plan.md`

**Path A total: 9 phases, 10 commits, ~26 files touched.**

### Path B — Email-code auth, no Clerk

#### Phase B0 — Plan (1 file)
- `context/clerk-migration-plan.md`

#### Phase B1 — Email-code endpoints (3 files)
- `functions/api/auth/login.ts` — rewrite: accept email, send one-time code via existing Gmail SMTP
- `functions/api/auth/verify.ts` — rewrite: redeem code, mint `__session` cookie
- `functions/api/auth/logout.ts` — keep (already clears our cookie)

#### Phase B2 — Frontend (3 files)
- `src/routes/Login.tsx` — email input + code entry, no password
- `src/lib/auth/AuthContext.tsx` — adjust `loginDemo` / `logout` for the new flow
- delete `src/routes/VerifyEmail.tsx`, `src/routes/ResetPassword.tsx`

#### Phase B3 — Delete legacy password machinery (3 files)
- `functions/lib/auth.ts` — remove `hashPassword`, `verifyPassword`, `decoyPasswordHash`,
  `verifyTurnstile`; keep `createSession`, `validateSession`, `setSessionCookie`, `jsonResponse`,
  `requireSameOrigin`, `requireAdmin`
- `functions/api/auth/signup.ts` — delete
- `functions/api/auth/reset-request.ts` — delete
- `functions/api/auth/reset.ts` — delete

#### Phase B4 — Record decisions (1 file)
- `context/clerk-migration-plan.md`

**Path B total: 5 phases, 5 commits, ~12 files touched.**

## Risks

### Path A
- Clerk bot protection false-positives on a fantasy-sports audience with throwaway addresses.
- Clerk's `user_id` becomes a permanent join key; reversing is a full re-identification pass.
- `rateLimitHorizon` now serves only `probe` — do not delete it.
- Custom domain DNS is a hard prerequisite; without it, nothing ships.

### Path B
- Email-code delivery depends on Gmail SMTP (already the case for verification/reset mail).
- Codes must be short-lived and single-use; reuse the `email_tokens` table pattern.
- No bot protection beyond Turnstile (keep it on the email-code request endpoint).

## Open questions
1. **Domain** — can you register one and set a CNAME to Clerk? This gates Path A vs Path B.
2. If Path A: confirm the domain choice before Phase A1.
3. If Path B: confirm the email-code expiry window (suggest 15 minutes, single-use).
