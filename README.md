# Homestand

Invite-only service that imports an ESPN fantasy baseball league's history and serves it
through an interactive dashboard: championships, head-to-head records, scoring, playoffs,
drafts, and keepers.

Full architecture and phased plan: `context/features/homestand-league-import-spec.md`.

## Status

The dashboard app, Python pipeline, and demo dataset are in place and deployed at
`homestand.pages.dev`. Auth is email + password with D1-backed sessions, email verification,
an admin approval gate (`./approve.sh <email>`), Turnstile bot protection, and a one-click
seeded demo account. AES-256-GCM encrypted ESPN credential storage, import records, and the
manual paste-a-cookie fallback page with live ESPN probe validation are implemented. The
crawl pipeline (`scripts/run_import.mjs` → `scripts/crawl_from_env.py`) writes per-import
archives to R2 and closes out the D1 row. **Not finished:** nothing yet runs that crawl on a
schedule, so a real user's import stays `pending`.

## Demo dataset

`data/processed/` holds a **deterministically anonymized** copy of a real league archive:
owner names, team names, and internal notes are replaced with synthetic identities; player
data, season structure, scoring, matchups, drafts, keepers, and transactions are preserved.
No real owner or team names are present.

The anonymizer itself lives upstream in `wsob-record-book` at `scripts/demo/anonymize.py`.

## Tech Stack

- **Data layer:** Python (`espn-api` / raw `requests`) against ESPN's v3 fantasy API.
- **App:** Vite + React + TypeScript + React Router, Recharts for charts, Vitest for tests.
- **Data storage:** versioned JSON under `data/`. App reads static JSON from `app/public/data/`.
- **Hosting:** Cloudflare Pages with D1 (`homestand-db`) and R2 (`homestand-raw-archive`).

## Running the app

```sh
cd app
npm install
npm run dev      # sync-data runs automatically
npm test
npm run build
```

`npm install` and `npm run …` only work from `app/` — there is no root `node_modules` and
no root `package.json`.

## Auth

Auth is implemented as Cloudflare Pages Functions in `app/functions/api/auth/` backed by
D1 (`app/migrations/`). Features:

- Seeded demo account (`app/migrations/0002_seed_demo.sql`); the handler looks it up
  by its `demo` flag rather than a hardcoded id. One click, no credentials.
- Email/password signup with Turnstile, email verification (Gmail SMTP), and an admin
  approval gate: `POST /api/admin/approve {"email": "..."}`, or `./approve.sh <email>`.
- PBKDF2-SHA256 password hashing via the Web Crypto API (native in Workers).
- Rate limits on `login`, `signup`, `reset-request` and `probe` over D1 counters with
  10-minute through daily windows (`app/functions/lib/rateLimitHorizon.ts`,
  `app/migrations/0009_rate_limit_counters.sql`). They fail closed, and login is keyed
  by host *and* account so neither spraying nor IP rotation gets around it. Cloudflare's
  native `ratelimits` binding is deliberately unused: a Pages config cannot declare it.
- HttpOnly session cookies with 7-day TTL.

Local secrets live in `app/.env` (copy `app/.env.example`):

```sh
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
ADMIN_API_KEY=dev-admin-key-change-me
GMAIL_USER=you@gmail.com
GMAIL_APP_PASSWORD="your 16 char app password"
```

Apply migrations for local testing:

```sh
cd app
npx wrangler d1 migrations apply homestand-db --local
```

Create an import and store encrypted ESPN credentials (`npm run dev` serves the origin on
**http://localhost:8788**):

```sh
TOKEN=$(curl -s -X POST http://localhost:8788/api/auth/demo -i | grep -i set-cookie | sed 's/.*homestand_session=\([^;]*\).*/\1/')
IMPORT=$(curl -s -X POST http://localhost:8788/api/imports \
  -H "Content-Type: application/json" -H "Cookie: homestand_session=$TOKEN" \
  -d '{"leagueId":6121,"yearStart":2025,"yearEnd":2025}')
IMPORT_ID=$(echo "$IMPORT" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
curl -X POST "http://localhost:8788/api/imports/$IMPORT_ID/credentials" \
  -H "Content-Type: application/json" -H "Cookie: homestand_session=$TOKEN" \
  -d '{"cookieHeader":"espn_s2=…; SWID={…}"}'
```

For production, set real secrets with `npx wrangler secret put <name>`.

## Running the pipeline

```sh
pip install -r requirements.txt
cp config.json.example config.json   # fill in league_id/espn_s2/swid
python3 scripts/extract.py           # fetch raw ESPN responses
python3 scripts/normalize.py         # data/raw/ -> data/processed/
python3 scripts/validate.py          # invariants over data/processed/
```

`config.json` holds ESPN session cookies and is gitignored. Never commit it.

## Contributing

Agent guidance lives in `AGENTS.md`; runnable commands in `CHEATSHEET.md`.