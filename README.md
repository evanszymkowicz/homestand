# Homestand

Invite-only service that imports an ESPN fantasy baseball league's history and serves it
through an interactive dashboard: championships, head-to-head records, scoring, playoffs,
drafts, and keepers.

Full architecture and phased plan: `context/features/homestand-league-import-spec.md`.

## Status

S0 (bootstrap). The dashboard app, Python pipeline, and demo dataset are in place. Auth,
the server-side ESPN crawl, and per-account storage are not yet built.

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
- **Hosting:** Cloudflare Pages (+ D1 and R2, not yet provisioned).

## Running the app

```sh
cd app
npm install
npm run dev      # sync-data runs automatically
npm test
npm run build
```

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