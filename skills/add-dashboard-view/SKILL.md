---
name: add-dashboard-view
description: Use when building a new dashboard view/page in the React app (Phase 3+) — league records, head-to-head grid, draft/keeper analytics, superlatives. Ensures coverage handling, lazy data loading, and chart standards.
---

# Add a Dashboard View

Checklist for any new view in the Vite + React app. Standards:
`context/coding-standards.md`. If the app isn't scaffolded yet, stop — this skill is for
Phase 3 onward.

## Data

- Lazy-load only the JSON this view needs from `data/processed/` — never import the whole
  dataset into the initial bundle.
- Types come from `src/types/` (the canonical processed-schema types). Don't redefine
  shapes locally; if the view needs a new derived shape, add it to `src/types/`.
- Derive stats in one place (a hook or pure helper) and pass results down as props — no
  duplicated aggregation logic across components.

## Partial history is a first-class constraint

- Read each season's `coverage` flag. Until the 2009–2018 backfill lands, every all-time
  stat this view shows must carry its qualifier ("since 2019") — in the heading, tooltip,
  or axis label, wherever the number appears.
- Build the label from the data (min covered season), not a hardcoded string, so Phase 7
  flips it automatically.
- Explicit empty states for: season not covered, view's data file missing, zero rows after
  filtering. Never render `NaN`, `undefined`, or a blank section.

## Charts

- Before writing chart code, apply the repo's chart conventions: CVD-safe diverging tokens
  (`--color-diverge-pos`/`-neg` in `app/src/index.css`) where diverging scales are used, and
  the accessibility rules below (see also `context/coding-standards.md`).
- Color is never the sole encoding — 10 owners need distinguishable series (direct labels,
  patterns, or ordering cues in addition to hue).
- Provide a text alternative or data table for each chart.
- Don't assume 22 weeks anywhere on a time axis — 2020 is shorter; drive axes from
  `seasons` metadata.

## Comparison views (trade evaluators, head-to-head, records)

- Prefer a side-by-side layout with a central summary/verdict panel over an arbitrary
  pool or a single long list.
- Summarize verdicts with visual grade badges — color-coded but never color-only (see
  the accessibility rule in `context/coding-standards.md`).
- Give every non-obvious metric a concise explanatory tooltip. Tooltip/copy text needs
  user sign-off per `context/coding-standards.md` — surface the exact wording late in
  the work, after functionality and tests pass.
- When polishing a view to match an existing route, reuse that route's components and
  visual patterns instead of inventing parallel ones.
- External reference UIs (e.g. ESPN's trade machines) are fine as design inspiration —
  adapt them to this league's domain rather than copying literally.

## Quality bar

- Functional components, one job each; PascalCase directory + `index.tsx`.
- Unit-test the calculation logic (records, head-to-head aggregation, keeper streaks) —
  not the presentational rendering.
- `lint` + `type-check` clean; spot-check the view in the dev server at desktop and phone
  widths before handing off.
