"""DB -> processed-JSON-shape reconstruction, shared by both DB acceptance tools.

check_fixture.py uses these to prove the database reproduces data/processed/
exactly; validate_db.py uses the same functions to feed validate.py's check
functions with collections rebuilt from the DB, so the pipeline's invariants
run against storage unchanged.

Every function here mirrors load.py's row mapping in reverse. The shapes they
produce are proven byte-identical to data/processed/'s JSON by check_fixture;
if that parity ever breaks, fix rebuild.py and load.py together.
"""

import json
import re
import sqlite3
from typing import Any

from lib.stat_ids import BATTING_STAT_IDS, PITCHING_STAT_IDS

BATTING_FIELDS = list(BATTING_STAT_IDS.values())
PITCHING_FIELDS = list(PITCHING_STAT_IDS.values())

SEASONS_JSON_FIELDS = [
    "playoff_brackets",
    "divisions",
    "scoring",
    "coverage",
    "notes",
    "settings",
    "roster_rules",
    "acquisition_rules",
    "draft_settings",
    "trade_rules",
]
OWNERS_JSON_FIELDS = ["team_names_by_year", "espn_member_keys", "co_owners"]
TEAMS_JSON_FIELDS = [
    "overall",
    "home",
    "away",
    "division_record",
    "value_by_stat",
    "transactions",
]
PLAYERS_JSON_FIELDS = ["eligible_slots", "games_played_by_position", "seasons_seen"]

# Boolean columns arrive as SQLite 0/1; the processed shape carries booleans.
# Mirrors dbShapes.ts's DB_BOOL_FIELDS -- keep the two lists in lockstep.
DB_BOOL_FIELDS = frozenset(
    {
        "absent_from_latest_season",
        "is_commissioner",
        "eliminated",
        "is_transaction_locked",
        "active",
        "droppable",
        "injured",
        "keeper",
        "traded_pick",
        "validated_on_prior_roster",
        "is_league_manager",
    }
)


def _coerce_bool_fields(rows: list[dict]) -> list[dict]:
    # Null-preserving (player_seasons.injured is nullable by design).
    for row in rows:
        for key in row:
            if key in DB_BOOL_FIELDS and row[key] is not None:
                row[key] = bool(row[key])
    return rows


# Tables carrying any DB_BOOL_FIELDS column; select_all applies coercion based on
# the FROM clause so every read path (fixture checker + validate_db) is covered.
BOOL_TABLES = frozenset(
    {
        "owners",
        "teams",
        "players",
        "player_seasons",
        "draft_picks",
        "keepers",
        "transactions",
    }
)


def select_all(con: sqlite3.Connection, sql: str, params: tuple = ()) -> list[dict]:
    # Pin to insertion (rowid) order: the fixture files are written in
    # pipeline iteration order, and without this the planner may serve rows
    # via a secondary index in some other order.
    if "ORDER BY" not in sql.upper():
        sql += " ORDER BY rowid"
    cur = con.execute(sql, params)
    columns = [d[0] for d in cur.description]
    rows = [dict(zip(columns, row)) for row in cur.fetchall()]
    table_match = re.search(r"\bFROM\s+([a-z_]+)", sql)
    if table_match and table_match.group(1) in BOOL_TABLES:
        return _coerce_bool_fields(rows)
    return rows


def parse_json_fields(rows: list[dict], fields: list[str]) -> list[dict]:
    # SQL NULL already round-trips to Python None; only decode non-null JSON.
    return [
        {**r, **{f: json.loads(r[f]) for f in fields if r.get(f) is not None}}
        for r in rows
    ]


def rebuild_achievements(con: sqlite3.Connection) -> list[dict]:
    return [
        {
            "year": r["year"],
            "member_key": r["member_key"],
            "owner_id": r["owner_id"],
            "espn_team_id": r["espn_team_id"],
            "trophies": json.loads(r["trophies"]),
        }
        for r in select_all(con, "SELECT * FROM achievements")
    ]


def rebuild_teams(con: sqlite3.Connection) -> list[dict]:
    owner_ids_by_team: dict[tuple[int, int], list[str]] = {}
    for r in select_all(con, "SELECT * FROM team_owners"):
        owner_ids_by_team.setdefault((r["year"], r["espn_team_id"]), []).append(
            r["owner_id"]
        )
    out = []
    for r in select_all(con, "SELECT * FROM teams"):
        row = {**r, **{f: json.loads(r[f]) for f in TEAMS_JSON_FIELDS}}
        row["owner_ids"] = owner_ids_by_team[(r["year"], r["espn_team_id"])]
        # Reinsert owner_ids at its original JSON position (2nd field).
        ordered = {
            "year": row.pop("year"),
            "espn_team_id": row.pop("espn_team_id"),
            "owner_ids": row.pop("owner_ids"),
        }
        ordered.update(row)
        out.append(ordered)
    return out


def rebuild_matchups(con: sqlite3.Connection) -> list[dict]:
    sides: dict[tuple[int, int], dict[str, dict]] = {}
    for r in select_all(con, "SELECT * FROM matchup_sides"):
        # Key by (year, matchup_id): ESPN reuses matchup ids every season.
        sides.setdefault((r["year"], r["matchup_id"]), {})[r["side"]] = {
            "owner_id": r["owner_id"],
            "espn_team_id": r["espn_team_id"],
            "score": r["score"],
        }
    out = []
    for m in select_all(con, "SELECT * FROM matchups"):
        s = sides.get((m["year"], m["matchup_id"]), {})
        out.append(
            {
                "year": m["year"],
                "week": m["week"],
                "matchup_id": m["matchup_id"],
                "playoff_tier": m["playoff_tier"],
                "winner": m["winner"],
                "home": s.get("home"),
                "away": s.get("away"),
            }
        )
    return out


def rebuild_player_seasons(con: sqlite3.Connection) -> list[dict]:
    """Mirror the JSON shape exactly: no ownership field (it lives in
    player_season_ownership.json), and fantasy_team_id's key exists only on
    the latest season's rows (the pipeline emits it there even when null,
    and omits it entirely for all prior seasons)."""
    latest_year = con.execute("SELECT MAX(year) FROM seasons").fetchone()[0]
    out = []
    for r in select_all(con, "SELECT * FROM player_seasons"):
        row = {
            **parse_json_fields([r], ["eligible_slots", "games_played_by_position"])[0]
        }
        if r["year"] != latest_year:
            row.pop("fantasy_team_id", None)
        out.append(row)
    return out


def rebuild_box_scores(con: sqlite3.Connection, year: int) -> list[dict]:
    slots_by_line: dict[tuple, list[dict]] = {}
    for s in select_all(con, "SELECT * FROM box_score_slots WHERE year = ?", (year,)):
        key = (s["matchup_id"], s["espn_team_id"], s["player_id"])
        slots_by_line.setdefault(key, []).append(
            {
                "scoring_period": s["scoring_period"],
                "lineup_slot_id": s["lineup_slot_id"],
                "points": s["points"],
                "raw_stats": json.loads(s["raw_stats"]),
            }
        )
    out = []
    for line in select_all(
        con, "SELECT * FROM box_score_lines WHERE year = ?", (year,)
    ):
        batting_vals = [line[f"b_{f}"] for f in BATTING_FIELDS]
        pitching_vals = [line[f"p_{f}"] for f in PITCHING_FIELDS]
        out.append(
            {
                "year": line["year"],
                "week": line["week"],
                "matchup_id": line["matchup_id"],
                "owner_id": line["owner_id"],
                "espn_team_id": line["espn_team_id"],
                "player_id": line["player_id"],
                "player_name": line["player_name"],
                "total_points": line["total_points"],
                "batting": (
                    None
                    if all(v is None for v in batting_vals)
                    else dict(zip(BATTING_FIELDS, batting_vals))
                ),
                "pitching": (
                    None
                    if all(v is None for v in pitching_vals)
                    else dict(zip(PITCHING_FIELDS, pitching_vals))
                ),
                "slots": slots_by_line.get(
                    (line["matchup_id"], line["espn_team_id"], line["player_id"]), []
                ),
            }
        )
    return out


def _rebuild_items(
    con: sqlite3.Connection,
    item_table: str,
    parent_table: str,
    parent_key: str,
    extra_item_fields: list[str],
) -> list[dict]:
    items_by_parent: dict[str, list[dict]] = {}
    for it in select_all(con, f"SELECT * FROM {item_table}"):  # noqa: S608
        item = {
            "player_id": it["player_id"],
            "item_type": it["item_type"],
            "from_espn_team_id": it["from_espn_team_id"],
            "to_espn_team_id": it["to_espn_team_id"],
            "from_lineup_slot_id": it["from_lineup_slot_id"],
            "to_lineup_slot_id": it["to_lineup_slot_id"],
        }
        for field in extra_item_fields:
            item[field] = it[field]
        items_by_parent.setdefault(it[parent_key], []).append(item)
    out = []
    for parent in select_all(con, f"SELECT * FROM {parent_table}"):  # noqa: S608
        out.append({**parent, "items": items_by_parent.get(parent[parent_key], [])})
    return out


def rebuild_transactions(con: sqlite3.Connection) -> list[dict]:
    return _rebuild_items(
        con, "transaction_items", "transactions", "transaction_id", []
    )


def rebuild_trades(con: sqlite3.Connection) -> list[dict]:
    return _rebuild_items(con, "trade_items", "trades", "trade_id", ["source"])


def derive_season_points(con: sqlite3.Connection) -> list[dict]:
    """player_season_points is no longer stored -- it is exactly the
    per-player roll-up of player_team_season_points (data.ts derives it
    client-side the same way), so rebuild synthesizes the collection here to
    keep build_data_from_db's key set identical to validate.py's
    load_processed(). Team rows are already rounded; sums are re-rounded once,
    and validate's tolerances absorb the sub-cent difference vs normalize's
    direct rounding of unrounded sums. Row order matches the pipeline's:
    years ascending, player_id ascending within a year (the team table's
    insertion order groups by exactly that)."""
    totals: dict[tuple[int, int], dict[str, Any]] = {}
    for r in select_all(con, "SELECT * FROM player_team_season_points"):
        key = (r["year"], r["player_id"])
        row = totals.get(key)
        if row is None:
            totals[key] = {
                "year": r["year"],
                "player_id": r["player_id"],
                "player_name": r["player_name"],
                "points": r["points"],
                "counted_points": r["counted_points"],
                "bench_points": r["bench_points"],
            }
        else:
            row["points"] += r["points"]
            row["counted_points"] += r["counted_points"]
            row["bench_points"] += r["bench_points"]
    return [
        {
            **row,
            "points": round(row["points"], 2),
            "counted_points": round(row["counted_points"], 2),
            "bench_points": round(row["bench_points"], 2),
        }
        for row in totals.values()
    ]


def build_data_from_db(con: sqlite3.Connection) -> dict[str, Any]:
    """The same key set as validate.py's load_processed(), sourced from the DB.
    Manual-input keys (retired_owner_ids, jersey_history_overrides,
    pro_team_overrides, owner_map_derived) stay file-backed -- see
    db-migration-scoring-spec.md's rule that data/manual/ remains loader input."""
    box_scores = {}
    years = [r["year"] for r in con.execute("SELECT year FROM seasons ORDER BY year")]
    for year in years:
        box_scores[year] = rebuild_box_scores(con, year)
    return {
        "owners": parse_json_fields(
            select_all(con, "SELECT * FROM owners"), OWNERS_JSON_FIELDS
        ),
        # Same tables, two keys -- mirrors load_processed()'s owners/league_owners
        # duality (check_league_owners compares shipped vs re-derived).
        "league_owners": parse_json_fields(
            select_all(con, "SELECT * FROM owners"), OWNERS_JSON_FIELDS
        ),
        "achievements": rebuild_achievements(con),
        "seasons": parse_json_fields(
            select_all(con, "SELECT * FROM seasons"), SEASONS_JSON_FIELDS
        ),
        "teams": rebuild_teams(con),
        "matchups": rebuild_matchups(con),
        "draft_picks": select_all(con, "SELECT * FROM draft_picks"),
        "keepers": select_all(con, "SELECT * FROM keepers"),
        "players": parse_json_fields(
            select_all(con, "SELECT * FROM players"), PLAYERS_JSON_FIELDS
        ),
        "player_seasons": rebuild_player_seasons(con),
        "player_season_points": derive_season_points(con),
        "player_season_ownership": select_all(
            con, "SELECT * FROM player_season_ownership"
        ),
        "player_team_season_points": select_all(
            con, "SELECT * FROM player_team_season_points"
        ),
        "player_season_backfill": parse_json_fields(
            select_all(con, "SELECT * FROM player_season_backfill"),
            ["batting", "pitching", "eligible_slots"],
        ),
        "transactions": rebuild_transactions(con),
        "trades": rebuild_trades(con),
        "box_scores": box_scores,
    }
