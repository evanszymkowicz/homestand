# AI Interaction Guidelines

## Communication

- Be concise and direct.
- Explain non-obvious decisions briefly.
- Always ask before large refactors or architectural changes.
- Don't add features or content not requested.
- When a preference isn't documented here or in `@context/coding-standards.md`: ask, never assume.

## Researching Conventions

- When looking up coding-standard questions (library idioms, APIs, best practices for
  React, Tailwind, Recharts, pytest, ruff, etc.), query **Context7** via the `context7`
  MCP tools first — its docs are current and versioned.
- Fall back to a web search only when Context7 doesn't cover the topic (or the user has
  pinned an unlisted version).

## Code Changes

- Make minimal changes to accomplish the task.
- Don't refactor unrelated code unless asked.
- Preserve the phased plan in `@context/project-overview.md`: don't pull work forward from a
  later phase without asking. The feature in flight is described in `@context/current-feature.md`.

## Data Rules (the dataset is the product)

- **Never delete or modify files under `data/raw/`** — it is a write-once archive of ESPN API
  responses. Parsers read from it; nothing ever edits it. Re-parse from local files; never
  re-scrape to re-parse.
- Never delete data JSON or mapping files (`owner-map.json`, `player-overrides.json`) without
  asking.
- **Never commit or print credentials.** `config.json` holds `espn_s2`/`swid` cookies and is
  gitignored — those cookies grant access to a real ESPN session. Keep them out of logs,
  error messages, and saved audit output.
- Box scores and owner names are real people — flag anything that would expose them publicly
  (hosting, screenshots, committed data) before doing it.

## Verify Before Handing Off

- **Python (data layer)**: `ruff check` and `ruff format --check` clean; `pytest` passes.
  Any parser or schema change must also pass the data validation suite (once it exists in
  Phase 2).
- **App (once scaffolded)**: lint and type-check clean for files you touched; spot-check
  UI/behavior changes in the Vite dev server. Unit tests are only expected for tricky logic
  (record calculations, coverage-aware aggregation) — run the ones that exist.
- No tooling is scaffolded yet — update this section with real commands as they land.

## Git — the user owns commits and merges

This project uses a PR-per-change workflow (squash-merged into `main`).

- **Do NOT commit, push, or merge** — the user handles all git operations.
- **Scoped exception — the in-season refresh bot.** `.github/workflows/in-season-refresh.yml`
  (Phase 8) commits and pushes straight to `main` as the automation bot, unreviewed, during an
  in-progress season. The job runs two modes: lightweight (7x/day — scoreboard patch +
  scoped D1 delta only, no commit) and heavy (1x/day at 1:00 AM ET, 6:00 AM ET on Mondays —
  adds extract + normalize + validate + commit + full D1 publish; the lightweight
  ladder includes morning slots that catch ESPN's overnight week finalization). This is
  deliberate — a PR-per-day would mean a manual merge click every day of the season — but it's
  an automated CI job, not an AI agent session, and its scope is fixed: only `data/raw/<season>/`
  and `data/processed/` files written by `scripts/extract.py`/`normalize.py`, gated by
  `scripts/validate.py` passing first. The AI agent itself still never commits or pushes.
- **Never** add AI attribution to commits or PRs — no "Co-Authored-By: <assistant>"
  trailers, no "Generated with <tool>" tags, nothing similar. There are no exceptions ever.
- When suggesting a commit/PR message, use a short descriptive title (conventional-commit
  style — `feat:`, `fix:`, `refactor:`, `chore:` — is welcome).
- Keep changes focused: one logical concern per PR; don't mix formatting-only churn with
  behavior changes.
- Branch naming: `feature/<desc>` or `fix/<desc>`.

## Commands the Agent May Run Without Asking

- Read-only inspection: `ls`, `cat`, `grep`, `find`, `jq`, and read-only git (`status`,
  `diff`, `log`, `show`, `ls-files`, `check-ignore`).
- Data layer: `python3 scripts/…`, `ruff check`, `ruff format --check`, `pytest`,
  `node scripts/hooks/…`.
- App: `npm run dev|build|lint|test|preview`, `npx tsc --noEmit`, `npx vitest …`,
  `npx oxlint …`, `npx prettier --check …`.

Still ask first: destructive operations (`rm`, `git reset/restore/clean`, killing
processes), dependency installs (`npm install`, `pip install`), and anything touching
credentials, `config.json`, or CI secrets.

## When Stuck

- If something isn't working after 2–3 attempts, stop and explain the issue rather than
  trying random fixes.
- Ask for clarification when requirements are unclear.
