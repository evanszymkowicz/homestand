# Homestand

Invite-only service that imports an ESPN fantasy baseball league's history and serves it
through an interactive dashboard: championships, head-to-head records, scoring, playoffs,
drafts, and keepers.

Full architecture and phased plan: `context/features/homestand-league-import-spec.md`.

## Status

S1/S2 in progress. The dashboard app, Python pipeline, and demo dataset are in place.
Invite-only auth with D1-backed sessions, email/password signup gated by invite tokens,
Turnstile bot protection, and a seeded John Doe demo account are implemented. S1 adds
AES-256-GCM encrypted ESPN credential storage, import records, and the manual
paste-a-cookie fallback page with live ESPN probe validation. The automated crawl and
R2 upload are not yet built.

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

- Seeded John Doe demo account (`app/migrations/0002_seed_demo.sql`); the handler
  looks it up by its `demo` flag rather than a hardcoded id.
- Email/password signup gated by an invite token and Turnstile.
- PBKDF2-SHA256 password hashing via the Web Crypto API (native in Workers).
- Rate limits on `login`, `reset-request` and `probe` via Cloudflare's native
  `ratelimits` binding (`app/functions/lib/rateLimit.ts`, limits in
  `app/wrangler.jsonc`). They fail closed, and login is keyed by host *and*
  account so neither spraying nor IP rotation gets around it.
- HttpOnly session cookies with 7-day TTL.

Local secrets live in `app/.dev.vars`:

```sh
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
ADMIN_API_KEY=dev-admin-key-change-me
```

Apply migrations and generate an invite for local testing:

```sh
cd app
npx wrangler d1 migrations apply homestand-db --local
curl -X POST http://localhost:8790/api/admin/invites \
  -H "Authorization: Bearer dev-admin-key-change-me" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com"}'
```

Create an import and store encrypted ESPN credentials:

```sh
TOKEN=$(curl -s -X POST http://localhost:8790/api/auth/demo -i | grep -i set-cookie | sed 's/.*homestand_session=\([^;]*\).*/\1/')
IMPORT=$(curl -s -X POST http://localhost:8790/api/imports \
  -H "Content-Type: application/json" -H "Cookie: homestand_session=$TOKEN" \
  -d '{"leagueId":6121,"yearStart":2025,"yearEnd":2025}')
IMPORT_ID=$(echo "$IMPORT" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
curl -X POST "http://localhost:8790/api/imports/$IMPORT_ID/credentials" \
  -H "Content-Type: application/json" -H "Cookie: homestand_session=$TOKEN" \
  -d '{"mode":"auto","email":"you@espn.com","password":"secret"}'
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