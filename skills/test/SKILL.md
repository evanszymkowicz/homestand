---
name: test
description: Use after implementing a feature to verify it — runs lint/tests/build for whatever layer changed, delegates to validate-data for data changes, and spot-checks the dev server for UI changes.
---

# Test a Feature

Verifies what `start` implemented. Follow `@context/ai-interaction.md`'s "Verify Before
Handing Off" section — the exact commands depend on which layer changed and how much of
the app is scaffolded yet.

## Steps

1. Read `context/current-feature.md` to see what was implemented.
2. Identify which layer(s) changed:
   - **Python data layer**: run `ruff check` and `ruff format --check`, then `pytest`.
   - **Data/parser/mapping changes** (`data/`, `owner-map.json`, `player-overrides.json`,
     any raw→processed parser): run the `validate-data` skill — don't re-derive its checks
     manually.
   - **App code** (Phase 3+, once Vite/React/TS is scaffolded): lint and type-check the
     touched files, run `npm run build` and fix errors, then spot-check the change in the
     dev server (`npm run dev`). For Phase 3+ dashboard views
     specifically, the `add-dashboard-view` skill's checklist applies too.
3. If no tooling is scaffolded yet for the layer you touched (true for most of the repo
   pre-Phase-2/3 per `AGENTS.md`), say so explicitly and fall back to manual checks:
   re-read the code, sanity-check outputs by hand (e.g. `python -c`/`jq` probes against
   produced JSON), and note in the report that automated verification wasn't possible yet.
4. Only write new unit tests for genuinely tricky logic (record calculations,
   coverage-aware aggregation) — not as a blanket requirement, and not for trivial
   pass-through code.
5. Report: what was run, what passed, what failed (with file + suspected cause), and what
   couldn't be verified automatically.

## Notes

- Never treat a clean `ruff`/build as sufficient for data changes — data correctness needs
  `validate-data`'s invariant checks, not just "it parses."
- Sanity-check thresholds and constants against the real archive before committing to
  them — small `python3 -c`/`node -e` probes over `data/processed/*.json` are ground
  truth when spec rationale is uncertain. Throwaway Vitest files that read the generated
  `public/data/*.json` are fine for validating pure functions, but delete them after the
  check and run `git status --short` to confirm no scratch artifacts survived.
- Screenshots/notes from dev-server checks, once relevant, follow whatever capture
  convention `@context/ai-interaction.md` documents at that point.
