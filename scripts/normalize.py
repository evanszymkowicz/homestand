#!/usr/bin/env python3
"""Normalization pipeline: raw ESPN archive -> app-facing processed JSON.

Usage:
    python scripts/normalize.py

Always normalizes EVERY year present in data/raw/ -- there is deliberately no
--years flag. A partial run truncates every processed file to the listed years
while leaving box_scores/{year}.json intact, which silently broke the
production flow on 2026-08-20 (a --years 2026 output was committed and every
non-box-score file lost 2009-2025). validate.py's seasons_cover_box_scores
check now fails loudly if that state ever reappears.

Reads data/raw/{year}/{view}.json (scripts/extract.py's output) and the manual
mapping layer under data/manual/ (owner-map.json, player-overrides.json,
season-notes.json). Never fetches -- parsers read local files only. Writes
data/processed/{achievements,owners,seasons,teams,matchups,draft_picks,keepers,
players,player_seasons,player_season_ownership,player_season_points,
player_team_season_points,player_season_backfill,card_points,transactions,trades,mlb_teams}.json
and data/processed/box_scores/{year}.json.

Run scripts/validate.py after every normalize -- validation failures are the
deliverable of Phase 2, not an annoyance.
"""

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path
from collections.abc import Callable
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.box_score_lines import (
    BENCH_AND_IR_SLOT_IDS,
    accumulate,
    applied_raw_stats,
    bench_contribution,
    counted_slot_contribution,
    counted_slot_days,
    day_has_activity,
    day_stat_blocks,
    derive_season_points,
    derive_team_season_points,
    finalize_line,
    matchup_stat_blocks,
    merge_residual_into_slot,
    new_line_entry,
    stat_dict_delta,
)
from lib.espn_client import (
    classify_signal,
    determine_current_week,
    determine_season_status,
    redact_swid,
    unwrap_league_object,
)
from lib.mapping import (
    MappingError,
    OwnerMap,
    PlayerRegistry,
    derive_owner_ids_from_raw,
    espn_member_key,
    load_owner_map,
    resolve_team_owner,
)
from lib.mlb_teams import MLB_TEAMS
from lib.schema import (
    AcquisitionRules,
    BattingLine,
    CardPoints,
    DraftPick,
    DraftSettings,
    EspnMemberKey,
    Keeper,
    LeagueOwner,
    LeagueSettings,
    Matchup,
    MatchupSide,
    PitchingLine,
    PlayerSeasonBackfill,
    RecordSplit,
    RosterRules,
    ScoringItem,
    Season,
    Team,
    TeamTransactions,
    Trade,
    TradeRules,
    Transaction,
    TransactionItem,
    TrophySlot,
    LeagueAchievement,
)
from lib.stat_ids import BATTING_STAT_IDS, PITCHING_STAT_IDS

REPO_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = REPO_ROOT / "data" / "raw"
MANUAL_DIR = REPO_ROOT / "data" / "manual"
PROCESSED_DIR = REPO_ROOT / "data" / "processed"

# ESPN's injured-list lineup slot. Mirrors app/src/lib/lineupSlots.ts's IR_SLOT_ID.
IR_SLOT_ID = 17


def discover_years(raw_dir: Path) -> list[int]:
    return sorted(
        int(p.name) for p in raw_dir.iterdir() if p.is_dir() and p.name.isdigit()
    )


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Corrupt JSON in {path}: {exc}") from exc


# Per-run memoization for load_view (below). Several independent passes read
# the same raw files -- compute_coverage and build_box_scores both walk every
# per-period boxscore file, trade detection re-reads them per team, and
# kona_player_info (~13MB in the current season) is parsed three times per
# year. The cache holds at most ONE year's views: the main loop processes
# years sequentially, so this captures all the reuse while keeping peak
# memory to a single season's parsed corpus. Entries are shared references --
# callers must treat returned structures as read-only.
_view_cache: dict[str, Any] = {}
_view_cache_year: int | None = None


def load_view(year: int, filename: str) -> dict[str, Any] | None:
    global _view_cache_year
    if _view_cache_year != year:
        _view_cache.clear()
        _view_cache_year = year
    if filename not in _view_cache:
        path = RAW_DIR / str(year) / filename
        _view_cache[filename] = (
            unwrap_league_object(_read_json(path)) if path.exists() else None
        )
    return _view_cache[filename]


def load_box_period(year: int, period: int) -> dict[str, Any] | None:
    return load_view(year, f"mBoxscore-period{period}.json")


def discover_box_periods(year: int) -> list[int]:
    periods = []
    for path in (RAW_DIR / str(year)).glob("mBoxscore-period*.json"):
        num = path.stem.removeprefix("mBoxscore-period")
        if num.isdigit():
            periods.append(int(num))
    return sorted(periods)


def load_roster_period(year: int, period: int) -> dict[str, Any] | None:
    return load_view(year, f"mRoster-period{period}.json")


def discover_roster_periods(year: int) -> list[int]:
    """Per-period mRoster files exist only for years whose mBoxscore carries no
    player detail (2018 — see context/research/data-audit-findings.md's probe)."""
    periods = []
    for path in (RAW_DIR / str(year)).glob("mRoster-period*.json"):
        num = path.stem.removeprefix("mRoster-period")
        if num.isdigit():
            periods.append(int(num))
    return sorted(periods)


def discover_achievement_files(year: int) -> list[Path]:
    """Per-member achievements captures exist only for 2026+ (the feature
    launched 2026-02-04); extract.py writes one file per mTeam member."""
    return sorted((RAW_DIR / str(year)).glob("achievements-member*.json"))


def roster_period_sample_signals(year: int, periods: list[int]) -> tuple[bool, bool]:
    """Sample a few per-period mRoster files in one pass. Returns
    (carries_player_days, carries_stat_lines): whether any player has a real
    day-level stat entry at all, and whether any such entry carries a raw
    stats dict (the stat-line source)."""
    if not periods:
        return False, False
    carries_days = False
    for period in sorted({periods[0], periods[len(periods) // 2], periods[-1]}):
        payload = load_roster_period(year, period)
        if not payload:
            continue
        for team in payload.get("teams", []):
            for e in team.get("roster", {}).get("entries", []):
                player = e.get("playerPoolEntry", {}).get("player")
                if not player:
                    continue
                for block in day_stat_blocks(player, period):
                    carries_days = True
                    if block.get("stats"):
                        return True, True
    return carries_days, False


# --- players --------------------------------------------------------------


def register_players_from_kona(
    registry: PlayerRegistry, year: int, kona: dict[str, Any] | None
) -> None:
    if not kona:
        return
    for entry in kona.get("players", []):
        player = entry.get("player")
        if player:
            registry.record(player, year)
            registry.record_fantasy_team(player["id"], year, entry.get("onTeamId"))


def register_players_from_roster(
    registry: PlayerRegistry, year: int, roster: dict[str, Any] | None
) -> None:
    if not roster:
        return
    for team in roster.get("teams", []):
        for entry in team.get("roster", {}).get("entries", []):
            player = entry.get("playerPoolEntry", {}).get("player")
            if player:
                registry.record(player, year)


# --- owners -----------------------------------------------------------------


# --- league rules (Phase 9.3a) -------------------------------------------


def _unlimited_to_none(value: Any) -> int | None:
    """ESPN spells 'no limit' as -1 across roster/acquisition/trade settings."""
    return None if value is None or value == -1 else value


def build_league_rules(year: int, payload: dict[str, Any]) -> dict[str, Any]:
    """The four rule blocks Season had no representation for, parsed from
    mSettings. Every field here was checked against all 17 archived seasons
    before adoption (Source-of-Truth Rule, rule 2) -- see the spec's Phase 9.3a
    notes for the field-level corrections that check produced."""
    settings = payload["settings"]
    roster = settings.get("rosterSettings") or {}
    acquisition = settings.get("acquisitionSettings") or {}
    draft = settings.get("draftSettings") or {}
    trade = settings.get("tradeSettings") or {}

    using_budget = bool(acquisition.get("isUsingAcquisitionBudget"))
    is_auction = draft.get("type") == "AUCTION"

    return {
        "settings": asdict(
            LeagueSettings(
                league_id=payload["id"],
                league_name=settings.get("name", ""),
                league_size=settings.get("size", 0),
                is_public=bool(settings.get("isPublic")),
            )
        ),
        "roster_rules": asdict(
            RosterRules(
                # Zero-count slots and ESPN's -1 "no limit" are dropped rather
                # than stored: both mean "no constraint", and ESPN emits a key
                # for every slot/position id whether or not it's in play.
                lineup_slot_counts={
                    slot: count
                    for slot, count in (roster.get("lineupSlotCounts") or {}).items()
                    if count
                },
                position_limits={
                    position: limit
                    for position, limit in (roster.get("positionLimits") or {}).items()
                    if limit != -1
                },
                bench_unlimited=bool(roster.get("isBenchUnlimited")),
                move_limit=_unlimited_to_none(roster.get("moveLimit")),
                lineup_lock_time=roster.get("lineupLocktimeType", ""),
                roster_lock_time=roster.get("rosterLocktimeType", ""),
                using_undroppable_list=bool(roster.get("isUsingUndroppableList")),
            )
        ),
        "acquisition_rules": asdict(
            AcquisitionRules(
                acquisition_type=acquisition.get("acquisitionType", ""),
                waiver_hours=acquisition.get("waiverHours", 0),
                waiver_order_reset=bool(acquisition.get("waiverOrderReset")),
                waiver_process_days=list(acquisition.get("waiverProcessDays") or []),
                waiver_process_hour=acquisition.get("waiverProcessHour", 0),
                minimum_bid=float(acquisition.get("minimumBid", 0) or 0),
                using_acquisition_budget=using_budget,
                # A budget of 0 in a league that doesn't use one is ESPN's
                # default, not a real rule -- keep the flag, drop the number.
                acquisition_budget=(
                    float(acquisition.get("acquisitionBudget", 0) or 0)
                    if using_budget
                    else None
                ),
                acquisition_limit=_unlimited_to_none(
                    acquisition.get("acquisitionLimit")
                ),
                matchup_acquisition_limit=(
                    acquisition.get("matchupAcquisitionLimit") or None
                ),
                transaction_locking_enabled=bool(
                    acquisition.get("transactionLockingEnabled")
                ),
            )
        ),
        "draft_settings": asdict(
            DraftSettings(
                draft_type=draft.get("type", ""),
                order_type=draft.get("orderType", ""),
                keeper_count=draft.get("keeperCount", 0),
                keeper_order_type=draft.get("keeperOrderType", ""),
                keeper_deadline_date=draft.get("keeperDeadlineDate"),
                auction_budget=(
                    float(draft.get("auctionBudget", 0) or 0) if is_auction else None
                ),
                time_per_pick=draft.get("timePerSelection", 0),
            )
        ),
        "trade_rules": asdict(
            TradeRules(
                deadline_date=trade.get("deadlineDate"),
                max_trades=_unlimited_to_none(trade.get("max")),
                revision_hours=trade.get("revisionHours", 0),
                veto_votes_required=trade.get("vetoVotesRequired", 0),
            )
        ),
    }


# --- ESPN-derived owners (Phase 9.3a) ------------------------------------


def build_league_owners(
    owner_map: OwnerMap, years: list[int]
) -> tuple[list[dict[str, Any]], list[str]]:
    """Canonical owners derived from ESPN's own member records rather than from
    owner-map.json's stored team_seasons.

    Emitted alongside owners.json during 9.3a; nothing reads it yet. The name
    join still runs through owner-map.json's name_index -- that's the one thing
    ESPN can't supply, since its member records carry no stable canonical name.
    SWIDs are hashed on the way out (see mapping.espn_member_key).

    Returns (owners, problems); problems are surfaced by the caller rather than
    raised, so a single unresolvable member doesn't abort the whole run.
    """
    keys_by_owner: dict[str, dict[str, set[int]]] = {}
    names_by_owner: dict[str, dict[str, list[str]]] = {}
    co_owners: dict[str, set[str]] = {}
    years_by_owner: dict[str, set[int]] = {}
    problems: list[str] = []

    for year in years:
        payload = load_view(year, "mTeam.json")
        if not payload:
            continue
        members_by_swid = {m["id"]: m for m in payload.get("members", [])}
        for team in payload.get("teams", []):
            try:
                owner_ids, _primary = derive_owner_ids_from_raw(
                    owner_map, members_by_swid, team
                )
            except MappingError as exc:
                problems.append(f"{year} espn_team_id={team['id']}: {exc}")
                continue
            for owner_id in owner_ids:
                years_by_owner.setdefault(owner_id, set()).add(year)
                by_year = names_by_owner.setdefault(owner_id, {})
                names = by_year.setdefault(str(year), [])
                if team["name"] not in names:
                    names.append(team["name"])
                co_owners.setdefault(owner_id, set()).update(
                    other for other in owner_ids if other != owner_id
                )
            for swid in team.get("owners", []):
                member = members_by_swid.get(swid)
                if member is None:
                    continue
                key = (
                    member.get("firstName", "").strip().lower(),
                    member.get("lastName", "").strip().lower(),
                )
                owner_id = owner_map.name_index.get(key)
                if owner_id is None:
                    continue
                member_keys = keys_by_owner.setdefault(owner_id, {})
                member_keys.setdefault(espn_member_key(swid), set()).add(year)

    # Coverage, not retirement -- see LeagueOwner's field comment. An owner who
    # sat out the latest season and one who left the league read identically
    # here, which is precisely why retired-owners.json still exists.
    latest_year = max(years) if years else None

    owners = []
    for owner_id, owner in sorted(owner_map.owners_by_id.items()):
        seen = years_by_owner.get(owner_id, set())
        if not seen:
            continue  # in owner-map.json but never resolved from ESPN's records
        last_year = max(seen)
        owners.append(
            asdict(
                LeagueOwner(
                    owner_id=owner_id,
                    canonical_name=owner["canonical_name"],
                    espn_member_keys=[
                        asdict(EspnMemberKey(member_key=key, years=sorted(key_years)))
                        for key, key_years in sorted(
                            keys_by_owner.get(owner_id, {}).items()
                        )
                    ],
                    team_names_by_year=dict(
                        sorted(names_by_owner.get(owner_id, {}).items())
                    ),
                    co_owners=sorted(co_owners.get(owner_id, set())),
                    last_active_year=last_year,
                    absent_from_latest_season=last_year != latest_year,
                    is_commissioner=owner.get("is_commissioner", False),
                )
            )
        )
    return owners, problems


# --- achievements ---------------------------------------------------------


def build_achievements(
    owner_map: OwnerMap, years: list[int]
) -> tuple[list[dict[str, Any]], list[str]]:
    """Per-member trophy records from extract.py's achievements-member files
    (2026+ only -- discover_achievement_files finds nothing earlier).

    Each raw file is one member's response from the achievements sub-path:
    list-wrapped {member: {id (SWID), displayName, isLeagueManager}, team:
    {abbrev, id, owners[]}, achievements: [20 slots], seasonIds}. The slot
    array is stored positionally (TrophySlot) -- ESPN names no trophies here.
    Owner attribution rides the same join build_league_owners uses: SWID ->
    mTeam members[] -> (first, last) -> owner-map name_index. A member that
    resolves to no owner still emits (with owner_id None) so the trophy data
    isn't lost; validate.py's linkage check fails loudly on it.

    Returns (records, problems); problems surface through build_archive's
    error list like every other builder's.
    """
    records: list[dict[str, Any]] = []
    problems: list[str] = []

    for year in years:
        files = discover_achievement_files(year)
        if not files:
            continue
        team_payload = load_view(year, "mTeam.json")
        members_by_swid = {
            m["id"]: m for m in (team_payload or {}).get("members", []) if m.get("id")
        }
        for path in files:
            label = f"{year} {path.name}"
            try:
                payload = unwrap_league_object(json.loads(path.read_text()))
            except json.JSONDecodeError:
                problems.append(f"{label}: not valid JSON")
                continue
            member = payload.get("member") or {}
            swid = member.get("id")
            if not isinstance(swid, str) or not swid:
                problems.append(f"{label}: response has no member id")
                continue
            mteam_member = members_by_swid.get(swid)
            name_key = (
                (mteam_member or {}).get("firstName", "").strip().lower(),
                (mteam_member or {}).get("lastName", "").strip().lower(),
            )
            owner_id = owner_map.name_index.get(name_key)
            if owner_id is None:
                who = member.get("displayName") or "unknown member"
                problems.append(f"{label}: member {who!r} unresolved to an owner")
            team = payload.get("team") or {}
            espn_team_id = team.get("id")
            slots_raw = payload.get("achievements")
            if not isinstance(slots_raw, list):
                problems.append(f"{label}: no achievements array")
                continue
            records.append(
                asdict(
                    LeagueAchievement(
                        year=year,
                        member_key=espn_member_key(swid),
                        owner_id=owner_id,
                        espn_team_id=(
                            espn_team_id if isinstance(espn_team_id, int) else None
                        ),
                        trophies=[
                            TrophySlot(slot=slot, earned=bool(occupied))
                            for slot, occupied in enumerate(slots_raw)
                        ],
                    )
                )
            )

    records.sort(key=lambda r: (r["year"], r["member_key"]))
    return records, problems


# --- seasons ------------------------------------------------------------


def compute_coverage(year: int, box_periods: list[int]) -> dict[str, str]:
    def signal_for(filename: str, view: str) -> str:
        payload = load_view(year, filename)
        if payload is None:
            return "missing"
        signal, _ = classify_signal(view, payload)
        return "full" if signal == "ok" else "partial"

    def has_player_level_data(payload: dict[str, Any]) -> bool:
        # A non-empty `schedule` alone isn't enough: 2018's leagueHistory-
        # fallback box scores have matchup totals but neither
        # rosterForCurrentScoringPeriod nor rosterForMatchupPeriod, i.e. no
        # player-level detail at all. See build_box_scores()'s docstring.
        for m in payload.get("schedule", []):
            for side_key in ("home", "away"):
                side = m.get(side_key)
                if not side:
                    continue
                roster = side.get("rosterForCurrentScoringPeriod") or side.get(
                    "rosterForMatchupPeriod"
                )
                if roster and roster.get("entries"):
                    return True
        return False

    def day_stat_line_state(payload: dict[str, Any], period: int) -> str:
        # "ok"   -> players' day blocks for this period carry raw stats dicts
        #           (the stat-line source; see day_stat_blocks).
        # "bad"  -> some block applied points without a raw stats dict -- the
        #           one shape that would break stat-line reconciliation. Wins
        #           over "ok": a single such block anywhere in the period means
        #           this day's stat lines can't be trusted as complete.
        # "none" -> nothing but empty husk blocks (stats/appliedStats empty,
        #           appliedTotal 0) or no day blocks at all: an MLB off-day,
        #           2020's canceled pre-COVID scoring periods, or an era whose
        #           player data is per-matchup only (2009-2017). Neutral, so
        #           days without baseball don't drag "full" down to "partial".
        saw_stats = False
        for m in payload.get("schedule", []):
            for side_key in ("home", "away"):
                side = m.get(side_key)
                if not side:
                    continue
                roster = side.get("rosterForCurrentScoringPeriod")
                if not roster:
                    continue
                for e in roster.get("entries", []):
                    player = e.get("playerPoolEntry", {}).get("player")
                    if not player:
                        continue
                    for block in day_stat_blocks(player, period):
                        if block.get("stats"):
                            saw_stats = True
                        elif block.get("appliedStats") or block.get("appliedTotal"):
                            return "bad"
        return "ok" if saw_stats else "none"

    box_signal = "missing"
    stat_line_signal = "missing"
    if box_periods:
        signals = []
        stat_states = []
        for period in box_periods:
            payload = load_box_period(year, period)
            signals.append(
                "ok" if payload and has_player_level_data(payload) else "empty"
            )
            stat_states.append(
                day_stat_line_state(payload, period) if payload else "none"
            )
        if all(s == "ok" for s in signals):
            box_signal = "full"
        elif any(s == "ok" for s in signals):
            box_signal = "partial"
        else:
            box_signal = "missing"

        active_days = [s for s in stat_states if s != "none"]
        if active_days and all(s == "ok" for s in active_days):
            stat_line_signal = "full"
        elif any(s == "ok" for s in active_days):
            stat_line_signal = "partial"

    # Player-level data recovered via per-period mRoster (2018) caps at "partial",
    # never "full": every response carries the season-end roster, so day lineups and
    # mid-season movers are unrecoverable (data-audit-findings.md's 2018 probe).
    if box_signal == "missing" or stat_line_signal == "missing":
        carries_days, carries_lines = roster_period_sample_signals(
            year, discover_roster_periods(year)
        )
        if box_signal == "missing" and carries_days:
            box_signal = "partial"
        if stat_line_signal == "missing" and carries_lines:
            stat_line_signal = "partial"

    return {
        "teams": signal_for("mTeam.json", "mTeam"),
        "matchups": signal_for("mMatchupScore.json", "mMatchupScore"),
        "draft": signal_for("mDraftDetail.json", "mDraftDetail"),
        "rosters": signal_for("mRoster.json", "mRoster"),
        "players": signal_for("kona_player_info.json", "kona_player_info"),
        "box_scores": box_signal,
        # Raw batting/pitching stat lines are a narrower capability than
        # points-level box scores: 2009-2017 raw data carries per-matchup
        # points but only season-cumulative stat dicts, so lines there stay
        # points-only ("missing") even though box_scores is "full".
        "stat_lines": stat_line_signal,
        # Binary in practice: ESPN's per-period mTransactions2 either serves a
        # season or it doesn't, and it doesn't for 2009-2018. Never "partial" --
        # a period file with no `transactions` key is a quiet day, not a hole.
        "transactions": ("full" if discover_transaction_periods(year) else "missing"),
        # Binary like transactions: 2026+ only (the feature launched 2026-02-04
        # and ESPN serves no earlier seasons), and zero earned trophies is a
        # quiet state, not a hole -- the per-member template IS the coverage.
        "achievements": ("full" if discover_achievement_files(year) else "missing"),
    }


def build_season(
    year: int,
    settings: dict[str, Any],
    matchupscore: dict[str, Any] | None,
    season_notes: dict[str, Any],
    box_periods: list[int],
) -> dict[str, Any]:
    schedule_settings = settings["settings"]["scheduleSettings"]
    regular_season_weeks = schedule_settings["matchupPeriodCount"]
    total_weeks = len(schedule_settings["matchupPeriods"])
    playoff_weeks = total_weeks - regular_season_weeks
    playoff_team_count = schedule_settings["playoffTeamCount"]
    divisions = [
        {"division_id": d["id"], "name": d["name"]}
        for d in schedule_settings.get("divisions", [])
    ]

    tiers: set[str] = set()
    if matchupscore:
        for m in matchupscore.get("schedule", []):
            tier = m.get("playoffTierType")
            if tier not in (None, "NONE"):
                tiers.add(tier)

    # _note is the internal audit trail (data/manual/season-notes.json); it only
    # surfaces in the app's public seasons.json "notes" (rendered directly in
    # the Season view) when the entry also opts in with _public: true -- most
    # notes are provenance writeups not meant for league members to read.
    notes = []
    year_notes = season_notes.get("seasons", {}).get(str(year))
    if year_notes and year_notes.get("_public") and year_notes.get("_note"):
        notes.append(year_notes["_note"])

    scoring = [
        ScoringItem(stat_id=item["statId"], points=item["points"])
        for item in sorted(
            settings["settings"]["scoringSettings"]["scoringItems"],
            key=lambda item: item["statId"],
        )
    ]

    return asdict(
        Season(
            year=year,
            regular_season_weeks=regular_season_weeks,
            playoff_weeks=playoff_weeks,
            playoff_team_count=playoff_team_count,
            playoff_brackets=sorted(tiers),
            divisions=[
                {"division_id": d["division_id"], "name": d["name"]} for d in divisions
            ],
            scoring=scoring,
            coverage=compute_coverage(year, box_periods),
            status=determine_season_status(settings, matchupscore),
            current_week=determine_current_week(settings),
            notes=notes,
            **build_league_rules(year, settings),
        )
    )


# --- teams ----------------------------------------------------------------


def _record_split(record: dict[str, Any]) -> dict[str, Any]:
    return asdict(
        RecordSplit(
            wins=record["wins"],
            losses=record["losses"],
            ties=record["ties"],
            points_for=record["pointsFor"],
            points_against=record["pointsAgainst"],
        )
    )


def _team_transactions(counter: dict[str, Any]) -> dict[str, Any]:
    """mTeam's transactionCounter -> schema.TeamTransactions. Present for all 17
    seasons.

    `acquisitions` is repaired where ESPN's own two sources contradict each
    other. Normally the per-week matchupAcquisitionTotals sum lands just *under*
    the season scalar, since a few acquisitions fall outside matchup weeks. 2018
    inverts that: its scalar reads 14 league-wide against a per-week sum of 348
    -- in range for the era and consistent with that season's 352 drops -- so
    the scalar is the broken half, not the per-week data. Taking the larger of
    the two keeps every other season untouched (their scalar already wins) while
    repairing 2018, and generalizes to any future season ESPN breaks the same
    way. validate.py's team_transactions re-reads the raw archive and reports
    each repair, so a silently-corrected value can't hide."""
    per_week = {
        week: count
        for week, count in (counter.get("matchupAcquisitionTotals") or {}).items()
        if count
    }
    return asdict(
        TeamTransactions(
            acquisitions=max(counter.get("acquisitions", 0), sum(per_week.values())),
            drops=counter.get("drops", 0),
            trades=counter.get("trades", 0),
            moves_to_active=counter.get("moveToActive", 0),
            moves_to_ir=counter.get("moveToIR", 0),
            acquisitions_budget_spent=float(
                counter.get("acquisitionBudgetSpent", 0) or 0
            ),
            team_charges=float(counter.get("teamCharges", 0) or 0),
            acquisitions_by_week=per_week,
        )
    )


def build_teams(
    year: int, team_payload: dict[str, Any], owner_map: OwnerMap
) -> list[dict[str, Any]]:
    teams = []
    for t in sorted(team_payload.get("teams", []), key=lambda x: x["id"]):
        entry = resolve_team_owner(owner_map, year, t["id"])
        record = t["record"]
        teams.append(
            asdict(
                Team(
                    year=year,
                    espn_team_id=t["id"],
                    owner_ids=entry["owner_ids"],
                    primary_owner_id=entry["primary_owner_id"],
                    team_name=t["name"],
                    division_id=t["divisionId"],
                    final_rank=t["rankCalculatedFinal"],
                    playoff_seed=t["playoffSeed"],
                    overall=_record_split(record["overall"]),
                    home=_record_split(record["home"]),
                    away=_record_split(record["away"]),
                    division_record=_record_split(record["division"]),
                    streak_type=record["overall"]["streakType"],
                    streak_length=record["overall"]["streakLength"],
                    # ESPN's 0 is a "not set" sentinel for all three of these
                    # (no elimination, no projection), never a real rank/week.
                    eliminated=t["eliminated"],
                    elimination_matchup_period=t["eliminationMatchupPeriod"] or None,
                    points_adjusted=t["pointsAdjusted"],
                    current_projected_rank=t["currentProjectedRank"] or None,
                    is_transaction_locked=t["isTransactionLocked"],
                    draft_day_projected_rank=t["draftDayProjectedRank"] or None,
                    waiver_rank=t.get("waiverRank"),
                    logo_url=t.get("logo"),
                    # Zero counts are dropped: absent means the team never
                    # recorded that stat, which is what a 0 said anyway, and
                    # ESPN emits a key for every scorable statId.
                    value_by_stat={
                        stat_id: value
                        for stat_id, value in (t.get("valuesByStat") or {}).items()
                        if value
                    },
                    transactions=_team_transactions(t.get("transactionCounter") or {}),
                )
            )
        )
    return teams


# --- matchups ---------------------------------------------------------------


def build_matchups(
    year: int, matchupscore: dict[str, Any], owner_map: OwnerMap
) -> list[dict[str, Any]]:
    def side(side_payload: dict[str, Any] | None) -> dict[str, Any] | None:
        if side_payload is None:
            return None
        entry = resolve_team_owner(owner_map, year, side_payload["teamId"])
        return asdict(
            MatchupSide(
                owner_id=entry["primary_owner_id"],
                espn_team_id=side_payload["teamId"],
                score=side_payload["totalPoints"],
            )
        )

    matchups = []
    for m in matchupscore.get("schedule", []):
        tier = m.get("playoffTierType")
        matchups.append(
            asdict(
                Matchup(
                    year=year,
                    week=m["matchupPeriodId"],
                    matchup_id=m["id"],
                    playoff_tier=None if tier in (None, "NONE") else tier,
                    winner=m.get("winner", "UNDECIDED"),
                    home=side(m.get("home")),
                    away=side(m.get("away")),
                )
            )
        )
    return matchups


# --- draft picks & keepers ---------------------------------------------


def load_pro_team_overrides() -> dict[tuple[int, int], int]:
    """(year, player_id) -> corrected pro_team_id, from the hand-verified
    data/manual/pro-team-overrides.json.

    That season's own kona_player_info.json usually reflects the real team
    correctly (see load_pro_team_lookup's docstring), but ESPN keeps a
    season's player data mutable through the following offseason until that
    league's next keeper deadline locks it in. A player who was a real free
    agent very late in that offseason (occasionally frozen even later by a
    lockout) gets caught as proTeamId 0 by this project's snapshot, even
    though he had a real team for the entire labeled season -- see this
    file's _readme.
    """
    raw = _read_json(MANUAL_DIR / "pro-team-overrides.json")
    return {
        (o["year"], o["player_id"]): o["pro_team_id"] for o in raw.get("overrides", [])
    }


def load_pro_team_lookup(
    year: int, overrides: dict[tuple[int, int], int]
) -> dict[int, int]:
    """player_id -> proTeamId, from that season's OWN kona_player_info.json.

    Deliberately per-year, not merged across years: ESPN doesn't version a
    player's bio/team fields historically within a single request, but each
    year's kona_player_info.json genuinely reflects that season's real team
    (verified against known mid-career moves, e.g. Albert Pujols correctly
    shows STL 2009-2011, then LAA for all nine of his Angels seasons
    2012-2020, then STL again in 2022). A cross-year "most recent" merge
    would be wrong -- see context/research/schema-decisions.md.
    """
    payload = load_view(year, "kona_player_info.json")
    lookup = (
        {
            e["player"]["id"]: e["player"].get("proTeamId", 0)
            for e in payload.get("players", [])
            if e.get("player")
        }
        if payload
        else {}
    )
    for player_id in list(lookup):
        override = overrides.get((year, player_id))
        if override is not None:
            lookup[player_id] = override
    return lookup


def build_draft_picks(
    year: int,
    draft_payload: dict[str, Any],
    owner_map: OwnerMap,
    player_registry: PlayerRegistry,
    pro_team_lookup: dict[int, int],
) -> list[dict[str, Any]]:
    picks = []
    for p in draft_payload.get("draftDetail", {}).get("picks", []):
        entry = resolve_team_owner(owner_map, year, p["teamId"])
        player_id = player_registry.canonical_id(p["playerId"])
        player = player_registry.players.get(player_id)
        owning_team_ids = p.get("owningTeamIds") or [p["teamId"]]
        traded_pick = owning_team_ids != [p["teamId"]]
        picks.append(
            asdict(
                DraftPick(
                    year=year,
                    overall_pick_number=p["overallPickNumber"],
                    round_id=p["roundId"],
                    round_pick_number=p["roundPickNumber"],
                    espn_team_id=p["teamId"],
                    owner_id=entry["primary_owner_id"],
                    player_id=player_id,
                    player_name=player["full_name"] if player else "",
                    keeper=bool(p.get("keeper")),
                    traded_pick=traded_pick,
                    # owningTeamIds' last element is always the original owner regardless of
                    # list length -- confirmed across the full raw archive (single-element lists
                    # give the original team directly; two-element lists are [drafter, original]).
                    traded_from_espn_team_id=(
                        owning_team_ids[-1] if traded_pick else None
                    ),
                    pro_team_id=pro_team_lookup.get(player_id),
                )
            )
        )
    return picks


def build_keepers(
    draft_picks: list[dict[str, Any]], prior_year_rosters: dict[int, set[int]]
) -> list[dict[str, Any]]:
    keepers = []
    for pick in draft_picks:
        if not pick["keeper"]:
            continue
        prior_roster = prior_year_rosters.get(pick["espn_team_id"], set())
        keepers.append(
            asdict(
                Keeper(
                    year=pick["year"],
                    espn_team_id=pick["espn_team_id"],
                    owner_id=pick["owner_id"],
                    player_id=pick["player_id"],
                    player_name=pick["player_name"],
                    round_id=pick["round_id"],
                    overall_pick_number=pick["overall_pick_number"],
                    validated_on_prior_roster=pick["player_id"] in prior_roster,
                    pro_team_id=pick["pro_team_id"],
                )
            )
        )
    return keepers


def roster_player_ids_by_team(
    roster_payload: dict[str, Any] | None,
) -> dict[int, set[int]]:
    if not roster_payload:
        return {}
    out: dict[int, set[int]] = {}
    for team in roster_payload.get("teams", []):
        ids = {e["playerId"] for e in team.get("roster", {}).get("entries", [])}
        out[team["id"]] = ids
    return out


# --- box scores ---------------------------------------------------------


def build_box_scores(
    year: int,
    box_periods: list[int],
    owner_map: OwnerMap,
    player_registry: PlayerRegistry,
    anchor_to_snapshots: bool = False,
) -> list[dict[str, Any]]:
    """Player-level lines per matchup, accumulated across the raw per-scoring-
    period box score files.

    Three incompatible raw shapes exist (see context/research/schema-decisions.md
    and data-audit-findings.md's 2018 probe):
    - 2019+: `rosterForCurrentScoringPeriod` -- a true per-day snapshot, only
      populated in the period file(s) that actually fall within a matchup's
      week, so it's safe to sum appliedStatTotal across every period file.
      Each day's raw stat dict (day_stat_block) also accumulates into the
      line's batting/pitching stat lines.
    - 2009-2017 (leagueHistory era): `rosterForMatchupPeriod` -- already a
      per-matchup total, identical across every period file in that matchup's
      window, so it must be read exactly once per (matchup, team) or totals
      get multiplied by however many period files span that week. Player stat
      blocks in this era are season-cumulative only (never per-day or
      per-matchup), so batting/pitching stay None -- coverage.stat_lines is
      "missing" for these years.
    - 2018 (leagueHistory fallback for that single season): the box scores carry
      neither field -- player detail comes from mRoster-period{N}.json instead
      (each carries per-player day stats for period N, including the raw stat
      dict, so stat lines accumulate the same way as 2019+). Fidelity caveats,
      all documented in season-notes.json: the roster ESPN serves is always the
      season-end one, so every player is attributed to their final team for the
      whole season (mid-season movers get misattributed, dropped players are
      invisible) and lineup_slot_id is the season-end slot, not the day's --
      which is why this year's coverage.box_scores is "partial", never "full".

    With anchor_to_snapshots (in-progress seasons only), every dual-roster-era
    line is pinned to its latest rosterForMatchupPeriod cumulative snapshot
    after stitching -- see the anchor pass near the end of this function.
    """
    # key: (matchup_id, espn_team_id, player_id) -> accumulator
    lines: dict[tuple[int, int, int], dict[str, Any]] = {}
    static_matchups_seen: set[tuple[int, int]] = set()  # (matchup_id, team_id)
    # Cumulative player points/stats seen on the prior scoring period; used when
    # both rosterForCurrentScoringPeriod and rosterForMatchupPeriod are present
    # (2019+ in-progress seasons, notably 2026) to derive reliable daily deltas
    # from the cumulative block and daily slots from the current block.
    prev_cumulative: dict[
        tuple[int, int, int], dict[str, Any]
    ] = {}  # key -> {"points": float, "stats": dict[int, int], "slot": int}
    # Latest daily-block slot per (matchup, team, player) within a team-week,
    # updated every period; see the last_daily_slot assignment in the per-day
    # loop for why it exists.
    last_daily_slot: dict[tuple[int, int, int], int] = {}
    # Per-team total of the cumulative block for the prior scoring period, keyed
    # only once a genuine snapshot has been seen. When it advances between
    # consecutive files the archive is being fetched live (one file per day) and
    # day-to-day points must come from cumulative deltas; when it stays flat the
    # files are backfilled snapshots of an already-completed week and the
    # per-day block is authoritative. A backfilled week's *first* file also
    # carries a non-zero week-to-date cumulative, but that is not an advance --
    # there was no prior snapshot -- so membership, not value, is what matters.
    team_cumulative_totals: dict[tuple[int, int], float] = {}
    # Per-team cumulative total from TWO periods ago (period N-1 when processing
    # period N+1). Used to detect off-days: if the cumulative didn't advance from
    # period N-1 to period N, then period N was an off-day.
    prev_team_cumulative_totals: dict[tuple[int, int], float] = {}
    # Deferred cumulative fills for backfill-gap periods. When a period shows
    # both a cumulative advance and a complete per-day block, the advance spans
    # several days (a week's early files backfilled, later ones fetched live),
    # so the delta cannot be attributed until the following period's per-day
    # reveals how much of it belongs to the current day. key (matchup_id,
    # team_id) -> list of {"day", "points", "stats", "slot", "player"}.
    pending_fill: dict[tuple[int, int], list[dict[str, Any]]] = {}
    # In-progress seasons only (anchor_to_snapshots): queued cumulative
    # advances awaiting resolution, keyed (matchup_id, team_id). Each advance
    # carries the day span its delta covers and per-player deltas; the span is
    # resolved once its last day's per-day data has been seen. See the
    # advance-handling blocks in the dual-roster loop below.
    pending_advances: dict[tuple[int, int], list[dict[str, Any]]] = {}
    # Coverage horizon (highest pointsByScoringPeriod day) of the cumulative
    # snapshot last seen per team-week -- the authority for which days an
    # advance spans. It is NOT the file's period: batch-fetched or lagging
    # captures carry horizons well behind (or ahead of) their own period.
    cum_through: dict[tuple[int, int], int] = {}
    # Minimum share of the current roster with a real per-day contribution
    # (points or active stat block) for a day to count as complete. Live
    # pre-game captures show ~0%; completed days show a meaningful fraction
    # (a quiet Monday can still land near 0.1).
    PER_DAY_COVERAGE_MIN = 0.1
    # Latest matchup-cumulative snapshot seen per line key, from each period
    # file's rosterForMatchupPeriod block. ESPN's authoritative running total
    # for that matchup -- the anchor that build_box_scores pins every line's
    # totals to after the delta-chain stitch below, so retro-revisions between
    # once-captured snapshots can't leave points and stats inconsistent.
    latest_cumulative: dict[tuple[int, int, int], dict[str, Any]] = {}
    # ESPN-declared defaultPositionId per line key, captured from whichever
    # payload first carried the player -- the slot-label consolidation's
    # fallback for pitching-only lines whose slot evidence is missing.
    default_position_by_key: dict[tuple[int, int, int], int] = {}

    def add_line(
        matchup_id: int,
        week: int,
        team_id: int,
        player_obj: dict[str, Any],
        points: float,
        slot_id: int,
        period: int,
        stats: dict[str, Any] | None,
    ) -> None:
        # Registration happens here (plus the kona/mRoster pass in main), so a
        # player's players.json presence and seasons_seen require at least one
        # day that survives the day_has_activity guard -- a season spent
        # entirely rostered-but-inactive leaves no players.json trace.
        player_id = player_registry.record(player_obj, year)
        key = (matchup_id, team_id, player_id)
        default_position = player_obj.get("defaultPositionId")
        if default_position is not None:
            default_position_by_key[key] = default_position
        if key not in lines:
            entry = resolve_team_owner(owner_map, year, team_id)
            lines[key] = new_line_entry(
                year,
                week,
                matchup_id,
                entry["primary_owner_id"],
                team_id,
                player_id,
                player_obj.get("fullName", ""),
            )
        accumulate(lines[key], points, slot_id, period, stats)

    def resolve_advance(team_key: tuple[int, int], advance: dict[str, Any]) -> None:
        """Emit one queued cumulative advance's unexplained residual.

        For a span of newly covered days, the advance's per-player deltas are
        the counted-only production between two cumulative snapshots
        (rosterForMatchupPeriod omits benched players); whatever part of that
        production the span's days already carry as counted per-day slots is
        subtracted. A same-horizon retro-revision skips the subtraction -- its
        baseline is the snapshot the slots already reconcile to, so the delta
        IS the residual.

        The remainder lands on the span's earliest day without any slot at all
        (add_line upserts by period, so a day holding only a bench/IR row must
        never be an add target -- that would clobber the IL marker and, via the
        slot label, double-count the production at anchoring). When every span
        day carries a slot, the residual folds into the span's last counted
        slot rather than replacing that day's per-day line via accumulate()'s
        upsert."""
        matchup_id, team_id = team_key
        span_lo, span_hi = advance["span"]
        for player_id, delta in advance["deltas"].items():
            key = (matchup_id, team_id, player_id)
            entry = lines.get(key)
            if advance.get("subtract_slots", True):
                for day in range(span_lo, span_hi + 1):
                    slot_points, slot_stats = counted_slot_contribution(entry, day)
                    delta["points"] -= slot_points
                    for stat_id_str, value in slot_stats.items():
                        delta["stats"][stat_id_str] = (
                            delta["stats"].get(stat_id_str, 0) - value
                        )
            if abs(delta["points"]) < 0.005 and not any(delta["stats"].values()):
                continue
            occupied = set(counted_slot_days(entry))
            uncovered = [
                day
                for day in range(span_lo, span_hi + 1)
                if day not in occupied
                and not (
                    entry is not None
                    and any(s["scoring_period"] == day for s in entry["slots"])
                )
            ]
            if uncovered:
                add_line(
                    matchup_id,
                    advance["week"],
                    team_id,
                    delta["player"],
                    delta["points"],
                    delta["slot"],
                    uncovered[0],
                    delta["stats"],
                )
            else:
                counted_days = [
                    day for day in range(span_lo, span_hi + 1) if day in occupied
                ]
                if counted_days:
                    merge_residual_into_slot(
                        entry, counted_days[-1], delta["points"], delta["stats"]
                    )
                else:
                    # Defensive: every span day carries only bench/IR rows.
                    # Counted production must still land somewhere -- replacing
                    # the last day's marker beats dropping the points or
                    # bench-labeling them (which the anchor would double-count).
                    add_line(
                        matchup_id,
                        advance["week"],
                        team_id,
                        delta["player"],
                        delta["points"],
                        delta["slot"],
                        span_hi,
                        delta["stats"],
                    )

    for period in box_periods:
        payload = load_box_period(year, period)
        if not payload:
            continue
        # Save current team_cumulative_totals as prev for off-day detection
        period_prev_cumulative_totals = dict(team_cumulative_totals)
        for m in payload.get("schedule", []):
            week = m["matchupPeriodId"]
            matchup_id = m["id"]
            for side_key in ("home", "away"):
                side_payload = m.get(side_key)
                if not side_payload:
                    continue
                team_id = side_payload["teamId"]

                current = side_payload.get("rosterForCurrentScoringPeriod")
                matchup_cumulative = side_payload.get("rosterForMatchupPeriod")

                if current is not None and matchup_cumulative is not None:
                    # 2019+ dual-roster path. ESPN serves a cumulative
                    # rosterForMatchupPeriod alongside the daily
                    # rosterForCurrentScoringPeriod, and which one is
                    # authoritative for a given period depends on how the file
                    # was captured:
                    #   - Backfilled (all of a week's files fetched the same
                    #     day): the cumulative block is identical across every
                    #     file and the daily block's appliedStatTotal is that
                    #     day's real points -- use the per-day block. The first
                    #     file also carries a non-zero week-to-date cumulative,
                    #     but with no prior snapshot that is not an advance.
                    #   - Live in-progress (one file per day): the cumulative
                    #     block advances each day and the daily block was
                    #     captured before that day's games conclude (usually
                    #     empty). The day-to-day contribution is the delta
                    #     between consecutive cumulative blocks, which lands on
                    #     the *prior* day (cum(N) is through day N-1).
                    #   - Mid-week gap (early files backfilled, later ones
                    #     live): the cumulative advances but the day's daily
                    #     block is complete -- the delta spans several days, so
                    #     it is held as pending and only attributed once the
                    #     following period's per-day shows how much of it
                    #     belongs to the current day.
                    # Unified handling below: emit the per-day block whenever
                    # it is complete; attribute a live single-day cumulative
                    # advance to the prior day immediately; and defer a
                    # multi-day advance (complete per-day + advance) until the
                    # next period resolves it.
                    per_day_entries: list[
                        tuple[dict[str, Any], float, int, list[dict[str, Any]]]
                    ] = []
                    per_day_by_player: dict[int, dict[str, Any]] = {}
                    current_entries_by_player: dict[int, dict[str, Any]] = {}
                    n_rostered = 0
                    n_active = 0
                    for e in current.get("entries", []):
                        player_obj = e.get("playerPoolEntry", {}).get("player")
                        if not player_obj:
                            continue
                        # Latest daily-block slot seen for this team-week, kept
                        # across periods: a cumulative-block line whose player
                        # is missing from the current period's daily block
                        # (dropped mid-week, or first entering the cumulative
                        # block after the fact) would otherwise fall back to
                        # the {"slot": 0} default -- slot 0 is the CATCHER
                        # slot, which rendered starting pitchers as catchers.
                        # Keyed by the canonical registry id, matching the
                        # line-key lookups below: an override remapping this
                        # raw ESPN id would otherwise make every lookup miss
                        # and fall back to the {"slot": 0} catcher default.
                        last_daily_slot[
                            (
                                matchup_id,
                                team_id,
                                player_registry.canonical_id(player_obj["id"]),
                            )
                        ] = e["lineupSlotId"]
                        # Keyed by the canonical registry id, matching the
                        # line-key lookups that consume it: an override
                        # remapping this raw ESPN id would otherwise make every
                        # lookup miss.
                        current_entries_by_player[
                            player_registry.canonical_id(player_obj["id"])
                        ] = e
                        player_registry.record_roster_day(
                            player_obj["id"], year, period
                        )
                        n_rostered += 1
                        points = (
                            e.get("playerPoolEntry", {}).get("appliedStatTotal") or 0.0
                        )
                        blocks = day_stat_blocks(player_obj, period)
                        per_day_entries.append(
                            (player_obj, points, e["lineupSlotId"], blocks)
                        )
                        per_day_by_player[player_obj["id"]] = {
                            "points": points,
                            "slot_id": e["lineupSlotId"],
                            "blocks": blocks,
                        }
                        if points or day_has_activity(blocks):
                            n_active += 1

                    cum_entries: dict[tuple[int, int, int], dict[str, Any]] = {}
                    team_cum_total = 0.0
                    for e in matchup_cumulative.get("entries", []):
                        pool_entry = e.get("playerPoolEntry", {})
                        player_obj = pool_entry.get("player")
                        if not player_obj:
                            continue
                        player_id = player_registry.record(player_obj, year)
                        key = (matchup_id, team_id, player_id)
                        cumulative_points = pool_entry.get("appliedStatTotal") or 0.0
                        team_cum_total += cumulative_points
                        cum_entries[key] = {
                            "points": cumulative_points,
                            "stats": applied_raw_stats(matchup_stat_blocks(player_obj)),
                            "player": player_obj,
                        }
                        latest_cumulative[key] = {
                            "points": cumulative_points,
                            "stats": {
                                int(stat_id_str): int(value)
                                for stat_id_str, value in cum_entries[key][
                                    "stats"
                                ].items()
                            },
                        }

                    team_key = (matchup_id, team_id)
                    # Coverage horizon of THIS file's cumulative snapshot: the
                    # days ESPN officially includes in it so far -- the side's
                    # pointsByScoringPeriod keys, not this file's period (a
                    # batch-refetched file for period N can hold a horizon days
                    # wide of N, and a live capture holds one behind). The
                    # "live" key seen in some payloads is not a day. Used only
                    # by the in-progress advance handling below; recorded for
                    # every dual-roster period so the next advance's span is
                    # measured from this snapshot's horizon.
                    covered_days = [
                        int(day_key)
                        for day_key in (side_payload.get("pointsByScoringPeriod") or {})
                        if str(day_key).lstrip("-").isdigit()
                    ]
                    snapshot_through = max(covered_days, default=period - 1)
                    prev_team_total = team_cumulative_totals.get(team_key)
                    prev_exists = team_key in team_cumulative_totals
                    cum_advanced = (
                        prev_exists and abs(team_cum_total - prev_team_total) > 0.01
                    )
                    per_day_complete = n_rostered > 0 and (
                        n_active / n_rostered >= PER_DAY_COVERAGE_MIN
                    )
                    # No in-progress-season special-casing here, deliberately.
                    # The capture regime is detectable from the files themselves
                    # (frozen cumulative across consecutive files = backfilled,
                    # complete daily blocks authoritative; advancing cumulative =
                    # live capture, deltas carry the production) and the
                    # cum_advanced/use_per_day branching below already handles
                    # both -- verified empirically 2026-08-22 across all 190
                    # decided 2026 team-weeks: weeks 1-17 reconcile exactly;
                    # weeks 18-19 carry documented residuals of up to ~70pt
                    # from the Aug-20 refresh + late MLB stat revisions (see
                    # season-notes.json's box_score_revision_gaps). An earlier
                    # attempt forced per-day emission unconditionally for
                    # anchor_to_snapshots seasons; that silently gutted
                    # live-captured weeks (week-19 pre-game daily blocks are
                    # empty) and was reverted -- don't reintroduce it.
                    use_per_day = not cum_advanced or per_day_complete

                    # 0) Resolve any deferred fill held from a backfill-gap
                    #    period of this same team-week. Its delta also covers
                    #    the current day, so subtract this period's per-day
                    #    before emitting the residual to the gap day.
                    #    Legacy attribution only -- in-progress seasons resolve
                    #    advances through pending_advances instead (below).
                    pending = (
                        None
                        if anchor_to_snapshots
                        else pending_fill.pop(team_key, None)
                    )
                    if pending:
                        for fill in pending:
                            day = per_day_by_player.get(fill["player"]["id"])
                            if use_per_day and day is not None:
                                fill["points"] -= day["points"]
                                fill["stats"] = stat_dict_delta(
                                    fill["stats"],
                                    {
                                        int(stat_id_str): value
                                        for stat_id_str, value in applied_raw_stats(
                                            day["blocks"]
                                        ).items()
                                    },
                                )
                            if fill["points"] or fill["stats"]:
                                add_line(
                                    matchup_id,
                                    week,
                                    team_id,
                                    fill["player"],
                                    fill["points"],
                                    fill["slot"],
                                    fill["day"],
                                    fill["stats"],
                                )

                    # 1) Per-day contribution for period N.
                    if use_per_day:
                        for player_obj, points, slot_id, blocks in per_day_entries:
                            if (
                                not points
                                and not day_has_activity(blocks)
                                and slot_id != IR_SLOT_ID
                            ):
                                continue
                            add_line(
                                matchup_id,
                                week,
                                team_id,
                                player_obj,
                                points,
                                slot_id,
                                period,
                                applied_raw_stats(blocks),
                            )

                    # 2) In-progress seasons: handle cumulative advances as
                    #    pending coverage-spanned residuals. ESPN's cumulative
                    #    block covers every day officially scored so far -- its
                    #    horizon is the side's pointsByScoringPeriod keys, NOT
                    #    this file's period -- and it advances by more than one
                    #    day whenever captures are batch-fetched or ESPN's
                    #    weekly aggregation lags (2026 wk21: files 154-157, all
                    #    captured Friday, hold through-Thursday cumulatives).
                    #    Attributing such a delta to `period` or `period - 1`
                    #    dumps multi-day production onto one day, and because
                    #    step 1 already emitted that period's true per-day
                    #    line, accumulate()'s upsert silently REPLACES it with
                    #    the delta (wk21 day 154: Ohtani's real 1.2-point
                    #    Tuesday replaced by the whole through-Thursday
                    #    cumulative). Instead the advance is queued as a span
                    #    and resolved once its last day's per-day data has been
                    #    seen: residual = delta minus the counted per-day slots
                    #    the span's days accumulated, landed on the span's
                    #    earliest day without any slot at all (add_line upserts
                    #    by period, so a bench/IR-only day must never be an add
                    #    target -- that would clobber the IL marker and, via
                    #    the slot label, double-count the production at
                    #    anchoring); when every span day carries a slot, the
                    #    residual folds into the span's last counted slot.
                    #    Slot subtraction happens only for spans of NEWLY
                    #    covered days: a same-horizon retro-revision's baseline
                    #    is the snapshot the slots already reconcile to (each
                    #    resolution leaves slot sums == that snapshot), so
                    #    subtracting would strip the span day's production.
                    #    Slot sums keep reconciling to the anchored snapshot
                    #    and per-day lines are never clobbered. Completed
                    #    seasons keep the legacy attribution below: their
                    #    per-period captures finished the job and their output
                    #    must stay byte-identical.
                    if anchor_to_snapshots:
                        if cum_advanced:
                            prev_through = cum_through.get(team_key)
                            grew = (
                                prev_through is not None
                                and snapshot_through > prev_through
                            )
                            if grew:
                                span = (prev_through + 1, snapshot_through)
                            else:
                                # No new covered days since the last snapshot:
                                # a pure retro-revision, folded into the last
                                # covered day at resolution time.
                                base = (
                                    prev_through
                                    if prev_through is not None
                                    else snapshot_through
                                )
                                span = (base, base)
                            deltas: dict[int, dict[str, Any]] = {}
                            for key, cum in cum_entries.items():
                                player_id = key[2]
                                prev = prev_cumulative.get(
                                    key, {"points": 0.0, "stats": {}, "slot": 0}
                                )
                                # Keyed canonically to match the line-key
                                # lookups below: an override remapping this raw
                                # ESPN id would otherwise make every lookup
                                # miss and silently degrade to the
                                # last_daily_slot fallback.
                                current_e = current_entries_by_player.get(player_id)
                                slot_id = (
                                    current_e["lineupSlotId"]
                                    if current_e is not None
                                    else last_daily_slot.get(key, prev["slot"])
                                )
                                # Counted residuals must never carry a bench/IR
                                # label: bench_contribution would add them on
                                # top of the snapshot during anchoring
                                # (double-count). Slot 0 is repaired for
                                # pitching-only lines by the slot-label
                                # consolidation; a residual with no day
                                # evidence has no better slot available.
                                if slot_id in BENCH_AND_IR_SLOT_IDS:
                                    slot_id = 0
                                deltas[player_id] = {
                                    "player": cum["player"],
                                    "points": cum["points"] - prev["points"],
                                    "stats": stat_dict_delta(
                                        cum["stats"], prev["stats"]
                                    ),
                                    "slot": slot_id,
                                }
                            if deltas:
                                pending_advances.setdefault(team_key, []).append(
                                    {
                                        "week": week,
                                        "span": span,
                                        # Only spans of newly covered days may
                                        # subtract existing slots: their
                                        # telescoping baseline is a snapshot the
                                        # slots do NOT yet reconcile to. A
                                        # same-horizon revision's baseline is the
                                        # snapshot the slots DO reconcile to, so
                                        # subtracting would strip the span day's
                                        # production before folding the revision
                                        # in.
                                        "subtract_slots": grew,
                                        "deltas": deltas,
                                    }
                                )
                        # Resolve every queued advance whose span has closed as
                        # of this period -- the per-day lines its span's days
                        # were still waiting for have all been seen by now
                        # (step 1 runs before this).
                        open_advances = pending_advances.get(team_key, [])
                        if open_advances:
                            still_open = [
                                adv for adv in open_advances if adv["span"][1] > period
                            ]
                            for adv in open_advances:
                                if adv["span"][1] <= period:
                                    resolve_advance(team_key, adv)
                            if still_open:
                                pending_advances[team_key] = still_open
                            else:
                                pending_advances.pop(team_key, None)

                    # 3) Cumulative fill for the prior day when the cumulative
                    #    advanced -- completed seasons only (legacy attribution;
                    #    see the comment above for why in-progress seasons no
                    #    longer take this path). A live single-day advance is
                    #    attributed immediately (delta(N) = day N-1). But when
                    #    the period also shows a complete per-day block, the
                    #    advance spans several days (mid-week backfill gap), so
                    #    the delta minus this period's per-day is held as
                    #    pending -- the next period's per-day subtraction
                    #    isolates the gap day exactly instead of double-counting
                    #    it.
                    if cum_advanced and not anchor_to_snapshots:
                        # Check if prior period was an off-day (no cumulative advance)
                        # If so, attribute entire delta to current period (skip pending_fill)
                        prior_period_advanced = (
                            team_key in prev_team_cumulative_totals
                            and abs(
                                team_cumulative_totals.get(team_key, 0.0)
                                - prev_team_cumulative_totals.get(team_key, 0.0)
                            )
                            > 0.01
                        )

                        for key, cum in cum_entries.items():
                            player_id = key[2]
                            prev = prev_cumulative.get(
                                key, {"points": 0.0, "stats": {}, "slot": 0}
                            )
                            delta_points = cum["points"] - prev["points"]
                            delta_stats = stat_dict_delta(cum["stats"], prev["stats"])
                            day = per_day_by_player.get(player_id)
                            current_e = current_entries_by_player.get(player_id)
                            slot_id = (
                                current_e["lineupSlotId"]
                                if current_e is not None
                                else last_daily_slot.get(key, prev["slot"])
                            )
                            if use_per_day:
                                if not prior_period_advanced:
                                    # Prior period was an off-day, attribute entire delta to current period
                                    add_line(
                                        matchup_id,
                                        week,
                                        team_id,
                                        cum["player"],
                                        delta_points,
                                        slot_id,
                                        period,
                                        delta_stats,
                                    )
                                else:
                                    # Prior period had games, use pending_fill
                                    if day is not None:
                                        delta_points -= day["points"]
                                        delta_stats = stat_dict_delta(
                                            delta_stats,
                                            {
                                                int(stat_id_str): value
                                                for stat_id_str, value in applied_raw_stats(
                                                    day["blocks"]
                                                ).items()
                                            },
                                        )
                                    if delta_points or delta_stats:
                                        pending_fill.setdefault(team_key, []).append(
                                            {
                                                "day": period - 1,
                                                "week": week,
                                                "points": delta_points,
                                                "stats": delta_stats,
                                                # Same slot resolution as the
                                                # immediate-emission path above:
                                                # the current day's real slot.
                                                # prev["slot"] is wrong here -- a
                                                # player first appearing in the
                                                # cumulative block mid-gap has
                                                # never seen a daily block, so it
                                                # is the {"slot": 0} default, and
                                                # slot 0 is the CATCHER slot: SPs
                                                # rendered as catchers in the app
                                                # (2026 wk19-20).
                                                "slot": slot_id,
                                                "player": cum["player"],
                                            }
                                        )
                            elif delta_points or delta_stats or slot_id == IR_SLOT_ID:
                                add_line(
                                    matchup_id,
                                    week,
                                    team_id,
                                    cum["player"],
                                    delta_points,
                                    slot_id,
                                    period - 1,
                                    delta_stats,
                                )
                    # Baseline bookkeeping for *every* period, advanced or not:
                    # a backfilled stretch keeps the cumulative flat, but the
                    # baseline must track it so the next advance's delta is
                    # relative to this snapshot rather than an empty default.
                    for key, cum in cum_entries.items():
                        player_id = key[2]
                        current_e = current_entries_by_player.get(player_id)
                        prev = prev_cumulative.get(
                            key, {"points": 0.0, "stats": {}, "slot": 0}
                        )
                        prev_cumulative[key] = {
                            "points": cum["points"],
                            "stats": {
                                int(stat_id_str): value
                                for stat_id_str, value in cum["stats"].items()
                            },
                            "slot": (
                                current_e["lineupSlotId"]
                                if current_e is not None
                                else last_daily_slot.get(key, prev["slot"])
                            ),
                        }
                    team_cumulative_totals[team_key] = team_cum_total
                    # Monotonic: a glitch-empty pointsByScoringPeriod (whose
                    # fallback horizon is period - 1) must never regress the
                    # horizon and manufacture a fake "growth" span over days
                    # the slots already reconcile to.
                    cum_through[team_key] = max(
                        cum_through.get(team_key, snapshot_through), snapshot_through
                    )

                    # Preserve IL-only rows for reconstructing IL stints. The
                    # per-day pass above already emits IL rows (its guard
                    # admits IR slots), so this only runs when per-day was
                    # skipped -- a live pre-game capture, where IL players are
                    # invisible to the cumulative block.
                    if not use_per_day:
                        for e in current.get("entries", []):
                            pool_entry = e.get("playerPoolEntry", {})
                            player_obj = pool_entry.get("player")
                            if not player_obj:
                                continue
                            player_id = player_registry.record(player_obj, year)
                            key = (matchup_id, team_id, player_id)
                            if player_id in prev_cumulative:
                                continue
                            if e["lineupSlotId"] != IR_SLOT_ID:
                                continue
                            add_line(
                                matchup_id,
                                week,
                                team_id,
                                player_obj,
                                0.0,
                                IR_SLOT_ID,
                                period,
                                {},
                            )
                            prev_cumulative[key] = {
                                "points": 0.0,
                                "stats": {},
                                "slot": IR_SLOT_ID,
                            }
                    continue

                if current is not None:
                    # Fallback per-day path for 2019+ responses that lack a
                    # cumulative roster block. Completed seasons (2025) land
                    # here only if the cumulative block is absent; the logic
                    # below is the original pre-2026 behavior.
                    for e in current.get("entries", []):
                        pool_entry = e.get("playerPoolEntry", {})
                        player_obj = pool_entry.get("player")
                        if not player_obj:
                            continue
                        player_registry.record_roster_day(
                            player_obj["id"], year, period
                        )
                        points = pool_entry.get("appliedStatTotal") or 0.0
                        blocks = day_stat_blocks(player_obj, period)
                        if (
                            not points
                            and not day_has_activity(blocks)
                            and e["lineupSlotId"] != IR_SLOT_ID
                        ):
                            continue
                        add_line(
                            matchup_id,
                            week,
                            team_id,
                            player_obj,
                            points,
                            e["lineupSlotId"],
                            period,
                            applied_raw_stats(blocks),
                        )
                    continue

                static_key = (matchup_id, team_id)
                if static_key in static_matchups_seen:
                    continue
                static = side_payload.get("rosterForMatchupPeriod")
                entries = static.get("entries", []) if static else []
                if not entries:
                    continue
                static_matchups_seen.add(static_key)
                for e in entries:
                    pool_entry = e.get("playerPoolEntry", {})
                    player_obj = pool_entry.get("player")
                    if not player_obj:
                        continue
                    points = pool_entry.get("appliedStatTotal") or 0.0
                    add_line(
                        matchup_id,
                        week,
                        team_id,
                        player_obj,
                        points,
                        e["lineupSlotId"],
                        week,
                        None,  # this era's stat blocks are season-cumulative only
                    )

        # Update prev for next iteration (off-day detection)
        prev_team_cumulative_totals = period_prev_cumulative_totals

    # Flush any deferred fills whose resolution period never appeared (a
    # backfill-gap at the very end of the archive). Emit them as-is to their
    # gap day -- better to land the points than to lose them.
    for team_key, fills in pending_fill.items():
        matchup_id, team_id = team_key
        for fill in fills:
            if fill["points"] or fill["stats"]:
                add_line(
                    matchup_id,
                    fill["week"],
                    team_id,
                    fill["player"],
                    fill["points"],
                    fill["slot"],
                    fill["day"],
                    fill["stats"],
                )

    # Flush in-progress advances whose span never closed in-loop (the archive
    # ends mid-span). resolve_advance subtracts whatever counted per-day slots
    # the span's days accumulated and lands the remainder on the span's
    # earliest uncovered day -- same semantics as the in-loop resolution.
    for team_key, advances in pending_advances.items():
        for advance in advances:
            resolve_advance(team_key, advance)

    roster_periods = discover_roster_periods(year)
    if roster_periods:
        # 2018 path (see docstring). Day -> matchup window per team-side comes from
        # pointsByScoringPeriod's keys on the full-season schedule every box file
        # carries: exactly the days that counted toward that matchup for that side.
        day_matchup: dict[tuple[int, int], tuple[int, int]] = {}
        first_box = load_box_period(year, box_periods[0]) if box_periods else None
        for m in (first_box or {}).get("schedule", []):
            for side_key in ("home", "away"):
                side_payload = m.get(side_key)
                if not side_payload:
                    continue
                for day_key in side_payload.get("pointsByScoringPeriod", {}):
                    day_matchup[(side_payload["teamId"], int(day_key))] = (
                        m["id"],
                        m["matchupPeriodId"],
                    )

        for period in roster_periods:
            payload = load_roster_period(year, period)
            if not payload:
                continue
            for team in payload.get("teams", []):
                team_id = team["id"]
                window = day_matchup.get((team_id, period))
                if window is None:
                    continue  # day counted toward no matchup for this team
                matchup_id, week = window
                for e in team.get("roster", {}).get("entries", []):
                    player_obj = e.get("playerPoolEntry", {}).get("player")
                    if not player_obj:
                        continue
                    blocks = day_stat_blocks(player_obj, period)
                    points = sum(block.get("appliedTotal") or 0.0 for block in blocks)
                    if not points and not day_has_activity(blocks):
                        continue  # no MLB games for this player that day
                    add_line(
                        matchup_id,
                        week,
                        team_id,
                        player_obj,
                        points,
                        e["lineupSlotId"],
                        period,
                        applied_raw_stats(blocks),
                    )

    # Anchor every dual-roster-era line to its latest cumulative snapshot
    # (see latest_cumulative above) -- but only for the in-progress season.
    # A completed season's stitching is validate-clean by construction (its
    # per-day captures finished the job, and its slot labels don't respect
    # snapshot horizons: mid-week gap fills dump multi-day production onto
    # earlier-labeled slots). The live-captured in-progress season is where
    # once-captured snapshots and retro-revisions leave points/stats
    # inconsistent, and there the snapshot is strictly the most recent
    # evidence. Lines without a snapshot -- 2009-2018's static/per-day
    # paths, or a player never seen in any cumulative block -- derive their
    # counted part from active slots instead.
    #
    # Semantics (counted vs. bench): ESPN's rosterForMatchupPeriod totals are
    # counted-only -- they sum exactly to the official matchup score across
    # the archive -- while per-day slots carry real production on bench/IR
    # slots too. total_points/stat_totals are FULL-PRODUCTION figures:
    # snapshot (the counted truth, which keeps stat_line_reconciliation and
    # pf_box_score_reconciliation exact) plus the line's own bench/IR slot
    # contribution, so a player's season total means the same thing in every
    # era (app/src/lib/boxScore.ts splits counted vs bench from slots).
    if anchor_to_snapshots:
        for key, entry in lines.items():
            bench_points, bench_stats = bench_contribution(entry)
            snapshot = latest_cumulative.get(key)
            if snapshot is None:
                # No counted-only snapshot exists for this line (player absent
                # from every rosterForMatchupPeriod block): derive the counted
                # part from its own active slots; the bench add-back below
                # makes totals the full slot sum either way.
                counted_points = 0.0
                counted_stats: dict[int, int] = {}
                for slot in entry["slots"]:
                    if slot["lineup_slot_id"] in BENCH_AND_IR_SLOT_IDS:
                        continue
                    counted_points += slot["points"]
                    for stat_id_str, value in slot.get("raw_stats", {}).items():
                        stat_id = int(stat_id_str)
                        counted_stats[stat_id] = counted_stats.get(stat_id, 0) + value
            else:
                counted_points = snapshot["points"]
                counted_stats = dict(snapshot["stats"])
            entry["total_points"] = counted_points + bench_points
            stat_totals = dict(counted_stats)
            for stat_id, value in bench_stats.items():
                stat_totals[stat_id] = stat_totals.get(stat_id, 0) + value
            entry["stat_totals"] = stat_totals

    # Slot-label consolidation. ESPN's cumulative rosterForMatchupPeriod block
    # labels every entry lineupSlotId 0 -- a placeholder, not a real catcher
    # assignment -- so a delta-chain line whose slot evidence was missing
    # (player absent from that period's daily block, first sighting in the
    # cumulative block) can inherit it and render as a catcher in the app.
    # Both repairs are restricted to pitching-only lines. A hitter's 0 day is
    # never touched: the UTIL slot holds any position player, so UTIL days
    # carry no position information, and a hitter's 0 day could be a genuine
    # catcher start or the same placeholder -- indistinguishable. A
    # pitching-only line, meanwhile, can never be a catcher.
    #   1. Consensus: within one team-week a pitcher occupies one active slot
    #      all week, so when every non-bench day agrees on a single non-zero
    #      slot, a 0 day is that slot too (bench/IL days excluded -- roster
    #      states, not positions).
    #   2. No evidence at all (Eric Lauer, 2026 wk20: present only in the
    #      cumulative block, never in any daily block): fall back to the
    #      player's ESPN-declared default position mapped into the lineup-slot
    #      space (1/SP -> 14, 11/RP -> 15). That's ESPN's own position
    #      declaration, not a fabrication; a default position outside the
    #      pitching pair leaves the day at 0.
    # Restricted to the in-progress season: 2026 is where the dual-block
    # placeholder anomaly exists. 2009-2017's static era is ALL slot 0 by era
    # placeholder (every entry, hitter and pitcher alike), so the fallback
    # would mislabel that entire archive's pitchers.
    DEFAULT_POSITION_TO_SLOT = {1: 14, 11: 15}
    if anchor_to_snapshots:
        for key, entry in lines.items():
            if any(
                int(stat_id) in BATTING_STAT_IDS for stat_id in entry["stat_totals"]
            ):
                continue  # a hitter's 0 day may be a real catcher start -- leave it
            slots = entry["slots"]
            others = {
                s["lineup_slot_id"]
                for s in slots
                if s["lineup_slot_id"] not in BENCH_AND_IR_SLOT_IDS
                and s["lineup_slot_id"] != 0
            }
            consensus = others.pop() if len(others) == 1 else None
            fallback = DEFAULT_POSITION_TO_SLOT.get(default_position_by_key.get(key, 0))
            if consensus is None and fallback is None:
                continue
            for s in slots:
                if s["lineup_slot_id"] == 0:
                    s["lineup_slot_id"] = (
                        consensus if consensus is not None else fallback
                    )

    out = [finalize_line(line) for line in lines.values()]
    out.sort(key=lambda r: (r["matchup_id"], r["espn_team_id"], r["player_id"]))
    return out


def _kona_stat_line(
    stats: dict[str, Any], id_map: dict[int, str], line_cls: type
) -> Any:
    """Map a kona season stat block's raw stats dict to a BattingLine or
    PitchingLine. Missing counting stats default to 0; if every mapped value is
    0 the line is returned as None so the caller knows this side had no
    accumulated activity."""
    values: dict[str, int] = {field: 0 for field in line_cls.__annotations__}
    for stat_id, field in id_map.items():
        raw = stats.get(str(stat_id))
        if raw is not None:
            values[field] = int(raw)
    if not any(values.values()):
        return None
    return line_cls(**values)


def build_player_season_backfill(
    years: list[int],
    player_registry: PlayerRegistry,
    player_season_points: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Backfill player-seasons missing from box scores using fantasy totals from
    each year's kona_player_info.json. Only players in the latest processed
    season's ESPN player pool are considered, so we don't fabricate lines for
    retired players."""
    if not years:
        return []
    latest_year = max(years)
    latest_kona = load_view(latest_year, "kona_player_info.json")
    if not latest_kona:
        return []
    active_ids: set[int] = set()
    for entry in latest_kona.get("players", []):
        player = entry.get("player")
        if player:
            active_ids.add(player_registry.canonical_id(player["id"]))
    if not active_ids:
        return []
    box_score_keys = {(row["year"], row["player_id"]) for row in player_season_points}
    # Collect the best real-season block per (year, player_id). Process kona
    # files in year order so the latest (and largest) pool wins for overlapping
    # seasons such as 2025, which appears in both the 2025 and 2026 kona
    # responses.
    best_block: dict[tuple[int, int], tuple[str, dict[str, Any], dict[str, Any]]] = {}
    for year in sorted(years):
        kona = load_view(year, "kona_player_info.json")
        if not kona:
            continue
        for entry in kona.get("players", []):
            player = entry.get("player")
            if not player:
                continue
            player_id = player_registry.canonical_id(player["id"])
            if player_id not in active_ids:
                continue
            player_name = player.get("fullName", "")
            for block in player.get("stats", []):
                if block.get("statSourceId") != 0 or block.get("statSplitTypeId") != 0:
                    continue
                block_year = block.get("seasonId")
                if not isinstance(block_year, int):
                    continue
                best_block[(block_year, player_id)] = (player_name, block, player)
    rows: list[dict[str, Any]] = []
    for (year, player_id), (player_name, block, player) in best_block.items():
        if year != latest_year:
            continue
        if (year, player_id) in box_score_keys:
            continue
        stats = block.get("stats") or {}
        batting = _kona_stat_line(stats, BATTING_STAT_IDS, BattingLine)
        pitching = _kona_stat_line(stats, PITCHING_STAT_IDS, PitchingLine)
        points = round(block.get("appliedTotal") or 0.0, 2)
        if points == 0 and batting is None and pitching is None:
            continue
        eligible_slots = sorted(set(player.get("eligibleSlots") or []))
        default_position_id = player.get("defaultPositionId")
        rows.append(
            asdict(
                PlayerSeasonBackfill(
                    year=year,
                    player_id=player_id,
                    player_name=player_name,
                    points=points,
                    batting=batting,
                    pitching=pitching,
                    eligible_slots=eligible_slots,
                    default_position_id=default_position_id,
                    source="kona",
                )
            )
        )
    rows.sort(key=lambda r: (r["year"], r["player_id"]))
    return rows


def build_card_points(
    years: list[int],
    player_registry: PlayerRegistry,
    player_season_points: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """ESPN player-card season totals for rostered player-seasons, harvested
    from each kona file's real season block (statSourceId 0, statSplitTypeId 0)
    -- the number ESPN's own player card shows, covering free-agent days the
    box-score archive never sees. Only (year, player) keys present in
    player_season_points are emitted. Kona files overlap seasons (e.g. 2025
    blocks appear in both the 2025 and 2026 responses), so files are processed
    in year order and the latest pool wins -- same convention as
    build_player_season_backfill."""
    if not years:
        return []
    consumed = {(row["year"], row["player_id"]) for row in player_season_points}
    best: dict[tuple[int, int], tuple[str, float]] = {}
    for year in sorted(years):
        kona = load_view(year, "kona_player_info.json")
        if not kona:
            continue
        for entry in kona.get("players", []):
            player = entry.get("player")
            if not player:
                continue
            player_id = player_registry.canonical_id(player["id"])
            player_name = player.get("fullName", "")
            for block in player.get("stats", []):
                if block.get("statSourceId") != 0 or block.get("statSplitTypeId") != 0:
                    continue
                block_year = block.get("seasonId")
                if not isinstance(block_year, int):
                    continue
                if (block_year, player_id) not in consumed:
                    continue
                best[(block_year, player_id)] = (
                    player_name,
                    round(block.get("appliedTotal") or 0.0, 2),
                )
    rows = [
        asdict(
            CardPoints(
                year=year,
                player_id=player_id,
                player_name=player_name,
                card_points=card_points,
            )
        )
        for (year, player_id), (player_name, card_points) in best.items()
    ]
    rows.sort(key=lambda r: (r["year"], r["player_id"]))
    return rows


# --- main -------------------------------------------------------------------


# --- transactions -----------------------------------------------------------

# ESPN transaction types kept out of transactions.json. Both are documented at
# schema.Transaction; validate.py's transaction_ledger reconciles their counts
# so dropping them stays auditable.
SKIPPED_TRANSACTION_TYPES = frozenset({"FUTURE_ROSTER", "DRAFT"})


def discover_transaction_periods(year: int) -> list[int]:
    """Per-period mTransactions2 files. Present for 2019+ only -- ESPN's
    leagueHistory endpoint serves no transaction view for 2009-2018."""
    periods = []
    for path in (RAW_DIR / str(year)).glob("mTransactions2-period*.json"):
        num = path.stem.removeprefix("mTransactions2-period")
        if num.isdigit():
            periods.append(int(num))
    return sorted(periods)


def discover_transaction_daily_captures(year: int) -> list[str]:
    """Historical daily-job mTransactions2 captures (added specifically to
    catch a TRADE_PROPOSAL's player list before ESPN purges it on execution --
    see the Phase 8 trade-capture spec). 2026 only: staged by the old
    sync_live_scoreboard.py and relayed from R2 into data/raw/ by the
    then-weekly job until the R2 retirement (2026-08) replaced the relay with
    the heavy run's direct current-period mTransactions2 refetch. The
    already-committed captures stay in the union; none are produced anymore."""
    dates = []
    for path in (RAW_DIR / str(year)).glob("mTransactions2-daily-*.json"):
        dates.append(path.stem.removeprefix("mTransactions2-daily-"))
    return sorted(dates)


def period_week_map(box_scores: list[dict[str, Any]]) -> dict[int, int]:
    """scoring period (a day) -> matchup week, read back off the box scores
    already built for this year. mSettings.scheduleSettings.matchupPeriods
    looks like it should answer this but doesn't: in this daily league it is an
    identity map (week 1 -> [1], week 2 -> [2] ...) covering only the first 25
    ids, while scoring periods run past 180. The box scores carry the real
    pairing, and reusing them costs no extra file reads."""
    return {
        slot["scoring_period"]: line["week"]
        for line in box_scores
        for slot in line["slots"]
    }


def _transaction_item(item: dict[str, Any]) -> dict[str, Any]:
    def team(value: Any) -> int | None:
        # 0 is ESPN's "free agency / no team", never a real team id.
        return value or None

    def slot(value: Any) -> int | None:
        # -1 is "not on a lineup". 0 is a real slot (catcher), so this cannot
        # be a plain falsiness check.
        return None if value in (None, -1) else value

    return asdict(
        TransactionItem(
            player_id=item["playerId"],
            item_type=item["type"],
            from_espn_team_id=team(item.get("fromTeamId")),
            to_espn_team_id=team(item.get("toTeamId")),
            from_lineup_slot_id=slot(item.get("fromLineupSlotId")),
            to_lineup_slot_id=slot(item.get("toLineupSlotId")),
        )
    )


def build_transactions(
    year: int,
    periods: list[int],
    owner_map: OwnerMap,
    weeks_by_period: dict[int, int],
    daily_capture_dates: list[str] | None = None,
) -> list[dict[str, Any]]:
    """The league's add/drop/trade ledger for one season, merged across every
    per-period mTransactions2 file, plus (2026+) any daily captures.

    Keying by ESPN's transaction id is load-bearing, not defensive: ESPN
    repeats the same transaction across several period files, 235 times over
    2019-2025 (228 of them in 2020 alone). Every repeat is byte-identical to
    its first appearance -- verified across all three affected years -- so
    collapsing them is lossless and last-write-wins stays deterministic.

    Daily captures (discover_transaction_daily_captures) merge into the same
    by-id map for the same reason: they only ever add ids the period files
    don't already have (a still-pending TRADE_PROPOSAL ESPN later purges once
    it executes), never overwrite one, so merge order doesn't matter.

    Returns [] for 2009-2018, which have no transaction files at all.
    """
    by_id: dict[str, dict[str, Any]] = {}
    for period in periods:
        payload = load_view(year, f"mTransactions2-period{period}.json")
        if not payload:
            # A period file with no `transactions` key is a quiet day, not a
            # gap: ESPN omits the key entirely when nothing happened.
            continue
        for raw in payload.get("transactions") or []:
            if raw["type"] in SKIPPED_TRANSACTION_TYPES:
                continue
            by_id[raw["id"]] = raw
    for date in daily_capture_dates or []:
        payload = load_view(year, f"mTransactions2-daily-{date}.json")
        if not payload:
            continue
        for raw in payload.get("transactions") or []:
            if raw["type"] in SKIPPED_TRANSACTION_TYPES:
                continue
            by_id[raw["id"]] = raw

    transactions = []
    # Scoring period leads the sort so the ~236 rows ESPN serves without a
    # proposedDate still land on the right day rather than at the top.
    ordered = sorted(
        by_id.values(),
        key=lambda t: (t["scoringPeriodId"], t.get("proposedDate") or 0, t["id"]),
    )
    for raw in ordered:
        entry = resolve_team_owner(owner_map, year, raw["teamId"])
        member_id = raw.get("memberId")
        transactions.append(
            asdict(
                Transaction(
                    year=year,
                    transaction_id=raw["id"],
                    transaction_type=raw["type"],
                    scoring_period_id=raw["scoringPeriodId"],
                    week=weeks_by_period.get(raw["scoringPeriodId"]),
                    proposed_date=raw.get("proposedDate"),
                    espn_team_id=raw["teamId"],
                    owner_id=entry["primary_owner_id"],
                    acting_member_key=(
                        espn_member_key(member_id) if member_id else None
                    ),
                    status=raw.get("status"),
                    is_league_manager=raw.get("isLeagueManager", False),
                    related_transaction_id=raw.get("relatedTransactionId"),
                    bid_amount=raw.get("bidAmount", 0.0),
                    items=[
                        _transaction_item(item) for item in (raw.get("items") or [])
                    ],
                )
            )
        )
    return transactions


def _team_roster_at_period(year: int, team_id: int, period: int) -> set[int] | None:
    """Full roster (every rostered player, bench/IR included) for team_id at a
    single raw scoring period, from mBoxscore-period{period}.json's
    rosterForCurrentScoringPeriod. Unlike processed box_scores.json, this
    isn't gated on the player having recorded any stats that day, so an
    inactive traded player (hurt, between starts) still shows up. Returns
    None if the period file is missing or doesn't carry a populated roster
    for this team (day falls outside that file's matchup week).
    """
    payload = load_box_period(year, period)
    if not payload:
        return None
    for m in payload.get("schedule", []):
        for side_key in ("home", "away"):
            side = m.get(side_key)
            if not side or side.get("teamId") != team_id:
                continue
            current = side.get("rosterForCurrentScoringPeriod")
            entries = current.get("entries") if current else None
            if not entries:
                continue
            return {
                e["playerPoolEntry"]["player"]["id"]
                for e in entries
                if e.get("playerPoolEntry", {}).get("player")
            }
    return None


def _roster_near_period(
    year: int,
    team_id: int,
    periods_to_try: list[int],
    cache: dict[tuple[int, int, int], set[int] | None],
) -> set[int]:
    for period in periods_to_try:
        key = (year, team_id, period)
        if key not in cache:
            cache[key] = _team_roster_at_period(year, team_id, period)
        roster = cache[key]
        if roster:
            return roster
    return set()


def _had_waiver_activity(
    transactions_this_year: list[dict[str, Any]],
    player_id: int,
    team_id: int,
    period_lo: int,
    period_hi: int,
) -> bool:
    for t in transactions_this_year:
        p = t.get("scoring_period_id")
        if p is None or not (period_lo <= p <= period_hi):
            continue
        if t.get("espn_team_id") != team_id or t.get("transaction_type") != "FREEAGENT":
            continue
        for item in t.get("items") or []:
            if item.get("player_id") == player_id and item.get("item_type") in (
                "ADD",
                "DROP",
            ):
                return True
    return False


def _reconstruct_trade_items(
    year: int,
    team_a_id: int,
    team_b_id: int,
    execution_period: int | None,
    before_floor: int | None,
    after_ceiling: int | None,
    available_periods_by_year: dict[int, list[int]],
    draft_picks_by_year: dict[int, list[dict[str, Any]]],
    transactions_by_year: dict[int, list[dict[str, Any]]],
    roster_cache: dict[tuple[int, int, int], set[int] | None],
) -> list[dict[str, Any]]:
    """Recover a trade's player exchange from raw per-period roster movement
    when the ledger's own player list didn't survive to execution (see
    build_trades).

    Diffs each trading team's roster just before the trade's execution
    scoring period against just after, rather than reading the execution
    period itself -- a same-day trade can still leave both teams' rosters
    reading inconsistently mid-transaction. before_floor/after_ceiling bound
    the search to strictly between this trade and the nearest *other* trade
    between the same two teams that same year (see build_trades) -- without
    that bound, two trades close together between the same pair would each
    independently rediscover the other's players too. See
    context/features/phase-8-trade-backfill-reconstruction-spec.md for the
    validated recipe this implements.
    """
    if execution_period is None:
        return []
    available = available_periods_by_year.get(year, [])

    if execution_period <= 1:
        picks = draft_picks_by_year.get(year, [])
        before_a = {p["player_id"] for p in picks if p["espn_team_id"] == team_a_id}
        before_b = {p["player_id"] for p in picks if p["espn_team_id"] == team_b_id}
    else:
        floor = before_floor if before_floor is not None else 0
        before_periods = sorted(
            (p for p in available if floor <= p < execution_period), reverse=True
        )
        before_a = _roster_near_period(year, team_a_id, before_periods, roster_cache)
        before_b = _roster_near_period(year, team_b_id, before_periods, roster_cache)

    # Look-ahead capped at +14 periods (~2 weeks): the execution period itself
    # is often still transitional, so the flip may only resolve a bit later;
    # beyond that (or at a sibling trade's own execution period) a "flip" is
    # more likely unrelated to this trade.
    ceiling = after_ceiling if after_ceiling is not None else execution_period + 14
    after_periods = sorted(p for p in available if execution_period <= p < ceiling)

    # pid -> the specific period its flip resolved at, so the waiver
    # sanity-check below can bound its window per player instead of using one
    # wide default -- a stale ADD/DROP from well before the trade shouldn't
    # disqualify a real trade candidate (see _had_waiver_activity).
    moved_a_to_b: dict[int, int] = {}
    moved_b_to_a: dict[int, int] = {}
    for period in after_periods:
        key_a = (year, team_a_id, period)
        key_b = (year, team_b_id, period)
        if key_a not in roster_cache:
            roster_cache[key_a] = _team_roster_at_period(year, team_a_id, period)
        if key_b not in roster_cache:
            roster_cache[key_b] = _team_roster_at_period(year, team_b_id, period)
        after_a = roster_cache[key_a] or set()
        after_b = roster_cache[key_b] or set()
        for pid in before_a:
            if pid in after_b and pid not in after_a and pid not in moved_a_to_b:
                moved_a_to_b[pid] = period
        for pid in before_b:
            if pid in after_a and pid not in after_b and pid not in moved_b_to_a:
                moved_b_to_a[pid] = period

    txs = transactions_by_year.get(year, [])

    def clean(pid: int, resolved_period: int) -> bool:
        return not (
            _had_waiver_activity(txs, pid, team_a_id, execution_period, resolved_period)
            or _had_waiver_activity(
                txs, pid, team_b_id, execution_period, resolved_period
            )
        )

    items: list[dict[str, Any]] = []
    for pid in sorted(pid for pid, p in moved_a_to_b.items() if clean(pid, p)):
        items.append(
            {
                "player_id": pid,
                "item_type": "TRADE",
                "from_espn_team_id": team_a_id,
                "to_espn_team_id": team_b_id,
                "from_lineup_slot_id": None,
                "to_lineup_slot_id": None,
                "source": "box_score_diff",
            }
        )
    for pid in sorted(pid for pid, p in moved_b_to_a.items() if clean(pid, p)):
        items.append(
            {
                "player_id": pid,
                "item_type": "TRADE",
                "from_espn_team_id": team_b_id,
                "to_espn_team_id": team_a_id,
                "from_lineup_slot_id": None,
                "to_lineup_slot_id": None,
                "source": "box_score_diff",
            }
        )
    return items


def _trade_team_ids(
    proposal: dict[str, Any] | None, group: list[dict[str, Any]]
) -> tuple[int, int]:
    team_ids: list[int] = []
    for t in ([proposal] if proposal else []) + group:
        if t["espn_team_id"] not in team_ids:
            team_ids.append(t["espn_team_id"])
    team_a_id = team_ids[0]
    team_b_id = team_ids[1] if len(team_ids) > 1 else team_a_id
    return team_a_id, team_b_id


def _execution_marker(group: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The row that finalizes a trade group: a TRADE_UPHOLD (commissioner
    finalization) when one exists, otherwise a binding TRADE_ACCEPT -- both
    sides agreed and the veto window passed clean, so ESPN finalizes the deal
    without ever writing an UPHOLD (the 2026 Crochet/Ray-for-Abreu trade).
    A TRADE_ACCEPT later vetoed carries a TRADE_VETO and no UPHOLD; that is
    not an execution, so a vetoed group with no uphold returns None."""
    executors = [
        t
        for t in group
        if t["transaction_type"] in ("TRADE_ACCEPT", "TRADE_UPHOLD")
        and t.get("status") not in ("PENDING", "CANCELED")
    ]
    if not executors:
        return None
    uphold = next(
        (t for t in executors if t["transaction_type"] == "TRADE_UPHOLD"), None
    )
    if uphold is not None:
        return uphold
    if any(t["transaction_type"] == "TRADE_VETO" for t in group):
        return None
    return executors[0]


def build_trades(
    transactions: list[dict[str, Any]],
    available_periods_by_year: dict[int, list[int]],
    draft_picks: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Executed trades, reconstructed from transactions.json's TRADE_* family
    (already merged from period + daily-capture files by build_transactions).

    Grouped by related_transaction_id -- every TRADE_ACCEPT/TRADE_UPHOLD row
    in a negotiation points directly at the operative TRADE_PROPOSAL's id
    (confirmed against all 11 real executed trades on file: never chained
    through an intermediate ACCEPT). A group is kept only when an execution
    marker finalizes it: a TRADE_UPHOLD (commissioner), or a binding
    TRADE_ACCEPT that was never vetoed -- ESPN sometimes finalizes on the
    accept alone (the 2026 Crochet/Ray-for-Abreu trade). A vetoed group
    carries a TRADE_VETO and no UPHOLD, and declined/canceled groups are
    dropped.

    The proposal's own `items` carry the full player exchange and, via each
    item's from/to team id, both sides of the trade -- but only survives
    when a daily capture caught it before ESPN purged it on execution
    (2026+, see build_transactions). When the proposal wasn't recovered,
    items comes back empty and team/owner attribution falls back to the
    surviving TRADE_ACCEPT/TRADE_UPHOLD rows' own team fields, which -- in
    every real trade seen -- span exactly the same two teams.

    When no ledger item of type TRADE survives either way, the player
    exchange is instead recovered by diffing box-score rosters across the
    trade's execution scoring period (see _reconstruct_trade_items and
    context/features/phase-8-trade-backfill-reconstruction-spec.md) --
    2019-2025 only, since that's a backfill against already-archived
    processed data, not a new live capture. Every item is tagged with a
    `source` (`ledger` or `box_score_diff`) so callers can tell the two
    apart; a trade neither the ledger nor the diff can recover keeps
    items == [] (surfaced as "NOT ON FILE" in the app).
    """
    by_id = {t["transaction_id"]: t for t in transactions}
    groups: dict[str, list[dict[str, Any]]] = {}
    for t in transactions:
        related = t.get("related_transaction_id")
        if related:
            groups.setdefault(related, []).append(t)

    draft_picks_by_year: dict[int, list[dict[str, Any]]] = {}
    for p in draft_picks:
        draft_picks_by_year.setdefault(p["year"], []).append(p)
    transactions_by_year: dict[int, list[dict[str, Any]]] = {}
    for t in transactions:
        transactions_by_year.setdefault(t["year"], []).append(t)

    # Pre-pass: every executed trade's (year, team pair, execution period),
    # so a trade needing reconstruction can bound its before/after search to
    # stop at the nearest *other* trade between the same two teams that year
    # -- otherwise two trades close together between the same pair would each
    # independently rediscover the other's players too (see
    # _reconstruct_trade_items).
    by_pair: dict[tuple[int, frozenset[int]], list[int]] = {}
    for proposal_id, group in groups.items():
        marker = _execution_marker(group)
        if marker is None:
            continue
        team_a_id, team_b_id = _trade_team_ids(by_id.get(proposal_id), group)
        key = (marker["year"], frozenset({team_a_id, team_b_id}))
        by_pair.setdefault(key, []).append(marker["scoring_period_id"])
    for periods in by_pair.values():
        periods.sort()

    roster_cache: dict[tuple[int, int, int], set[int] | None] = {}

    trades = []
    for proposal_id, group in groups.items():
        marker = _execution_marker(group)
        if marker is None:
            continue
        proposal = by_id.get(proposal_id)
        items = proposal["items"] if proposal else []
        if not items:
            # Rare, but observed: ESPN sometimes echoes the item list onto a
            # TRADE_ACCEPT row too, surviving even when the proposal itself
            # was purged.
            for t in group:
                if t["items"]:
                    items = t["items"]
                    break
        items = [dict(item, source="ledger") for item in items]

        owner_by_team = {
            t["espn_team_id"]: t["owner_id"]
            for t in ([proposal] if proposal else []) + group
        }
        team_a_id, team_b_id = _trade_team_ids(proposal, group)

        # A trade with only one known side (proposal fully pruned, single
        # TRADE_ACCEPT on file) can't be represented as a two-sided row in
        # trades.json. The app surfaces these as unrecorded entries from the
        # raw transaction ledger instead.
        if team_a_id == team_b_id:
            continue

        if not any(item["item_type"] == "TRADE" for item in items):
            execution_period = marker["scoring_period_id"]
            sibling_periods = by_pair[
                (marker["year"], frozenset({team_a_id, team_b_id}))
            ]
            earlier = [p for p in sibling_periods if p < execution_period]
            later = [p for p in sibling_periods if p > execution_period]
            items = items + _reconstruct_trade_items(
                marker["year"],
                team_a_id,
                team_b_id,
                execution_period,
                max(earlier) if earlier else None,
                min(later) if later else None,
                available_periods_by_year,
                draft_picks_by_year,
                transactions_by_year,
                roster_cache,
            )

        trades.append(
            asdict(
                Trade(
                    year=marker["year"],
                    trade_id=proposal_id,
                    proposed_date=proposal["proposed_date"] if proposal else None,
                    executed_date=marker["proposed_date"],
                    team_a_espn_team_id=team_a_id,
                    team_a_owner_id=owner_by_team.get(team_a_id),
                    team_b_espn_team_id=team_b_id,
                    team_b_owner_id=owner_by_team.get(team_b_id),
                    acting_member_key=(proposal or marker)["acting_member_key"],
                    items=items,
                )
            )
        )

    trades.sort(key=lambda t: (t["year"], t["executed_date"] or 0, t["trade_id"]))
    return trades


def _canon_neg_zero(value: Any) -> Any:
    """Replace IEEE -0.0 with 0.0, recursively. round() can produce -0.0
    (e.g. round(-0.001, 2)), which json.dumps serializes as "-0.0" -- a
    wart that survives JSON.parse as a distinct value in consumers
    (Object.is semantics) and that the DB layer cannot reproduce (SQLite
    REAL loses the sign). Zero arithmetic is identical either way, so the
    processed shape carries canonical 0 everywhere."""
    if isinstance(value, float) and value == 0.0:
        return 0.0
    if isinstance(value, dict):
        return {k: _canon_neg_zero(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_canon_neg_zero(v) for v in value]
    return value


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(_canon_neg_zero(data), indent=2) + "\n")


def build_archive(
    on_box_scores: Callable[[int, list[dict[str, Any]]], None] | None = None,
) -> dict[str, Any]:
    """Run the full-archive normalization pipeline without writing anything.

    Returns every processed collection the writer needs. on_box_scores(year,
    rows), when given, is called once per year as that season's box scores
    finish building, letting the caller stream them instead of holding every
    season's lines in memory.
    """
    if not RAW_DIR.is_dir() or not any(RAW_DIR.iterdir()):
        sys.exit("data/raw/ is empty or missing. Run scripts/extract.py first.")

    years = discover_years(RAW_DIR)
    if not years:
        sys.exit("No years found under data/raw/ -- run scripts/extract.py first.")

    owner_map = load_owner_map(MANUAL_DIR / "owner-map.json")
    season_notes = json.loads((MANUAL_DIR / "season-notes.json").read_text())
    player_registry = PlayerRegistry.with_retired(
        MANUAL_DIR / "player-overrides.json",
        {
            int(k): int(v)
            for k, v in json.loads((MANUAL_DIR / "retired-players.json").read_text())
            .get("retired_players", {})
            .items()
        },
    )
    pro_team_overrides = load_pro_team_overrides()

    # Pass A: register every player identity seen, across all years, before
    # building anything that needs a name resolved (draft picks reference a
    # playerId with no name of their own).
    for year in years:
        register_players_from_kona(
            player_registry, year, load_view(year, "kona_player_info.json")
        )
        register_players_from_roster(
            player_registry, year, load_view(year, "mRoster.json")
        )

    all_seasons = []
    all_teams = []
    all_matchups = []
    all_draft_picks = []
    all_keepers = []
    all_player_season_points = []
    all_player_team_season_points: list[dict[str, Any]] = []
    all_transactions: list[dict[str, Any]] = []
    all_box_periods_by_year: dict[int, list[int]] = {}
    errors: list[str] = []

    for year in years:
        try:
            settings = load_view(year, "mSettings.json")
            team_payload = load_view(year, "mTeam.json")
            matchupscore = load_view(year, "mMatchupScore.json")
            draft_payload = load_view(year, "mDraftDetail.json")
            box_periods = discover_box_periods(year)

            if settings:
                all_seasons.append(
                    build_season(
                        year, settings, matchupscore, season_notes, box_periods
                    )
                )
            if team_payload:
                all_teams.extend(build_teams(year, team_payload, owner_map))
            if matchupscore:
                all_matchups.extend(build_matchups(year, matchupscore, owner_map))

            # Before draft picks on purpose: a player dropped before the
            # season-level mRoster/kona_player_info snapshot (Pass A) but who
            # played while rostered still needs registering from box-score
            # data, so a same-year draft pick referencing them resolves a
            # name -- most likely to matter for an in-progress season, where
            # the roster snapshot is a current one, not a season-end one.
            box_scores = build_box_scores(
                year,
                box_periods,
                owner_map,
                player_registry,
                anchor_to_snapshots=determine_season_status(settings, matchupscore)
                == "in_progress",
            )
            if on_box_scores is not None:
                on_box_scores(year, box_scores)
            all_box_periods_by_year[year] = box_periods
            all_player_season_points.extend(derive_season_points(year, box_scores))
            all_player_team_season_points.extend(
                derive_team_season_points(year, box_scores)
            )

            year_draft_picks: list[dict[str, Any]] = []
            if draft_payload:
                pro_team_lookup = load_pro_team_lookup(year, pro_team_overrides)
                year_draft_picks = build_draft_picks(
                    year, draft_payload, owner_map, player_registry, pro_team_lookup
                )
                all_draft_picks.extend(year_draft_picks)

            prior_rosters = roster_player_ids_by_team(
                load_view(year - 1, "mRoster.json")
            )
            all_keepers.extend(build_keepers(year_draft_picks, prior_rosters))

            # After box scores on purpose: the scoring-period -> week map is
            # read back off them (see period_week_map).
            all_transactions.extend(
                build_transactions(
                    year,
                    discover_transaction_periods(year),
                    owner_map,
                    period_week_map(box_scores),
                    discover_transaction_daily_captures(year),
                )
            )
        except MappingError as exc:
            errors.append(f"{year}: {redact_swid(str(exc))}")

    # Phase 9.3b cutover: owners.json is now the ESPN-derived record. Its shape
    # is a superset of the old owner-map-derived one (same owner_id,
    # canonical_name, team_names_by_year -- proven identical across all 30
    # owners during 9.3a's parallel run -- plus ESPN member keys, co-owners, and
    # coverage years), so the app reads it unchanged. validate.py's
    # derive_owners_from_owner_map() is the independent re-derivation from
    # owner-map.json, which is how drift gets caught now that the manual file
    # is no longer authoritative (Source-of-Truth Rule, rule 4).
    league_owners, owner_problems = build_league_owners(owner_map, years)
    errors.extend(owner_problems)
    all_achievements, achievement_problems = build_achievements(owner_map, years)
    errors.extend(achievement_problems)
    latest_year = max(years) if years else None
    player_season_backfill = (
        build_player_season_backfill(years, player_registry, all_player_season_points)
        if latest_year is not None
        else []
    )
    card_points = build_card_points(years, player_registry, all_player_season_points)

    # Collect player IDs that have fantasy relevance for ghost pruning
    drafted_ids = {p["player_id"] for p in all_draft_picks}
    scored_ids = {p["player_id"] for p in all_player_team_season_points}

    pruned_players = player_registry.to_sorted_list(
        prune_ghosts=True, drafted_ids=drafted_ids, scored_ids=scored_ids
    )
    pruned_player_ids = {p["player_id"] for p in pruned_players}
    pruned_player_seasons = [
        ps
        for ps in player_registry.to_player_seasons()
        if ps["player_id"] in pruned_player_ids
    ]
    pruned_player_season_ownership = [
        o
        for o in (
            player_registry.to_season_ownership(latest_year) if latest_year else []
        )
        if o["player_id"] in pruned_player_ids
    ]

    return {
        "years": years,
        "seasons": all_seasons,
        "teams": all_teams,
        "matchups": all_matchups,
        "draft_picks": all_draft_picks,
        "keepers": all_keepers,
        "player_season_points": all_player_season_points,
        "player_team_season_points": all_player_team_season_points,
        "transactions": all_transactions,
        "box_periods_by_year": all_box_periods_by_year,
        "owners": league_owners,
        "achievements": all_achievements,
        "players": pruned_players,
        "player_seasons": pruned_player_seasons,
        "player_season_ownership": pruned_player_season_ownership,
        "player_season_backfill": player_season_backfill,
        "card_points": card_points,
        "trades": build_trades(
            all_transactions, all_box_periods_by_year, all_draft_picks
        ),
        "mlb_teams": [
            {"pro_team_id": pro_team_id, **info}
            for pro_team_id, info in sorted(MLB_TEAMS.items())
        ],
        "errors": errors,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()

    # Deliberately no --years flag: a partial run truncates every processed
    # file to the listed years while leaving box_scores/ intact, which broke
    # the production flow on 2026-08-20 (a --years 2026 output got committed;
    # every non-box-score file lost 2009-2025). Full-archive normalization is
    # the only mode; validate.py's seasons_cover_box_scores check backs this.
    archive = build_archive(
        on_box_scores=lambda year, rows: write_json(
            PROCESSED_DIR / "box_scores" / f"{year}.json", rows
        )
    )
    years: list[int] = archive["years"]
    all_seasons = archive["seasons"]
    all_teams = archive["teams"]
    all_matchups = archive["matchups"]
    all_draft_picks = archive["draft_picks"]
    all_keepers = archive["keepers"]
    all_player_season_points = archive["player_season_points"]
    all_player_team_season_points = archive["player_team_season_points"]
    all_transactions = archive["transactions"]
    league_owners = archive["owners"]
    player_registry_players_count = len(archive["players"])

    write_json(PROCESSED_DIR / "owners.json", league_owners)
    write_json(PROCESSED_DIR / "achievements.json", archive["achievements"])
    write_json(PROCESSED_DIR / "seasons.json", all_seasons)
    write_json(PROCESSED_DIR / "teams.json", all_teams)
    write_json(PROCESSED_DIR / "matchups.json", all_matchups)
    write_json(PROCESSED_DIR / "draft_picks.json", all_draft_picks)
    write_json(PROCESSED_DIR / "keepers.json", all_keepers)

    write_json(PROCESSED_DIR / "players.json", archive["players"])
    write_json(PROCESSED_DIR / "player_seasons.json", archive["player_seasons"])
    write_json(
        PROCESSED_DIR / "player_season_ownership.json",
        archive["player_season_ownership"],
    )
    write_json(PROCESSED_DIR / "player_season_points.json", all_player_season_points)
    write_json(
        PROCESSED_DIR / "player_team_season_points.json", all_player_team_season_points
    )
    write_json(
        PROCESSED_DIR / "player_season_backfill.json", archive["player_season_backfill"]
    )
    write_json(PROCESSED_DIR / "card_points.json", archive["card_points"])
    write_json(PROCESSED_DIR / "transactions.json", all_transactions)
    write_json(PROCESSED_DIR / "trades.json", archive["trades"])
    write_json(PROCESSED_DIR / "mlb_teams.json", archive["mlb_teams"])

    print(
        f"Normalized {len(years)} seasons: {len(all_teams)} teams, {len(all_matchups)} matchups, "
        f"{len(all_draft_picks)} draft picks, {len(all_keepers)} keepers, "
        f"{player_registry_players_count} players, "
        f"{len(archive['achievements'])} achievement records."
    )
    unvalidated_keepers = [k for k in all_keepers if not k["validated_on_prior_roster"]]
    if unvalidated_keepers:
        print(
            f"\n{len(unvalidated_keepers)} keeper picks did not match the prior season's roster "
            "(expected for a league's first draft; otherwise needs investigation):"
        )
        for k in unvalidated_keepers:
            print(
                f"  {k['year']} espn_team_id={k['espn_team_id']} player_id={k['player_id']} {k['player_name']!r}"
            )

    if archive["errors"]:
        print("\nErrors:")
        for e in archive["errors"]:
            print(f"  {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
