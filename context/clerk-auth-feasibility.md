# Feasibility: Clerk Enterprise Connections (and Clerk auth generally)

**Date:** 2026-10-12
**Scope:** Replace the hand-rolled auth in `app/functions/lib/auth.ts` + `app/functions/api/auth/*`
with [Clerk Enterprise Connections](https://clerk.com/docs/guides/configure/auth-strategies/enterprise-connections/overview),
evaluated against Homestand's actual requirements.

## Verdict

**The linked feature is not a fit. Clerk as the general identity layer — which is the actual
question, and what Kodo Analytics does — is a clean technical fit, but should not be adopted now.**

- **Enterprise SSO / Enterprise Connections: no.** It requires the user to have a corporate
  identity provider (Azure AD, Google Workspace, Okta Workforce, custom SAML/OIDC). Homestand's
  users are individual fantasy baseball league members signing up with a personal gmail address.
  Zero of them have an IdP tenant to connect. There is nothing for this feature to do.
- **Clerk as consumer identity: yes, this works, and it is cheap.** See §2 — the "sign up with the
  email your ESPN account uses" requirement imposes no constraint on the auth provider, because
  **our pipeline never matches the account email against ESPN.** Clerk handles email + password +
  verification on the free Hobby tier, with no cap that matters at our scale. Kodo Analytics proves
  the pattern in production for a comparable product.
- **Still not now.** It deletes ~450 lines of working code and adds a third-party identity
  dependency, a D1 migration, and hand-written Pages Functions glue — in exchange for reimplementing
  worse the three things we actually built (admin approval gate, one-click demo login, local tier
  state). The product's actual blocker is R1, not auth.

## 1. What the linked docs cover

Enterprise Connections is Clerk's B2B SSO story. Three protocol paths, all requiring an
external corporate IdP:

| Path | Requirement | Fit for Homestand |
| --- | --- | --- |
| SAML | Azure AD / Google Workspace / Okta Workforce / custom SAML connection | None of our users have one |
| EASIE (OIDC) | Google Workspace or Microsoft Entra, multi-tenant IdP | None of our users have one |
| OIDC custom | Any OIDC-compatible provider, configured per connection | Would need *every* user to have an IdP |

Constraints that make it a hard no even setting user fit aside:

- **Domain-gated.** SAML authenticates only when the user's email domain matches the connection's
  configured domain (subdomains off by default). Homestand's users are spread across every consumer
  email provider there is; there is no single domain to allow.
- **Billed separately.** SSO connections require Pro ($25/mo) or Business ($300/mo); 1 connection
  included, then $75/mo each. We would need zero connections.
- **"Enterprise SSO for workspace"** (the Business-plan feature) links an enterprise connection to a
  Clerk *Organization*. Homestand has no Organization concept — one account maps to N imports, and
  there is no group membership to manage.

Nothing in that page maps to a product whose entire user base is hobbyist league commissioners.

## 2. Can Clerk serve accounts keyed to a personal ESPN email?

**Yes. This is the strongest argument for Clerk, and it is a non-issue technically.**

The premise is that users must sign up with the email address their ESPN account uses, because
that is the identity ESPN knows them by. That is a true statement about **ESPN**, but it is not a
technical constraint on Homestand's auth layer, because **Homestand never authenticates to ESPN
with an email.** Verified in the code:

- `app/functions/api/imports/[importId]/credentials.ts:42-60` — the user pastes their ESPN cookie
  string; the handler extracts `espn_s2` and `SWID` and encrypts the `SWID` into
  `espn_credentials.encrypted_swid`. There is no email field anywhere in the request body.
- `scripts/run_import.mjs:84-111` — resolves `imports.account_id`, then reads
  `encrypted_espn_s2` / `encrypted_swid` from `espn_credentials` by `import_id`. It never joins to
  `accounts`, and never reads `accounts.email`.
- `scripts/derive_owner_map.py` — **zero occurrences of the string `email`.** Owner identities are
  derived from the ESPN archive's member records, keyed by SWID.
- `grep -rn "email" app/functions/api/imports/**` — no matches.

So the identity chain is: **Clerk user → D1 `accounts.id` → `imports.account_id` →
`espn_credentials.encrypted_swid` → ESPN.** The account email appears nowhere in it. The email is
used for exactly three things: login identity, the `./approve.sh <email>` admin lookup, and
notification mail (R1 import-status, still unbuilt).

**Implication:** nothing breaks if a user's Homestand email differs from their ESPN email. The
"sign up with your ESPN email" instruction is copy on the signup page, not an enforced invariant.
Clerk treats an email as an opaque string with a verification state, which is exactly what we need.

**Kodo Analytics** (`kodoanalytics.com/sign-in`) is the right precedent: same problem, same
audience, same ESPN data source. Its pages load `clerk-js` and `@clerk/nextjs`. Two caveats on
transferring that precedent:

- **They are on Next.js.** `@clerk/nextjs` is a first-class integration with server-side `auth()`
  and middleware. We are a Vite SPA on Cloudflare Pages Functions, so we would use
  `@clerk/clerk-react` + `@clerk/backend` and hand-write the server glue at all 8 protected
  endpoints. Supported, but a materially different amount of work than Kodo's.
- **Different business shape.** Kodo is ad-supported and free with a ko-fi link, covering five
  league platforms. It has no approval gate and no paid tier. Its Clerk setup is the easy case.

**What Clerk would give us for this specific need:** password signup, email verification, reset,
and bot protection all on the free Hobby tier, with 50,000 monthly retained users included — orders
of magnitude above a product that currently cannot complete a single signup (R1). No paid plan is
required for anything in §2.

## 3. Our actual auth requirements

Inventory from the code, not the spec. "Custom" means Clerk has no equivalent and we keep or
rebuild the logic ourselves.

| # | Requirement | Where it lives today | Clerk equivalent | Verdict |
| --- | --- | --- | --- | --- |
| 1 | Email + password signup, login | `api/auth/signup.ts`, `login.ts` | Native (`@clerk/clerk-react`) | Replaced |
| 2 | Password reset request + redemption | `api/auth/reset-request.ts`, `reset.ts` | Native | Replaced |
| 3 | Email verification before first login | `email_tokens` table, `VerifyEmail.tsx`, `functions/lib/email.ts` (Gmail SMTP) | Native (Clerk sends the mail) | Replaced; our SMTP becomes R1-import-status-only |
| 4 | Turnstile bot gate on signup | `verifyTurnstile()` in `lib/auth.ts` | Clerk bot protection (all plans) | Replaced |
| 5 | Rate limiting on `login` / `reset-request` / `signup` | `lib/rateLimitHorizon.ts` + `0009_rate_limit_counters.sql` | Clerk lockout + bot protection | Replaced for auth; **`probe` stays** |
| 6 | **Rate limiting on `probe`** (ESPN session oracle) | same | none | **Custom, stays either way** |
| 7 | **Admin approval gate** — account exists but cannot log in until `./approve.sh <email>` | `accounts.approved` (mig `0010`), `api/admin/approve.ts` | Closest is *Require invitations* (Hobby), which is a pre-signup allowlist, not post-signup approval | **Custom, stays** |
| 8 | **One-click demo login** — `POST /api/auth/demo`, account resolved by `demo = 1` flag | `api/auth/demo.ts` | *Sign-in tokens* / *testing tokens* — one-shot session creation via Backend API | **Custom, worse.** A demo sign-in that burns an API round-trip or a signed token is not a one-click button |
| 9 | **Local account state** — `tier` (free/subscriber/admin), `approved`, `demo`, `display_name` | `accounts` table | `publicMetadata` on the Clerk user | **Custom.** Clerk has no notion of "pending approval" or "free tier, no import yet" |
| 10 | D1 session table + `validateSession()` at 8 call sites | `sessions` table, `lib/auth.ts:103` | `clerkClient.authenticateRequest(request)` | Replaced |
| 11 | Tenant scoping — every `imports` row belongs to an `account_id`; the data proxy resolves account from session | `api/data/...`, `api/imports/...` | Session token gives a Clerk `user_id`; we keep the D1 `accounts` row keyed to it | **Partially custom** |
| 12 | Admin API key for `/api/admin/*` (bearer, machine-to-machine) | `requireAdmin()`, `ADMIN_API_KEY` | Clerk M2M tokens (all plans) | Optional; current code is fine |
| 13 | Vite + React **SPA** (not Next.js) | `AuthContext.tsx` | `@clerk/clerk-react` | Supported |
| 14 | Cloudflare **Pages Functions** | `functions/**` | `@clerk/backend` is documented for V8 isolates; `authenticateRequest(request)` takes a web `Request` | Supported, but **no first-class Pages integration** — we write the glue |

Requirements 7, 8, and 9 are the crux: together they are the reason this is not a pure swap. They are
Homestand product state, not authentication, and Clerk has no opinion about any of them. We would
keep the D1 `accounts` table (a Clerk `user_id` column plus `tier`/`approved`/`demo`), keep
`approve.sh` (rewritten to call the Clerk Backend API instead of a Pages Function), and keep the
D1 rate limiter for `probe`. That is most of the seam we are trying to delete.

## 4. Effort and cost, Option B (Clerk as auth provider)

Surfaces to remove or rewrite, with current sizes:

**Delete (400 lines):** `Login.tsx` (230) · `VerifyEmail.tsx` (60) · `ResetPassword.tsx` (83) ·
`api/auth/{signup,login,reset-request,reset,verify}.ts` (247) · password hashing and the decoy-hash
enumeration defence in `lib/auth.ts` (lines 143–191, 49)

**Keep:** `lib/crypto.ts`, `lib/rateLimitHorizon.ts` (for `probe`), `api/auth/me.ts` (resolves Clerk
`user_id` → D1 account row) · `api/auth/logout.ts` (Clerk has no session delete we need to call) ·
`api/auth/demo.ts` · `api/admin/approve.ts` · the `accounts`, `imports`, `credentials`,
`rate_limit_counters` tables · `cron/` and `scripts/run_import.mjs`, which read `imports.account_id`
from D1 and never touch auth at all

**Add:** `@clerk/clerk-react` + `@clerk/backend` · a migration adding `clerk_user_id` to
`accounts` and backfilling it for the demo row · `ClerkProvider` wrapping `main.tsx` · a rewritten
`AuthContext` that reads Clerk's client-side user instead of `fetch("/api/auth/me")` · a rewritten
`Login.tsx` (~20 lines with `<SignIn/>`) · a rewritten `approve.sh` hitting the Clerk Backend API ·
a webhook or a first-login sync to materialize D1 account rows · `clerk.com` added to the CSP

**Also:** delete `email_tokens` table + the verification route; decide whether `functions/lib/email.ts`
(Gmail SMTP) survives for R1 import-status mail — it should, R1 is still open.

Rough estimate: **2–4 days** for one engineer with no prior Clerk experience, most of it in Clerk's
SPA + Pages Functions integration and in not breaking tenant scoping. There is no integration test
coverage of the auth flows today (`src/**/*.test.ts` covers data logic and the rate limiter only), so
this is verified by hand.

**Cost:** Hobby is free to 50,000 monthly retained users and covers passwords, verification, reset,
bot protection, and *Require invitations*. Pro ($25/mo, $20 annual) is needed for MFA, custom email
templates, custom session lifetime, and 1 SSO connection. At our scale, free to $25/mo. Clerk bills
on retained users, not signups, so an unreached signup is free.

## 5. Risks

- **Data-handling change.** The repo's stated posture is that credential material is handled
  defensively (ESPN cookies encrypted, `check-changed-file.mjs` credential scan, no raw archive
  committed). Clerk means user email and password live at a third party. Defensible — Clerk is
  SOC2 Type II, but SOC2 access is a **Business ($300/mo)** plan feature; Hobby and Pro ship
  security documentation without the report.
- **Lock-in.** Clerk `user_id` becomes the join key for accounts, imports, and every future table.
  Reversing is a full account re-identification pass, and Clerk's migration assistance is an
  Enterprise-plan item.
- **No first-class Cloudflare Pages integration.** `@clerk/backend` works on V8 isolates, but every
  one of the 8 protected endpoints gets hand-written `authenticateRequest()` glue. That glue is
  code we own anyway — it is not obviously less than the `validateSession()` call it replaces.
- **Third-party latency on every request.** Mitigable: supply the PEM `jwtKey` so session
  verification is local and zero-roundtrip. Worth knowing before it becomes a production surprise.
- **We lose the parts we built deliberately.** The D1 horizon limiter exists because the native
  Cloudflare `ratelimits` binding cannot be declared in a Pages config (`future-items.md`). Clerk's
  lockout covers auth, but it does not cover `probe`, so `rateLimitHorizon.ts` stays regardless.
- **Clerk's bot protection can false-positive on this audience.** Our current Turnstile gate only
  runs at signup and is tuned for a hobbyist crowd. Clerk applies lockout and bot detection
  continuously, and its domain screening can challenge or refuse signups from disposable and
  privacy-oriented email providers — a real risk with a fantasy-sports user base that includes
  plenty of throwaway-address users. Today's setup lets us tune limits in
  `lib/rateLimitHorizon.ts`; Clerk's are not ours to tune below the plan's settings.
- **Onboarding email changes if Clerk sends verification.** Copy currently says "verify, then wait for
  admin approval." Clerk sends its own verification mail, so the two-step message splits across two
  senders unless custom email templates are bought (Pro).

## 6. Recommendation

**Do not adopt Clerk now.** The auth system is ~450 lines, works, has no known defect, and has zero
production users. The item that blocks public reachability is R1 (no GitHub Actions secrets, so no
production crawl ever runs — a real signup gets an empty dashboard). Fixing R1 unblocks the
product; swapping auth does not.

Revisit Clerk when one of these becomes true:

- Real user signups arrive and we want to stop maintaining password reset + verification + bot
  protection by hand.
- Someone asks for Google sign-in (Clerk: one social connection, Hobby tier, ~10 lines of UI). Given
  that §2 settles the ESPN-email coupling, this is the most likely near-term trigger.
- A paying customer needs SAML/OIDC SSO. This is the only scenario in which the linked feature
  becomes relevant, and it would mean a B2B pivot we have not planned.

Note what §2 changes and what it does not. It removes the last technical objection to Clerk — there
is no requirement Clerk cannot meet, and Kodo proves the pattern works for this exact product
shape. What it does not change is the sequencing: with zero real signups, there is nothing to
simplify, and swapping now means rewriting the approval gate before it has ever rejected anyone.

**If the goal is less auth code, the cheaper move** is to drop the password entirely and send a
one-time login link or six-digit email code from the existing Gmail SMTP path. That deletes
`hashPassword`, `verifyPassword`, `decoyPasswordHash`, the reset endpoints, and the `sessions`
table's password-adjacent machinery — roughly 200 lines — with no vendor, no D1 migration, and no
third-party holding user credentials. It keeps the approval gate, the demo account, and `probe`
untouched. That is the same deletion Clerk offers at a fraction of the dependency cost.

Spec-lock note: the canonical spec (`context/features/homestand-league-import-spec.md` § Auth) still
describes an invite-token signup; the invite gate was removed in migration `0011_drop_invites.sql`
and replaced by the post-signup approval gate. Any auth rewrite should also reconcile that spec.
## 7. Technical debt: Clerk on Vite + React vs. the hand-rolled setup

Measured against what the app actually is: **38,477 LOC of client TS/TSX**, ~28 routes, a single
SPA; **1,112 LOC of Pages Functions** under `functions/`; 8 `useAuth()` call sites; only **2 places
read a field off the account** (`AppShell/index.tsx:41` for the display name, and the auth context
itself). All data is client-fetched from `/api/data/[importId]/[collection]` off R2, and all
computation happens client-side.

**Debt added: roughly neutral on lines, positive on coupling.** This is the part that matters most:

| | Today | With Clerk |
| --- | --- | --- |
| Per-endpoint auth | `validateSession(request, env.DB)` | `authenticateRequest(request)` — **same shape, one-line swap** |
| User → app state | join returns the `accounts` row | Clerk gives a `user_id`; we must join to D1 ourselves for `tier` / `approved` / `demo` |
| Client auth state | one `AuthContext` | `ClerkProvider` + our `AuthContext` must coexist — this is the real risk |
| Bundle | — | `clerk-js` is a large runtime download (Kodo ships `clerk.browser.js`); most of our users reach the app in one click and never touch a Clerk UI |
| Demo login | D1 insert + cookie, one round trip | needs a Clerk sign-in/testing token, or a seeded user whose password users would have to type |

**The honest read:** the per-endpoint glue is *not* worse than what we have — we already write one
call per handler, and Clerk's is the same shape. The genuine new debt is (a) Clerk's `user_id`
becoming the join key forever, (b) two auth contexts on the client, and (c) the demo-login
regression. **None of that is caused by Vite.** Clerk supports Vite SPAs; the debt is inherent to
adopting Clerk, and a Next.js migration would not remove it.

## 8. Would a separate Next.js migration make sense?

**No — not as a way to enable Clerk. Clerk works fine on Vite.** Next's advantage here is one
function, `clerkMiddleware()`, that wraps all 8 endpoints at once. On Pages Functions we would hand-
write the equivalent — roughly 30 lines, in a `functions/_middleware.ts`. Paying a rewrite of 38,477
LOC to avoid writing 30 lines is not a trade.

What a Next.js migration would actually cost us:

- **The 38,477-LOC client rewrite.** React Router's data model (loaders, the `setImportContext` /
  cache-invalidation contract in `lib/data.ts`, tenant switching) becomes the App Router's server
  model — or we mark everything `"use client"` and gain nothing but a heavier framework.
- **The 1,112-LOC Functions rewrite** into Route Handlers or Server Actions. And Server Actions
  would break `/api/data/[importId]/[[collection]]`, which the client data layer depends on.
- **Cloudflare support is a re-implementation, not the real thing.** Per Cloudflare's own guidance,
  Next.js on Workers means **vinext**, which "reimplements the Next.js API surface on Vite" — with
  an explicit instruction not to assume full parity. That is a compatibility surface to track
  forever, on a product whose whole appeal is 17 years of league history being *correct*.
- **The only genuine win** is the separate `cron/` Workers project, which exists solely because Pages
  cannot host cron triggers. A Workers-hosted Next app could absorb it. That is a small structural
  win, not a reason to migrate.

**What would justify Next.js on its own merits: public marketing pages that need indexing.**
`Landing.tsx` renders inside the SPA, so it ships one static `<title>` from `index.html` and has no
per-route metadata. If we ever want a real marketing site — a dozen indexable pages, per-route OG
tags — that argues for server rendering. But it argues for it on the *marketing* side specifically,
and Astro or a small static site would serve those pages without touching the dashboard at all.

**If both are on the table, sequence them separately.** Clerk on Vite is a contained change
(~2–4 days, §4). A Next migration is a rewrite whose only payoff is auth middleware we can write by
hand. Bundling them means the risky rewrite and the routine dependency move fail together instead of
failing separately.

### Current arrangement vs. Next.js

| | Vite SPA + Pages Functions (today) | Next.js on vinext/Workers |
| --- | --- | --- |
| Auth middleware | Explicit, per endpoint (or ~30 shared lines) | `clerkMiddleware()`, one place |
| Client rewrite | none | 38,477 LOC |
| API rewrite | none | 1,112 LOC |
| Framework parity | Real Vite, real React Router | vinext re-implements the Next surface; edge cases exist |
| Cron | Separate `cron/` Workers project | Can live with the app |
| Data fetching | Client-side from an R2 proxy; fits the app (all computation is client-side anyway) | Would want to move to RSC/server — or everything stays client and Next adds weight for nothing |
| SSR / SEO | None for the dashboard (correct today — it is a gated app) | Would help a public marketing site, if one exists |
| Bundle | Lean, no framework runtime | Larger baseline, partly offset by RSC if we restructure |
| Build/deploy | `vite build` + `wrangler pages deploy dist` | Vite + vinext + Workers deploy |
| Debugging | The stack you already have | An extra abstraction layer between code and runtime |

**Recommendation:** adopt Clerk on Vite when §6's triggers fire. Do not migrate to Next.js as part of
it, and do not migrate to Next.js for auth reasons at all.
