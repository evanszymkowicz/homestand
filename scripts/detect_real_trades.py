#!/usr/bin/env python3
"""Detects real-life MLB trades for this season's rostered players and auto-splits
data/manual/jersey-history-overrides.json into per-team stints.

See context/features/phase-8-jersey-trade-detection-spec.md. Standalone script -- no MCP
dependency, callable from CI (scripts/lib/mlb_stats_client.py hits statsapi.mlb.com directly).

Usage:
    python3 scripts/detect_real_trades.py --year 2026 [--previous-kona-player-info PATH] [--dry-run]

Weekly-only, ESPN-diff-triggered (see context/features/phase-8-jersey-trade-detection-spec.md's
"Cadence" section for the full history/rationale). `--previous-kona-player-info` scopes MLB
Stats API lookups to only players whose ESPN-reported team actually changed; the current
stint's pro_team_id always comes from that ESPN value directly (see build_entries), never from
MLB's own team name. Idempotent: re-running finds the same real trades and produces the same
entries, replacing only its own previously auto-generated entries for a given (player_id,
year) -- never touches hand-written entries.
"""

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib.mlb_crosswalk import load_cache, resolve_pool
from lib.mlb_stats_client import get_season_teams_with_games, get_season_transactions
from lib.mlb_teams import MLB_TEAMS

REPO_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = REPO_ROOT / "data" / "raw"
PROCESSED_DIR = REPO_ROOT / "data" / "processed"
MANUAL_DIR = REPO_ROOT / "data" / "manual"
OVERRIDES_PATH = MANUAL_DIR / "jersey-history-overrides.json"
CROSSWALK_OVERRIDES_PATH = MANUAL_DIR / "mlb-player-id-overrides.json"
CACHE_PATH = MANUAL_DIR / "mlb-player-id-cache.json"
CACHE_README = (
    "Auto-maintained bank of confirmed (our player_id) -> MLB Stats API personId "
    "resolutions, written by scripts/detect_real_trades.py so repeat runs skip the "
    "name-search call. Only unambiguous live-search resolutions land here -- never "
    "guesses. Human entries in mlb-player-id-overrides.json always win (consulted "
    "first), so a stale cache entry can never shadow one. Safe to delete outright; "
    "the next run simply re-resolves via search."
)

AUTO_SOURCE_PREFIX = "auto-detected: MLB Stats API transaction log"
NAME_TO_PRO_TEAM_ID = {info["name"]: pid for pid, info in MLB_TEAMS.items()}
NUMBER_CHANGE_RE = re.compile(r"changed number to (\d+)")


def pro_team_lookup_from_kona(path: Path) -> dict[int, int]:
    """player_id -> proTeamId, ESPN's own field. Empty dict if `path` doesn't exist."""
    if not path.exists():
        return {}
    payload = json.loads(path.read_text())
    return {
        e["player"]["id"]: e["player"].get("proTeamId", 0)
        for e in payload.get("players", [])
        if e.get("player")
    }


def jersey_lookup_from_kona(path: Path) -> dict[int, str]:
    """player_id -> jersey, ESPN's own field -- avoids an extra live MLB Stats call for
    "today's number" (get_current_team_and_jersey) when we already have this on disk."""
    if not path.exists():
        return {}
    payload = json.loads(path.read_text())
    return {
        e["player"]["id"]: e["player"]["jersey"]
        for e in payload.get("players", [])
        if e.get("player", {}).get("jersey")
    }


def current_season_pool(year: int) -> list[dict[str, Any]]:
    """[{"player_id", "player_name"}, ...] for every player_seasons.json row this year --
    this project's own definition of "this season's rostered pool" (546 for 2026)."""
    rows = json.loads((PROCESSED_DIR / "player_seasons.json").read_text())
    return [
        {"player_id": r["player_id"], "player_name": r["player_name"]}
        for r in rows
        if r["year"] == year
    ]


def jersey_as_of(
    num_events: list[dict[str, Any]],
    date: str,
    fallback: str | None,
    inclusive: bool = True,
) -> str | None:
    """Jersey number in effect on `date`, from the most recent "NUM" event on or before
    it (strictly before if `inclusive` is False); `fallback` (typically today's current
    number) when no such event exists this season -- the honest default when nothing on
    record says otherwise. `inclusive=False` matters for the team a player is *leaving* on
    a trade date: a same-day Number Change on record belongs to the new team's stint, not
    the old one, so that boundary must exclude it rather than let both stints pick it up."""
    candidates = [
        e
        for e in num_events
        if (e.get("date", "") < date if not inclusive else e.get("date", "") <= date)
    ]
    if not candidates:
        return fallback
    match = NUMBER_CHANGE_RE.search(candidates[-1].get("description", ""))
    return match.group(1) if match else fallback


def build_season_stints(
    person_id: int, year: int, current_jersey: str | None
) -> list[dict[str, Any]] | None:
    """This season's real team/jersey stints for one player, oldest first. None if no
    real trade happened this season -- a single-team season needs no split, ESPN's own
    per-year field is already correct for it. `current_jersey` is ESPN's own value (see
    jersey_lookup_from_kona) -- no live MLB Stats call needed for "today's number"."""
    events = get_season_transactions(person_id, year)
    trades = [e for e in events if e.get("typeCode") == "TR"]
    if not trades:
        return None
    # One team across the whole season means no stint split, however the log
    # labels the move -- skip the teams-with-games call entirely.
    trade_teams = [trades[0]["fromTeam"]["name"]]
    trade_teams += [t["toTeam"]["name"] for t in trades]
    if len(set(trade_teams)) < 2:
        return None
    num_events = [e for e in events if e.get("typeCode") == "NUM"]

    # Each stint's jersey is looked up as of *leaving* it (the next trade's date, or
    # today for the last stint) -- a number assigned right after arrival often lags the
    # trade date by weeks, so an arrival-date lookup would wrongly carry over the
    # previous team's number.
    teams = trade_teams
    departure_dates = [t["date"] for t in trades]
    stints = [
        {
            "team": team,
            "jersey": jersey_as_of(num_events, date, current_jersey, inclusive=False),
        }
        for team, date in zip(teams[:-1], departure_dates)
    ]
    stints.append({"team": teams[-1], "jersey": current_jersey})

    # A "TR" event doesn't mean the player ever actually played for the team named --
    # a spring-training DFA/trade can move him before he appears in a real game there.
    # Drop any non-final stint for a team with zero recorded games; the final stint is
    # exempt (its team comes from ESPN's own data downstream, not this check, in
    # build_entries -- a just-completed trade may have zero games so far).
    played = get_season_teams_with_games(person_id, year)
    stints = [s for s in stints[:-1] if s["team"] in played] + stints[-1:]
    if len(stints) < 2:
        return None
    return stints


def build_entries(
    player_id: int,
    player_name: str,
    year: int,
    stints: list[dict[str, Any]],
    current_pro_team_id: int,
) -> list[dict[str, Any]] | None:
    """Map each stint to our pro_team_id; None if an *earlier* stint's team name doesn't
    match MLB_TEAMS. The last (current) stint always gets `current_pro_team_id` verbatim --
    ESPN's own value, never derived from MLB's team name."""
    entries = []
    for i, stint in enumerate(stints):
        if i == len(stints) - 1:
            pro_team_id = current_pro_team_id
            # Label matches the id we actually wrote, not necessarily stint["team"].
            team_label = MLB_TEAMS.get(pro_team_id, {}).get("name", stint["team"])
        else:
            pro_team_id = NAME_TO_PRO_TEAM_ID.get(stint["team"])
            if pro_team_id is None:
                return None
            team_label = stint["team"]
        entries.append(
            {
                "player_id": player_id,
                "player_name": player_name,
                "pro_team_id": pro_team_id,
                "jersey": stint["jersey"],
                "start_year": year,
                "end_year": year,
                "source": f"{AUTO_SOURCE_PREFIX} ({team_label})",
            }
        )
    return entries


def merge_auto_entries(
    existing: list[dict[str, Any]],
    player_id: int,
    year: int,
    new_entries: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], bool]:
    """Replace this player-year's own previously auto-generated entries with a freshly
    computed set; leaves every hand-written entry (any other source string) untouched.
    Returns (updated list, changed?) -- changed is False when the freshly computed set is
    identical to what's already there, so re-running doesn't touch the file every day."""
    kept = [
        e
        for e in existing
        if not (
            e["player_id"] == player_id
            and e["start_year"] == year
            and e.get("source", "").startswith(AUTO_SOURCE_PREFIX)
        )
    ]
    prior_auto = [
        e
        for e in existing
        if e["player_id"] == player_id
        and e["start_year"] == year
        and e.get("source", "").startswith(AUTO_SOURCE_PREFIX)
    ]
    changed = prior_auto != new_entries
    return kept + new_entries, changed


def detect_and_merge(
    year: int,
    pool: list[dict[str, Any]],
    overrides_raw: dict[str, Any],
    crosswalk_overrides_path: Path,
    current_pro_team_lookup: dict[int, int],
    current_jersey_lookup: dict[int, str],
    person_id_cache: dict[int, int] | None = None,
) -> tuple[dict[str, Any], bool, list[dict[str, Any]], dict[int, int], int]:
    """Pure detection + merge. `pool` must already be restricted to players whose ESPN
    team changed (see main()) -- trusts the caller's filtering, doesn't re-check it.
    Returns (updated overrides, changed?, unresolved, newly_resolved person-ids,
    cache hits). Writes nothing; the caller persists newly_resolved to the cache."""
    resolved, unresolved, newly_resolved, cache_hits = resolve_pool(
        pool, crosswalk_overrides_path, person_id_cache
    )
    overrides = overrides_raw["overrides"]
    id_to_name = {p["player_id"]: p["player_name"] for p in pool}
    any_changed = False

    for player_id, person_id in resolved.items():
        stints = build_season_stints(
            person_id, year, current_jersey_lookup.get(player_id)
        )
        if stints is None:
            continue
        entries = build_entries(
            player_id,
            id_to_name[player_id],
            year,
            stints,
            current_pro_team_lookup[player_id],
        )
        if entries is None:
            print(
                f"  {player_id} {id_to_name[player_id]}: real trade found but a team name "
                f"didn't match MLB_TEAMS -- skipped, needs investigation"
            )
            continue

        # A hand-written entry already covering the same team is trusted as-is -- never
        # duplicated, and never silently overwritten even if it looks wrong (that needs a
        # human, not this script). Only genuinely new teams get auto-written.
        hand_written = {
            e["pro_team_id"]: e["jersey"]
            for e in overrides
            if e["player_id"] == player_id
            and e["start_year"] == year
            and not e.get("source", "").startswith(AUTO_SOURCE_PREFIX)
        }
        filtered = []
        for e in entries:
            hand_jersey = hand_written.get(e["pro_team_id"])
            if hand_jersey is None:
                filtered.append(e)
            elif hand_jersey != e["jersey"]:
                print(
                    f"  {player_id} {id_to_name[player_id]}: hand-written entry for "
                    f"pro_team_id={e['pro_team_id']} has jersey={hand_jersey}, auto-detected "
                    f"jersey={e['jersey']} -- conflict, needs a human look, not auto-written"
                )
        entries = filtered
        overrides, changed = merge_auto_entries(overrides, player_id, year, entries)
        if changed:
            any_changed = True
            if entries:
                print(
                    f"  {player_id} {id_to_name[player_id]}: {len(entries)}-stint split written"
                )
            else:
                print(
                    f"  {player_id} {id_to_name[player_id]}: stale auto-detected entries "
                    f"removed (fully hand-covered now)"
                )

    return (
        {**overrides_raw, "overrides": overrides},
        any_changed,
        unresolved,
        newly_resolved,
        cache_hits,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument(
        "--previous-kona-player-info",
        type=Path,
        default=None,
        help=(
            "Last week's kona_player_info.json content, pre-force-refresh. Omit (or point "
            "at a missing file) to skip detection entirely -- correct for a season's "
            "first-ever weekly run."
        ),
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="report what would change, write nothing"
    )
    args = parser.parse_args()

    kona_path = RAW_DIR / str(args.year) / "kona_player_info.json"
    current_lookup = pro_team_lookup_from_kona(kona_path)
    jersey_lookup = jersey_lookup_from_kona(kona_path)
    previous_lookup = (
        pro_team_lookup_from_kona(args.previous_kona_player_info)
        if args.previous_kona_player_info is not None
        else {}
    )
    if not previous_lookup:
        print(
            "No previous kona_player_info.json snapshot to diff against -- "
            "skipping trade detection this run."
        )
        return

    changed_ids = {
        pid for pid, team in current_lookup.items() if previous_lookup.get(pid) != team
    }
    pool = [p for p in current_season_pool(args.year) if p["player_id"] in changed_ids]
    if not pool:
        print(
            "No player's ESPN team changed since last week -- no new real trades to detect."
        )
        return

    overrides_raw = json.loads(OVERRIDES_PATH.read_text())
    person_id_cache = load_cache(CACHE_PATH)
    updated_raw, any_changed, unresolved, newly_resolved, cache_hits = detect_and_merge(
        args.year,
        pool,
        overrides_raw,
        CROSSWALK_OVERRIDES_PATH,
        current_lookup,
        jersey_lookup,
        person_id_cache,
    )
    print(
        f"Trade detection: {len(pool)} changed players -- "
        f"{cache_hits} person-ids from cache, "
        f"{len(newly_resolved)} newly resolved, "
        f"{len(unresolved)} unresolved."
    )
    if unresolved:
        print(f"{len(unresolved)} players could not be resolved to an MLB person id:")
        for u in unresolved:
            print(f"  {u['player_id']} {u['player_name']}: {u['reason']}")

    if not any_changed and not newly_resolved:
        print("No new real trades detected.")
        return
    if args.dry_run:
        print("--dry-run: not writing.")
        return
    if newly_resolved:
        merged = {**person_id_cache, **newly_resolved}
        CACHE_PATH.write_text(
            json.dumps(
                {
                    "_readme": CACHE_README,
                    "resolved": {str(k): v for k, v in sorted(merged.items())},
                },
                indent=2,
            )
            + "\n"
        )
    if any_changed:
        OVERRIDES_PATH.write_text(json.dumps(updated_raw, indent=2) + "\n")


if __name__ == "__main__":
    main()
