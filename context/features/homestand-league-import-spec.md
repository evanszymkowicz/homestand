# Homestand: Invite-Only ESPN League Import Service

**Status:** Approved, S0-ready — revised 2026-10-04
**Decisions locked:** Separate fork repo · Invite-only email signup · **Email/invite-tier subscription model in the first milestone (no Stripe, no payment form)** · ESPN email/password backend auth (automated + manual session fallback) · **Server-side crawl only — no browser extension of any kind** · Backend crawl script using stored session · **Demo tenant is a deterministic anonymized copy of the real league archive (no mock-league generator)** · Cloudflare storage provisioning · Baseball scorebook visual identity

## Fork Timing

**wsob-record-book is in constant development mode.** Feature development on the upstream repo continues actively; the Homestand fork is deferred until upstream reaches a stable fork point. S0 (bootstrap) cannot begin until the fork is created. This spec documents the architecture and phases for when the fork happens, but no work begins until upstream stabilizes.

## Goal

Homestand is an invite-only, email-centric service that imports a user's ESPN fantasy baseball league history and serves it through the existing dashboard architecture. A visitor joins by email invitation, authenticates with the same email and password they use for ESPN, and a background script provisions Cloudflare storage, obtains an ESPN session, and pulls the league's data. The product is positioned as an email-based subscription: access is gated by invitation and account state, not by a public self-serve signup.

The demo experience is a seeded "John Doe" account that loads an anonymized snapshot of the real league history, so prospects can browse end-to-end without providing credentials.

## Acceptance Criteria

1. The site is invite-only: no open registration; an admin-generated invite token (sent by email) is required to create an account.
2. A visitor can click **"Try the demo"** to log in as the seeded John Doe account without registering or providing ESPN credentials.
3. An invited user creates an account with email + password; email verification is required before first login.
4. During onboarding the user enters their ESPN email, ESPN password, and ESPN league ID; the backend uses these to obtain an ESPN session and import the league.
5. The backend provisions per-account Cloudflare storage (R2 raw archive + D1 normalized data) and runs the unmodified Python pipeline (`normalize.py` + `validate.py`) against the imported league.
6. Authenticated users see only their own imports; data is scoped per account and invisible to others.
7. Free-tier accounts are limited to 1 import with a short TTL eviction; subscription state is modeled through email/invite status rather than a public payment form in the first milestone.
8. Transactional emails (invite, verify, reset, import status) send via the configured email provider.
9. The app front page is branded **"Homestand"** in a baseball script typeface (Washington Nationals road-uniform style) and uses a baseball scorebook color palette distinct from the upstream dashboard.
10. The demo tenant is seeded with an anonymized version of the real league history (fake owner identities; real player and season data preserved).

## Out of Scope

- Real billing or Stripe integration in the first milestone (subscription is modeled by email/invite state and tier flags).
- Real user support (no contact form, no support inbox — demo-grade posture).
- Firefox extension or any browser extension (the crawl runs server-side).
- Persistent archival beyond TTL (the fork is a live demo instrument; permanent archives stay upstream).
- Multi-language support.
- Mobile app.

## Visual Identity

### Brand

- Product name: **Homestand**.
- Front-page wordmark: "Homestand" set in **Lobster** (Google Fonts, SIL OFL 1.1) — **decided
  2026-10-04**, free, commercial, no attribution, no pageview cap, web-embeddable. Lobster is
  the closest available face to the **classic baseball city-name script** style (curved
  baseline, connected strokes, consistent rightward lean). There is no licensable
  MLB/Nationals typeface — those are proprietary and the clubs do not sell them — so this is
  an approximation of a *style*, not a licensed club font. Full option comparison and the
  rejected alternatives: `context/research/homestand-font-options.md`. Rendered mockup:
  `context/research/design-inspiration/homestand-brand-mockup.html`.
  - **The wordmark is solid ink at every size.** A red/blue offset "misregistration" effect
    behind it was built and cut — Lobster's stems are ~14px thick at hero scale, so no offset
    reads as misregistered ink rather than a drop shadow. Do not reintroduce it.
  - **Never rasterize the wordmark** (no PNG, no outlined SVG). It must stay real selectable
    text for screen readers and text scaling.
  - A purpose-built baseball script (Flanders, Haglos, Bandbox, Detourne, …) is the
    better-looking option but costs a separate **webfont** license tier from Creative Market —
    the standard font license forbids `@font-face` outright. Budget $25–100+.
  - **Wordmark must be real text**, never a rasterized image or outlined SVG, so screen
    readers and text scaling work.
- Supporting copy is set in a clean sans-serif to let the script wordmark read as the primary brand.

### Scorebook Color Palette

The UI should evoke a physical baseball scorebook: off-white paper, pencil/ink rulings, and restrained accent colors.

| Token | Suggested value | Role |
|---|---|---|
| `--hs-paper` | `#f7f5ed` | Page background |
| `--hs-paper-dark` | `#e8e4d6` | Card/surface background |
| `--hs-ink` | `#2a2520` | Primary text, ruling lines |
| `--hs-ink-faint` | `#6b655d` | Secondary text |
| `--hs-rule` | `#d4cfc2` | Borders, grid lines |
| `--hs-red` | `#b91c1c` | Emphasis, errors, outs |
| `--hs-blue` | `#1e40af` | Links, active states |
| `--hs-pencil` | `#6b7280` | Graphite accents |
| `--hs-highlight` | `#facc15` | Selected cells, markers |

- Light mode is the canonical experience (scorebooks are paper). A dark mode may be added later but is not required for the first milestone.
- Tables and grids should use visible horizontal rules, subtle vertical rules, and numeric columns aligned like box-score columns.
- The upstream accent green and blue tokens are replaced; the fork must not reuse the record-book palette.

## Architecture

### Invite-only identity

- Accounts are created only with a valid invite token.
- An admin (or an admin Pages Function) generates invite tokens and emails them to prospective users.
- Auth uses email + password with argon2 hashing; email verification is required.
- Password reset and import-status emails are transactional only.

### ESPN credential flow

- During onboarding the user supplies their **ESPN email**, **ESPN password**, and **ESPN league ID**.
- The backend stores the ESPN credentials encrypted at rest (see Security & ToS Register).
- A background crawl script authenticates to ESPN using the stored credentials, obtains a session ID (`espn_s2`/`SWID` equivalent), and fetches the league's API responses.
- The system supports **two auth modes**:
  1. **Automated login:** the crawl script submits the stored email/password and extracts the session cookies from the response.
  2. **Manual session fallback (decided 2026-10-04 — paste-a-cookie form):** if ESPN presents
     MFA, CAPTCHA, or any unhandled challenge, the user is sent to a dedicated **authenticated
     in-app route** (its own page, not a modal — the instructions need room and the page must be
     linkable so it can be emailed back to a user whose crawl failed mid-flight) and pastes the
     two cookie values there. The backend validates them before accepting, stores them encrypted
     like the password, and resumes the crawl with those tokens.

     - Fields: `espn_s2` and `SWID` (`SWID` is the `SWID`-style value including its
      `SWID=...` wrapper as ESPN presents it).
     - **Validate before accepting.** A single probe request against a cheap ESPN endpoint
       confirms the pair is live and unexpired; a bad pair is rejected inline with an
       explanation rather than failing later inside the crawl.
     - **Never echo the values back** into the page, an error message, a log, or a URL. Form
       fields are write-only, and the route must not accept them via query string (they would
       land in server logs and browser history).
     - Instructions must be copy-pasteable and version-pinned: "log in at espn.com in this
       browser, open devtools → Application → Cookies → `https://espn.com`, copy `espn_s2` and
       `SWID`." Browser chrome differs, so name the panel rather than hand-waving at devtools.
     - Pasting a session **overrides** automated login for that account until the credential is
       updated — the automated path must not keep retrying over a known-good manual session.
- The session is refreshed as needed; if authentication fails, the user is notified by email and in-app and can update credentials or switch to manual session entry.
- Cookie values and session IDs are treated as secrets: logged carefully, never exposed in UI or logs, rotated on credential updates.

### Session-scoped, invisible-to-others data

- Each account's imports are scoped to that account. Other users cannot see them.
- TTL eviction (short for Free, longer for subscribers) deletes R2 prefix + D1 rows via a Cron Trigger.
- Storage stays bounded by active accounts × plan caps.

### Cloudflare provisioning

- On first import, the backend provisions:
  - An R2 prefix `{accountId}/raw/{year}/{view}.json` for the raw ESPN archive.
  - D1 tables/rows scoped to the import for normalized data.
- The Python pipeline runs unmodified against the materialized raw directory; the only per-tenant input is the league ID and season range.

## Phases

### S0 — Bootstrap & Parity Harness

**Scope:**
- Duplicate repo as private `homestand` (new Cloudflare Pages project, D1, R2 — separate from the record-book stack).
- De-brand: app title/meta, `wrangler.jsonc` project + D1 names, Pages project, package names, `context/` docs.
- Apply the new visual identity: scorebook color tokens, "Homestand" script wordmark, baseball scorebook styling.
- TS port of `espn_client.py` core (`build_url`, era split, `classify_signal`, `X-Fantasy-Filter`, 0.75s delay, 401/403 stop) with golden-fixture parity tests driven by upstream `data/raw/` responses.
- **Anonymous demo dataset:** derive a deterministic, anonymized copy of the real league history by replacing owner names and email addresses with synthetic identities while preserving player data, season structure, and all historical records. Store in `data/demo/`. (Decided 2026-10-04: anonymized real archive, **not** a synthetic mock-league generator — the earlier mock-generator plan is superseded.)

**Deliverables:**
- Fork repo `homestand` (private).
- Anonymous demo dataset in `data/demo/`.
- TS parity harness + golden fixtures.
- New Cloudflare stack (Pages, D1, R2).
- Updated CSS/token set implementing the scorebook palette and script wordmark.

### S1 — Backend ESPN Auth + Crawl

**Scope:**
- Secure storage for ESPN credentials (encrypted at rest; see Security & ToS Register).
- Backend script that authenticates to ESPN (automated login, or the manual paste-a-cookie
  session) and fetches:
  - All 8 season views for the requested league ID and season range.
  - Per-period box scores (2018+ modern era, 2017 and earlier `leagueHistory` era).
  - 2019+ transaction ledger.
  - 2018 `mRoster` fallback where needed.
- Politeness (0.75s delay), 401/403 stop, and `classify_signal` empty-response detection replicated from upstream.
- Raw responses uploaded to per-account R2 in the `data/raw/{year}/{view}.json` layout.
- **Verification oracle:** byte-diff the crawl against the committed upstream `data/raw/` for league 6121 where season/range overlap exists.

**Deliverables:**
- Encrypted credential store.
- Backend crawl script (Pages Function, Worker, or CI-triggered service) with automated login
    plus the manual paste-a-cookie fallback.
    - **Manual session page** — its own authenticated route with `espn_s2` + `SWID` fields,
      a live validation probe before acceptance, and write-only inputs (never query-string,
      never echoed back). This is the S1 deliverable the fallback hinges on; see
      §ESPN credential flow.
- R2 per-account prefix structure (`{accountId}/raw/{year}/{view}.json`).
- Parity test suite (crawl output vs. upstream archive byte-diff).

### S2 — Invite-Only Registration + Demo Access

**Scope:**
- Admin invite-token generation and email delivery.
- Email + password signup gated on a valid invite token.
- Email verification + password reset.
- Turnstile on signup form (free bot protection).
- Seeded John Doe instant-demo account ("Try the demo" button) preloaded with the anonymized demo dataset.
- Free-tier accounts live (1 import, short TTL idle eviction).

**Deliverables:**
- Auth Pages Functions (invite validation, signup, login, verify, reset, logout).
- Session management (HttpOnly cookie, per-account scope key).
- Admin invite-generation flow.
- John Doe seed script (runs on D1 init, loads `data/demo/`).
- Turnstile integration on signup form.

### S3 — Ingest + Provisioning

**Scope:**
- Authenticated onboarding form: ESPN email, ESPN password, league ID, season range.
- Entitlement + capacity checks at the door (Free tier: 1 import max; global cap: ~70 active leagues on R2 free tier).
- Provisions R2 raw archive and queues normalization.
- Upload/import progress tracking (backend-persistent state).

**Deliverables:**
- Onboarding endpoint (`POST /api/onboarding`).
- Encrypted credential persistence.
- Entitlement middleware (checks account tier + active import count).
- Capacity check (returns 503 "at capacity" when global cap hit).

### S4 — Import Job + Normalization

**Scope:**
- Queue → Python worker (GitHub Actions `workflow_dispatch` to start, swappable to a small always-on service later).
- Worker materializes the tenant's raw dir from R2, runs `normalize.py` + `validate.py` unmodified with per-tenant config.
- Per-import D1 publish (tenant = account's import; per-account scope).
- TTL eviction Cron Trigger: sweeps accounts idle > TTL, deletes R2 prefix + D1 rows for that account.

**Deliverables:**
- Import job queue (Durable Object or external queue).
- Python worker script (reuses upstream `normalize.py` + `validate.py`).
- Per-import D1 publish (tenant-scoped tables or composite uniqueness on `import_id`).
- TTL eviction Cron Trigger (hourly sweep).

### S5 — App Scoping + Import UX

**Scope:**
- `/api/data/{importId}/...` (Pages Function requires identity, resolves caller's imports).
- `data.ts` gains an import prefix (`dataBaseUrl = /api/data/{importId}/`).
- Import wizard in the app: enter ESPN credentials + league ID → trigger crawl → live progress → validation report → dashboard.
- Retention/capacity messaging (honest "at capacity" or "import will expire in X days" notices).
- League switcher (if user has multiple imports, subscriber tier only).

**Deliverables:**
- Scoped data endpoint (`/api/data/{importId}/{collection}`).
- Import wizard UI (credential + league ID form, crawl progress, validation report).
- Retention banner (shows TTL countdown for Free tier).
- League switcher (subscriber tier only, if user has multiple imports).

## Security & ToS Register

### Credential hygiene

- The backend **must store ESPN email/password encrypted at rest**. Use a Cloudflare Workers-compatible encryption mechanism (e.g., AES-256-GCM with a secret key stored in `wrangler secret put`, or a dedicated secrets service).
- ESPN session tokens (`espn_s2`/`SWID`) are stored encrypted and treated as secrets.
- The manual fallback accepts these values from the user, so they are a credential ingress:
  write-only form fields, validated server-side before acceptance, rejected inline on failure,
  never echoed into the page or an error message, never passed in a URL or query string (which
  would persist them in server logs and browser history), and wiped on account or import
  deletion alongside the password.
- No plaintext credentials or session tokens in logs, error messages, D1 rows, or R2 metadata.
- Credentials are re-encrypted on update and wiped when an account or import is deleted.

### ToS and operational risk

- ESPN's Terms of Service prohibit automated access. A server-side script authenticating with user credentials and crawling league data is higher-risk than a personal, user-IP browser extension.
- Mitigations:
  - Strict politeness (0.75s between requests).
  - Per-user crawl scheduling (no concurrent bursts from a single IP).
  - Clear in-app disclosure that the service accesses ESPN on the user's behalf.
  - Easy credential revocation and import deletion.
- Endpoint churn: ESPN changes response shapes without notice. The parity harness + versioned crawl profile tracks upstream `espn_client.py` changes.
- MFA/CAPTCHA: ESPN may challenge automated logins. The architecture supports both automated password login and a manual session-cookie fallback; S1 implements both paths so users are never blocked by an auth challenge.

### Data isolation and privacy

- Per-account data isolation (invisible to other visitors).
- TTL eviction (data expires, not permanently stored).
- Demo tenant uses anonymized owner identities; no real names or emails are exposed in the demo.

## Capacity Budget

| Resource | Free Tier | Capacity |
|---|---|---|
| R2 | 10 GB | ~70 raw archives (135 MB/league) |
| D1 | 5 GB | ~100-300 tenants (with zlib+base64 chunking à la `publish_d1_delta.py`) |
| GitHub Actions | 2,000 min/mo | ~100-200 imports (10-20 min each) |
| Resend / email provider | Provider limit | Invite + transactional volume |
| Cloudflare Pages | Unlimited (free tier) | N/A |
| Cloudflare Workers | 100,000 req/day | ~10k active users (assuming 10 req/user/day) |

**Global cap:** ~70 active leagues on R2 free tier. When hit, new imports queue or refuse with honest "at capacity" messaging.

## Demo Dataset

**Purpose:** Seed the John Doe demo tenant + serve as CI fixture corpus.

**Spec:**
- Derived from the real upstream league history (2009–present) with owner and team identities anonymized.
- **Scrubbed — decided 2026-10-04:**
  - **Owner names.** Replaced with deterministic fictional names. Every `owner_id`'s
    display name, plus any place a name is pre-joined into a string
    (`teams.json` team-owner display fields, trade summaries, recap/trade asset labels).
  - **Email addresses.** Replaced with synthetic addresses at a reserved domain.
  - **Team names.** Replaced with fictional names too — not preserved. Team names are the
    most identifying string in the dataset and are frequently derived from an owner
    ("Brushbacks" → whoever), so leaving them intact would deanonymize the scrubbed names.
  - **Personal notes / free-text fields.** Replaced with empty or neutral values.
- **Preserved unchanged:** player IDs, player names, season structure, scoring, matchups,
  draft picks, and transactions. Historical *records* (who won, who traded whom, points
  scored) are the product and stay intact — only identities move.
- Output in `data/demo/` (committed to the fork repo).

**Determinism requirement.** The same input must always produce the same output — same
owner id always maps to the same fake name, across regenerations and across machines. Use a
seeded mapping (sorted key order + a fixed salt), never a random or insertion-ordered
substitution. Golden fixtures and the D1 seed both depend on it: a dataset that reshuffles
between runs breaks parity tests and silently re-points a live demo account at different
fake owners.

**Identity-mapping consistency.** Owner and team renames must be applied by **id**, at the
single point where display names are resolved — not string-replaced in the output files. A
string replacement leaves pre-joined display fields stale (the same class of bug the A4
recap-identity change fixed upstream, where `ownerIds`/`teamId` flow as ids and names resolve
at render). Scrub at the loader, not in the bytes.

**Uses:**
- Seeds the John Doe demo tenant on D1 init.
- Golden fixtures for crawl-parity tests where the real archive is the oracle and the anonymized copy is the demo source.
- App e2e tests (load demo data → verify dashboard renders).

## Billing / Subscription Model (First Milestone)

- **Email-only subscription:** access is invite-only and tier state is stored on the account record (`free` / `subscriber`). No public self-serve payment form in S0–S5.
- **Free tier:** 1 import, short TTL idle eviction (e.g., 72h).
- **Subscriber tier:** 3 imports, longer retention (e.g., 30d), plus league switcher.
- **Plan changes** are applied by admin/email workflow in the first milestone; a Stripe integration may be added later as a separate phase.
- **Demonstrable difference:** retention TTL + import count + league switcher entitlement — the same gating code you'd ship for real billing.

## Email Provider Abstraction

**Provider:** Resend free tier (sandbox mode, verified recipients only — no domain required for demo) or another transactional provider.

**Local dev:** Mailpit (catch-all SMTP server, no real sending).

**Templates:** Invite, verify, reset, import started/completed/failed.

**When to add a custom domain:** When the demo is public (arbitrary recipients). Until then, sandbox mode is sufficient.

## Open Questions

1. ~~ESPN authentication surface~~ **Decided:** build both automated password login and manual session-cookie fallback.
2. ~~Subscription fulfillment~~ **Decided:** email-only / invite-tier model in the first milestone; Stripe deferred.
3. ~~Browser extension as the harvester~~ **Decided (2026-10-04):** dropped. The crawl runs
   server-side; see §ESPN credential flow and §Out of Scope. Any extension-shaped idea is
   out of scope for this milestone.
4. ~~Demo data source~~ **Decided (2026-10-04):** a deterministic anonymized copy of the real
   archive, not a synthetic mock-league generator. See §Demo Dataset.
5. ~~Draft status~~ **Decided (2026-10-04):** approved and S0-ready. S0 work is unblocked by
   spec; it remains gated on the fork repo existing (see §Fork Timing).

### Resolved 2026-10-04 — **no open questions remain**

All spec-level decisions are settled. Anything still outstanding is an implementation detail
inside a phase, not a spec question.

- ~~**Font licensing**~~ **Decided: Lobster** — Google Fonts, SIL OFL 1.1, $0.
  See §Visual Identity and `context/research/homestand-font-options.md`.
- ~~**Demo anonymization depth**~~ **Decided (2026-10-04): scrub owner names, emails, and team
  names** (plus personal notes). Team names are scrubbed because they are usually derived
  from the owner and would deanonymize the owner names. See §Demo Dataset for the full rule
  and the determinism requirement.
- ~~**Manual session UX shape**~~ **Decided (2026-10-04): a paste-a-cookie form on its own
  authenticated in-app route** — `espn_s2` + `SWID`, validated before acceptance, write-only
  fields, stored encrypted. See §ESPN credential flow. (The authenticated-redirect variant was
  rejected: you cannot read another origin's cookies, so it only works via an extension or
  bookmarklet, both descoped.)

## Upstream Sync Strategy

- `scripts/lib/espn_client.py` and the pipeline evolve upstream; golden-fixture tests pin fork compatibility.
- `context/` planning stays separate per repo (fork has its own future-items).
- The demo dataset is fork-only and must be regenerated when the upstream archive is extended.
