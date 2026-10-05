"""Box-score line accumulation — shared by normalize.py's full weekly rebuild
and the live daily box-score patch (Phase 8 extension).

Pulled out of normalize.py's build_box_scores() so both callers accumulate a
player's per-scoring-period points/stats/slots the same way instead of
maintaining two copies of the stat-id mapping. Deliberately excludes
PlayerRegistry: registering a *new* player (as opposed to resolving an
already-registered player_id) is a decision normalize.py's weekly pass makes,
not something this module does on its own -- the live patch caller resolves
player identity itself (see scripts/sync_live_scoreboard.py's docstring for
why new-player registration stays weekly-only).
"""

from dataclasses import asdict
from typing import Any

from lib.schema import (
    BattingLine,
    BoxScorePlayerLine,
    BoxScoreSlot,
    PitchingLine,
    PlayerSeasonPoints,
    PlayerTeamSeasonPoints,
)
from lib.stat_ids import BATTING_STAT_IDS, PITCHING_STAT_IDS

BATTING_NAME_TO_STAT_ID = {name: stat_id for stat_id, name in BATTING_STAT_IDS.items()}
PITCHING_NAME_TO_STAT_ID = {
    name: stat_id for stat_id, name in PITCHING_STAT_IDS.items()
}


def day_stat_blocks(player: dict[str, Any], period: int) -> list[dict[str, Any]]:
    """The player's single-day stat blocks (statSourceId 0, statSplitTypeId 5)
    for the requested scoring period: `appliedTotal`/`appliedStats` plus the raw
    `stats` dict ({statId: whole-number count} — named in scripts/lib/stat_ids.py).
    Doubleheader days produce one block per game, so this is a list; empty when
    the player had no stat entry that day (an MLB off-day / All-Star break).
    Responses can also carry *other* days' entries (per-period mRoster includes
    the prior day's) — callers must read only the requested period's, or days
    get double-counted."""
    return [
        s
        for s in player.get("stats", [])
        if (
            s.get("statSplitTypeId") == 5
            and s.get("statSourceId") == 0
            and s.get("scoringPeriodId") == period
        )
    ]


def matchup_stat_blocks(player: dict[str, Any]) -> list[dict[str, Any]]:
    """The player's whole-matchup cumulative stat block(s).

    Modern (2019+) `mBoxscore` responses carry both a per-day
    `rosterForCurrentScoringPeriod` and a cumulative
    `rosterForMatchupPeriod`. The cumulative block uses `scoringPeriodId: 0`
    with `statSplitTypeId: 5` / `statSourceId: 0`, and its `appliedStats`/`stats`
    cover the entire matchup window. This is the source of truth for weekly
    player points and counting stats when the per-day view is incomplete (most
    notably during an in-progress season like 2026)."""
    return [
        s
        for s in player.get("stats", [])
        if (
            s.get("statSplitTypeId") == 5
            and s.get("statSourceId") == 0
            and s.get("scoringPeriodId") == 0
        )
    ]


def applied_raw_stats(blocks: list[dict[str, Any]]) -> dict[str, Any]:
    """Raw stat counts that actually generated applied points, merged across a
    day's blocks. Raw ids absent from a block's appliedStats did not score and
    are excluded: ESPN's 2018 batter-entity Ohtani carries full raw pitching
    lines on days he pitched with empty appliedStats (his pitching never scored
    for that entity), and a stat line must stay recomputable to the points it
    produced (validate.py's stat_line_reconciliation)."""
    merged: dict[str, Any] = {}
    for block in blocks:
        stats = block.get("stats") or {}
        for stat_id_str in block.get("appliedStats") or {}:
            value = stats.get(stat_id_str)
            if value:
                merged[stat_id_str] = merged.get(stat_id_str, 0) + value
    return merged


def day_has_activity(blocks: list[dict[str, Any]]) -> bool:
    """Whether any of a day's blocks shows real baseball: a raw stats dict,
    applied per-stat points, or a nonzero applied total. Empty husk blocks
    (all three absent) appear on days without games -- most notably 2020's
    canceled pre-COVID scoring periods, where ESPN emits a block per player
    with stats={} and appliedTotal=0.0."""
    return any(
        block.get("stats") or block.get("appliedStats") or block.get("appliedTotal")
        for block in blocks
    )


def stat_dict_delta(
    current: dict[str, int], previous: dict[int, int]
) -> dict[str, int]:
    """Difference between a freshly-extracted stat dict (string keys) and the
    already-accumulated `stat_totals` dict (int keys). Returns only changed
    values, which is exactly what a new daily slot should contribute.

    Deliberately iterates only `current`'s keys: a stat that vanished from
    the cumulative block must NOT be back-attrited as a negative delta on
    whatever day is being stitched -- on live-captured historical windows
    that misattributed revisions onto unrelated days (negative AB counts in
    finished seasons' slots). Phantom counts instead wash out through
    anchor_entry_to_snapshot(), which pins totals to the same authoritative
    snapshot the points come from."""
    delta: dict[str, int] = {}
    for stat_id_str, value in current.items():
        diff = value - previous.get(int(stat_id_str), 0)
        if diff:
            delta[stat_id_str] = diff
    return delta


# Slots that never count toward a team's active point total. Mirrors
# validate.py's BENCH_AND_IR_SLOTS (16 = bench, 17 = IR); duplicated here
# because lib/ must not import from validate.py.
BENCH_AND_IR_SLOT_IDS = {16, 17}

# Cumulative-snapshot anchoring below is a no-op when the accumulated totals
# already agree with ESPN's snapshot this closely -- pure float-accumulation
# noise, not a real revision. Keeps completed seasons' output byte-identical.
ANCHOR_POINTS_TOLERANCE = 0.015


def bench_contribution(entry: dict[str, Any]) -> tuple[float, dict[int, int]]:
    """A line's bench/IR production: summed slot points and raw stats.

    ESPN's rosterForMatchupPeriod cumulative blocks are counted-only -- a
    benched player never appears in one -- so bench production reaches the
    archive exclusively through per-day slots and must survive anchoring
    separately (see anchor_entry_to_snapshot)."""
    points = 0.0
    stats: dict[int, int] = {}
    for slot in entry["slots"]:
        if slot["lineup_slot_id"] not in BENCH_AND_IR_SLOT_IDS:
            continue
        points += slot["points"]
        for stat_id_str, value in (slot.get("raw_stats") or {}).items():
            stat_id = int(stat_id_str)
            if (stat_id in BATTING_STAT_IDS or stat_id in PITCHING_STAT_IDS) and value:
                stats[stat_id] = stats.get(stat_id, 0) + int(value)
    return points, stats


def counted_slot_contribution(
    entry: dict[str, Any] | None, day: int
) -> tuple[float, dict[str, int]]:
    """The counted (non-bench/IR) points and raw stats a line's slots carry for
    one scoring period -- that day's share of a counted matchup-cumulative.

    The mirror of bench_contribution, used when resolving a cumulative advance
    against already-emitted per-day slots: the advance's delta is counted-only
    (rosterForMatchupPeriod omits benched players), so bench production must
    not be subtracted from it. Returns zeros for a day the line has no counted
    slot for."""
    points = 0.0
    stats: dict[str, int] = {}
    if entry is None:
        return points, stats
    for slot in entry["slots"]:
        if slot["scoring_period"] != day:
            continue
        if slot["lineup_slot_id"] in BENCH_AND_IR_SLOT_IDS:
            continue
        points += slot["points"]
        for stat_id_str, value in (slot.get("raw_stats") or {}).items():
            stats[stat_id_str] = stats.get(stat_id_str, 0) + int(value)
    return points, stats


def counted_slot_days(entry: dict[str, Any] | None) -> set[int]:
    """Scoring periods this line has a counted (non-bench/IR) slot for."""
    if entry is None:
        return set()
    return {
        slot["scoring_period"]
        for slot in entry["slots"]
        if slot["lineup_slot_id"] not in BENCH_AND_IR_SLOT_IDS
    }


def merge_residual_into_slot(
    entry: dict[str, Any],
    day: int,
    points: float,
    stats: dict[str, int],
) -> None:
    """Fold a retro-revision residual into a span's last counted slot.

    Used when every day of a resolved cumulative-advance span already carries a
    counted slot, so there is no uncovered day to land the residual on: the
    revision is merged into the last day rather than replacing that day's
    per-day line via accumulate()'s upsert (which would delete it). Only the
    slot is touched -- the anchor pass re-pins total_points/stat_totals from
    the authoritative cumulative snapshot plus bench contribution afterwards,
    and slot sums reconcile against that pinned total by construction."""
    for slot in entry["slots"]:
        if slot["scoring_period"] != day:
            continue
        if slot["lineup_slot_id"] in BENCH_AND_IR_SLOT_IDS:
            continue
        slot["points"] += points
        raw = slot.setdefault("raw_stats", {})
        for stat_id_str, value in stats.items():
            raw[stat_id_str] = raw.get(stat_id_str, 0) + int(value)
        return


def anchor_entry_to_snapshot(
    entry: dict[str, Any],
    points: float,
    raw_stats: dict[int, int],
) -> bool:
    """Pin a line's totals to ESPN's matchup-cumulative snapshot PLUS its own
    bench production.

    `points`/`raw_stats` are COUNTED-ONLY figures from the latest
    rosterForMatchupPeriod block (ESPN omits benched players entirely), so the
    authoritative full-production targets are:

        total_points = snapshot points + bench slot points
        stat_totals  = snapshot stats  + bench slot raw stats

    Delta-chain stitching (per-day blocks, cumulative deltas, pending fills)
    can leave `total_points` and `stat_totals` mutually inconsistent when ESPN
    retro-revises scoring between once-captured snapshots. The residual
    (target minus accumulated) folds into the line's last active slot: slots
    keep summing to total_points (validate.py's pf_box_score_reconciliation
    sums active-slot points against the team's record -- bench slots are
    untouched, so both sides stay truthful) and stat_totals keeps recomputing
    to total_points (its stat_line_reconciliation). A negative residual count
    is truthful -- a scoring revision landing after the day was first captured.

    Callers must only anchor the in-progress season: a completed season's
    stitching is validate-clean by construction, its totals already include
    bench production, and its slot labels don't respect snapshot horizons
    (mid-week gap fills dump multi-day production onto earlier-labeled slots),
    so pinning those lines can subtract real tail-of-season production.

    No-op (returns False) when the entry already matches its targets within
    ANCHOR_POINTS_TOLERANCE with identical stats, so clean lines serialize
    byte-identically. Lines whose player vanished from later rosters simply
    never get anchored past their own last snapshot."""
    anchored_stats = {
        stat_id: int(value)
        for stat_id, value in raw_stats.items()
        if int(value) and (stat_id in BATTING_STAT_IDS or stat_id in PITCHING_STAT_IDS)
    }
    bench_points, bench_stats = bench_contribution(entry)
    # Union-key merge: bench stats add on top of the snapshot's counted ones.
    target_points = points + bench_points
    target_stats = dict(anchored_stats)
    for stat_id, value in bench_stats.items():
        target_stats[stat_id] = target_stats.get(stat_id, 0) + value

    residual_points = target_points - entry["total_points"]
    residual_stats: dict[int, int] = {}
    for stat_id in set(target_stats) | set(entry["stat_totals"]):
        diff = target_stats.get(stat_id, 0) - entry["stat_totals"].get(stat_id, 0)
        if diff:
            residual_stats[stat_id] = diff
    if abs(residual_points) <= ANCHOR_POINTS_TOLERANCE and not residual_stats:
        return False

    target = None
    for slot in entry["slots"]:
        if slot["lineup_slot_id"] not in BENCH_AND_IR_SLOT_IDS and slot.get(
            "raw_stats"
        ):
            target = slot  # last active slot that ever carried stats wins
    if target is None:
        for slot in entry["slots"]:
            if slot["lineup_slot_id"] not in BENCH_AND_IR_SLOT_IDS:
                target = slot
    if target is None and entry["slots"]:
        # Degenerate bench-only line: nowhere else for the counted residual to
        # go while keeping slots summing to total_points. Cannot arise from
        # live captures (a player absent from every active slot has no
        # snapshot to anchor to), so this is defensive only.
        target = entry["slots"][-1]

    entry["total_points"] += residual_points
    for stat_id, diff in residual_stats.items():
        new_value = entry["stat_totals"].get(stat_id, 0) + diff
        if new_value:
            entry["stat_totals"][stat_id] = new_value
        else:
            entry["stat_totals"].pop(stat_id, None)
    if target is not None:
        target["points"] += residual_points
        raw = target.setdefault("raw_stats", {})
        for stat_id, diff in residual_stats.items():
            key = str(stat_id)
            raw[key] = raw.get(key, 0) + diff
            if not raw[key]:
                del raw[key]
    return True


def new_line_entry(
    year: int,
    week: int,
    matchup_id: int,
    owner_id: str,
    espn_team_id: int,
    player_id: int,
    player_name: str,
) -> dict[str, Any]:
    """A fresh accumulator for one (matchup, team, player) box-score line —
    the shape `accumulate()`/`finalize_line()` operate on."""
    return {
        "year": year,
        "week": week,
        "matchup_id": matchup_id,
        "owner_id": owner_id,
        "espn_team_id": espn_team_id,
        "player_id": player_id,
        "player_name": player_name,
        "total_points": 0.0,
        "stat_totals": {},
        "slots": [],
    }


def entry_from_serialized(row: dict[str, Any]) -> dict[str, Any]:
    """The inverse of finalize_line() — reconstructs an accumulator from an
    already-committed box_scores.json row, so a live patch can merge a new
    day onto it without re-deriving every prior day's contribution. Stat
    totals round-trip exactly: values are whole-number counts on both sides
    (see accumulate()'s rounding)."""
    totals: dict[int, int] = {}
    for name, value in (row.get("batting") or {}).items():
        if value:
            totals[BATTING_NAME_TO_STAT_ID[name]] = value
    for name, value in (row.get("pitching") or {}).items():
        if value:
            totals[PITCHING_NAME_TO_STAT_ID[name]] = value
    return {
        "year": row["year"],
        "week": row["week"],
        "matchup_id": row["matchup_id"],
        "owner_id": row["owner_id"],
        "espn_team_id": row["espn_team_id"],
        "player_id": row["player_id"],
        "player_name": row["player_name"],
        "total_points": row["total_points"],
        "stat_totals": totals,
        "slots": list(row.get("slots", [])),
    }


def accumulate(
    entry: dict[str, Any],
    points: float,
    slot_id: int,
    period: int,
    stats: dict[str, Any] | None,
) -> None:
    """Upserts `period` on `entry` — an existing slot is replaced (its old
    points/raw_stats subtracted first), not skipped, so same-day live-patch
    reruns don't double-count; normalize.py's per-day pass visits each period
    once, so it's always a pure add there -- callers that emit twice for one
    period (e.g. a cumulative-delta wave after the per-day wave) must not:
    the upsert would silently replace the per-day line with the delta.
    A legacy slot with no raw_stats (pre-migration)
    has no recoverable stat contribution to subtract, so this call's stats
    are withheld from stat_totals too (stored as an empty sentinel, not
    merged) rather than risk a double-count -- the one exception being the
    entry's original pre-migration baseline itself, which was never
    slot-scoped and so can't be un-baked; that one-time residual clears at
    the next weekly full rebuild, not on a later same-day rerun."""
    raw_stats: dict[str, int] = {}
    if stats:
        for stat_id_str, value in stats.items():
            stat_id = int(stat_id_str)
            if value and (stat_id in BATTING_STAT_IDS or stat_id in PITCHING_STAT_IDS):
                # Mapped raw values are whole-number counts everywhere
                # (verified in stat_ids.py's methodology); round() guards
                # against float representation, not fractional stats.
                raw_stats[stat_id_str] = int(round(value))

    totals = entry["stat_totals"]
    stats_reconcilable = True
    for i, slot in enumerate(entry["slots"]):
        if slot["scoring_period"] != period:
            continue
        entry["total_points"] -= slot["points"]
        if "raw_stats" in slot:
            for old_stat_id_str, old_value in slot["raw_stats"].items():
                old_stat_id = int(old_stat_id_str)
                totals[old_stat_id] = totals.get(old_stat_id, 0) - old_value
        else:
            stats_reconcilable = False
        del entry["slots"][i]
        break

    entry["total_points"] += points
    # Only merge into stat_totals when the replaced slot's own contribution
    # (if any) was itself reconcilable -- otherwise this slot's raw_stats is
    # stored empty, a sentinel meaning "not yet reflected in stat_totals",
    # so a later same-day rerun of this same period doesn't subtract stats
    # that were never added.
    stored_raw_stats = raw_stats if stats_reconcilable else {}
    if stats_reconcilable:
        for stat_id_str, value in raw_stats.items():
            stat_id = int(stat_id_str)
            totals[stat_id] = totals.get(stat_id, 0) + value
    entry["slots"].append(
        asdict(
            BoxScoreSlot(
                scoring_period=period,
                lineup_slot_id=slot_id,
                points=points,
                raw_stats=stored_raw_stats,
            )
        )
    )


def stat_line(totals: dict[int, int], mapping: dict[int, str], cls: type) -> Any:
    values = {name: totals.get(stat_id, 0) for stat_id, name in mapping.items()}
    if not any(values.values()):
        return None  # no activity on this side of the ball (or no raw stats)
    return cls(**values)


def slot_split(line: dict[str, Any]) -> tuple[float, float]:
    """(counted, bench) slot-point sums for one box-score line -- counted is
    what active slots produced (the only part team scores are made of), bench
    the bench/IR remainder. Pre-2019's single synthetic slot counts as
    active, so those seasons naturally split to (total, 0)."""
    counted = 0.0
    bench = 0.0
    for slot in line["slots"]:
        if slot["lineup_slot_id"] in BENCH_AND_IR_SLOT_IDS:
            bench += slot["points"]
        else:
            counted += slot["points"]
    return counted, bench


def derive_season_points(
    year: int, box_scores: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """One row per player with any box-score activity in `year`, points summed
    across every espn_team_id they appeared under (an in-season trade or
    waiver pickup shouldn't split a player's production into two rows). Shared
    by normalize.py's full rebuild and the live daily patch so
    player_season_points.json never drifts out of sync with the season's
    box_scores/{year}.json -- validate.py's player_season_points_reconciliation
    enforces that these two stay an exact re-derivation of each other.

    `points` keeps summing total_points (float accumulation order unchanged,
    keeping completed seasons byte-identical); counted/bench are the explicit
    slot split, stored alongside so no consumer ever re-derives them."""
    totals: dict[int, float] = {}
    counted_totals: dict[int, float] = {}
    bench_totals: dict[int, float] = {}
    names: dict[int, str] = {}
    for line in box_scores:
        player_id = line["player_id"]
        counted, bench = slot_split(line)
        totals[player_id] = totals.get(player_id, 0.0) + line["total_points"]
        counted_totals[player_id] = counted_totals.get(player_id, 0.0) + counted
        bench_totals[player_id] = bench_totals.get(player_id, 0.0) + bench
        names[player_id] = line["player_name"]
    return [
        asdict(
            PlayerSeasonPoints(
                year=year,
                player_id=player_id,
                player_name=names[player_id],
                points=round(points, 2),
                counted_points=round(counted_totals[player_id], 2),
                bench_points=round(bench_totals[player_id], 2),
            )
        )
        for player_id, points in sorted(totals.items())
    ]


def derive_team_season_points(
    year: int, box_scores: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """One row per (player, team) that scored in `year` -- the per-owner split
    behind derive_season_points()'s totals. Same source and same pass as that
    function, so the two can never disagree: this groups by (player, team)
    where that one groups by player alone. A player traded or claimed
    mid-season yields one row per team that rostered him while he scored.
    Shared for the same reason as derive_season_points -- see that
    function's docstring; validate.py's player_team_points check enforces
    this rolls up exactly to player_season_points.json. Carries the same
    explicit counted/bench split per row."""
    totals: dict[tuple[int, str, int], float] = {}
    counted_totals: dict[tuple[int, str, int], float] = {}
    bench_totals: dict[tuple[int, str, int], float] = {}
    names: dict[int, str] = {}
    for line in box_scores:
        key = (line["player_id"], line["owner_id"], line["espn_team_id"])
        counted, bench = slot_split(line)
        totals[key] = totals.get(key, 0.0) + line["total_points"]
        counted_totals[key] = counted_totals.get(key, 0.0) + counted
        bench_totals[key] = bench_totals.get(key, 0.0) + bench
        names[line["player_id"]] = line["player_name"]
    return [
        asdict(
            PlayerTeamSeasonPoints(
                year=year,
                player_id=player_id,
                player_name=names[player_id],
                owner_id=owner_id,
                espn_team_id=espn_team_id,
                points=round(points, 2),
                counted_points=round(
                    counted_totals[(player_id, owner_id, espn_team_id)], 2
                ),
                bench_points=round(
                    bench_totals[(player_id, owner_id, espn_team_id)], 2
                ),
            )
        )
        for (player_id, owner_id, espn_team_id), points in sorted(totals.items())
    ]


def finalize_line(entry: dict[str, Any]) -> dict[str, Any]:
    """Serializes an accumulator into the BoxScorePlayerLine dict shape
    written to box_scores/{year}.json."""
    return asdict(
        BoxScorePlayerLine(
            year=entry["year"],
            week=entry["week"],
            matchup_id=entry["matchup_id"],
            owner_id=entry["owner_id"],
            espn_team_id=entry["espn_team_id"],
            player_id=entry["player_id"],
            player_name=entry["player_name"],
            total_points=round(entry["total_points"], 2),
            batting=stat_line(entry["stat_totals"], BATTING_STAT_IDS, BattingLine),
            pitching=stat_line(entry["stat_totals"], PITCHING_STAT_IDS, PitchingLine),
            slots=[BoxScoreSlot(**s) for s in entry["slots"]],
        )
    )
