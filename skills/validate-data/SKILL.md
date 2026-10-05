---
name: validate-data
description: Use after any extraction run, parser change, or edit to processed JSON/mapping files — runs the validation suite (or manual invariant checks until it exists) and interprets failures for this league's data.
---

# Validate the Dataset

The dataset is the product; every dashboard view trusts the processed JSON. Run this after
extraction runs, parser/schema changes, or edits to `owner-map.json` /
`player-overrides.json`.

## How to run

1. If the pytest validation suite exists (Phase 2+, look in `tests/` or `scripts/`), run it:
   `pytest`. That is the source of truth — don't re-derive its checks manually.
2. Until then, check invariants directly with small `python -c`/`jq` probes against the
   files that exist.

## Invariants

Per season (processed data):
- Exactly 10 teams.
- Each team's win/loss totals reconcile with that season's matchup results.
- Season metadata present: week count, playoff format, `coverage` flag. 2020's shorter
  season is correct — flag hardcoded 22-week assumptions, not 2020 itself.
- Keepers = draft rounds 1–5; every keeper row traces to a draft pick.

Cross-season:
- Every team maps to a canonical owner in `owner-map.json`; no orphan owners or teams.
- Player identity is consistent across seasons (check `player-overrides.json` for
  collisions).
- Seasons 2009–2018 absent is EXPECTED until the Phase 7 backfill — missing Group B is
  never a failure. All-time aggregates over partial data must be labeled, not silently
  computed as if complete.

Raw layer:
- `data/raw/` and `data/audit/` files are untouched since capture (`git status` clean for
  existing files; only additions allowed).
- No credentials in any tracked file: grep `git ls-files` output for `espn_s2` and
  `\{[0-9A-Fa-f-]{36}\}`.

## Interpreting failures

- Wins don't reconcile → usually a playoff/consolation matchup classification bug in the
  parser, or double-counted two-week playoff rounds — check `seasons` metadata first.
- Wrong team count → ESPN stub response parsed as real (see the 200-with-empty trap in
  the espn-extraction skill); check the raw file's data signal before blaming the parser.
- Orphan owner → a team changed names/owners mid-history; fix in `owner-map.json`, never
  in the raw data.

Report what was checked, what passed, and each failure with file + season + suspected
layer (raw capture vs. parser vs. mapping).
