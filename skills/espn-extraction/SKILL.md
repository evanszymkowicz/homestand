---
name: espn-extraction
description: Use whenever writing or running code that calls ESPN's fantasy API (audit script, extraction scripts, probing endpoints). Covers credentials, endpoint era-split, known API traps, politeness, and archive discipline for this league (flb, est. 2009, 10 teams).
---

# ESPN Extraction Checklist

Follow this whenever code touches `lm-api-reads.fantasy.espn.com` or the `espn-api` package.

## Credentials

- `espn_s2` + `SWID` come from the gitignored `config.json` — never hardcoded, never from
  editing source. Verify `git check-ignore config.json` passes before the first run.
- `SWID` keeps its curly braces; the cookie name is uppercase `SWID`. A truncated `espn_s2`
  paste is the most common silent auth failure.
- Cookies must never appear in logs, exceptions, saved responses' filenames, or emitted
  reports. On request errors, log the URL and status — never the headers.
- Cookies expire eventually. If a previously working script starts failing auth, re-grab
  cookies before debugging code.

## Requests

- Game key is `flb` (baseball) — most online examples use `ffl` (football).
- Era split: `seasons/{year}/segments/0/leagues/{id}?view={view}` for 2018+;
  `leagueHistory/{id}?seasonId={year}&view={view}` for ≤2017, whose response is a
  single-element list — unwrap with `[0]`.
- `espn-api` package: `from espn_api.baseball import League`, then
  `League(league_id=..., year=..., espn_s2=..., swid=...)`. It is the primary path but is
  spottier for old seasons — raw `requests` with a cookies dict
  (`{'espn_s2': ..., 'SWID': ...}`) and `Accept: application/json` is the secondary path.
- `mBoxscore` is per scoring period (`scoringPeriodId` param). Sample periods 1 /
  mid-season/final — never loop all ~180 days.
- `kona_player_info` requires an `X-Fantasy-Filter` header to limit results, or the
  response is enormous.
- **Live-week response shape is not stable mid-season.** ESPN can change the in-progress
  week's mBoxscore payload without notice (2026-08: a `rosterForMatchupPeriodDelayed`
  block appeared alongside `rosterForMatchupPeriod`, and per-player week-to-date
  `playerPoolEntry.appliedStatTotal` stopped tracking the daily blocks -- one player's
  froze at day-1 while others advanced). Never assume the cumulative snapshot advances
  day-to-day; normalize's snapshot anchoring + validate's gates treat undecided-week lines
  as provisional (see validate.py `_undecided_weeks`) and re-capture via
  `--refresh-decided-weeks` once the week decides.
- **Achievements ("Fantasy Achievements" trophies) are a sub-path, not a view.** 2026+
  only (launched 2026-02-04; `leagueHistory` 404s it, and `seasonId` for earlier years
  returns empty). `GET .../seasons/{year}/segments/0/leagues/{id}/achievements` serves ONE
  member per call and rotates members arbitrarily between calls; the per-member form
  `/leagues/{id}/members/{memberSwid}/achievements` pins one (the SWID comes from
  `mTeam`'s `members[].id` — URL-only, never persisted). Payload: `{member, team,
  achievements: [20 slots], seasonIds}` — unearned slots are empty `{}`; unknown `view=`
  names return the default league payload (byte-identical), so view-name guessing proves
  nothing. Extracted daily by extract.py's heavy run; spec:
  `context/features/espn-trophies-activity-tray-spec.md`.

## The 200-with-empty trap

ESPN often returns HTTP 200 with a stub/empty structure for seasons you can't access.
Status codes prove nothing — always apply a data-signal heuristic (`len(teams) == 10`,
non-empty `draftDetail.picks`, matchup count > 0) and record status + size + signal per
year × view. For 2009–2018 (owner joined 2019), record the *exact* failure shape — those
notes feed the commissioner runbook (written at the end of Phase 1 for the Group B
capture; the merge itself is Phase 7).

## Politeness

Sequential requests with a 0.5–1s sleep between them. Retry once or twice with backoff on
429/5xx; a persistent 401/403 means stop and check cookies, not retry harder.

## Archive discipline

- Save the raw response bytes verbatim to `data/raw/{year}/{view}.json` (Phase 0:
  `data/audit/{year}/{view}.json`) **before** any inspection or parsing.
- Never overwrite or edit an existing raw file — the archive is write-once (the git
  pre-commit hook in `.githooks/pre-commit` blocks manual edits/overwrites of existing raw
  files; scripts should refuse to clobber too).
- Sanity-check with one known-good call (e.g. current-year `mTeam`, expect 10 teams)
  before running any loop.

## League-specific facts

- 10 teams every season; keepers are draft rounds 1–5 (validate, don't assume).
- 2020 is a shortened MLB season — never hardcode week counts; record 2020's actual
  structure when encountered.
