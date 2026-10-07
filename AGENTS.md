# AGENTS.md

Guidance for AI agents working in this repository. Harness- and model-agnostic.

## Project

Homestand. A private, approval-gated service that imports an ESPN fantasy baseball league's
history and
serves it as an interactive dashboard.

## Status

S1/S2 landed; S5 scoping landed. Auth is email + password with email verification and an
admin approval gate (`./approve.sh <email>`), plus one-click demo access; D1 sessions,
encrypted ESPN credential storage, the manual session-cookie fallback, the tenant-scoped data
proxy, and the landing page are in place. Gmail SMTP sends verification and reset mail
(`GMAIL_USER` / `GMAIL_APP_PASSWORD`). `cron/` runs the eviction sweep hourly. The crawl
runner takes `--target remote` for production runs and `--pending` to sweep queued imports,
and `.github/workflows/cron.yml` sweeps it every 15 minutes — but the repo has no Actions
secrets, so it has never run. R1 is blocked on two `gh secret set` commands, not on code.
Read before starting work:

- `context/features/homestand-league-import-spec.md` — the canonical architecture and phased plan.
- `context/future-items.md` — known-open work, including the one item that **blocks public
  reachability** (nothing runs the production crawl, so a real signup gets an empty
  dashboard). Rate limiting is closed.
- `context/ai-interaction.md` — how to work in this repo: data rules, verification expectations.
- `context/coding-standards.md` — Python and TypeScript/React conventions.
- `data/README.md` — the processed data dictionary. Read before consuming any JSON.

## Commands

Commands are listed in `CHEATSHEET.md`. Two traps worth keeping in context:

- `normalize.py` is idempotent and has **no `--years` flag**: a partial run truncates every
  processed file while leaving `box_scores/` intact. Run `validate.py` after every normalize.
- `cd app && npx tsc -b --noEmit`. There is no root tsconfig and no root `node_modules` —
  TypeScript lives in `app/`, so `tsc` must run from there. Add `--force` if results look
  stale (a plain `-b` skips up-to-date projects).

`app/scripts/sync-data.mjs` copies `data/processed/` into `app/public/data/` before `dev`,
`test`, and `build` — never edit `app/public/data/` directly.

## Data rules that bite

- **League rules are programmatic, never hardcoded.** Roster, acquisition, draft/keeper, and
  trade settings come from `seasons.json`'s `settings`, `roster_rules`, `acquisition_rules`,
  `draft_settings`, and `trade_rules` blocks. They change across seasons.
- **Coverage is per data family, per season.** Gate every all-time figure on `seasons.json`'s
  `coverage`: transactions are missing for 2009–2018, stat lines for 2009–2017, and 2018's box
  scores are partial.
- **ESPN member ids are SWIDs** — byte-identical to the session cookie. They are never
  written to `data/processed/`; only salted hashes (`espn_member_key`) are.
- **This repo ships demo data only.** `data/processed/` is an anonymized copy with synthetic
  owner and team identities. Never commit real owner names, team names, or the raw ESPN
  archive (`data/raw/`).

## Hooks

- `scripts/hooks/protect-raw-data.mjs <path>` — exits non-zero for any path under
  `data/raw/` or `data/audit/`.
- `scripts/hooks/check-changed-file.mjs <path>` — credential scan plus `ruff` on `.py`.
- Pre-commit: `git config core.hooksPath .githooks` (once per clone).

## Tech Stack

- **Data layer:** Python, `espn-api` package plus raw `requests` against ESPN's v3 API.
- **App:** Vite + React + TypeScript + React Router; Recharts for charts; Vitest for tests.
- **Data storage:** versioned JSON under `data/`, produced by Python and consumed by the app.
- **Hosting:** Cloudflare Pages; D1 and R2 hold per-account imports today.