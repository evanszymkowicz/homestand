# Cheatsheet

Every command in this repo, deduplicated. Rules and conventions live in `AGENTS.md`; this file
is just the runnable surface. See `context/ai-interaction.md` for what the agent may run
without asking, and `data/README.md` before consuming any JSON.

## Data layer

Run from the repo root. The binary is `python3`.

```sh
python3 scripts/extract.py      # fetch raw ESPN responses (skips existing; --force refetches)
python3 scripts/normalize.py    # data/raw/ + data/manual/ -> data/processed/ (every year, always)
python3 scripts/validate.py     # invariant checks over data/processed/; non-zero exit on failure
ruff check scripts/ && ruff format scripts/
```

Two traps:

- **`normalize.py` has no `--years` flag, deliberately.** A partial run truncates every
  processed file to the listed years while leaving `box_scores/` intact. Full-archive runs only.
- **Always run `validate.py` after `normalize.py`.** Its warnings are documented data quirks;
  a *new* warning means something changed.

## App

Run from `app/`. `sync-data.mjs` (copying `data/processed/` → `app/public/data/`) runs
automatically before `dev`, `test`, and `build`.

```sh
npm run dev          # vite
npm run build        # sync-data + tsc -b + vite build
npm test             # sync-data + vitest run
npm run lint         # oxlint
npm run format       # prettier --write .
npm run format:check # prettier --check .
```

Typecheck alone:

```sh
npx tsc -b app --noEmit    # from repo root — the tsconfigs live in app/
```

There is **no root tsconfig**, so from the root you must pass the `app` argument. Plain
`tsc --noEmit` checks nothing and passes vacuously. Plain `-b` skips up-to-date projects — add
`--force` if results look stale.

Never edit `app/public/data/` directly; it is a build artifact.

## Hooks

```sh
node scripts/hooks/check-changed-file.mjs <file>   # credential scan + ruff on .py
node scripts/hooks/protect-raw-data.mjs <path>    # exits non-zero under data/raw|data/audit
```

`check-changed-file.mjs` is advisory (`--strict` also fails on credential findings).
`protect-raw-data.mjs` is a hard block.

Enable the pre-commit gate once per clone:

```sh
git config core.hooksPath .githooks
```

## Not yours to run

The user owns every git operation — branch, commit, merge, push, PR. Suggest, never execute. No
AI attribution (`Co-Authored-By`, "Generated with …") in commits or PRs, ever.