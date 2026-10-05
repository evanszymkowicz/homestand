#!/usr/bin/env python3
"""Validation suite for data/processed/ — run after every scripts/normalize.py.

Usage:
    python scripts/validate.py

Checks the invariants from context/features/phase-2-normalization-spec.md.
Failures are the deliverable, not an annoyance: each one is a bug that would
otherwise reach the league's eyes. Exits non-zero if any check fails.
"""

import json
import re
import sys
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.mapping import derive_owner_ids_from_raw, load_owner_map
from lib.box_score_lines import slot_split
from lib.espn_client import TRADE_CAPTURE_START_YEAR, unwrap_league_object
from lib.mlb_teams import MLB_TEAMS
from lib.stat_ids import BATTING_STAT_IDS, PITCHING_STAT_IDS

REPO_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = REPO_ROOT / "data" / "raw"
MANUAL_DIR = REPO_ROOT / "data" / "manual"
PROCESSED_DIR = REPO_ROOT / "data" / "processed"

# 2019 is the first year data/raw box scores carry a real per-day lineup slot
# (rosterForCurrentScoringPeriod) instead of a slot-less full-roster dump
# (rosterForMatchupPeriod, always lineupSlotId=0) -- see data/manual/
# season-notes.json's pre_2019_box_score_fidelity note for how this was found.
MODERN_BOX_SCORE_START_YEAR = 2019
BENCH_AND_IR_SLOTS = {16, 17}
PF_TOLERANCE = 0.5
# A handful of 2021/2022/2024 team-seasons are off by up to ~2.4 points (out of
# thousands) between box-score-derived PF and the team record -- consistent
# with ESPN applying a late stat correction to the day-by-day box score after
# the team-record snapshot was already final. Reconciliation still runs at
# PF_TOLERANCE; only this looser, separately-reported threshold treats that
# residual as expected rather than a failure worth listing individually.
PF_BOX_SCORE_TOLERANCE = 3.0
# Per-day slot sums vs ESPN's official pointsByScoringPeriod scores: exact
# placement by construction, so only float drift should separate them. Loose
# enough for accumulated float noise, tight enough that any real day-level
# misattribution (the wk21 clobber was off by tens team-wide) fails loudly.
BOX_SCORE_DAY_TOLERANCE = 2.0
# How far a documented revision gap (season-notes.json's
# box_score_revision_gaps.active_slot_gap_pt) may drift from its recorded
# value before the documentation is considered stale. Small drift is expected:
# ESPN keeps applying late stat corrections to captured weeks. Beyond this,
# refresh the documented amounts from a fresh normalize run.
REVISION_GAP_DRIFT_TOLERANCE = 2.0
# Stat lines recompute a line's fantasy points exactly (integer counts x that
# season's per-unit points), so the tolerance only absorbs the 2-decimal
# rounding of total_points plus float error -- far tighter than the team-level
# thresholds above.
STAT_LINE_TOLERANCE = 0.05


# --- Phase 9.1 enrichment bounds -------------------------------------------
# ESPN lineup-slot ids observed across the whole 2009-2025 archive. 0 (C) is
# real, so this range starts at 0 -- not the 1-25 the Phase 9 spec guessed.
MAX_LINEUP_SLOT_ID = 22
# Per-position games in a single season, well clear of the 162-game regular
# season. ESPN counts a player at every position he appears at in a game, so
# these counts are not bounded by games played the way a naive 162 assumes;
# postseason games fold into the pre-2015 counts on top of that (2009 Robinson
# Cano, 176 at 2B, is the archive's real maximum). Deliberately loose: this is
# a warn that should only fire on corruption -- a career total collapsed into
# one season, or an accidental multiplier -- not on a legitimately busy year.
MAX_GAMES_PER_POSITION_PER_SEASON = 250
# valuesByStat only exists from 2019; the leagueHistory-era mTeam omits it.
VALUE_BY_STAT_START_YEAR = 2019
# Weighting a team's valuesByStat counts by that season's scoring must land at
# or above points_for (the counts include bench players, who score no team
# points) but not wildly above it. Measured spread across 2019-2025 is
# +7.4% to +15.9%; the ceiling leaves headroom before it means something broke.
VALUE_BY_STAT_MIN_RATIO = 1.0
VALUE_BY_STAT_MAX_RATIO = 1.5
# For an in-progress season, Phase 8's daily job live-patches points_for
# (scripts/sync_live_scoreboard.py's patch_team_records, re-derived from
# matchups.json) but leaves value_by_stat untouched -- that field comes from
# ESPN's own mTeam response, refreshed only by the weekly full rebuild. That
# gap can legitimately push the ratio under the archived-season floor above;
# observed as low as 0.97x this session. This floor is deliberately looser,
# not the box-score reconciliation itself -- a genuine corruption would still
# show up in wl_reconciliation or the box-score checks.
VALUE_BY_STAT_IN_PROGRESS_MIN_RATIO = 0.9

# --- Phase 9.2 enrichment bounds -------------------------------------------
# A real average draft position, once ESPN's 0.0 / 9999 "no ADP" sentinels have
# been normalized to None. Generous: ESPN's ADP pool spans far more players than
# any one league drafts, so deep values in the hundreds are ordinary.
MAX_PLAUSIBLE_ADP = 1000.0

# --- Phase 9.4 / player-card bounds ----------------------------------------
# ESPN's player payload carries no jersey at all before this season; 2009-2016
# read null for every player, which is "not reported", never "no number".
JERSEY_START_YEAR = 2017


@dataclass
class Failure:
    check: str
    detail: str
    # "warn" findings print but don't fail the run: they flag data worth a look
    # (an ESPN value outside its expected band) rather than a broken invariant.
    level: str = "error"


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Corrupt JSON in {path}: {exc}") from exc


def derive_owners_from_owner_map(owner_map: Any) -> list[dict[str, Any]]:
    """Rebuilds owner_id -> team_names_by_year straight from owner-map.json's
    team_seasons, independent of anything normalize.py wrote.

    This is the Source-of-Truth Rule's rule 4 for the Phase 9.3b cutover: the
    hand-maintained file stopped being the source of owners.json, so the
    comparison it used to win by default has to be kept explicitly. (A
    normalize.py twin of this derivation existed until the 2026-08 pipeline
    review removed it as dead code; owners.json itself comes from
    build_league_owners().)
    """
    by_owner: dict[str, dict[str, list[str]]] = {}
    for (year, _team_id), entry in owner_map.team_seasons.items():
        for owner_id in entry["owner_ids"]:
            names = by_owner.setdefault(owner_id, {}).setdefault(str(year), [])
            if entry["team_name"] not in names:
                names.append(entry["team_name"])
    return [
        {
            "owner_id": owner_id,
            "team_names_by_year": dict(sorted(by_owner.get(owner_id, {}).items())),
        }
        for owner_id in sorted(owner_map.owners_by_id)
        if by_owner.get(owner_id)
    ]


def load_processed() -> dict[str, Any]:
    box_scores: dict[int, list[dict[str, Any]]] = {}
    for path in sorted((PROCESSED_DIR / "box_scores").glob("*.json")):
        box_scores[int(path.stem)] = load_json(path)
    return {
        "owners": load_json(PROCESSED_DIR / "owners.json"),
        "achievements": load_json(PROCESSED_DIR / "achievements.json"),
        # Same file. Two keys because check_league_owners compares the shipped
        # (ESPN-derived) owners against an independent re-derivation from
        # owner-map.json, built below.
        "league_owners": load_json(PROCESSED_DIR / "owners.json"),
        "retired_owner_ids": load_json(MANUAL_DIR / "retired-owners.json")[
            "retired_owner_ids"
        ],
        "seasons": load_json(PROCESSED_DIR / "seasons.json"),
        "teams": load_json(PROCESSED_DIR / "teams.json"),
        "matchups": load_json(PROCESSED_DIR / "matchups.json"),
        "draft_picks": load_json(PROCESSED_DIR / "draft_picks.json"),
        "keepers": load_json(PROCESSED_DIR / "keepers.json"),
        "players": load_json(PROCESSED_DIR / "players.json"),
        "player_seasons": load_json(PROCESSED_DIR / "player_seasons.json"),
        "player_season_points": load_json(PROCESSED_DIR / "player_season_points.json"),
        "player_season_ownership": load_json(
            PROCESSED_DIR / "player_season_ownership.json"
        ),
        "player_team_season_points": load_json(
            PROCESSED_DIR / "player_team_season_points.json"
        ),
        "card_points": load_json(PROCESSED_DIR / "card_points.json"),
        "player_season_backfill": load_json(
            PROCESSED_DIR / "player_season_backfill.json"
        ),
        "transactions": load_json(PROCESSED_DIR / "transactions.json"),
        "trades": load_json(PROCESSED_DIR / "trades.json"),
        "box_scores": box_scores,
        "jersey_history_overrides": load_json(
            MANUAL_DIR / "jersey-history-overrides.json"
        )["overrides"],
        "pro_team_overrides": load_json(MANUAL_DIR / "pro-team-overrides.json")[
            "overrides"
        ],
    }


# --- checks -----------------------------------------------------------------


def check_team_counts(data: dict[str, Any]) -> list[Failure]:
    failures = []
    teams_by_year: dict[int, list[dict[str, Any]]] = {}
    for t in data["teams"]:
        teams_by_year.setdefault(t["year"], []).append(t)

    for season in data["seasons"]:
        if season["coverage"]["teams"] != "full":
            continue
        year = season["year"]
        year_teams = teams_by_year.get(year, [])
        if len(year_teams) != 10:
            failures.append(
                Failure("team_counts", f"{year}: {len(year_teams)} teams (expected 10)")
            )
            continue
        by_division: dict[int, int] = {}
        for t in year_teams:
            by_division[t["division_id"]] = by_division.get(t["division_id"], 0) + 1
        for division_id, count in by_division.items():
            if count != 5:
                failures.append(
                    Failure(
                        "team_counts",
                        f"{year}: division {division_id} has {count} teams (expected 5)",
                    )
                )
    return failures


def check_standings_ranks(data: dict[str, Any]) -> list[Failure]:
    failures = []
    seasons_by_year = {s["year"]: s for s in data["seasons"]}
    teams_by_year: dict[int, list[dict[str, Any]]] = {}
    for t in data["teams"]:
        teams_by_year.setdefault(t["year"], []).append(t)
    for year, year_teams in sorted(teams_by_year.items()):
        # final_rank is a clean 1..N permutation only once a season is over —
        # an in-progress season's rank is live/provisional (Phase 8).
        if seasons_by_year.get(year, {}).get("status") == "in_progress":
            continue
        ranks = sorted(t["final_rank"] for t in year_teams)
        expected = list(range(1, len(year_teams) + 1))
        if ranks != expected:
            failures.append(
                Failure("standings_ranks", f"{year}: ranks {ranks} != {expected}")
            )
    return failures


def check_wl_reconciliation(data: dict[str, Any]) -> list[Failure]:
    failures = []
    reg_matchups_by_year: dict[int, list[dict[str, Any]]] = {}
    for m in data["matchups"]:
        if m["playoff_tier"] is None:
            reg_matchups_by_year.setdefault(m["year"], []).append(m)

    for t in data["teams"]:
        year, team_id = t["year"], t["espn_team_id"]
        wins = losses = ties = 0
        pf = pa = 0.0
        for m in reg_matchups_by_year.get(year, []):
            for side, other in ((m["home"], m["away"]), (m["away"], m["home"])):
                if not side or not other or side["espn_team_id"] != team_id:
                    continue
                pf += side["score"]
                pa += other["score"]
                if m["winner"] == "TIE":
                    ties += 1
                elif (side is m["home"] and m["winner"] == "HOME") or (
                    side is m["away"] and m["winner"] == "AWAY"
                ):
                    wins += 1
                elif m["winner"] in ("HOME", "AWAY"):
                    losses += 1

        overall = t["overall"]
        if (wins, losses, ties) != (
            overall["wins"],
            overall["losses"],
            overall["ties"],
        ):
            failures.append(
                Failure(
                    "wl_reconciliation",
                    f"{year} espn_team_id={team_id}: matchups give {wins}-{losses}-{ties}, "
                    f"team record says {overall['wins']}-{overall['losses']}-{overall['ties']}",
                )
            )
        if abs(pf - overall["points_for"]) > PF_TOLERANCE:
            failures.append(
                Failure(
                    "wl_reconciliation",
                    f"{year} espn_team_id={team_id}: matchups PF {pf:.1f} != team record PF "
                    f"{overall['points_for']:.1f}",
                )
            )
        if abs(pa - overall["points_against"]) > PF_TOLERANCE:
            failures.append(
                Failure(
                    "wl_reconciliation",
                    f"{year} espn_team_id={team_id}: matchups PA {pa:.1f} != team record PA "
                    f"{overall['points_against']:.1f}",
                )
            )
    return failures


def check_playoff_bracket_structure(data: dict[str, Any]) -> list[Failure]:
    failures = []
    matchups_by_year: dict[int, list[dict[str, Any]]] = {}
    for m in data["matchups"]:
        matchups_by_year.setdefault(m["year"], []).append(m)

    for season in data["seasons"]:
        year = season["year"]
        if season["coverage"]["matchups"] != "full" or not season["playoff_brackets"]:
            continue
        year_matchups = matchups_by_year.get(year, [])
        winners_bracket = [
            m for m in year_matchups if m["playoff_tier"] == "WINNERS_BRACKET"
        ]
        if not winners_bracket:
            failures.append(
                Failure(
                    "playoff_bracket_structure", f"{year}: no WINNERS_BRACKET matchups"
                )
            )
            continue
        participants: set[int] = set()
        for m in winners_bracket:
            for side in (m["home"], m["away"]):
                if side:
                    participants.add(side["espn_team_id"])
        if len(participants) != season["playoff_team_count"]:
            failures.append(
                Failure(
                    "playoff_bracket_structure",
                    f"{year}: WINNERS_BRACKET has {len(participants)} participants, "
                    f"season says playoff_team_count={season['playoff_team_count']}",
                )
            )
        weeks = {m["week"] for m in winners_bracket}
        if season["status"] != "in_progress" and len(weeks) != season["playoff_weeks"]:
            failures.append(
                Failure(
                    "playoff_bracket_structure",
                    f"{year}: WINNERS_BRACKET spans {len(weeks)} weeks, "
                    f"season says playoff_weeks={season['playoff_weeks']}",
                )
            )

        # An UNDECIDED game with both sides present is a real game awaiting a
        # result. UNDECIDED with a missing side is just a bye placeholder --
        # ESPN seeds the top seeds into a later round by leaving a one-sided
        # slot in the opening round -- so it is not an unfinished season.
        undecided = [
            m
            for m in winners_bracket
            if m.get("winner") == "UNDECIDED" and m["home"] and m["away"]
        ]
        if undecided and season["status"] != "in_progress":
            failures.append(
                Failure(
                    "playoff_bracket_structure",
                    f"{year}: season is {season['status']} but {len(undecided)} "
                    "WINNERS_BRACKET game(s) are still UNDECIDED",
                )
            )

        # A finished bracket must converge to exactly one champion: the team
        # that wins a WINNERS_BRACKET game and never loses one. This is what
        # separates a real championship round from a phantom trailing
        # matchup period -- a captured week the league never actually played
        # would leave the bracket unconverged (or leave the champion trailing
        # an undecided game), and the app would then credit a title to a team
        # that never won one.
        #
        # Only meaningful once the tournament is over. A live bracket has 2-3
        # unbeaten teams by design -- espn_client.py holds a season
        # in_progress through the whole playoff window -- so convergence is
        # expected to fail mid-playoff and must not be reported as corruption.
        if season["status"] == "in_progress":
            continue

        winners: set[int] = set()
        losers: set[int] = set()
        for m in winners_bracket:
            if m["winner"] not in ("HOME", "AWAY") or not m["home"] or not m["away"]:
                continue
            home_id, away_id = m["home"]["espn_team_id"], m["away"]["espn_team_id"]
            winners.add(home_id if m["winner"] == "HOME" else away_id)
            losers.add(away_id if m["winner"] == "HOME" else home_id)

        champions = winners - losers
        if len(champions) != 1:
            failures.append(
                Failure(
                    "playoff_bracket_structure",
                    f"{year}: WINNERS_BRACKET does not converge to a single "
                    f"champion ({len(champions)} unbeaten: {sorted(champions)})",
                )
            )
            continue

        champion_id = champions.pop()
        ranked = [
            t
            for t in data["teams"]
            if t["year"] == year and t["espn_team_id"] == champion_id
        ]
        if not ranked:
            failures.append(
                Failure(
                    "playoff_bracket_structure",
                    f"{year}: bracket champion espn_team_id={champion_id} "
                    "has no row in teams.json",
                )
            )
        elif ranked[0]["final_rank"] != 1:
            failures.append(
                Failure(
                    "playoff_bracket_structure",
                    f"{year}: bracket champion {ranked[0]['team_name']} has "
                    f"final_rank={ranked[0]['final_rank']}, expected 1",
                )
            )
    return failures


def check_pf_box_score_reconciliation(
    data: dict[str, Any], season_notes: dict[str, Any]
) -> list[Failure]:
    """Active-slot box-score points must reconcile against official scoring.

    Completed seasons: summed per team across all regular-season matchups and
    compared against teams.json's points_for (2009-2018 excluded -- see
    season-notes.json's pre_2019_box_score_fidelity note).

    In-progress seasons: teams.json's points_for lags mid-season, so each
    *decided* matchup-week is instead reconciled individually against its
    matchups.json score -- exactly the check that would have caught the
    2026-08 post-hoc re-fetch day-level corruption. Team-weeks listed in
    season-notes.json's box_score_revision_gaps.weekly_shortfalls are not
    skipped but pinned: a gap that heals to within tolerance of zero is a
    warning (the re-fetch fixed it -- remove the stale pin), while drift
    beyond REVISION_GAP_DRIFT_TOLERANCE from the documented amount is a
    failure (new ESPN revisions landed -- refresh the numbers)."""
    failures = []
    seasons_by_year = {s["year"]: s for s in data["seasons"]}
    reg_matchup_ids_by_year: dict[int, set[int]] = {}

    documented_gaps: dict[tuple[int, int, int], float] = {}
    for year_str, season_note in season_notes.get("seasons", {}).items():
        try:
            note_year = int(year_str)
        except (TypeError, ValueError):
            failures.append(
                Failure(
                    "pf_box_score_reconciliation",
                    f"season-notes.json has a non-numeric seasons key {year_str!r}",
                )
            )
            continue
        shortfalls = season_note.get("box_score_revision_gaps", {}).get(
            "weekly_shortfalls", []
        )
        for i, gap in enumerate(shortfalls):
            try:
                key = (note_year, int(gap["matchup_id"]), int(gap["espn_team_id"]))
                documented_gaps[key] = float(gap["active_slot_gap_pt"])
            except (KeyError, TypeError, ValueError):
                failures.append(
                    Failure(
                        "pf_box_score_reconciliation",
                        f"season-notes.json {year_str} "
                        f"box_score_revision_gaps.weekly_shortfalls[{i}] is "
                        f"malformed (needs matchup_id, espn_team_id, "
                        f"active_slot_gap_pt): {gap!r}",
                    )
                )
    exempt_team_weeks = set(documented_gaps)

    # Decided in-progress matchup scores, keyed (year, matchup_id): official
    # weekly totals live on the matchup row mid-season.
    decided_scores: dict[tuple[int, int], dict[str, tuple[int, float]]] = {}
    for m in data["matchups"]:
        if m["playoff_tier"] is None:
            reg_matchup_ids_by_year.setdefault(m["year"], set()).add(m["matchup_id"])
        if (
            seasons_by_year.get(m["year"], {}).get("status") == "in_progress"
            and m["winner"] != "UNDECIDED"
        ):
            decided_scores[(m["year"], m["matchup_id"])] = {
                "home": (m["home"]["espn_team_id"], m["home"]["score"]),
                "away": (m["away"]["espn_team_id"], m["away"]["score"]),
            }

    in_progress_years = {
        year
        for year, season in seasons_by_year.items()
        if season.get("status") == "in_progress"
    }

    for t in data["teams"]:
        year, team_id = t["year"], t["espn_team_id"]
        if year < MODERN_BOX_SCORE_START_YEAR:
            continue  # see season-notes.json's pre_2019_box_score_fidelity note
        if year in in_progress_years:
            continue  # handled per-week below
        reg_ids = reg_matchup_ids_by_year.get(year, set())
        active_pf = 0.0
        for line in data["box_scores"].get(year, []):
            if line["espn_team_id"] != team_id or line["matchup_id"] not in reg_ids:
                continue
            for slot in line["slots"]:
                if slot["lineup_slot_id"] not in BENCH_AND_IR_SLOTS:
                    active_pf += slot["points"]
        expected = t["overall"]["points_for"]
        if abs(active_pf - expected) > PF_BOX_SCORE_TOLERANCE:
            failures.append(
                Failure(
                    "pf_box_score_reconciliation",
                    f"{year} espn_team_id={team_id}: active box-score PF {active_pf:.1f} != "
                    f"team record PF {expected:.1f}",
                )
            )

    week_active_pf: dict[tuple[int, int, int], float] = {}
    for year, lines in sorted(data["box_scores"].items()):
        if year not in in_progress_years:
            continue
        for line in lines:
            key = (year, line["matchup_id"])
            if key not in decided_scores:
                continue
            team_id = line["espn_team_id"]
            if team_id not in (
                decided_scores[key]["home"][0],
                decided_scores[key]["away"][0],
            ):
                continue
            for slot in line["slots"]:
                if slot["lineup_slot_id"] not in BENCH_AND_IR_SLOTS:
                    key3 = (year, line["matchup_id"], team_id)
                    week_active_pf[key3] = (
                        week_active_pf.get(key3, 0.0) + slot["points"]
                    )

    # A decided matchup-week must have box-score lines at all: a week whose
    # lines are entirely absent produces no key above and would otherwise pass
    # vacuously -- silent data loss is exactly what this check exists to catch.
    for (year, matchup_id), sides in sorted(decided_scores.items()):
        for team_id, _ in sides.values():
            if (year, matchup_id, team_id) not in week_active_pf:
                failures.append(
                    Failure(
                        "pf_box_score_reconciliation",
                        f"{year} matchup_id={matchup_id} espn_team_id={team_id}: "
                        f"decided matchup has no box-score lines at all -- "
                        f"raw capture for this week may be missing",
                    )
                )

    for (year, matchup_id, team_id), active_pf in sorted(week_active_pf.items()):
        sides = decided_scores[(year, matchup_id)]
        expected = sides["home"][1] if sides["home"][0] == team_id else sides["away"][1]
        gap = active_pf - expected
        if (year, matchup_id, team_id) in exempt_team_weeks:
            documented = documented_gaps[(year, matchup_id, team_id)]
            if abs(gap) <= PF_BOX_SCORE_TOLERANCE:
                failures.append(
                    Failure(
                        "pf_box_score_reconciliation",
                        f"{year} matchup_id={matchup_id} espn_team_id={team_id}: "
                        f"documented revision gap {documented:+.1f} healed to "
                        f"{gap:+.1f} -- remove the stale "
                        f"box_score_revision_gaps pin from season-notes.json",
                        level="warn",
                    )
                )
            elif abs(gap - documented) > REVISION_GAP_DRIFT_TOLERANCE:
                failures.append(
                    Failure(
                        "pf_box_score_reconciliation",
                        f"{year} matchup_id={matchup_id} espn_team_id={team_id}: "
                        f"documented revision gap {documented:+.1f} drifted to "
                        f"{gap:+.1f} -- refresh season-notes.json's "
                        f"box_score_revision_gaps from a fresh normalize run",
                    )
                )
            continue
        if abs(gap) > PF_BOX_SCORE_TOLERANCE:
            failures.append(
                Failure(
                    "pf_box_score_reconciliation",
                    f"{year} matchup_id={matchup_id} espn_team_id={team_id}: active "
                    f"box-score PF {active_pf:.1f} != matchup score {expected:.1f}",
                )
            )
    return failures


def check_seasons_cover_box_scores(data: dict[str, Any]) -> list[Failure]:
    """Every year with a box_scores/{year}.json must have a seasons.json row.
    Guards the archive against a `normalize.py --years <recent>` run being
    committed: that truncates seasons.json (and every other processed file)
    to the listed years while leaving box_scores/ intact, and most checks
    would then pass vacuously over the missing seasons."""
    failures = []
    season_years = {s["year"] for s in data["seasons"]}
    for year in sorted(data["box_scores"]):
        if year not in season_years:
            failures.append(
                Failure(
                    "seasons_cover_box_scores",
                    f"box_scores/{year}.json exists but seasons.json has no "
                    f"{year} row -- processed archive looks truncated (was "
                    f"normalize.py run with --years?)",
                )
            )
    return failures


def check_stat_line_reconciliation(data: dict[str, Any]) -> list[Failure]:
    """Every box-score stat line must recompute its own fantasy points from the
    season's scoring settings: sum(stat_value * points_per_unit) over the ids in
    scripts/lib/stat_ids.py (which cover the full scored union) == total_points.
    Lines without stat objects contribute 0, so this also catches a line that
    earned points but lost its stats. Seasons whose coverage.stat_lines is
    "missing" (2009-2017: raw stat dicts are season-cumulative only) must carry
    no stat objects at all."""
    failures = []

    def fail(detail: str) -> None:
        failures.append(Failure("stat_line_reconciliation", detail))

    seasons_by_year = {s["year"]: s for s in data["seasons"]}
    for season in data["seasons"]:
        if "stat_lines" not in season["coverage"]:
            fail(f"{season['year']}: coverage has no stat_lines flag")
        if not season.get("scoring"):
            fail(f"{season['year']}: scoring settings missing or empty")

    for year, lines in sorted(data["box_scores"].items()):
        season = seasons_by_year.get(year)
        if season is None:
            continue
        stat_lines_coverage = season["coverage"].get("stat_lines", "missing")
        points_per_unit = {
            item["stat_id"]: item["points"] for item in season.get("scoring", [])
        }
        for line in lines:
            batting, pitching = line["batting"], line["pitching"]
            where = (
                f"{year} matchup_id={line['matchup_id']} "
                f"player_id={line['player_id']} ({line['player_name']!r})"
            )
            if stat_lines_coverage == "missing":
                if batting is not None or pitching is not None:
                    fail(f"{where}: has stat lines but coverage.stat_lines is missing")
                continue
            expected = 0.0
            for mapping, stat_obj in (
                (BATTING_STAT_IDS, batting),
                (PITCHING_STAT_IDS, pitching),
            ):
                if not stat_obj:
                    continue
                for stat_id, name in mapping.items():
                    expected += stat_obj[name] * points_per_unit.get(stat_id, 0.0)
            if abs(expected - line["total_points"]) > STAT_LINE_TOLERANCE:
                fail(
                    f"{where}: stat line recomputes to {expected:.2f} points, "
                    f"total_points says {line['total_points']:.2f}"
                )
    return failures


def _undecided_weeks(data: dict[str, Any]) -> set[tuple[int, int]]:
    """(year, week) of UNDECIDED matchups in in-progress seasons only -- the
    live week whose lines are provisional.

    Its box-score lines are provisional captures. ESPN's cumulative
    rosterForMatchupPeriod snapshot and per-day feeds disagree intraday
    mid-week -- and since 2026 week 21 the per-player week-to-date
    pool totals can freeze outright while the daily blocks keep advancing --
    so a player's snapshot-anchored total_points drifts away from his slot
    sums until the week decides. The per-player aggregation gates below
    therefore compare decided weeks only; once the week decides,
    extract.py --refresh-decided-weeks re-captures it and full strictness
    applies there again.

    The in-progress gate matters: historical matchups.json rows can carry
    UNDECIDED winners too (ESPN never finalized several seasons' late
    playoff weeks in the archived responses), but those weeks are final
    data no refresh will re-capture, so they must stay under the strict
    comparison. Mirrors check_pf_box_score_reconciliation's status gate."""
    in_progress_years = {
        season["year"]
        for season in data["seasons"]
        if season.get("status") == "in_progress"
    }
    return {
        (m["year"], m["week"])
        for m in data["matchups"]
        if m["year"] in in_progress_years and m.get("winner") == "UNDECIDED"
    }


def _undecided_contributions(
    data: dict[str, Any],
    undecided: set[tuple[int, int]],
    key_of: Callable[[int, dict[str, Any]], tuple[Any, ...]],
) -> dict[tuple[Any, ...], tuple[float, float, float]]:
    """(points, counted, bench) sums of undecided-week box-score lines,
    grouped by key_of(year, line). Lets the stored season aggregates shed
    their provisional contribution so both sides of a strict comparison
    cover exactly the decided weeks."""
    contributions: dict[Any, tuple[float, float, float]] = {}
    for year, lines in data["box_scores"].items():
        for line in lines:
            if (year, line["week"]) not in undecided:
                continue
            counted, bench = slot_split(line)
            key = key_of(year, line)
            prev = contributions.get(key, (0.0, 0.0, 0.0))
            contributions[key] = (
                prev[0] + line["total_points"],
                prev[1] + counted,
                prev[2] + bench,
            )
    return contributions


def check_player_season_points_reconciliation(data: dict[str, Any]) -> list[Failure]:
    """player_season_points.json must be an exact re-derivation of box_scores:
    same (year, player_id) set, and points == sum(total_points) for that
    player that year across every espn_team_id they appeared under. The
    explicit counted/bench split is pinned the same way: each field equals
    its slot-derived sum, and the two add back to points. Both sides shed
    their undecided-week (in-progress) contribution first -- see
    _undecided_weeks for why provisional lines can't meet the tolerance."""
    failures = []
    undecided = _undecided_weeks(data)
    expected: dict[tuple[int, int], float] = {}
    expected_counted: dict[tuple[int, int], float] = {}
    expected_bench: dict[tuple[int, int], float] = {}
    line_keys: set[tuple[int, int]] = set()
    for year, lines in data["box_scores"].items():
        for line in lines:
            key = (year, line["player_id"])
            line_keys.add(key)
            if (year, line["week"]) in undecided:
                continue
            counted, bench = slot_split(line)
            expected[key] = expected.get(key, 0.0) + line["total_points"]
            expected_counted[key] = expected_counted.get(key, 0.0) + counted
            expected_bench[key] = expected_bench.get(key, 0.0) + bench
    undecided_sums = _undecided_contributions(
        data, undecided, lambda year, line: (year, line["player_id"])
    )

    actual_rows = {(r["year"], r["player_id"]): r for r in data["player_season_points"]}
    actual = {key: row["points"] for key, row in actual_rows.items()}

    for year, player_id in sorted(line_keys - set(actual)):
        failures.append(
            Failure(
                "player_season_points_reconciliation",
                f"{year} player_id={player_id}: present in box_scores but missing from player_season_points.json",
            )
        )
    for year, player_id in sorted(set(actual) - line_keys):
        failures.append(
            Failure(
                "player_season_points_reconciliation",
                f"{year} player_id={player_id}: present in player_season_points.json but not in box_scores",
            )
        )
    for key in sorted(line_keys & set(actual)):
        year, player_id = key
        row = actual_rows[key]
        u_points, u_counted, u_bench = undecided_sums.get(key, (0.0, 0.0, 0.0))
        # The stored row is rounded to 2 decimals while the line-derived
        # contribution is not, so the residual carries that rounding noise --
        # well inside STAT_LINE_TOLERANCE.
        decided_points = row["points"] - u_points
        decided_counted = row["counted_points"] - u_counted
        decided_bench = row["bench_points"] - u_bench
        if abs(expected.get(key, 0.0) - decided_points) > STAT_LINE_TOLERANCE:
            failures.append(
                Failure(
                    "player_season_points_reconciliation",
                    f"{year} player_id={player_id}: decided-week derived "
                    f"{expected.get(key, 0.0):.2f} != stored {actual[key]:.2f}",
                )
            )
        if (
            abs(expected_counted.get(key, 0.0) - decided_counted) > STAT_LINE_TOLERANCE
            or abs(expected_bench.get(key, 0.0) - decided_bench) > STAT_LINE_TOLERANCE
            or abs(decided_counted + decided_bench - decided_points)
            > STAT_LINE_TOLERANCE
        ):
            failures.append(
                Failure(
                    "player_season_points_reconciliation",
                    f"{year} player_id={player_id}: decided-week counted/bench split "
                    f"({decided_counted:.2f}/{decided_bench:.2f}) does "
                    f"not match slots ({expected_counted.get(key, 0.0):.2f}/"
                    f"{expected_bench.get(key, 0.0):.2f}) or sum to points "
                    f"({actual[key]:.2f})",
                )
            )
    return failures


def check_keepers(data: dict[str, Any], season_notes: dict[str, Any]) -> list[Failure]:
    failures = []
    exceptions = {
        (e["year"], e["espn_team_id"], e["player_id"])
        for e in season_notes.get("keeper_validation_exceptions", {}).get(
            "exceptions", []
        )
    }
    for k in data["keepers"]:
        if k["validated_on_prior_roster"]:
            continue
        key = (k["year"], k["espn_team_id"], k["player_id"])
        if key not in exceptions:
            failures.append(
                Failure(
                    "keepers",
                    f"{k['year']} espn_team_id={k['espn_team_id']} player_id={k['player_id']} "
                    f"({k['player_name']!r}) fails prior-roster validation and isn't a "
                    "documented exception in data/manual/season-notes.json",
                )
            )
    return failures


def check_owner_mapping(owner_map: Any) -> list[Failure]:
    """Cross-checks owner-map.json's team_seasons against a fresh name-based
    derivation from data/raw/ -- catches drift (a new season added without an
    owner-map.json update) and orphans (a team-season the manual file never
    covered)."""
    failures = []
    for year_dir in sorted(RAW_DIR.iterdir()):
        if not (year_dir.is_dir() and year_dir.name.isdigit()):
            continue
        year = int(year_dir.name)
        team_path = year_dir / "mTeam.json"
        if not team_path.exists():
            continue
        payload = unwrap_league_object(json.loads(team_path.read_text()))
        members_by_swid = {m["id"]: m for m in payload.get("members", [])}
        for t in payload.get("teams", []):
            entry = owner_map.team_seasons.get((year, t["id"]))
            if entry is None:
                failures.append(
                    Failure(
                        "owner_mapping",
                        f"{year} espn_team_id={t['id']} ({t['name']!r}): no entry in "
                        "owner-map.json's team_seasons (orphan)",
                    )
                )
                continue
            try:
                derived_ids, derived_primary = derive_owner_ids_from_raw(
                    owner_map, members_by_swid, t
                )
            except Exception as exc:  # noqa: BLE001 -- surfaced as a validation failure
                failures.append(
                    Failure("owner_mapping", f"{year} espn_team_id={t['id']}: {exc}")
                )
                continue
            if (
                derived_ids != entry["owner_ids"]
                or derived_primary != entry["primary_owner_id"]
            ):
                failures.append(
                    Failure(
                        "owner_mapping",
                        f"{year} espn_team_id={t['id']}: owner-map.json says "
                        f"owner_ids={entry['owner_ids']} primary={entry['primary_owner_id']}, "
                        f"but raw data derives owner_ids={derived_ids} primary={derived_primary}",
                    )
                )
    return failures


def check_player_references(
    data: dict[str, Any], season_notes: dict[str, Any]
) -> list[Failure]:
    failures = []
    known_ids = {p["player_id"] for p in data["players"]}
    documented_gaps = {
        e["player_id"]
        for e in season_notes.get("unresolvable_draft_picks", {}).get("player_ids", [])
    }

    def check_ref(source: str, year: int, player_id: int, player_name: str) -> None:
        if player_id in documented_gaps:
            return
        if player_id not in known_ids:
            failures.append(
                Failure(
                    "player_references",
                    f"{source} {year}: player_id={player_id} ({player_name!r}) not in players.json",
                )
            )
        elif not player_name:
            failures.append(
                Failure(
                    "player_references",
                    f"{source} {year}: player_id={player_id} has no resolved player_name",
                )
            )

    for p in data["draft_picks"]:
        check_ref("draft_picks", p["year"], p["player_id"], p["player_name"])
    for k in data["keepers"]:
        check_ref("keepers", k["year"], k["player_id"], k["player_name"])
    for year, lines in data["box_scores"].items():
        for line in lines:
            check_ref("box_scores", year, line["player_id"], line["player_name"])
    for row in data["player_season_backfill"]:
        check_ref(
            "player_season_backfill",
            row["year"],
            row["player_id"],
            row["player_name"],
        )
    return failures


def check_player_season_backfill(data: dict[str, Any]) -> list[Failure]:
    """The backfill file must only contain player-seasons missing from
    player_season_points, must map to known players, and must re-derive from the
    latest season's kona player pool."""
    failures = []
    known_ids = {p["player_id"] for p in data["players"]}
    box_score_keys = {
        (row["year"], row["player_id"]) for row in data["player_season_points"]
    }
    team_keys = {(t["year"], t["espn_team_id"]) for t in data["teams"]}
    seasons_by_year = {s["year"]: s for s in data["seasons"]}

    for row in data["player_season_backfill"]:
        key = (row["year"], row["player_id"])
        where = f"{row['year']} player_id={row['player_id']} ({row['player_name']!r})"
        if row["player_id"] not in known_ids:
            failures.append(
                Failure(
                    "player_season_backfill",
                    f"{where}: player_id not in players.json",
                )
            )
        if key in box_score_keys:
            failures.append(
                Failure(
                    "player_season_backfill",
                    f"{where}: duplicates an existing player_season_points row",
                )
            )
        if row["source"] != "kona":
            failures.append(
                Failure(
                    "player_season_backfill",
                    f"{where}: unexpected source {row['source']!r}",
                )
            )

    # fantasy_team_id must map to a real team when present (current season only).
    for ps in data["player_seasons"]:
        ftid = ps.get("fantasy_team_id")
        if ftid is None:
            continue
        year = ps["year"]
        if (year, ftid) not in team_keys:
            failures.append(
                Failure(
                    "player_season_backfill",
                    f"player_seasons {year} player_id={ps['player_id']}: "
                    f"fantasy_team_id={ftid} has no team row",
                )
            )
        if seasons_by_year.get(year, {}).get("status") != "in_progress":
            failures.append(
                Failure(
                    "player_season_backfill",
                    f"player_seasons {year} player_id={ps['player_id']}: "
                    f"fantasy_team_id should only be present for in-progress seasons",
                    level="warn",
                )
            )

    return failures


def check_card_points(data: dict[str, Any]) -> list[Failure]:
    """card_points.json must contain at most one row per player_season_points
    key, every row must map to a known player, and card_points must be a real
    number. Rows are ESPN's full-season player-card totals (kona real season
    blocks), so no inequality against rostered points is asserted -- negative
    pitching breaks it in both directions. Per-season presence below 90% of
    rostered keys warns (archival thinness, e.g. kona pool gaps for injured
    players) rather than fails."""
    failures = []
    known_ids = {p["player_id"] for p in data["players"]}
    points_keys = {
        (row["year"], row["player_id"]) for row in data["player_season_points"]
    }
    seen: set[tuple[int, int]] = set()
    covered: dict[int, int] = {}
    rostered: dict[int, int] = {}
    for row in data["player_season_points"]:
        rostered[row["year"]] = rostered.get(row["year"], 0) + 1

    for row in data["card_points"]:
        if not isinstance(row, dict):
            failures.append(Failure("card_points", f"row is not an object: {row!r}"))
            continue
        year = row.get("year")
        player_id = row.get("player_id")
        if not isinstance(year, int) or isinstance(year, bool):
            failures.append(Failure("card_points", f"row has a bad year: {row!r}"))
            continue
        if not isinstance(player_id, int) or isinstance(player_id, bool):
            failures.append(Failure("card_points", f"row has a bad player_id: {row!r}"))
            continue
        key = (year, player_id)
        where = f"{year} player_id={player_id} ({row.get('player_name')!r})"
        if key in seen:
            failures.append(
                Failure(
                    "card_points",
                    f"{where}: duplicate row",
                )
            )
        seen.add(key)
        if player_id not in known_ids:
            failures.append(
                Failure(
                    "card_points",
                    f"{where}: player_id not in players.json",
                )
            )
        if key not in points_keys:
            failures.append(
                Failure(
                    "card_points",
                    f"{where}: no matching player_season_points row",
                )
            )
        value = row.get("card_points")
        if (
            not isinstance(value, (int, float))
            or isinstance(value, bool)
            or value != value
            or value in (float("inf"), float("-inf"))
        ):
            failures.append(
                Failure(
                    "card_points",
                    f"{where}: card_points is not a finite number: {value!r}",
                )
            )
            continue
        covered[year] = covered.get(year, 0) + 1

    for year in sorted(rostered):
        total = rostered[year]
        hit = covered.get(year, 0)
        if total > 0 and hit / total < 0.9:
            failures.append(
                Failure(
                    "card_points",
                    f"{year}: only {hit}/{total} rostered player-seasons have "
                    f"card rows",
                    level="warn",
                )
            )

    return failures


def check_pro_team_ids(data: dict[str, Any]) -> list[Failure]:
    """Every non-null pro_team_id must be a key MLB_TEAMS recognizes -- catches
    a future ESPN proTeamId this reference table (scripts/lib/mlb_teams.py)
    hasn't been extended to cover."""
    failures = []
    for p in data["draft_picks"]:
        pt = p["pro_team_id"]
        if pt is not None and pt not in MLB_TEAMS:
            failures.append(
                Failure(
                    "pro_team_ids",
                    f"draft_picks {p['year']}: player_id={p['player_id']} has unrecognized "
                    f"pro_team_id={pt}",
                )
            )
    return failures


def check_player_eligibility(data: dict[str, Any]) -> list[Failure]:
    """Bounds the Phase 9.1 player enrichment. eligible_slots and
    games_played_by_position are career aggregates (union / per-season sum), so
    the per-season limits scale by how many seasons the player appears in."""
    failures = []
    for p in data["players"]:
        where = f"player_id={p['player_id']} ({p['full_name']!r})"
        seasons = max(len(p["seasons_seen"]), 1)

        for slot_id in p["eligible_slots"]:
            if not 0 <= slot_id <= MAX_LINEUP_SLOT_ID:
                failures.append(
                    Failure(
                        "player_eligibility",
                        f"{where}: eligible_slots has {slot_id}, outside ESPN's "
                        f"0-{MAX_LINEUP_SLOT_ID} slot range",
                        level="warn",
                    )
                )

        for position_id, games in p["games_played_by_position"].items():
            if games < 0:
                failures.append(
                    Failure(
                        "player_eligibility",
                        f"{where}: negative games ({games}) at position {position_id}",
                    )
                )
                continue
            ceiling = MAX_GAMES_PER_POSITION_PER_SEASON * seasons
            if games > ceiling:
                failures.append(
                    Failure(
                        "player_eligibility",
                        f"{where}: {games} career games at position {position_id} over "
                        f"{seasons} season(s) exceeds the {ceiling}-game ceiling",
                        level="warn",
                    )
                )
    return failures


def check_team_enrichment(data: dict[str, Any]) -> list[Failure]:
    """Bounds the Phase 9.1 team enrichment. The in-season-only fields
    (eliminated, current_projected_rank, ...) are deliberately unchecked: every
    archived season carries ESPN's post-season reset, so there is nothing to
    assert until Phase 8 runs this against a live season."""
    failures = []
    teams_by_year: dict[int, list[dict[str, Any]]] = {}
    for t in data["teams"]:
        teams_by_year.setdefault(t["year"], []).append(t)
    scoring_by_year = {
        s["year"]: {item["stat_id"]: item["points"] for item in s.get("scoring", [])}
        for s in data["seasons"]
    }
    status_by_year = {s["year"]: s.get("status") for s in data["seasons"]}

    for year, year_teams in sorted(teams_by_year.items()):
        team_count = len(year_teams)
        for t in year_teams:
            where = f"{year} espn_team_id={t['espn_team_id']}"
            for field_name in ("waiver_rank", "draft_day_projected_rank"):
                rank = t[field_name]
                if rank is not None and not 1 <= rank <= team_count:
                    failures.append(
                        Failure(
                            "team_enrichment",
                            f"{where}: {field_name}={rank} outside 1-{team_count}",
                        )
                    )

            value_by_stat = t["value_by_stat"]
            if year < VALUE_BY_STAT_START_YEAR:
                if value_by_stat:
                    failures.append(
                        Failure(
                            "team_enrichment",
                            f"{where}: has value_by_stat, but the leagueHistory-era "
                            f"mTeam (pre-{VALUE_BY_STAT_START_YEAR}) carries none",
                        )
                    )
                continue
            if not value_by_stat:
                failures.append(
                    Failure("team_enrichment", f"{where}: value_by_stat is empty")
                )
                continue

            points_for = t["overall"]["points_for"]
            if not points_for:
                continue
            weighted = sum(
                count * scoring_by_year.get(year, {}).get(int(stat_id), 0.0)
                for stat_id, count in value_by_stat.items()
            )
            ratio = weighted / points_for
            min_ratio = (
                VALUE_BY_STAT_IN_PROGRESS_MIN_RATIO
                if status_by_year.get(year) == "in_progress"
                else VALUE_BY_STAT_MIN_RATIO
            )
            if not min_ratio <= ratio <= VALUE_BY_STAT_MAX_RATIO:
                failures.append(
                    Failure(
                        "team_enrichment",
                        f"{where}: value_by_stat weighted by season scoring is "
                        f"{weighted:.1f}, {ratio:.3f}x points_for {points_for:.1f} "
                        f"(expected {min_ratio}-{VALUE_BY_STAT_MAX_RATIO}x)",
                        level="warn",
                    )
                )
    return failures


def check_player_ownership(data: dict[str, Any]) -> list[Failure]:
    """Bounds player_season_ownership.json's fields.

    Deliberately does NOT check the spec's "ADP exists iff the player was
    drafted": ESPN's averageDraftPosition is a cross-league average covering
    every ESPN league of this type, so undrafted-in-this-league players
    legitimately carry one. Nor does it bound ADP percent change to +/-100 --
    it's a percentage change, and the archive's real range is -214% to +261%.
    """
    failures = []
    for row in data["player_season_ownership"]:
        where = f"{row['year']} player_id={row['player_id']} ({row['player_name']!r})"
        for name in ("percent_owned", "percent_started"):
            value = row[name]
            if not 0.0 <= value <= 100.0:
                failures.append(
                    Failure(
                        "player_ownership",
                        f"{where}: {name}={value} outside 0-100",
                    )
                )
        adp = row["average_draft_position"]
        if adp is not None and not 0 < adp < MAX_PLAUSIBLE_ADP:
            failures.append(
                Failure(
                    "player_ownership",
                    f"{where}: average_draft_position={adp} outside 0-{MAX_PLAUSIBLE_ADP} "
                    "(ESPN's 0.0/9999 'no ADP' sentinels should already be None)",
                )
            )
    return failures


def check_player_season_rollup(data: dict[str, Any]) -> list[Failure]:
    """players.json's career aggregates must be exactly the rollup of
    player_seasons.json: eligible_slots the union, games_played_by_position the
    per-position sum. Both come from one accumulator in PlayerRegistry, so this
    is the Source-of-Truth Rule's cross-check (rule 4) -- it fails only if the
    two emitters drift apart."""
    failures = []
    slots: dict[int, set[int]] = {}
    games: dict[int, dict[str, int]] = {}
    for row in data["player_seasons"]:
        player_id = row["player_id"]
        slots.setdefault(player_id, set()).update(row["eligible_slots"])
        totals = games.setdefault(player_id, {})
        for position_id, count in row["games_played_by_position"].items():
            totals[position_id] = totals.get(position_id, 0) + count

    for p in data["players"]:
        player_id = p["player_id"]
        where = f"player_id={player_id} ({p['full_name']!r})"
        expected_slots = sorted(slots.get(player_id, set()))
        if p["eligible_slots"] != expected_slots:
            failures.append(
                Failure(
                    "player_season_rollup",
                    f"{where}: players.json eligible_slots {p['eligible_slots']} != "
                    f"player_seasons union {expected_slots}",
                )
            )
        expected_games = {k: v for k, v in sorted(games.get(player_id, {}).items())}
        if p["games_played_by_position"] != expected_games:
            failures.append(
                Failure(
                    "player_season_rollup",
                    f"{where}: players.json games_played_by_position "
                    f"{p['games_played_by_position']} != player_seasons sum {expected_games}",
                )
            )
    return failures


def check_team_transactions(data: dict[str, Any]) -> list[Failure]:
    """Transaction counters are ESPN's own totals (Source-of-Truth Rule), so
    this bounds them rather than recomputing them."""
    failures = []
    for t in data["teams"]:
        where = f"{t['year']} espn_team_id={t['espn_team_id']}"
        tx = t["transactions"]
        for name in (
            "acquisitions",
            "drops",
            "trades",
            "moves_to_active",
            "moves_to_ir",
            "acquisitions_budget_spent",
            "team_charges",
        ):
            if tx[name] < 0:
                failures.append(
                    Failure("team_transactions", f"{where}: negative {name}={tx[name]}")
                )
        # normalize.py repairs `acquisitions` to max(scalar, per-week sum), so
        # this can only fail if that repair regressed.
        by_week = sum(tx["acquisitions_by_week"].values())
        if by_week > tx["acquisitions"]:
            failures.append(
                Failure(
                    "team_transactions",
                    f"{where}: per-week acquisitions sum to {by_week}, above the stored "
                    f"season total {tx['acquisitions']} -- normalize.py's repair regressed",
                )
            )

    failures.extend(_report_acquisition_repairs(data))
    return failures


def _report_acquisition_repairs(data: dict[str, Any]) -> list[Failure]:
    """Re-reads mTeam from data/raw/ and reports every team-season where the
    stored acquisitions count differs from ESPN's own scalar.

    This is the Source-of-Truth Rule's rule 4 applied to a repair rather than a
    dropped derivation: normalize.py silently takes the larger of ESPN's two
    contradictory acquisition sources, and without this the correction would be
    invisible in the processed output. Expect exactly the 2018 team-seasons; a
    new year appearing here means ESPN broke another season the same way."""
    failures = []
    stored = {
        (t["year"], t["espn_team_id"]): t["transactions"]["acquisitions"]
        for t in data["teams"]
    }
    for year_dir in sorted(RAW_DIR.iterdir()):
        if not (year_dir.is_dir() and year_dir.name.isdigit()):
            continue
        year = int(year_dir.name)
        team_path = year_dir / "mTeam.json"
        if not team_path.exists():
            continue
        payload = unwrap_league_object(json.loads(team_path.read_text()))
        for t in payload.get("teams", []):
            key = (year, t["id"])
            if key not in stored:
                continue
            raw_scalar = (t.get("transactionCounter") or {}).get("acquisitions", 0)
            if stored[key] != raw_scalar:
                failures.append(
                    Failure(
                        "team_transactions",
                        f"{year} espn_team_id={t['id']}: acquisitions repaired from ESPN's "
                        f"scalar {raw_scalar} to {stored[key]} (its own per-week totals)",
                        level="warn",
                    )
                )
    return failures


def check_league_owners(data: dict[str, Any]) -> list[Failure]:
    """**The Phase 9.3b cutover gate.**

    While 9.3a runs both owner sources in parallel, the ESPN-derived
    league_owners.json must agree with the owner-map-derived owners.json on
    every owner identity. 9.3b does not start until this is clean -- the whole
    point of the parallel phase is that owner_mapping (which validates the
    manual file against raw) stops being meaningful the moment the manual file
    stops being authoritative, so the agreement has to be proven while both
    still exist.

    Team names are not compared here because ESPN is the source of truth for
    team names and owners can change them at any time. The owner-map.json is
    only used for name canonicalization (mapping ESPN member names to
    owner_ids), not for tracking team names.

    Also enforces the two structural invariants the spec calls for: no ESPN
    member identity shared across owners, and retirement consistent with the
    seasons the owner actually appears in.
    """
    failures = []
    league_owners = {o["owner_id"]: o for o in data["league_owners"]}
    owners = {o["owner_id"]: o for o in data["owner_map_derived"]}

    for owner_id in sorted(set(owners) - set(league_owners)):
        failures.append(
            Failure(
                "league_owners",
                f"{owner_id}: in owner-map.json but not derivable from ESPN's member records",
            )
        )
    for owner_id in sorted(set(league_owners) - set(owners)):
        failures.append(
            Failure(
                "league_owners",
                f"{owner_id}: ESPN-derived but absent from owner-map.json",
            )
        )
    seen_keys: dict[str, str] = {}
    for owner in data["league_owners"]:
        for entry in owner["espn_member_keys"]:
            other = seen_keys.get(entry["member_key"])
            if other is not None and other != owner["owner_id"]:
                failures.append(
                    Failure(
                        "league_owners",
                        f"ESPN member identity {entry['member_key']} maps to both "
                        f"{other!r} and {owner['owner_id']!r}",
                    )
                )
            seen_keys[entry["member_key"]] = owner["owner_id"]

    seasons_by_owner: dict[str, set[int]] = {}
    for t in data["teams"]:
        for owner_id in t["owner_ids"]:
            seasons_by_owner.setdefault(owner_id, set()).add(t["year"])
    latest_year = max((t["year"] for t in data["teams"]), default=None)
    for owner in data["league_owners"]:
        owner_id = owner["owner_id"]
        seen = seasons_by_owner.get(owner_id, set())
        if not seen:
            continue
        last_year = max(seen)
        if owner["last_active_year"] != last_year:
            failures.append(
                Failure(
                    "league_owners",
                    f"{owner_id}: last_active_year={owner['last_active_year']} but "
                    f"last appears in teams.json in {last_year}",
                )
            )
        if owner["absent_from_latest_season"] != (last_year != latest_year):
            failures.append(
                Failure(
                    "league_owners",
                    f"{owner_id}: absent_from_latest_season="
                    f"{owner['absent_from_latest_season']} contradicts last season "
                    f"{last_year} vs archive latest {latest_year}",
                )
            )

    # retired-owners.json is NOT replaced by the ESPN-derived coverage fields
    # above -- retirement is a real-world event ESPN can't report. All that can
    # be checked is that the manual file names owners who actually exist.
    for owner_id in data["retired_owner_ids"]:
        if owner_id not in league_owners:
            failures.append(
                Failure(
                    "league_owners",
                    f"{owner_id}: listed in retired-owners.json but not a known owner",
                )
            )
    return failures


def check_achievements_coverage(data: dict[str, Any]) -> list[Failure]:
    """achievements.json exists iff some season claims achievements coverage,
    every raw capture backs exactly one processed record (per-year count
    parity -- normalize writes output before its error exit, so a red run can
    legitimately leave a short processed file on disk), and no capture is
    orphaned.

    Raw-file truth is the glob extract.py writes (2026+ only -- the feature
    launched 2026-02-04 and ESPN serves no earlier seasons, so coverage for
    2009-2025 is "missing" by construction, not by capture failure)."""
    failures = []
    covered = {
        s["year"]
        for s in data["seasons"]
        if s["coverage"].get("achievements", "missing") != "missing"
    }
    raw_counts = Counter(
        int(p.parent.name) for p in RAW_DIR.glob("*/achievements-member*.json")
    )
    processed_counts = Counter(r["year"] for r in data["achievements"])
    for year in sorted(covered - set(raw_counts)):
        failures.append(
            Failure(
                "achievements_coverage",
                f"{year}: coverage.achievements is set but data/raw/{year}/ has no "
                "achievements-member captures",
            )
        )
    for year in sorted(set(raw_counts) - covered):
        failures.append(
            Failure(
                "achievements_coverage",
                f"{year}: raw achievements captures exist but coverage.achievements is missing",
            )
        )
    for year in sorted(set(processed_counts) - set(raw_counts)):
        failures.append(
            Failure(
                "achievements_coverage",
                f"{year}: processed achievement records but no raw captures",
            )
        )
    for year in sorted(set(raw_counts) - set(processed_counts)):
        failures.append(
            Failure(
                "achievements_coverage",
                f"{year}: raw achievements captures but no processed records",
            )
        )
    for year in sorted(set(raw_counts) & set(processed_counts)):
        if raw_counts[year] != processed_counts[year]:
            failures.append(
                Failure(
                    "achievements_coverage",
                    f"{year}: {processed_counts[year]} processed records for "
                    f"{raw_counts[year]} raw captures",
                )
            )
    return failures


def check_achievements_shape(data: dict[str, Any]) -> list[Failure]:
    """ESPN's per-member template is a fixed 20-slot array; a different arity
    means ESPN changed the template (or a parser bug slipped through). Slot
    indices are unique positions; member_keys are unique per season."""
    failures = []
    seen_records: set[tuple[int, str]] = set()
    for r in data["achievements"]:
        where = f"{r['year']} member_key={r['member_key']}"
        if (r["year"], r["member_key"]) in seen_records:
            failures.append(Failure("achievements_shape", f"{where}: duplicate record"))
        seen_records.add((r["year"], r["member_key"]))
        trophies = r["trophies"]
        if len(trophies) != 20:
            failures.append(
                Failure(
                    "achievements_shape",
                    f"{where}: {len(trophies)} trophy slots (expected the 20-slot template)",
                )
            )
        slots = [t["slot"] for t in trophies]
        if len(set(slots)) != len(slots):
            failures.append(
                Failure("achievements_shape", f"{where}: duplicate slot indices")
            )
        if any(not 0 <= slot < 20 for slot in slots):
            failures.append(
                Failure("achievements_shape", f"{where}: slot index out of range")
            )
    return failures


def check_achievements_linkage(data: dict[str, Any]) -> list[Failure]:
    """Every record attributes to a known owner and a real team-season (a null
    owner_id or espn_team_id is normalize's unresolved-member state and fails
    here so it never ships), and member_key is the 16-hex salted hash -- never
    a raw SWID (a 38-char braced GUID), mirroring transaction_ledger's
    committed-credentials guard."""
    failures = []
    owner_ids = {o["owner_id"] for o in data["league_owners"]}
    team_seasons = {(t["year"], t["espn_team_id"]) for t in data["teams"]}
    for r in data["achievements"]:
        where = f"{r['year']} member_key={r['member_key']}"
        if r["owner_id"] is None:
            failures.append(
                Failure(
                    "achievements_linkage",
                    f"{where}: member unresolved to an owner (normalize warned)",
                )
            )
        elif r["owner_id"] not in owner_ids:
            failures.append(
                Failure(
                    "achievements_linkage",
                    f"{where}: unknown owner_id {r['owner_id']}",
                )
            )
        if r["espn_team_id"] is None:
            failures.append(
                Failure(
                    "achievements_linkage",
                    f"{where}: espn_team_id unresolved (normalize warned)",
                )
            )
        elif (r["year"], r["espn_team_id"]) not in team_seasons:
            failures.append(
                Failure(
                    "achievements_linkage",
                    f"{where}: espn_team_id {r['espn_team_id']} not in {r['year']} teams.json",
                )
            )
        if not re.fullmatch(r"[0-9a-f]{16}", r["member_key"]):
            failures.append(
                Failure(
                    "achievements_linkage",
                    f"{where}: member_key is not a salted hash",
                )
            )
    return failures


def check_league_rules(data: dict[str, Any]) -> list[Failure]:
    """Coherence of the programmatic league rules embedded in seasons.json.

    Note what is deliberately NOT checked: the spec's "if bench_unlimited is
    false, lineup slots sum to 12-15". bench_unlimited is true in all 17
    archived seasons, so that rule can never fire here -- asserting it would be
    theatre. The checks below are the ones this league's data can actually
    violate."""
    failures = []
    for season in data["seasons"]:
        year = season["year"]
        missing = [
            block
            for block in (
                "settings",
                "roster_rules",
                "acquisition_rules",
                "draft_settings",
                "trade_rules",
            )
            if not season.get(block)
        ]
        for block in missing:
            failures.append(Failure("league_rules", f"{year}: missing {block}"))
        if missing:
            # Report the gap and move on -- the coherence checks below all read
            # into these blocks, and validate.py's job is to describe broken
            # data, not to crash on it.
            continue

        settings = season["settings"]
        team_count = sum(1 for t in data["teams"] if t["year"] == year)
        if team_count and settings["league_size"] != team_count:
            failures.append(
                Failure(
                    "league_rules",
                    f"{year}: settings.league_size={settings['league_size']} but "
                    f"teams.json has {team_count} teams",
                )
            )

        roster = season["roster_rules"]
        starters = sum(
            count
            for slot, count in roster["lineup_slot_counts"].items()
            if int(slot) not in BENCH_AND_IR_SLOTS
        )
        if not 1 <= starters <= 40:
            failures.append(
                Failure(
                    "league_rules",
                    f"{year}: {starters} starting lineup slots is implausible",
                )
            )

        draft = season["draft_settings"]
        keeper_count = draft["keeper_count"]
        actual_keepers = sum(1 for k in data["keepers"] if k["year"] == year)
        if actual_keepers > keeper_count * team_count:
            failures.append(
                Failure(
                    "league_rules",
                    f"{year}: {actual_keepers} keepers exceeds the rule maximum "
                    f"{keeper_count} x {team_count} teams",
                )
            )
    return failures


def check_transaction_ledger(data: dict[str, Any]) -> list[Failure]:
    """Structural checks on transactions.json, plus the Source-of-Truth Rule's
    rule 4 for what normalize.py deliberately drops.

    Deliberately NOT here: the spec's "waiver costs are within league's
    acquisition budget". Phase 9.3a established this league has never run an
    acquisition budget (using_acquisition_budget False, budget 0, all 17
    years), and every raw bidAmount is 0 -- the check would assert nothing, the
    same dead-check shape as roster_rules.bench_unlimited.
    """
    failures = []
    transactions = data["transactions"]

    seasons_by_year = {s["year"]: s for s in data["seasons"]}
    owner_ids = {o["owner_id"] for o in data["owners"]}
    known_players = {p["player_id"] for p in data["players"]}
    team_ids_by_year: dict[int, set[int]] = {}
    for t in data["teams"]:
        team_ids_by_year.setdefault(t["year"], set()).add(t["espn_team_id"])

    seen_ids: set[str] = set()
    years_with_rows: set[int] = set()
    for tx in transactions:
        year = tx["year"]
        years_with_rows.add(year)
        where = f"{year} {tx['transaction_type']} {tx['transaction_id'][:8]}"

        if tx["transaction_id"] in seen_ids:
            failures.append(
                Failure("transaction_ledger", f"{where}: duplicate transaction_id")
            )
        seen_ids.add(tx["transaction_id"])

        if tx["transaction_type"] in ("FUTURE_ROSTER", "DRAFT"):
            failures.append(
                Failure(
                    "transaction_ledger",
                    f"{where}: type is supposed to be filtered out by normalize.py",
                )
            )
        if tx["espn_team_id"] not in team_ids_by_year.get(year, set()):
            failures.append(
                Failure(
                    "transaction_ledger",
                    f"{where}: espn_team_id={tx['espn_team_id']} has no team row",
                )
            )
        if tx["owner_id"] is not None and tx["owner_id"] not in owner_ids:
            failures.append(
                Failure(
                    "transaction_ledger", f"{where}: unknown owner_id {tx['owner_id']}"
                )
            )
        # A raw SWID is a 38-char braced GUID. acting_member_key must be the
        # 16-hex-char salted hash instead -- this is the committed-credentials
        # guard, so it is an error, not a warning.
        key = tx["acting_member_key"]
        if key is not None and not re.fullmatch(r"[0-9a-f]{16}", key):
            failures.append(
                Failure(
                    "transaction_ledger",
                    f"{where}: acting_member_key is not a salted hash",
                )
            )
        if tx["bid_amount"] < 0:
            failures.append(
                Failure("transaction_ledger", f"{where}: negative bid_amount")
            )

        for item in tx["items"]:
            # Warn, not error: 7 player ids across 2019-2025 appear ONLY in the
            # transaction log -- never in kona_player_info, mRoster, or any box
            # score, in any year. They were added and dropped without ever
            # being on a season-end roster or scoring, so their names are
            # unrecoverable from data/raw/ and players.json cannot carry them
            # (a Player needs a full_name). The app must therefore tolerate an
            # item whose player_id resolves to nothing. A sudden jump in this
            # count would mean players.json really did lose players.
            if item["player_id"] not in known_players:
                failures.append(
                    Failure(
                        "transaction_ledger",
                        f"{where}: item references player_id {item['player_id']}, "
                        f"which appears nowhere else in the archive",
                        level="warn",
                    )
                )
            for side in ("from_espn_team_id", "to_espn_team_id"):
                team_id = item[side]
                if team_id is not None and team_id not in team_ids_by_year.get(
                    year, set()
                ):
                    failures.append(
                        Failure(
                            "transaction_ledger",
                            f"{where}: item {side}={team_id} has no team row",
                        )
                    )
            for side in ("from_lineup_slot_id", "to_lineup_slot_id"):
                slot = item[side]
                if slot is not None and not 0 <= slot <= MAX_LINEUP_SLOT_ID:
                    failures.append(
                        Failure(
                            "transaction_ledger",
                            f"{where}: item {side}={slot} out of range",
                        )
                    )

    # Coverage has to agree with what actually landed, in both directions --
    # that is what stops a silently-empty year from reading as complete.
    for year, season in sorted(seasons_by_year.items()):
        coverage = season["coverage"]["transactions"]
        has_rows = year in years_with_rows
        if coverage == "full" and not has_rows:
            failures.append(
                Failure(
                    "transaction_ledger",
                    f"{year}: coverage says 'full' but no transactions were emitted",
                )
            )
        if coverage == "missing" and has_rows:
            failures.append(
                Failure(
                    "transaction_ledger",
                    f"{year}: coverage says 'missing' but transactions were emitted",
                )
            )

    failures.extend(_report_dropped_transaction_types(data))
    return failures


def _report_dropped_transaction_types(data: dict[str, Any]) -> list[Failure]:
    """Re-reads mTransactions2 from data/raw/ and reports, per year, how many
    rows normalize.py dropped and whether the DRAFT rows it dropped reconcile
    with draft_picks.json.

    Source-of-Truth Rule, rule 4: FUTURE_ROSTER and DRAFT are not stored, so
    the only way that stays honest is to keep counting them here. The DRAFT
    reconciliation is the real check -- it proves draft_picks.json is not
    missing picks that the transaction log knows about."""
    failures = []
    picks_by_year: dict[int, int] = {}
    for pick in data["draft_picks"]:
        picks_by_year[pick["year"]] = picks_by_year.get(pick["year"], 0) + 1

    for year_dir in sorted(RAW_DIR.iterdir()):
        if not (year_dir.is_dir() and year_dir.name.isdigit()):
            continue
        year = int(year_dir.name)
        dropped: dict[str, set[str]] = {"FUTURE_ROSTER": set(), "DRAFT": set()}
        for path in sorted(year_dir.glob("mTransactions2-period*.json")):
            payload = unwrap_league_object(json.loads(path.read_text()))
            for raw in payload.get("transactions") or []:
                if raw["type"] in dropped:
                    dropped[raw["type"]].add(raw["id"])
        if not any(dropped.values()):
            continue

        failures.append(
            Failure(
                "transaction_ledger",
                f"{year}: dropped {len(dropped['FUTURE_ROSTER'])} FUTURE_ROSTER "
                f"(lineup shuffling) and {len(dropped['DRAFT'])} DRAFT rows "
                f"(draft_picks.json is authoritative)",
                level="warn",
            )
        )
        espn_picks = len(dropped["DRAFT"])
        stored_picks = picks_by_year.get(year, 0)
        if espn_picks and espn_picks != stored_picks:
            failures.append(
                Failure(
                    "transaction_ledger",
                    f"{year}: {espn_picks} DRAFT transactions but draft_picks.json "
                    f"has {stored_picks} picks",
                )
            )
    return failures


def check_trades(data: dict[str, Any]) -> list[Failure]:
    """Cross-checks trades.json against transactions.json's executed TRADE_*
    rows (a TRADE_UPHOLD, or a binding TRADE_ACCEPT that was never vetoed --
    see build_trades' _execution_marker), and enforces that every trade
    executed once the daily capture existed (TRADE_CAPTURE_START_YEAR+, see
    the Phase 8 trade-capture spec) actually recovered its player exchange --
    the whole point of that capture. Earlier trades are allowed an empty items
    list -- an ESPN-side gap (it prunes the proposal a TRADE_ACCEPT points at),
    not a defect in this pipeline."""
    failures = []
    trades = data["trades"]
    owner_ids = {o["owner_id"] for o in data["owners"]}
    team_ids_by_year: dict[int, set[int]] = {}
    for t in data["teams"]:
        team_ids_by_year.setdefault(t["year"], set()).add(t["espn_team_id"])

    upheld: set[str] = set()
    accepted: set[str] = set()
    vetoed: set[str] = set()
    for tx in data["transactions"]:
        related = tx.get("related_transaction_id")
        if not related:
            continue
        if tx["transaction_type"] == "TRADE_UPHOLD":
            upheld.add(related)
        elif tx["transaction_type"] == "TRADE_ACCEPT" and tx.get("status") not in (
            "PENDING",
            "CANCELED",
        ):
            accepted.add(related)
        elif tx["transaction_type"] == "TRADE_VETO":
            vetoed.add(related)
    executed_ids = upheld | (accepted - vetoed)

    # A trade is only expected in trades.json when both sides are knowable:
    # either a TRADE_UPHOLD exists, the proposal survived in the ledger, or
    # multiple teams are represented in the execution rows. A single-sided
    # TRADE_ACCEPT (proposal fully pruned before capture) can't be turned into
    # a valid two-sided trades.json row; the app surfaces these as unrecorded
    # entries from the raw ledger instead.
    tx_by_id = {t["transaction_id"]: t for t in data["transactions"]}
    representable_ids = set()
    for trade_id in executed_ids:
        if trade_id in upheld:
            representable_ids.add(trade_id)
            continue
        proposal = tx_by_id.get(trade_id)
        if proposal is not None:
            representable_ids.add(trade_id)
            continue
        related = [
            t
            for t in data["transactions"]
            if t.get("related_transaction_id") == trade_id
        ]
        teams = {t["espn_team_id"] for t in related}
        if len(teams) > 1:
            representable_ids.add(trade_id)

    trade_ids: set[str] = set()
    for trade in trades:
        where = f"{trade['year']} trade {trade['trade_id'][:8]}"
        if trade["trade_id"] in trade_ids:
            failures.append(Failure("trades", f"{where}: duplicate trade_id"))
        trade_ids.add(trade["trade_id"])

        for side in ("team_a", "team_b"):
            team_id = trade[f"{side}_espn_team_id"]
            if team_id not in team_ids_by_year.get(trade["year"], set()):
                failures.append(
                    Failure(
                        "trades",
                        f"{where}: {side}_espn_team_id={team_id} has no team row",
                    )
                )
            owner_id = trade[f"{side}_owner_id"]
            if owner_id is not None and owner_id not in owner_ids:
                failures.append(
                    Failure("trades", f"{where}: unknown {side}_owner_id {owner_id}")
                )

        if trade["team_a_espn_team_id"] == trade["team_b_espn_team_id"]:
            failures.append(
                Failure("trades", f"{where}: both sides resolve to the same team")
            )

        if trade["year"] >= TRADE_CAPTURE_START_YEAR and not trade["items"]:
            failures.append(
                Failure(
                    "trades",
                    f"{where}: executed {trade['year']}+ trade has no player exchange "
                    "-- the daily capture should have caught this proposal before "
                    "ESPN purged it",
                )
            )

        team_pair = {trade["team_a_espn_team_id"], trade["team_b_espn_team_id"]}
        for item in trade["items"]:
            if item.get("source") not in ("ledger", "box_score_diff"):
                failures.append(
                    Failure("trades", f"{where}: item missing a valid source")
                )
            if item["item_type"] == "TRADE":
                sides = {item["from_espn_team_id"], item["to_espn_team_id"]}
                if sides != team_pair:
                    failures.append(
                        Failure(
                            "trades",
                            f"{where}: TRADE item's teams {sides} don't match "
                            f"the trade's own {team_pair}",
                        )
                    )

    missing = representable_ids - trade_ids
    for trade_id in sorted(missing):
        failures.append(
            Failure("trades", f"executed trade {trade_id[:8]} has no trades.json row")
        )
    return failures


def check_player_positions(data: dict[str, Any]) -> list[Failure]:
    """default_position_id is non-null everywhere, and jersey follows ESPN's
    2017 cutoff.

    The app types both `Player.default_position_id` and
    `PlayerSeason.default_position_id` as non-nullable because ESPN reports
    them for every row in the archive (2,010 players, 8,039 player-seasons).
    That typing is only safe while it stays true, so this asserts it rather
    than leaving a future null to surface as a crash in the UI.
    """
    failures = []
    for player in data["players"]:
        if player["default_position_id"] is None:
            failures.append(
                Failure(
                    "player_positions",
                    f"player_id={player['player_id']} ({player['full_name']}): "
                    f"null default_position_id -- the app types this non-null",
                )
            )

    jersey_years = set()
    for row in data["player_seasons"]:
        where = f"{row['year']} player_id={row['player_id']}"
        if row["default_position_id"] is None:
            failures.append(
                Failure(
                    "player_positions",
                    f"{where}: null default_position_id -- the app types this non-null",
                )
            )
        if row["jersey"]:
            jersey_years.add(row["year"])

    # ESPN's player payload carries no jersey before 2017. A jersey appearing
    # in an earlier season would mean the field moved, and every "not reported"
    # caveat written against it would be wrong.
    early = sorted(y for y in jersey_years if y < JERSEY_START_YEAR)
    if early:
        failures.append(
            Failure(
                "player_positions",
                f"jersey numbers present in {early}, before ESPN began reporting them "
                f"({JERSEY_START_YEAR})",
            )
        )
    return failures


def check_jersey_history_overrides(data: dict[str, Any]) -> list[Failure]:
    """Guards data/manual/jersey-history-overrides.json's auto-detected entries (Phase 8
    jersey-trade-detection spec) -- hand-written entries are trusted as-is, since a human
    already verified them against the MLB Stats API by hand (see the file's own _readme).

    Two things only an auto-write could get wrong on its own: (1) an exact-duplicate entry
    for the same (player_id, year, pro_team_id, jersey) -- would mean the merge logic in
    scripts/detect_real_trades.py's merge_auto_entries() double-wrote instead of
    replacing; (2) a pro_team_id that contradicts data/manual/pro-team-overrides.json's
    hand-verified correction for that exact (year, player_id) -- that file's overrides
    exist specifically because kona_player_info.json's own value was wrong for the year,
    so an auto-detected entry silently disagreeing with it would mean detect_real_trades.py
    trusted a stale MLB Stats API team read instead.
    """
    failures = []
    auto = [
        e
        for e in data["jersey_history_overrides"]
        if e.get("source", "").startswith("auto-detected:")
    ]

    seen: set[tuple[int, int, int, str]] = set()
    for e in auto:
        key = (e["player_id"], e["start_year"], e["pro_team_id"], e["jersey"])
        if key in seen:
            failures.append(
                Failure(
                    "jersey_history_overrides",
                    f"{e['start_year']} {e['player_name']}: duplicate auto-detected entry "
                    f"for pro_team_id={e['pro_team_id']} jersey={e['jersey']}",
                )
            )
        seen.add(key)
        if e["start_year"] != e["end_year"]:
            failures.append(
                Failure(
                    "jersey_history_overrides",
                    f"{e['player_name']}: auto-detected entry spans "
                    f"{e['start_year']}-{e['end_year']} -- these are only ever written at "
                    f"year granularity, a multi-year span means something upstream changed",
                )
            )

    pro_team_corrections = {
        (o["year"], o["player_id"]): o["pro_team_id"]
        for o in data["pro_team_overrides"]
    }
    for e in auto:
        correction = pro_team_corrections.get((e["start_year"], e["player_id"]))
        if correction is not None and correction != e["pro_team_id"]:
            failures.append(
                Failure(
                    "jersey_history_overrides",
                    f"{e['start_year']} {e['player_name']}: auto-detected pro_team_id="
                    f"{e['pro_team_id']} contradicts pro-team-overrides.json's hand-verified "
                    f"{correction} for the same year",
                )
            )
    return failures


def check_player_team_points(data: dict[str, Any]) -> list[Failure]:
    """The per-owner points split must roll up exactly to player_season_points.

    Both come from the same box-score pass, so any drift means one of the two
    aggregations changed without the other -- which would silently corrupt
    every "what did this pickup do for the manager who made it" figure the app
    derives from the split. Both sides shed their undecided-week (in-progress)
    contribution first -- see _undecided_weeks for why provisional lines can't
    meet the tolerance.
    """
    failures = []
    undecided = _undecided_weeks(data)
    rolled: dict[tuple[int, int], float] = {}
    rolled_counted: dict[tuple[int, int], float] = {}
    rolled_bench: dict[tuple[int, int], float] = {}
    owner_ids = {o["owner_id"] for o in data["owners"]}
    team_keys = {(t["year"], t["espn_team_id"]) for t in data["teams"]}
    undecided_team_sums = _undecided_contributions(
        data,
        undecided,
        lambda year, line: (
            year,
            line["player_id"],
            line["owner_id"],
            line["espn_team_id"],
        ),
    )
    undecided_player_sums = _undecided_contributions(
        data, undecided, lambda year, line: (year, line["player_id"])
    )

    for row in data["player_team_season_points"]:
        key = (row["year"], row["player_id"])
        u_points, u_counted, u_bench = undecided_team_sums.get(
            (row["year"], row["player_id"], row["owner_id"], row["espn_team_id"]),
            (0.0, 0.0, 0.0),
        )
        decided_points = row["points"] - u_points
        decided_counted = row["counted_points"] - u_counted
        decided_bench = row["bench_points"] - u_bench
        rolled[key] = rolled.get(key, 0.0) + decided_points
        rolled_counted[key] = rolled_counted.get(key, 0.0) + decided_counted
        rolled_bench[key] = rolled_bench.get(key, 0.0) + decided_bench
        where = f"{row['year']} player_id={row['player_id']}"
        if row["owner_id"] not in owner_ids:
            failures.append(
                Failure(
                    "player_team_points",
                    f"{where}: unknown owner_id {row['owner_id']}",
                )
            )
        if (row["year"], row["espn_team_id"]) not in team_keys:
            failures.append(
                Failure(
                    "player_team_points",
                    f"{where}: espn_team_id={row['espn_team_id']} has no team row",
                )
            )
        if abs(decided_counted + decided_bench - decided_points) > 0.05:
            failures.append(
                Failure(
                    "player_team_points",
                    f"{where}: counted/bench split ({decided_counted:.2f}/"
                    f"{decided_bench:.2f}) != points ({row['points']:.2f})",
                )
            )

    season = {(r["year"], r["player_id"]): r for r in data["player_season_points"]}
    for key, total in sorted(rolled.items()):
        expected = season.get(key)
        if expected is None:
            failures.append(
                Failure(
                    "player_team_points",
                    f"{key[0]} player_id={key[1]}: split rows with no "
                    f"player_season_points row to roll up into",
                )
            )
            continue
        u_points, u_counted, u_bench = undecided_player_sums.get(key, (0.0, 0.0, 0.0))
        expected_points = expected["points"] - u_points
        expected_counted = expected["counted_points"] - u_counted
        expected_bench = expected["bench_points"] - u_bench
        # Tolerance absorbs the 2-decimal rounding each side applies
        # independently, nothing more.
        if abs(total - expected_points) > 0.05:
            failures.append(
                Failure(
                    "player_team_points",
                    f"{key[0]} {expected['player_name']}: decided-week split sums to "
                    f"{total:.2f}, season total is {expected_points:.2f} "
                    f"(stored row {expected['points']:.2f})",
                )
            )
        elif (
            abs(rolled_counted[key] - expected_counted) > 0.05
            or abs(rolled_bench[key] - expected_bench) > 0.05
        ):
            failures.append(
                Failure(
                    "player_team_points",
                    f"{key[0]} {expected['player_name']}: decided-week split sums to "
                    f"counted/bench ({rolled_counted[key]:.2f}/"
                    f"{rolled_bench[key]:.2f}) but the season row carries "
                    f"({expected_counted:.2f}/"
                    f"{expected_bench:.2f}) (stored row "
                    f"({expected['counted_points']:.2f}/"
                    f"{expected['bench_points']:.2f}))",
                )
            )

    for key in season:
        if key not in rolled:
            failures.append(
                Failure(
                    "player_team_points",
                    f"{key[0]} player_id={key[1]}: season points row with no "
                    f"per-owner split",
                )
            )
    return failures


def check_box_score_day_reconciliation(data: dict[str, Any]) -> list[Failure]:
    """Per-day counted slot sums must equal ESPN's official day scores.

    The freshest raw mBoxscore file of an in-progress season carries every
    matchup's pointsByScoringPeriod -- ESPN's official per-day team scores.
    Since the cumulative-stitching fix (2026-08, see normalize.py's advance
    handling), processed per-day slots land residual production on the exact
    day ESPN leaves uncovered by per-player data, so every covered day's
    team counted-slot sum must match. This is the check that would have caught
    the 2026 wk21 corruption (a batch-refetched file set whose through-Thursday
    cumulative was dumped onto day 154, silently replacing that day's real
    per-day lines): every covered day of every week reconciles to the cent.

    Scope: in-progress seasons only, and the newest week with pbsp coverage is
    exempt -- its raw captures predate ESPN's post-revision finals until the
    next in-season refresh (--refresh-decided-weeks) re-captures them, so
    per-day slots legitimately carry revision drift against the freshest
    pbsp until then (observed <= ~15pt/day on 2026 wk21; heals on the next
    run). Every older week of the season was healed by a prior refresh and is
    checked exactly -- that is where a stitching bug would survive and be
    caught. A failure means the day-level stitching disagrees with ESPN's
    official day scores for a healed week: re-run normalize (and extract.py
    --refresh-decided-weeks if a capture was partial) rather than pinning it."""
    failures: list[Failure] = []
    in_progress_years = {
        s["year"] for s in data["seasons"] if s.get("status") == "in_progress"
    }

    for year in sorted(in_progress_years):
        # Same filename guard as normalize.py's discover_box_periods -- a
        # nonconforming name (mBoxscore-period.json) would crash the regex.
        candidates = []
        for path in (RAW_DIR / str(year)).glob("mBoxscore-period*.json"):
            digits = path.stem.removeprefix("mBoxscore-period")
            if digits.isdigit():
                candidates.append((int(digits), path))
        freshest = max(candidates, default=None)
        freshest_path = freshest[1] if freshest else None
        if freshest_path is None:
            continue
        payload = load_json(freshest_path)
        expected: dict[tuple[int, int, int], dict[int, float]] = {}
        for m in payload.get("schedule") or []:
            week = m.get("matchupPeriodId")
            for side_key in ("home", "away"):
                side = m.get(side_key) or {}
                team_id = side.get("teamId")
                if team_id is None or week is None:
                    continue
                for day_key, score in (side.get("pointsByScoringPeriod") or {}).items():
                    if not str(day_key).lstrip("-").isdigit():
                        continue  # ESPN's "live" aggregate key, not a day
                    expected.setdefault((m["id"], week, team_id), {})[int(day_key)] = (
                        float(score)
                    )

        # The live window: the newest week with official day scores. Its slots
        # were stitched from captures that predate ESPN's finals (see docstring).
        live_week = max((week for _, week, _ in expected), default=None)

        actual: dict[tuple[int, int], dict[int, float]] = {}
        for line in data["box_scores"].get(year, []):
            key = (line["matchup_id"], line["espn_team_id"])
            for slot in line.get("slots") or []:
                if slot["lineup_slot_id"] in BENCH_AND_IR_SLOTS:
                    continue
                day = slot["scoring_period"]
                actual.setdefault(key, {})
                actual[key][day] = actual[key].get(day, 0.0) + slot["points"]

        for (matchup_id, week, team_id), days in sorted(expected.items()):
            if week == live_week:
                continue
            for day, score in sorted(days.items()):
                got = actual.get((matchup_id, team_id), {}).get(day, 0.0)
                if abs(got - score) > BOX_SCORE_DAY_TOLERANCE:
                    failures.append(
                        Failure(
                            "box_score_day_reconciliation",
                            f"{year} matchup_id={matchup_id} espn_team_id={team_id} "
                            f"day {day}: counted slot sum {got:.2f} != ESPN official "
                            f"day score {score:.2f}",
                        )
                    )
    return failures


# Checks whose check() takes (data, season_notes) -- shared with
# scripts/db/validate_db.py's dispatch, which must not drift from this.
NEEDS_SEASON_NOTES = frozenset(
    ("keepers", "player_references", "pf_box_score_reconciliation")
)

CHECKS = [
    ("team_counts", check_team_counts),
    ("standings_ranks", check_standings_ranks),
    ("wl_reconciliation", check_wl_reconciliation),
    ("playoff_bracket_structure", check_playoff_bracket_structure),
    ("pf_box_score_reconciliation", check_pf_box_score_reconciliation),
    ("box_score_day_reconciliation", check_box_score_day_reconciliation),
    ("seasons_cover_box_scores", check_seasons_cover_box_scores),
    ("stat_line_reconciliation", check_stat_line_reconciliation),
    ("player_season_points_reconciliation", check_player_season_points_reconciliation),
    ("keepers", check_keepers),
    ("player_references", check_player_references),
    ("pro_team_ids", check_pro_team_ids),
    ("player_eligibility", check_player_eligibility),
    ("team_enrichment", check_team_enrichment),
    ("player_ownership", check_player_ownership),
    ("player_season_rollup", check_player_season_rollup),
    ("team_transactions", check_team_transactions),
    ("league_owners", check_league_owners),
    ("achievements_coverage", check_achievements_coverage),
    ("achievements_shape", check_achievements_shape),
    ("achievements_linkage", check_achievements_linkage),
    ("league_rules", check_league_rules),
    ("transaction_ledger", check_transaction_ledger),
    ("trades", check_trades),
    ("player_positions", check_player_positions),
    ("player_team_points", check_player_team_points),
    ("player_season_backfill", check_player_season_backfill),
    ("card_points", check_card_points),
    ("jersey_history_overrides", check_jersey_history_overrides),
]


def main() -> None:
    # Was a hardcoded relative Path("data/raw"), so this guard depended on the
    # caller's cwd instead of the RAW_DIR the rest of the module reads. That
    # broke any caller redirecting the pipeline at another archive -- notably
    # scripts/normalize_for_import.py, which rebinds RAW_DIR per tenant.
    raw_dir = RAW_DIR
    if not raw_dir.is_dir() or not any(raw_dir.iterdir()):
        sys.exit("data/raw/ is empty or missing. Run extract.py first.")

    if not PROCESSED_DIR.exists():
        sys.exit("data/processed/ not found -- run scripts/normalize.py first.")

    data = load_processed()
    season_notes = load_json(MANUAL_DIR / "season-notes.json")
    owner_map = load_owner_map(MANUAL_DIR / "owner-map.json")
    data["owner_map_derived"] = derive_owners_from_owner_map(owner_map)

    all_failures: list[Failure] = []
    for name, check in CHECKS:
        if name in NEEDS_SEASON_NOTES:
            all_failures.extend(check(data, season_notes))
        else:
            all_failures.extend(check(data))
    all_failures.extend(check_owner_mapping(owner_map))

    by_check: dict[str, list[Failure]] = {}
    for f in all_failures:
        by_check.setdefault(f.check, []).append(f)

    check_names = [name for name, _ in CHECKS] + ["owner_mapping"]
    for name in check_names:
        findings = by_check.get(name, [])
        errors = [f for f in findings if f.level == "error"]
        warnings = [f for f in findings if f.level == "warn"]
        if errors:
            status = f"FAIL ({len(errors)})"
        elif warnings:
            status = f"PASS ({len(warnings)} warn)"
        else:
            status = "PASS"
        print(f"{name}: {status}")
        # Errors first: a truncated list should never bury a real failure
        # behind warnings.
        for f in (errors + warnings)[:20]:
            prefix = "warn: " if f.level == "warn" else ""
            print(f"  {prefix}{f.detail}")
        if len(findings) > 20:
            print(f"  ... and {len(findings) - 20} more")

    errors = [f for f in all_failures if f.level == "error"]
    warnings = [f for f in all_failures if f.level == "warn"]
    print(
        f"\n{len(errors)} failures and {len(warnings)} warnings "
        f"across {len(check_names)} checks."
    )
    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
