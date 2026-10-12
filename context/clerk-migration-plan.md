# Clerk migration — senior review & phased plan

**Date:** 2026-10-12
**Branch:** `feature/clerk-auth`
**References:** `context/clerk-auth-feasibility.md` (the notes under review)

## Feasibility

**Confirmed feasible. No technical blocker.** The ESPN-email coupling is a non-issue — the pipeline
keys off the SWID cookie, never the account email (see feasibility §2 for the code citations).
Clerk handles password auth, email verification, reset, and bot protection on the free Hobby tier.
The approval gate and the ESPN cookie-paste import path are preserved by design.

## Review of the notes

### Right
- Enterprise Connections is the wrong feature. Correct.
- The ESPN-email analysis is correct and verified in code.
- D1 `accounts`, the approval gate, demo, and the `probe` rate limiter must stay. Correct.
- Effort (~2–4 days) and the bot-protection false-positive risk are sound.

### Gaps the plan must close
1. **The approval gate is underspecified.** It is the #1 constraint and the notes only say
   "custom, stays." The design below makes it concrete — and it turns out `approve.sh` needs
   **no change**, because it looks up by email, which we still store in D1.
2. **Session ownership is never named.** The notes assume `authenticateRequest()` per endpoint but
   never address what happens to our `sessions` table, our cookie, `logout`, or the client's
   `credentials: "same-origin"` calls. Decision D1 below.
3. **Clerk custom domain / cookie behavior is omitted.** Clerk's session is a `__session` cookie on
   a custom domain, or a `__clerk_db_jwt` header without one. This determines whether our existing
   `credentials: "same-origin"` fetches just work. Custom domain is a Hobby feature but is a DNS
   task, not code.
4. **The demo path has no design.** The notes call it "worse" but propose nothing. Decision D4.
5. **"Delete ~450 lines" is optimistic.** Doesn't count `ClerkProvider`, the D1 upsert that
   provisions accounts, the approval-pending UI, or the middleware helper. The 2–4 day estimate
   stands; the line-count framing is misleading.
6. **The `probe` rate limiter becomes load-bearing.** With Clerk owning auth, `probe` is the only
   endpoint still on `rateLimitHorizon`. Worth a line so it isn't accidentally deleted.

## Architectural decisions

**D1 — Clerk owns sessions for real users.** Standard pattern. Our `sessions` table becomes
vestigial (kept only for demo). `authenticateRequest()` replaces `validateSession()` at each
endpoint — same one-call shape, so the diff is small.

**D2 — D1 `accounts` keeps `approved` / `tier` / `demo` / `email` / `display_name`; add
`clerk_user_id TEXT UNIQUE`.** This is the authorization + app-state store. `clerk_user_id` is the
join key.

**D3 — Approval gate lives in D1, checked in middleware after Clerk auth.** Flow:
1. User signs up via Clerk `<SignUp/>` → Clerk creates user, sends verification email.
2. User verifies, signs in via `<SignIn/>` → Clerk sets session.
3. Middleware: `authenticateRequest()` → `userId` → upsert D1 account (`approved=0` on first
   sight) → check `approved`.
4. `approved=0` → 403 `{ error: "awaiting approval" }`.
5. Admin runs `./approve.sh <email>` → D1 `approved=1`. **No change to `approve.sh`** — it looks
   up by email, which we still store.
6. User reloads → access granted.

> **Pre- vs post-signup approval.** D3 preserves the current **post-signup** model (account
> created, access gated). If you want **pre-signup** (user cannot even create an account), Clerk's
> "Require invitations" allowlist does that on Hobby — but it changes the UX and the admin
> workflow. Flag if you want that instead.

**D4 — Demo stays on our own session cookie, outside Clerk.** The demo button is a marketing
feature, not a user auth path. Keeping `/api/auth/demo` as-is means: (a) no Clerk user to seed for
the demo account, (b) no sign-in-token redirect dance, (c) the button stays instant. Cost: the
middleware accepts two schemes — Clerk for real users, our cookie for demo — but our cookie is
only ever set by `demo.ts`, so the fallback only ever matches the demo account.
`ponytail: two auth schemes, demo-only fallback; upgrade when demo ever needs Clerk features.`

**D5 — Clerk keys are secrets, not vars.** `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` go in
`wrangler secret put`, not `wrangler.jsonc` (which already keeps `ADMIN_API_KEY`,
`TURNSTILE_SECRET_KEY`, `CREDENTIALS_ENCRYPTION_KEY` out of the file for the same reason). Add
`CLERK_JWT_KEY` (the PEM public key) so session verification is local and zero-roundtrip.

**D6 — Custom domain for Clerk.** Required so Clerk's `__session` cookie is set on our domain and
our `credentials: "same-origin"` fetches work unchanged. Without it, the frontend must attach a
`__clerk_db_jwt` Authorization header — a change to every fetch call. Pricing lists custom domain as
Hobby. This is a DNS/ops task, not a code task.

## Phased execution plan

Each commit ≤5 files. Branch: `feature/clerk-auth`.

### Phase 0 — Plan (1 file)
- `context/clerk-migration-plan.md`

### Phase 1 — Foundation (3 files)
- `app/package.json` — add `@clerk/clerk-react`
- `app/migrations/0013_clerk_user_id.sql` — `ALTER TABLE accounts ADD COLUMN clerk_user_id TEXT UNIQUE;`
- `functions/lib/clerk.ts` — `createClerkClient`, `authenticate(request)` → `{ userId } | null`,
  `requireAccount(db, userId)` → upsert + return D1 account

### Phase 2 — Protect the API (5 files)
- `functions/api/auth/me.ts` — rewrite on Clerk
- `functions/api/imports/index.ts` — swap `validateSession` → `requireAccount`
- `functions/api/imports/[importId]/index.ts` — swap
- `functions/api/imports/[importId]/probe.ts` — swap, keep rate limit
- `functions/api/imports/[importId]/credentials.ts` — swap

### Phase 3 — Data proxy (1 file)
- `functions/api/data/[importId]/[[collection]].ts` — swap

### Phase 4 — Frontend provider + context (4 files)
- `src/main.tsx` — `<ClerkProvider>` with publishableKey
- `src/lib/auth/AuthContext.tsx` — rewrite on `useUser()` / `useAuth()`, keep tenant state
- `src/components/AuthGuard.tsx` — Clerk loading state
- `src/routes/Login.tsx` — `<SignIn/>` + approval-pending screen

### Phase 5 — Delete legacy auth (2 commits)
- **5a (4 files):** delete `src/routes/VerifyEmail.tsx`, `src/routes/ResetPassword.tsx`,
  `functions/api/auth/verify.ts`, `functions/api/auth/reset-request.ts`
- **5b (4 files):** delete `functions/api/auth/reset.ts`, `functions/api/auth/login.ts`,
  `functions/api/auth/signup.ts`, `functions/api/auth/logout.ts`

### Phase 6 — Cleanup (3 files)
- `functions/lib/auth.ts` — drop password/session code, keep `validateSession` + cookie helpers
  for demo
- `src/App.tsx` — remove verify/reset routes
- `approve.sh` — verify unchanged (should work as-is)

### Phase 7 — Record demo decision (1 file)
- `context/clerk-migration-plan.md` — demo-path decision + follow-ups

**Total: 8 phases, 9 commits, ~26 files touched.**

## Risks carried from the notes
- Clerk bot protection false-positives on a fantasy-sports audience with throwaway addresses.
- Clerk's `user_id` becomes a permanent join key; reversing is a full re-identification pass.
- `rateLimitHorizon` now serves only `probe` — do not delete it.

## Open questions
1. **Pre- vs post-signup approval** — D3 preserves current (post-signup). Want pre-signup
   (Clerk allowlist) instead?
2. **Demo path** — D4 keeps demo on our cookie. Acceptable, or do you want demo fully on Clerk?
3. **Custom domain** — D6 needs a DNS CNAME to Clerk. Do you control the domain, and is that a
   step you can do?