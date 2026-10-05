# data/

## Layout

- `data/audit/{year}/{view}.json` — Phase 0 audit archive. Sampled box scores only (3
  scoring periods/year). Committed, write-once, kept as evidence — not a data source for
  later phases.
- `data/raw/{year}/{view}.json` — the permanent extraction archive (Phase 1+). Byte-for-byte
  ESPN API responses, one file per year × view, plus one file per scoring period for box
  scores (`mBoxscore-period{N}.json`), rosters (`mRoster-period{N}.json`, 2018 only), and
  transactions (`mTransactions2-period{N}.json`, 2019+ only). Write-once: nothing ever edits
  or deletes files here once written; re-running `scripts/extract.py` skips existing files
  unless `--force` is passed. Parsers (Phase 2+) read only from this directory — they never
  fetch.
  - `mTransactions2-daily-{YYYYMMDD}.json` (2026+ only, Phase 8 trade-capture spec) — one
    extra byte-for-byte `mTransactions2` snapshot per day, captured by the daily live-update
    job (`scripts/sync_live_scoreboard.py`) specifically because ESPN purges a
    `TRADE_PROPOSAL`'s player list the instant the trade executes. It never reaches this
    directory directly (that script never writes `data/raw/` or commits — see its docstring):
    the daily job stages it to R2 under this same relative path, and
    `in-season-refresh.yml`'s "Pull daily trade-proposal captures" step (weekly mode only)
    downloads it into the real, git-tracked `data/raw/{year}/` before that week's commit,
    at which point it's an ordinary write-once raw file like any other. `scripts/normalize.py`'s
    `build_transactions` merges these into the same by-id map as the period files (see
    `discover_transaction_daily_captures`).
- `data/manual/` — the human-judgment layer (Phase 2+). Hand-edited, committed, precious:
  `owner-map.json`, `player-overrides.json`, `season-notes.json`, `pro-team-overrides.json`,
  `retired-owners.json`. See "Manual mapping files" below.
- `data/processed/` — app-facing, versioned JSON derived from `data/raw/` + `data/manual/`
  by `scripts/normalize.py` (Phase 2+). See "Processed data dictionary" below.

## Views

Pulled per season (list confirmed accessible for 2009–2025 by the Phase 0 audit — see
`context/research/data-audit.md`):

| View | Contents |
|------|----------|
| `mSettings` | League/season settings, including `status.finalScoringPeriod` (used to size the box-score loop — never hardcode a week count). |
| `mTeam` | Team/franchise records for the season. |
| `mStandings` | Standings. |
| `mMatchup` | Regular-season schedule/results. |
| `mMatchupScore` | Matchup scoring detail, including playoff bracket type. |
| `mDraftDetail` | Draft picks, including the `keeper` flag per pick. |
| `mRoster` | Rosters. |
| `kona_player_info` | Player pool/ownership data. |
| `mBoxscore` (per scoring period) | Daily box scores — one file per scoring period, `1..finalScoringPeriod`. |
| `mRoster` (per scoring period) | 2018 only, where `mBoxscore` carries no player detail. Always returns *season-end* rosters regardless of the period asked for, so it recovers daily stat lines but not day-accurate lineups. |
| `mTransactions2` (per scoring period) | **2019+ only** — ESPN's `leagueHistory` endpoint serves no transaction view for 2009–2018. A period file with no `transactions` key is a quiet day, not a gap. ESPN repeats the same transaction across several period files (235 times over 2019–2025), always byte-identically. |

## config.json fields

`config.json` is gitignored — copy `config.json.example` to `config.json` and fill in real
values. Never commit it or paste its contents anywhere (logs, issues, chat).

| Field | Meaning |
|-------|---------|
| `league_id` | ESPN fantasy league ID, from the league URL. |
| `espn_s2` | The `espn_s2` cookie from a logged-in ESPN session. Grants read access to the league; treat like a password. |
| `swid` | The `SWID` cookie, including its curly braces. Doubles as the account's member GUID — also treat like a credential. |
| `year_start`/`year_end` | Inclusive season range used by `scripts/audit.py` and `scripts/extract.py` when no `--years` override is passed. |

## Getting `espn_s2`/`SWID`

Log into fantasy.espn.com, open DevTools → Application (Chrome) or Storage (Firefox) →
Cookies → `fantasy.espn.com`, and copy the `espn_s2` and `SWID` values into `config.json`.
Cookies expire eventually — if a previously working run starts failing with an auth error,
re-grab them before debugging code.

## Manual mapping files

Hand-edited under `data/manual/`, read by `scripts/normalize.py`, never overwritten
wholesale by a script. See `context/research/schema-decisions.md` for why these are shaped
the way they are.

### `owner-map.json`

Maps every ESPN team/owner record (2009-present) to a canonical, cross-season `owner_id`.

- `owners[]` — one entry per real person: `owner_id` (kebab-case slug), `canonical_name`,
  `name_variants` (other first+last names ESPN has shown for this person, e.g. a nickname
  used before they set a real name), `_note` (hand-written context, or `null`).
- `team_seasons[]` — one entry per (year, ESPN team slot): `year`, `espn_team_id`,
  `team_name` (that year's team name), `owner_ids` (list — usually one, two for a genuine
  co-owned team), `primary_owner_id`, optional `_note`.

ESPN member IDs (SWIDs) are deliberately **not** stored here — see the file's own
`_readme` and `context/ai-interaction.md`'s credential-hygiene rules.

Since Phase 9.3b this file is **no longer the source of `owners.json`** — ESPN's own member
records are (`normalize.build_league_owners`). It survives as the *name-canonicalization*
layer that derivation depends on: ESPN's member records carry no stable canonical name, so
the first+last-name index is the join key. `validate.derive_owners_from_owner_map()` rebuilds
owner → team-names from it independently and asserts the two still agree.

### `pro-team-overrides.json`

Hand-verified `(year, player_id) -> pro_team_id` corrections. ESPN keeps a season's player
data mutable through the following offseason, so a player who changed MLB teams over a winter
can read with the wrong team in the older season's own file.

### `retired-owners.json`

`retired_owner_ids[]` — owners who have actually left the league. **Not derivable from ESPN
and not replaceable by it**: retirement is a real-world event, and an owner who leaves *after*
the newest archived season still appears in it. `owners.json`'s `absent_from_latest_season` is
about archive coverage, not retirement — this file is the authority. Synced to the app
directly by `sync-data.mjs`.

### `player-overrides.json`

Starts empty (`{"overrides": []}`). Grows only when `scripts/validate.py` catches an ESPN
player-ID inconsistency (the same real player under two different IDs). Each entry:
`player_id` (the ID to remap), `canonical_player_id` (the ID to remap it to), `_note`.

### `season-notes.json`

Per-season quirks and cross-cutting validation findings that `normalize.py`/`validate.py`
read instead of hardcoding. Grows as new findings surface.

- `seasons.{year}` — per-year facts (e.g. `"2020"`'s shortened-season structure,
  `"2014"`'s draft pick count anomaly, `"2018"`'s box-score coverage gap, `"2025"`'s
  Ohtani per-day pitching stat-block gap), each with a `_note` explaining what was found
  and how it was verified.
- `pre_2019_box_score_fidelity` — general note: pre-2019 box scores can't distinguish
  active from bench players, so PF reconciliation against them only runs 2019+.
- `keeper_validation_exceptions.exceptions[]` — every keeper that didn't validate against
  its prior-season roster, with what was found instead (`year`, `espn_team_id`,
  `player_id`, `player_name`, `found_on_prior_year_espn_team_id`).
- `unresolvable_draft_picks.player_ids[]` — draft picks whose player_id appears nowhere
  else in the raw archive, so `player_name` stays empty in `draft_picks.json`.

## Processed data dictionary

Everything under `data/processed/`, written by `scripts/normalize.py` from
`data/raw/` + `data/manual/`. Regenerate with `python scripts/normalize.py`; check with
`python scripts/validate.py`. Field shapes are defined once, as dataclasses, in
`scripts/lib/schema.py`.

Cross-season identity is always `owner_id` (a stable slug, e.g. `ryan-cooper`), not ESPN's
`espn_team_id` (a per-season slot ESPN reuses across different owners — see
`context/research/schema-decisions.md`). `year` is the season; ESPN's own numeric IDs
(`espn_team_id`, `matchup_id`, `player_id`) are kept alongside as a foreign key back into
`data/raw/`, not as the primary identity.

### `owners.json`

One entry per canonical owner (30 as of the full 2009-2025 archive):

| Field | Type | Meaning |
|---|---|---|
Derived from **ESPN's own member records** since Phase 9.3b, with `owner-map.json` supplying
canonical names. The first three fields are unchanged from the pre-cutover shape (proven
identical across all 30 owners before the switch); the rest are new.

| Field | Type | Meaning |
|---|---|---|
| `owner_id` | string | Stable slug, cross-season identity key. |
| `canonical_name` | string | Display name. |
| `team_names_by_year` | `{year: [name, ...]}` | Every team name this owner used, by year. |
| `espn_member_keys` | `[{member_key, years}]` | One entry per ESPN account this person used. `member_key` is a **salted SHA-256 hash** (16 hex chars) of ESPN's member id — that id *is* the SWID session cookie, so the raw value is never written to `data/processed/`. More than one entry means the owner changed ESPN accounts. |
| `co_owners` | `string[]` | `owner_id`s who ever shared a team-season with this owner. |
| `last_active_year` | int | Last season this owner fields a team in the archive. |
| `absent_from_latest_season` | bool | Whether `last_active_year` predates the newest season on file. **This is archive coverage, not retirement** — an owner who left *after* the newest archived season still reads as present. Use `retired-owners.json` for who has actually left. |

### `achievements.json`

One entry per league member per captured season — **2026+ only**. ESPN's "Fantasy
Achievements" trophies (Bronze Boss, Fortune Teller, Points Savage, … — 20 total,
awarded as they are earned) launched 2026-02-04; `seasonId` requests for any earlier
year return empty slots and the legacy `leagueHistory` endpoint 404s the sub-path, so
**there is no pre-2026 backfill and never will be**. Gate every display on
`seasons.json`'s `coverage.achievements`, not on this array's contents.

| Field | Type | Meaning |
|---|---|---|
| `year` | int | |
| `member_key` | string | Salted SHA-256 hash of the member's ESPN id (the SWID) — same credential rule as `owners.json`'s `espn_member_keys`; the raw value rides only in the request URL and the raw archive. |
| `owner_id` | string \| null | Canonical owner the member resolves to via `owner-map.json`'s name index. `null` means unresolved — validate's `achievements_linkage` check fails loudly, so a shipped null is a bug to fix, not a UI state. |
| `espn_team_id` | int \| null | The member's team that season, per the achievements payload's own `team` block. |
| `trophies` | `[{slot, earned}]` | ESPN's **fixed 20-slot per-member template** — one positional slot per trophy. The payload names no trophies and carries no ids, so slots stay positional: which slot is which trophy is pending the first observed earned slot (cross-check the ESPN app's display when it happens). Zero `earned` flags is the expected steady state, not a gap. |

Raw source: `data/raw/{year}/achievements-member{NN}.json` — one verbatim response per
`mTeam` member (the sub-path serves one member per request; the bare call rotates
arbitrarily). Captured daily by the heavy run while the season is in progress, frozen
once it's final. Because captures are cumulative snapshots, diffing consecutive days
derives earn dates later if that ever matters. Endpoint details:
`context/features/espn-trophies-activity-tray-spec.md`.

### `seasons.json`

One entry per year (2009-2025):

| Field | Type | Meaning |
|---|---|---|
| `year` | int | |
| `regular_season_weeks` | int | From `mSettings`'s `matchupPeriodCount` — never hardcoded (2020 was 8, not 21). |
| `playoff_weeks` | int | Total scheduled weeks minus `regular_season_weeks`. |
| `playoff_team_count` | int | |
| `playoff_brackets` | `string[]` | Distinct non-`NONE` `playoffTierType` values seen that year, e.g. `WINNERS_BRACKET`. |
| `divisions` | `[{division_id, name}]` | |
| `coverage` | `{family: "full"\|"partial"\|"missing"}` | Per data family (`teams`, `matchups`, `draft`, `rosters`, `players`, `box_scores`, `stat_lines`, `transactions`, `achievements`), not one flag per season — see schema-decisions.md. **Gate any all-time figure on this**: `transactions` is `"missing"` for 2009–2018, `stat_lines` is `"missing"` for 2009–2017, and `achievements` is `"missing"` for 2009–2025 (ESPN's trophies launched 2026-02-04 — there is no pre-2026 data to backfill). |
| `status` | `"in_progress"\|"final"` | From `mSettings`'s `status.currentMatchupPeriod` vs. its own scheduled matchup-period count (Phase 8). **Gate any all-time aggregate on `status === "final"`** — an `"in_progress"` season's totals are a snapshot, not a finished record. |
| `current_week` | int | `status.currentMatchupPeriod` as-is — the week a season-scoped scoreboard should default to. Not "the last week with a matchup row": ESPN pre-generates the full schedule's pairings upfront, so an in-progress season's *future* weeks already have placeholder (0-0, `UNDECIDED`) matchups before they're played. |
| `notes` | `string[]` | Any `season-notes.json` `_note` for this year. |
| `settings` | `{league_id, league_name, league_size, is_public}` | |
| `roster_rules` | object | `lineup_slot_counts` (slot-id-as-string → starters, zeros dropped), `position_limits` (position-id-as-string → max rostered, unlimited dropped), `bench_unlimited`, `move_limit`, `lineup_lock_time`, `roster_lock_time`, `using_undroppable_list`. `lineup_slot_counts` is byte-identical all 17 seasons; `position_limits` genuinely changed in 2010 and 2011, which is why these are stored per season. |
| `acquisition_rules` | object | `acquisition_type`, `waiver_hours`, `waiver_order_reset`, `waiver_process_days`, `waiver_process_hour`, `minimum_bid`, `using_acquisition_budget`, `acquisition_budget`, `acquisition_limit`, `matchup_acquisition_limit`, `transaction_locking_enabled`. This league has **never** used an acquisition budget — `using_acquisition_budget` is false and the budget is 0 in all 17 seasons. |
| `draft_settings` | object | `draft_type`, `order_type` (how the *order* was set, distinct from the format), `keeper_count`, `keeper_order_type`, `keeper_deadline_date` (epoch ms; absent for 2009), `auction_budget`, `time_per_pick`. |
| `trade_rules` | object | `deadline_date` (epoch ms; ESPN omits it in several seasons), `max_trades`, `revision_hours`, `veto_votes_required`. |

These five blocks (Phase 9.3a) are the programmatic replacement for hardcoded league rules.
They deliberately do **not** restate `regular_season_weeks`/`playoff_weeks`/
`playoff_team_count`/`divisions` — those come from the same `mSettings` payload and stay
where they are rather than being duplicated into a second source.

ESPN's "unlimited" sentinel (`-1`) is normalized to `null` throughout these blocks, so a
`null` limit means unlimited, not unknown.

### `teams.json`

One entry per (owner, season) — 170 as of the full archive:

| Field | Type | Meaning |
|---|---|---|
| `year`, `espn_team_id` | | |
| `owner_ids` | `string[]` | Usually one; two for a genuine co-owned team. |
| `primary_owner_id` | string | |
| `team_name` | string | That season's team name. |
| `division_id`, `final_rank`, `playoff_seed` | int | `final_rank` uses ESPN's `rankCalculatedFinal` (`rankFinal` is always 0 in this league's data — see schema-decisions.md). |
| `overall`, `home`, `away`, `division_record` | `{wins, losses, ties, points_for, points_against}` | **Regular season only** — ESPN's own `record.overall` excludes playoffs (verified empirically). |
| `streak_type`, `streak_length` | | Current streak as of `overall`. |
| `draft_day_projected_rank` | int \| null | Preseason projection. Real for **2021+ only**; `null` earlier. |
| `waiver_rank` | int \| null | Waiver priority as of the season's end. |
| `logo_url` | string \| null | Not set for every pre-2019 team. |
| `value_by_stat` | `{statId: count}` | Raw season stat **counts**, not fantasy points and *not* a decomposition of `points_for` — the counts cover every rostered player, bench included, so weighting them by that season's scoring lands ~7–16% above `points_for`. Empty for 2009–2018 (the `leagueHistory`-era `mTeam` omits it). Stat ids are named in `scripts/lib/stat_ids.py`. |
| `transactions` | object | See below. |

`transactions` (from ESPN's `transactionCounter`, present all 17 seasons): `acquisitions`,
`drops`, `trades`, `moves_to_active`, `moves_to_ir`, `acquisitions_budget_spent`,
`team_charges`, and `acquisitions_by_week` (week-as-string → count).

- `acquisitions_budget_spent` and `team_charges` are **always 0.0** — this league has never
  run a FAAB budget or charged fees through ESPN.
- `acquisitions` is **repaired** where ESPN's season scalar contradicts its own per-week
  totals: it is `max(scalar, sum(acquisitions_by_week))`. This affects **2018 only**, whose
  scalar reads 14 league-wide against 348 from the per-week data. `validate.py` re-reads
  `data/raw/` and warns on every repair, so the correction stays visible.
- `trades` counts a trade once **per participating team**, so two team-sides make one trade.
  It disagrees with `transactions.json`'s ledger in 5 of the 7 covered seasons; both are
  ESPN's own numbers.

#### In-season-only fields

`eliminated`, `elimination_matchup_period`, `points_adjusted`, `current_projected_rank`, and
`is_transaction_locked` are populated by ESPN **while a season is live** and reset once it
ends. Every row in the 2009–2025 archive therefore carries the reset value (`eliminated`
false, the ranks/periods `null`, `points_adjusted` 0.0). Treat a historical row's value as
ESPN's post-season reset, **not** as evidence about that season. They are captured because
Phase 8 runs this pipeline daily against an in-progress season, where they carry real values.

### `matchups.json`

One entry per regular-season or playoff matchup — 2016 as of the full archive:

| Field | Type | Meaning |
|---|---|---|
| `year`, `week`, `matchup_id` | | `matchup_id` is ESPN's own ID, stable across raw files for that matchup. |
| `playoff_tier` | string \| null | `null` for regular season (ESPN's `"NONE"` normalized away); otherwise `WINNERS_BRACKET`, `WINNERS_CONSOLATION_LADDER`, or `LOSERS_CONSOLATION_LADDER`. |
| `winner` | string | `HOME`, `AWAY`, `TIE`, or `UNDECIDED`. |
| `home` | `{owner_id, espn_team_id, score}` | |
| `away` | same \| null | `null` on a playoff bye. |

### `box_scores/{year}.json`

One entry per (player, matchup) — split by year, the largest processed files (up to ~8MB
for a modern season):

| Field | Type | Meaning |
|---|---|---|
| `year`, `week`, `matchup_id` | | |
| `owner_id`, `espn_team_id` | | The rostering team, not necessarily the winner. |
| `player_id`, `player_name` | | |
| `total_points` | float | Full rostered production — everything the player scored while on this fantasy roster during matchup periods, started slots and bench/IR days alike (= that line's counted part + its bench/IR slot contribution; the same basis as `player_season_points.json`'s `points`). The counted part anchors to the line's latest cumulative snapshot (`rosterForMatchupPeriod` — counted-only, summing exactly to ESPN's official matchup score) or, for a line with no snapshot, to its own active slots. ESPN's official matchup score itself is counted-only: filter `slots` to `lineup_slot_id` ∉ {16,17} and sum — what `validate.py`'s `pf_box_score_reconciliation` and the app's counted views compute. |
| `slots` | `[{scoring_period, lineup_slot_id, points, raw_stats}]` | Per-day breakdown, 2019+ only meaningfully distinguishes active vs. bench (slot 16/17) — pre-2019 entries all carry `lineup_slot_id: 0` and one synthetic `slots` entry per matchup (ESPN doesn't expose per-day granularity for that era). See `pre_2019_box_score_fidelity` in `season-notes.json`. `raw_stats` (`{stat_id_str: count}`) is internal bookkeeping the live-patch job uses to replace a same-day slot without double-counting — not meant for display, and absent on slots written before it existed. |

**Counted vs. bench semantics:** slots carry *real* per-day production on bench/IR-labeled
entries too, and `total_points` includes it — a player's slot sums equal their
`total_points`. Consumers after ESPN's official matchup score must filter `lineup_slot_id`
16/17 before summing (`app/src/lib/boxScore.ts` helpers already do); that filtered sum is
what `validate.py`'s `pf_box_score_reconciliation` and `box_score_day_reconciliation`
checks assert against. Day attribution for the in-progress season uses the same
capture-regime detection as completed seasons (frozen cumulative = backfilled, daily
blocks authoritative; advancing = live capture, deltas authoritative). Small documented
residuals for weeks 18–19 of 2026 (mixed-regime stitch + late ESPN stat revisions) live in
`season-notes.json`'s `"2026"` entry, pinned by validate.py. The newest week's raw captures
predate ESPN's post-revision finals, so its slots may drift a few points (one week-21 2026
row's `total_points` exceeds its slot sum by 3.1) until the next in-season refresh —
validate.py's live-week exemption tolerates that window by design.

2018 is `coverage.box_scores: "partial"` (6,528 rows), recovered from per-period `mRoster`
rather than `mBoxscore`. Because that view always returns *season-end* rosters regardless of
the period asked for, 2018's daily stat lines are real but its lineup slots are **not
day-accurate** — mid-season movers are unrecoverable. See `season-notes.json`'s `"2018"`
entry.

### `draft_picks.json`

One entry per pick, every draft — 5,099 as of the full archive (not a clean
10 x 30 x 17 = 5,100; see `traded_pick` below):

| Field | Type | Meaning |
|---|---|---|
| `year`, `overall_pick_number`, `round_id`, `round_pick_number` | | |
| `espn_team_id`, `owner_id` | | |
| `player_id`, `player_name` | | `player_name` is empty for a small number of unresolvable picks — see `unresolvable_draft_picks` in `season-notes.json`. |
| `keeper` | bool | ESPN's own `keeper` flag on the pick — authoritative, not inferred from round number. |
| `traded_pick` | bool | True when the exercising team differs from the pick's original round slot (2014 has one such pick — see `season-notes.json`). |
| `pro_team_id` | int \| null | The player's real MLB team **for that draft year specifically** — looked up in that same year's `kona_player_info.json`, not merged across years (see "Player-MLB franchise data" below). `null` for the small number of deep-bench picks not in that year's kona snapshot (~500-player cap) — see `unresolvable_draft_picks`/coverage note in `season-notes.json`. Resolve to a name/abbreviation via `mlb_teams.json`. |

### `keepers.json`

Derived: every draft pick with `keeper: true` — one season × 10 teams × 5 rounds, minus exceptions (849 as of the 2026 archive):

| Field | Type | Meaning |
|---|---|---|
| `year`, `espn_team_id`, `owner_id` | | |
| `player_id`, `player_name`, `round_id`, `overall_pick_number` | | |
| `validated_on_prior_roster` | bool | True if `player_id` was on this `espn_team_id`'s roster at the end of the prior season. 20 documented `false` exceptions (in-season trades/pickups, not rule violations) are listed in `season-notes.json`'s `keeper_validation_exceptions`. |
| `pro_team_id` | int \| null | Same as `draft_picks.json`'s field — that keeper year's real MLB team. All keepers resolve (kona's ~500-player cap never excludes an actual keeper-quality player in this archive). A player kept across multiple years whose real team changed will show a different `pro_team_id` per year — e.g. Freddie Freeman: ATL 2013-2020, `0` (no team on file, his free-agency window) 2021, LAD 2022-2025. |

### `players.json`

Cross-season player identity, merged from every raw view that embeds a player object
(`kona_player_info`, `mRoster`, box scores — no single view lists every player who ever
appeared):

| Field | Type | Meaning |
|---|---|---|
2,010 entries as of the full archive. Everything here is a **career-level** value — the
per-season breakdown is `player_seasons.json`.

| Field | Type | Meaning |
|---|---|---|
| `player_id` | int | ESPN's numeric ID, remapped through `player-overrides.json` if an override exists. |
| `full_name` | string | Most-recently-seen value. |
| `default_position_id` | int | Career-level primary position. Non-null for all 2,010 players (`validate.py`'s `player_positions` asserts it). For a given year use `player_seasons.json`'s. |
| `eligible_slots` | `int[]` | Union across `seasons_seen`. ESPN slot ids run **0–22** — slot 0 is catcher, so 0 is real, not a sentinel. |
| `games_played_by_position` | `{positionId: games}` | Career games at each position, summed per season. Legitimately exceeds 162 per season: ESPN counts a player at *every* position he appears at in a game, and pre-2015 counts fold in postseason games (2009 Robinson Cano: 176 at 2B). |
| `active`, `pro_team_id`, `jersey`, `droppable` | | **Latest-season-wins, not career facts** — they describe the player as of the most recent season he appears in. `jersey` is a string and is absent before 2017. |
| `seasons_seen` | `int[]` | Years this player appeared in any source. |
| `roster_days` | int | Distinct `(year, scoring_period)` days rostered. **2019+ only** — earlier eras have no per-day rosters to count. |

`pro_team_id` here is **not** the team a player played for in any given past year — see
"Player-MLB franchise data" below. For per-year truth use `draft_picks.json`/`keepers.json`.

### `player_seasons.json`

Per-player-per-season eligibility, health, and market value — the year-by-year counterpart to
`players.json`'s career aggregates. 8,039 entries. Built from `kona_player_info` (ESPN's top
~500 by ownership) plus `mRoster`, which adds rostered players outside that cap.

| Field | Type | Meaning |
|---|---|---|
| `year`, `player_id`, `player_name` | | |
| `eligible_slots` | `int[]` | That season's slots, not the career union. |
| `games_played_by_position` | `{positionId: games}` | That season only. Keyed by *position* id (1=SP, 2=C … 10=DH, 11=RP, 12=PH), a different id space from `eligible_slots`. The app excludes 12 from its position displays — a pinch-hit appearance is not a fielding position. |
| `default_position_id` | int | That season's PRIMARY position. Present for **every row in all 17 seasons** — `validate.py`'s `player_positions` check asserts this, because the app types it non-nullable. Per-season on purpose: a player's primary position moves over a career, so `players.json`'s career-level value is the wrong thing to show against a given year. |
| `jersey` | string \| null | **2017+ only.** ESPN's player payload carries no jersey at all for 2009–2016, so `null` there means "not reported", never "no number". A string, not an int. |
| `injury_status` | string \| null | Status as of ESPN's last update to that season's data, i.e. roughly season-end — **not** "was injured during this season". Observed: `ACTIVE`, `DAY_TO_DAY`, `OUT`, `SUSPENSION`, `TEN_DAY_DL`. `null` before 2017, where ESPN's payload carries no injury status at all (absent and healthy stay distinguishable). |
| `injured` | bool \| null | |
| `ownership` | object \| null | See below. `null` if no view that year carried one. |
| `pro_team_id` | int \| null | That season's real MLB team, same per-year truth as `draft_picks.json`/`keepers.json`'s field (0 = no team on file, e.g. a late-offseason free agent — see that section's Freddie Freeman example). `null` only for a player outside both `kona_player_info`'s ~500-cap and that year's `mRoster`. Falls back for players with no draft pick that season (waiver/free-agent adds) where `draft_picks.json` has nothing to report. |

`ownership` is **cross-league, not this league**: `percent_owned`, `percent_started`,
`percent_change`, `average_draft_position`, `average_draft_position_percent_change`,
`auction_value_average`, `auction_value_average_change` are averaged over every ESPN fantasy
baseball league of this type. That is what makes them useful — a high-scoring, low-
`percent_owned` player is a genuine waiver steal. They are **not** derived from this league's
10 rosters, and ADP is present for undrafted players too. ESPN's "no value" sentinels
(`0.0`, `9999.0`, `-1`) are normalized to `null`.

Verified per-season-accurate rather than a present-day snapshot: Albert Pujols reads 100%
owned 2009–2012 and 8.9% by 2020; Derek Jeter disappears after his 2014 retirement.

### `player_season_points.json`

Derived: total box-score points a player produced in a season, summed across every team he
appeared for that year (so an in-season trade doesn't split his production into two rows).
7,730 entries. Fields: `year`, `player_id`, `player_name`, `points`, `counted_points`,
`bench_points`.

`points` is the sum of box_scores' `total_points` — rostered production: everything the
player scored while on a fantasy roster during matchup periods, started slots and bench/IL
days alike (`counted_points` + `bench_points`). ESPN's player card counts all real-world
production and can legitimately run higher: it adds games played outside the matchup
calendar (free-agent days — Ohtani 2026: card 475.0 vs 426.7 here) and two-way pitching
that never occupied a roster slot (Ohtani 2025: card 567.7 vs 471.3). The card basis is
available after all — every season's kona snapshot carries its own `(statSourceId 0,
statSplitTypeId 0)` full-season block, harvested into `card_points.json` below — so the
app's season points columns show the card total with the rostered share beside it (see
`app/src/lib/ptsSemantics.ts` for the remaining counted-base hover notes).

Exists so consumers don't re-derive it from `box_scores/*.json`, which run tens of MB across
all years combined.

### `player_team_season_points.json`

The per-owner split behind `player_season_points.json` — one row per (player, team) that
scored in a season. 9,491 entries. Fields: `year`, `player_id`, `player_name`, `owner_id`,
`espn_team_id`, `points`, `counted_points`, `bench_points` (same semantics as
`player_season_points.json`'s).

Exists because *"what did this player score that year"* and *"what did this player produce
for the manager who acquired him"* are different questions, and only the second is a record
about a manager. **1,411 of the archive's 7,730 player-seasons are split across more than
one owner**, so for those the season total credits production a given manager never received.

Derived from the same box-score pass as `player_season_points.json`, which is its exact
roll-up — `validate.py`'s `player_team_points` check asserts that in both directions.

### `card_points.json`

ESPN's full-season player-card totals — everything the player scored in real life under
the league's scoring, rostered days and free-agent days alike. 7,723 entries. Fields:
`year`, `player_id`, `player_name`, `card_points`. Harvested from each kona snapshot's
own `(statSourceId 0, statSplitTypeId 0)` full-season block (round 2), one row per
`(year, player)` key present in `player_season_points.json`; later kona files win for
overlapping seasons, same convention as the backfill. Missing rows mean ESPN reported
no season block (e.g. season-long injuries) — consumers fall back to rostered points,
never to zero. No card-vs-rostered inequality is asserted (negative pitching breaks it
in both directions); `validate.py`'s `card_points` check asserts resolution,
uniqueness, and per-season presence. The in-progress season is season-to-date and moves
with each daily refresh, like all live data.

### `transactions.json`

The league's add/drop/trade ledger — 3,143 rows. **Coverage is 2019–2025 only**, 7 of the
archive's 17 seasons; check `seasons.json`'s `coverage.transactions` before presenting any
figure as all-time.

| Field | Type | Meaning |
|---|---|---|
| `year` | int | |
| `transaction_id` | string | ESPN's own uuid. |
| `transaction_type` | string | ESPN's vocabulary: `FREEAGENT`, `ROSTER`, `TRADE_PROPOSAL`, `TRADE_ACCEPT`, `TRADE_DECLINE`, `TRADE_UPHOLD`, `TRADE_VETO`. |
| `scoring_period_id` | int | A **day** in this daily-scoring league, not a week. |
| `week` | int \| null | Matchup week the day fell in. `null` for 68 rows on preseason days, the All-Star gap, and post-season-end periods. |
| `proposed_date` | int \| null | Epoch ms. `null` on ~236 rows ESPN serves without a date (mostly 2020); those rows drop the acting member too. |
| `espn_team_id`, `owner_id` | | The acting team. |
| `acting_member_key` | string \| null | Salted hash identifying **which co-owner** acted on a shared team. Never a raw ESPN member id (that id is the SWID cookie). Joins against `owners.json`'s `espn_member_keys`. |
| `status` | string \| null | `EXECUTED`, `CANCELED`, `PENDING`. Absent on some trade rows. |
| `is_league_manager` | bool | Commissioner acting on a team's behalf. |
| `related_transaction_id` | string \| null | Links a `TRADE_ACCEPT`/`DECLINE` back to the `TRADE_PROPOSAL` it answers. |
| `bid_amount` | float | Always 0 — this league has never used an acquisition budget. |
| `items` | `[{player_id, item_type, from_espn_team_id, to_espn_team_id, from_lineup_slot_id, to_lineup_slot_id}]` | One per player movement. `item_type` is `ADD`, `DROP`, `TRADE`, or `LINEUP`. ESPN's team-id `0` ("free agency") and lineup-slot `-1` ("not on a lineup") are normalized to `null`; slot `0` is a real slot (catcher) and is preserved. |

#### Trades: the ledger loses most player exchanges on execution; two fixes cover it

**ESPN prunes a `TRADE_PROPOSAL` once it executes.** The surviving `TRADE_ACCEPT`/
`TRADE_UPHOLD` row usually carries only the collateral roster drops, not the player exchange.
Of the **11 executed trades in 2019–2025 with a real `TRADE_UPHOLD` row, exactly 2 still carry
their `TRADE` items directly in this file** (ESPN occasionally echoes the item list onto a
`TRADE_ACCEPT` row too, surviving even when the proposal itself was purged). This file
(`transactions.json`) itself is not further reconstructed — that only happens downstream, in
`trades.json`. `validate.py` warns on every affected trade so the gap stays visible here.

**Fixed for 2026 onward (Phase 8 trade-capture spec):** the daily live-update job now captures
`mTransactions2` once a day and relays it into `data/raw/{year}/mTransactions2-daily-
{YYYYMMDD}.json` (see the Layout section above) specifically to catch a `TRADE_PROPOSAL`'s
player list before ESPN purges it — the 48-hour mandatory trade-review window
(`seasons.json`'s `trade_rules.revision_hours`) comfortably beats the once-a-day cadence.

**Backfilled for the other 9 of 2019–2025 (Phase 8 trade-backfill-reconstruction spec):**
recovered by diffing raw per-period rosters (`mBoxscore-period{N}.json`) across each trade's
execution boundary — not gated on player activity, so an inactive traded player still shows up,
unlike `data/processed/box_scores/{year}.json`'s week-grain, activity-gated rows. Two trades
between the same team pair days apart are disambiguated by bounding each trade's search to stop
at the other's execution period, so neither one's roster diff bleeds into the other. See
`trades.json` below for the result, including its `source` field (`ledger` vs. `box_score_diff`)
per item. One further 2021 trade has only a single `TRADE_ACCEPT` row on file (no `TRADE_UPHOLD`
at all), so neither the ledger nor the backfill can resolve it — genuinely unrecoverable. Adds
and drops were never affected by any of this — their `items` are complete, and there are 2,818
free-agent moves.

#### What is deliberately not here

- **`FUTURE_ROSTER`** — routine start/sit lineup shuffling, 11,619 of the 17,097 raw rows
  (68%). Roster bookkeeping, not league activity; it would bury every real add, drop, and
  trade.
- **`DRAFT`** — `draft_picks.json` is the source of truth for picks and carries more (keeper
  flags, pick values). Storing both would mean two sources to reconcile at read time.

`validate.py` counts both per year and reconciles the dropped `DRAFT` rows against
`draft_picks.json` (300 = 300 in every covered year), so nothing is silently lost.

#### Player ids that resolve to nothing

**7 player ids across 2019–2025 appear only in this file** — never in `kona_player_info`,
`mRoster`, or any box score, in any year. They were added and dropped without ever making a
season-end roster or scoring, so their names are unrecoverable and `players.json` cannot
carry them (a player row needs a name). **The app must tolerate an item whose `player_id`
joins to nothing.**

### `trades.json`

Every executed trade — one row per trade. Built by `scripts/normalize.py`'s `build_trades`:
groups `transactions.json`'s `TRADE_*` rows by `related_transaction_id`, keeps a group only if
it contains a `TRADE_UPHOLD` (executed, not vetoed/declined/canceled), and resolves the player
exchange in two stages: first the ledger (the `TRADE_PROPOSAL`'s own items, or a `TRADE_ACCEPT`
row ESPN happened to echo them onto), then — only if neither survived — a box-score roster diff
across the trade's execution period (`_reconstruct_trade_items`, 2019–2025 only; see the
Trades section under `transactions.json` above and `context/features/phase-8-trade-backfill-
reconstruction-spec.md`). One 2021 trade has no `TRADE_UPHOLD` row at all and is absent from
this file entirely — never dropped silently, `validate.py`'s `check_trades` cross-references it
against `transactions.json`.

| Field | Type | Meaning |
|---|---|---|
| `year` | int | |
| `trade_id` | string | The originating `TRADE_PROPOSAL`'s `transaction_id` — stable, joins back to `transactions.json`. |
| `proposed_date` | int \| null | Epoch ms, from the `TRADE_PROPOSAL` row. `null` when that row wasn't recoverable (pre-2026, no daily capture). |
| `executed_date` | int | Epoch ms, from the `TRADE_UPHOLD` row — always present. |
| `team_a_espn_team_id`, `team_a_owner_id` | | One side of the trade. |
| `team_b_espn_team_id`, `team_b_owner_id` | | The other side. Team/owner attribution comes from the proposal's own items when available, falling back to the surviving `TRADE_ACCEPT`/`TRADE_UPHOLD` rows' team fields otherwise — both sources agree on the same two teams in every trade seen. |
| `acting_member_key` | string \| null | Whoever proposed the trade. Same salted-hash convention as `transactions.json`. |
| `items` | `[{player_id, item_type, from_espn_team_id, to_espn_team_id, from_lineup_slot_id, to_lineup_slot_id, source}]` | The full player exchange (plus any collateral `DROP`s). `source` is `"ledger"` (ESPN's own record) or `"box_score_diff"` (recovered from roster movement — see above), added to every item regardless of origin. Empty only for the one trade neither source resolves. `year >= 2026` with empty `items` is a `validate.py` failure, not just a warning, since the daily capture is supposed to guarantee recovery going forward; the 2019–2025 backfill has no such hard requirement since a handful of roster diffs may someday fail to resolve cleanly. |

### `mlb_teams.json`

Static reference table, `scripts/lib/mlb_teams.py`: one entry per ESPN `proTeamId` (0-30).

| Field | Type | Meaning |
|---|---|---|
| `pro_team_id` | int | Joins against `draft_picks.json`/`keepers.json`'s `pro_team_id`. |
| `abbrev` | string | e.g. `"LAD"`. `0` is `"FA"` — not a real team, see below. |
| `name` | string | e.g. `"Los Angeles Dodgers"`. |

#### Player-MLB franchise data

`pro_team_id` is resolved **per draft/keeper year**, from that year's own
`kona_player_info.json`, not merged across seasons. This matters: ESPN doesn't version a
player's team historically within a single response, but each year's own file genuinely
reflects that season's real team (verified against known movement — e.g. Albert Pujols
correctly shows STL 2009-2011, then LAA for all nine of his Angels seasons 2012-2020, not
just his first year there, then STL again in 2022, his final season). A merged
"most-recently-seen" value (which is what `players.json` uses for `full_name`) would be
actively wrong here — e.g. it would show every one of Pujols' STL and LAA seasons alike as
whichever team was seen last. `0` (`"FA"`) means that year's player-pool snapshot had no
MLB team on file for that player (offseason movement, free agency, etc. at the moment
ESPN's data was captured) — a real, expected artifact of the source, not an error to fix.
