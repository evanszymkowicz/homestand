# Coding Standards

Two codebases live in this repo: a **Python data layer** (extraction, parsing, validation —
runs offline) and a **Vite + React + TypeScript app** (reads processed JSON; no backend).
Neither is scaffolded yet — these are the standards to build to. Add real commands to
AGENTS.md and @context/ai-interaction.md as tooling lands.

## Python (data layer)

- **Ruff** for both linting and formatting — keep both clean.
- Type hints on all function signatures. Use `dataclass`/`TypedDict` for structured shapes
  where they aid readability; don't fully type ESPN's raw responses — treat them as
  untrusted dicts and validate what you extract.
- **pytest** for tests. The Phase 2 validation suite (10 teams per season, wins reconcile
  with matchups, etc.) is mandatory and must pass after any parser or schema change.
- Scripts are **config-driven**: all configuration (league ID, cookies, year range) comes from the
  gitignored `config.json` — no hardcoded credentials, no editing source to change a run.
  The commissioner must be able to run them by editing only `config.json`.
- Parsers read local files under `data/raw/` only — never fetch inside a parser.
- Save raw API responses verbatim (`data/raw/{year}/{view}.json`) before any parsing.
- Modules and functions: `snake_case`; scripts live in `scripts/`.

## TypeScript

- Strict mode. No `any` — use proper typing or `unknown`.
- **Typing focus is the processed-data boundary and component props.** Canonical types for
  the processed JSON schema (`owners`, `teams`, `matchups`, `seasons`, `draft_picks`,
  `keepers`, …) live in `src/types/` — reuse them; don't redefine parallel shapes. The app
  never touches raw ESPN responses, so don't type those here.
- **Partial history is a first-class constraint**: every season carries a `coverage` flag,
  and types/components must tolerate missing seasons and fields. All-time stats show honest
  labels ("since 2019") until the 2009–2018 backfill lands, then extend automatically.
- Use type inference where obvious, explicit types where they aid readability (component
  props, data-loading results).

## React

- Functional components only, hooks for state and side effects.
- One job per component; extract reusable logic into custom hooks.
- Load processed JSON lazily per view — don't bundle the whole dataset into the initial load.
- Guard against malformed or missing data; render explicit empty states (including
  "no data for this season yet" coverage states) rather than empty sections.
- Charting library: **Recharts** (decided Phase 3, see @context/future-items.md).

## Styling

**Tailwind** (decided Phase 3, see @context/future-items.md). Design tokens (colors,
spacing, shadows) from the `prototypes/*.html` mockups live as Tailwind theme extensions in
`tailwind.config.ts` — no inline styles, no magic values scattered in components.

**Hover-to-reveal over wrapping**: in fixed-width UI (cards, grid cells, table rows), variable-length
text (names, labels) truncates to one line rather than wrapping. If it can overflow, use
`TickerText` (`src/components/TickerText`) — it truncates with an ellipsis and only marquee-scrolls
the full content on hover, so nothing ever pushes a layout taller than intended. Don't reach for
`truncate` alone when the full value matters (an owner name, a score line); `TickerText` keeps it
recoverable on hover instead of just cutting it off. See `StatCard`'s `detail`/`runnersUp` rendering
for the reference usage.

## File Organization & Naming

- Components: `src/components/<ComponentName>/index.tsx` (PascalCase directory + component).
- Functions: camelCase. Constants: SCREAMING_SNAKE_CASE. Types/Interfaces: PascalCase
  (no prefix).
- Data: `data/raw/{year}/{view}.json` (immutable archive) → `data/processed/` (app-facing,
  versioned JSON). Manual mapping files: `owner-map.json`, `player-overrides.json`.

## Formatting

- **Prettier is authoritative** for TS/JS: semicolons, double quotes, 120-col width,
  `arrowParens: avoid`, `bracketSameLine: true` (the `>` of a multi-line JSX tag ends
  the last attribute line), `trailingComma: es5`.
- Python formatting is `ruff format`.

## Null-handling preferences

- **Prefer nullish coalescing (`??`)** over `||` for default values when the alternative
  might be a valid falsy value like `0` or `false`. The `??` operator only falls back when
  the value is `null` or `undefined`, making it safer for numeric and boolean contexts.
- **Prefer optional chaining (`?.`)** when accessing properties that may be `null` or
  `undefined`. This avoids explicit null checks and reduces nested `if` statements.
- When both patterns can solve a problem, `?.` is preferred for property access and `??`
  is preferred for providing default values.
- **Keep `||` where a falsy value is itself invalid state** — e.g. `""` from split-initials
  or a title lookup means "nothing usable", so falling back on truthiness is the point
  (`Headshot`, `useDocumentTitle(playerName || "Players")`). Never blind-swap these to `??`.
- **`x == null` is the one allowed loose equality** (catches `null` and `undefined` in
  test-then-branch position). Use `??` for default-value position instead of chaining ==
  checks; oxlint's `eqeqeq` (`null: ignore`) bans every other loose comparison.
- **Logical assignment (`??=`, `||=`)** replaces self-referencing default assignments on
  locals and accumulators (`counts[key] ??= 0`). It does not fit the get→mutate→set idiom
  around `Map`s — there the existing reference needs reinserting regardless.

## Reliability

- **Never cache rejected promises.** A failed fetch should evict itself from the cache so
  subsequent calls can retry. Module-level caches that store rejected promises permanently
  trap the user until hard refresh. Pair with retry-with-backoff for transient failures.
- **Always wrap the root in an ErrorBoundary.** Any unhandled render error should show a
  recovery UI, not a white screen. The boundary should offer a "Try again" button that
  clears state and reloads. `console.error` logging is sufficient; external error tracking
  (Sentry, etc.) can be added later as a future item.
- **Always set a fetch timeout.** Use `AbortController` with a 30-second timeout. A hanging
  request blocks the UI indefinitely and consumes resources. 30 seconds is generous for the
  largest payloads (~13MB) but still fails fast enough to recover.
- **Prefer `Promise.allSettled` over `Promise.all` for independent fetches.** When loading
  multiple independent data sources (e.g., box scores for multiple years), one failure
  should not kill the whole batch. Show a coverage note listing which items failed, matching
  the existing `CoverageBadge` pattern. See `context/research/design-inspiration/partial-failure-mockups.html`
  for UI treatments.
- **Add retry with exponential backoff for transient failures.** Network errors and 5xx
  responses are often transient. An initial attempt plus three retries at 500ms/1s/2s
  delays recovers from most temporary outages without overwhelming the server.

## Testing

- **Data layer — strict**: pytest plus the validation suite; data correctness is
  non-negotiable because every view downstream trusts the processed JSON.
- **App — lighter**: lint/format clean and browser spot checks are the baseline. Write unit
  tests only for logic that can silently produce wrong numbers (record calculations,
  head-to-head aggregation, keeper detection display, coverage-aware totals) — not for
  presentational components.
- **Run `npm test` before declaring any feature finished — no exceptions for "just a UI
  change."** UI edits routinely shift markup, props, or rendered text that existing tests
  assert on; several deploys have shipped broken because a test went stale alongside a UI
  change and nobody re-ran the suite before calling the work done. A green test run is part
  of the definition of done, not an optional final step.
- **Chart helper text needs sign-off**: any caption, legend note, or explanatory copy placed
  above or below a chart must be reviewed by the user before the feature is considered done.
  Surface the exact text for review as one of the last steps of feature work — after
  functionality and tests, before wrap-up (e.g. before `complete`).

## Playwright MCP Output

`.playwright-mcp/` (gitignored) is scratch output from the `mcp__playwright__*` tools —
console logs (`.log`), page snapshots (`.yml`), and screenshots (`.png`). Don't let it
accumulate as a flat pile of timestamped files:

- Before generating output for a task, create a subdirectory under `.playwright-mcp/` named
  for what's being checked (e.g. `.playwright-mcp/head-to-head-grid/`,
  `.playwright-mcp/keeper-view-dark-mode/`), and direct that run's files into it.
- Only the most recent run's files should exist for a given subdirectory — delete the
  previous log/yml/png before (or after) writing new ones instead of leaving timestamped
  versions to pile up.

## Playwright MCP Browser

The Playwright MCP server runs with `--browser chromium --headless`, relying on Playwright's
bundled Chromium (installed via `npx playwright install chromium`) rather than a system
Google Chrome. `@playwright/mcp` defaults to the "chrome" channel when `--browser` is
omitted, which fails on machines without Chrome installed — keep the explicit flag so MCP
works anywhere the bundled Chromium is present. See `.mcp.json` (repo root) for the sanctioned
invocation.

## Code Quality

- No commented-out code, unused imports, or unused variables.
- No copy-pasted constants, maps, or helpers across files — extract shared values.
- Accessibility: semantic elements, alt text, visible focus states, color never the sole
  indicator (charts included — see season/team encodings).

## Comments

- Default to no comments. Well-named identifiers should carry the meaning.
- When a comment is warranted, keep it to **one or two lines** — a non-obvious constraint,
  invariant, or workaround, not an explanation of what the code does.
- Never document overall file purpose, module structure, or application flow in comments —
  that belongs in this file or `context/`, and it rots as the code changes. Reading the code
  should be enough to recover what it does; comments are only for the *why* that reading
  can't recover.
