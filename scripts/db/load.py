#!/usr/bin/env python3
"""Load the normalized archive into SQLite (db-migration-scoring-spec step 2).

Usage:
    python scripts/db/load.py [--db PATH] [--schema PATH]

Runs normalize.build_archive() -- the exact same single pass behind
scripts/normalize.py's JSON output -- and inserts every collection into a
fresh SQLite database built from schema.sql. No counting math lives here:
this file only maps JSON row shapes onto tables. Any discrepancy between
the two writers' outputs is therefore a bug in one place, caught by the
golden-fixture acceptance tests.

The database replaces data/processed/ as the app's source ("full replacement"
decision). It is a generated artifact: never hand-edit it; fix inputs under
data/raw/ + data/manual/, re-run this script.
"""

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from normalize import MANUAL_DIR, build_archive  # noqa: E402
from lib.stat_ids import BATTING_STAT_IDS, PITCHING_STAT_IDS  # noqa: E402

REPO_ROOT = SCRIPTS_DIR.parent
DEFAULT_DB = REPO_ROOT / "data" / "wsob.db"
DEFAULT_SCHEMA = Path(__file__).resolve().parent / "schema.sql"

# Column names follow schema.sql's b_/p_ prefixes, in stat_ids.py order.
BATTING_COLUMNS = [f"b_{name}" for name in BATTING_STAT_IDS.values()]
PITCHING_COLUMNS = [f"p_{name}" for name in PITCHING_STAT_IDS.values()]


def _j(value: Any) -> str:
    return json.dumps(value)


def insert_rows(
    con: sqlite3.Connection, table: str, columns: list[str], rows: list[tuple]
) -> None:
    if not rows:
        return
    placeholders = ", ".join("?" for _ in columns)
    quoted = ", ".join(f'"{c}"' for c in columns)
    con.executemany(f"INSERT INTO {table} ({quoted}) VALUES ({placeholders})", rows)


def load_seasons(con: sqlite3.Connection, seasons: list[dict[str, Any]]) -> None:
    json_fields = [
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
    rows = []
    for s in seasons:
        rows.append(tuple(_j(s[f]) if f in json_fields else s[f] for f in s))
    insert_rows(con, "seasons", list(seasons[0].keys()), rows)


def load_owners(con: sqlite3.Connection, archive: dict[str, Any]) -> None:
    json_fields = ["team_names_by_year", "espn_member_keys", "co_owners"]
    owners = archive["owners"]
    rows = [tuple(_j(o[f]) if f in json_fields else o[f] for f in o) for o in owners]
    insert_rows(con, "owners", list(owners[0].keys()), rows)

    retired = json.loads((MANUAL_DIR / "retired-owners.json").read_text())
    insert_rows(
        con,
        "retired_owners",
        ["owner_id"],
        [(oid,) for oid in retired["retired_owner_ids"]],
    )


def load_achievements(con: sqlite3.Connection, archive: dict[str, Any]) -> None:
    achievements = archive["achievements"]
    insert_rows(
        con,
        "achievements",
        ["year", "member_key", "owner_id", "espn_team_id", "trophies"],
        [
            (
                r["year"],
                r["member_key"],
                r["owner_id"],
                r["espn_team_id"],
                _j(r["trophies"]),
            )
            for r in achievements
        ],
    )


def load_manual_overrides(con: sqlite3.Connection) -> None:
    """The two remaining hand-maintained data/manual/ files the app reads
    (retired-owners.json is handled in load_owners). Column order mirrors
    schema.sql; rowid preserves file order for byte-parity serving."""
    jersey = json.loads((MANUAL_DIR / "jersey-history-overrides.json").read_text())
    insert_rows(
        con,
        "jersey_history_overrides",
        [
            "player_id",
            "player_name",
            "pro_team_id",
            "jersey",
            "start_year",
            "end_year",
            "start_date",
            "end_date",
            "source",
        ],
        [
            (
                o["player_id"],
                o["player_name"],
                o["pro_team_id"],
                o["jersey"],
                o["start_year"],
                o["end_year"],
                o.get("start_date"),
                o.get("end_date"),
                o.get("source"),
            )
            for o in jersey["overrides"]
        ],
    )

    positions = json.loads((MANUAL_DIR / "position-overrides.json").read_text())
    insert_rows(
        con,
        "position_overrides",
        [
            "player_id",
            "player_name",
            "year",
            "position_id",
            "espn_default_position_id",
            "source",
            "note",
        ],
        [
            (
                o["player_id"],
                o["player_name"],
                o["year"],
                o["position_id"],
                o.get("espn_default_position_id"),
                o.get("source"),
                o.get("note"),
            )
            for o in positions["overrides"]
        ],
    )


def load_teams(con: sqlite3.Connection, teams: list[dict[str, Any]]) -> None:
    json_fields = [
        "overall",
        "home",
        "away",
        "division_record",
        "value_by_stat",
        "transactions",
    ]
    team_rows = []
    owner_rows = []
    for t in teams:
        # owner_ids becomes the team_owners child table, not a column.
        team_rows.append(
            tuple(_j(t[f]) if f in json_fields else t[f] for f in t if f != "owner_ids")
        )
        for position, owner_id in enumerate(t["owner_ids"]):
            owner_rows.append((t["year"], t["espn_team_id"], owner_id, position))
    insert_rows(
        con,
        "teams",
        [f for f in teams[0].keys() if f != "owner_ids"],
        team_rows,
    )
    insert_rows(
        con,
        "team_owners",
        ["year", "espn_team_id", "owner_id", "position"],
        owner_rows,
    )


def load_matchups(con: sqlite3.Connection, matchups: list[dict[str, Any]]) -> None:
    matchup_rows = []
    side_rows = []
    for m in matchups:
        matchup_rows.append(
            (m["year"], m["week"], m["matchup_id"], m["playoff_tier"], m["winner"])
        )
        for side in ("home", "away"):
            payload = m[side]
            if payload is None:
                continue
            side_rows.append(
                (
                    m["year"],
                    m["matchup_id"],
                    side,
                    payload["espn_team_id"],
                    payload["owner_id"],
                    payload["score"],
                )
            )
    insert_rows(
        con,
        "matchups",
        ["year", "week", "matchup_id", "playoff_tier", "winner"],
        matchup_rows,
    )
    insert_rows(
        con,
        "matchup_sides",
        ["year", "matchup_id", "side", "espn_team_id", "owner_id", "score"],
        side_rows,
    )


def _stat_columns(
    line: dict[str, Any],
    side_key: str,
    stat_field_names: list[str],
    column_names: list[str],
) -> list[Any]:
    """NULL when the line has no activity on that side of the ball (the JSON's
    null batting/pitching object), else one value per mapped stat field."""
    values = line.get(side_key)
    if values is None:
        return [None] * len(column_names)
    return [values.get(name, 0) for name in stat_field_names]


def make_box_score_row(line: dict[str, Any]) -> tuple:
    base = [
        line["year"],
        line["week"],
        line["matchup_id"],
        line["espn_team_id"],
        line["owner_id"],
        line["player_id"],
        line["player_name"],
        line["total_points"],
    ]
    return (
        tuple(base)
        + tuple(
            _stat_columns(
                line, "batting", list(BATTING_STAT_IDS.values()), BATTING_COLUMNS
            )
        )
        + tuple(
            _stat_columns(
                line, "pitching", list(PITCHING_STAT_IDS.values()), PITCHING_COLUMNS
            )
        )
    )


def load_box_scores(
    con: sqlite3.Connection, year: int, lines: list[dict[str, Any]]
) -> None:
    con.executemany(
        "INSERT INTO box_score_lines (year, week, matchup_id, espn_team_id,"
        " owner_id, player_id, player_name, total_points,"
        + ", ".join(BATTING_COLUMNS + PITCHING_COLUMNS)
        + ") VALUES ("
        + ", ".join("?" * (8 + len(BATTING_COLUMNS) + len(PITCHING_COLUMNS)))
        + ")",
        [make_box_score_row(line) for line in lines],
    )
    slot_rows = []
    for line in lines:
        for slot in line.get("slots", []):
            slot_rows.append(
                (
                    line["year"],
                    line["matchup_id"],
                    line["espn_team_id"],
                    line["player_id"],
                    slot["scoring_period"],
                    slot["lineup_slot_id"],
                    slot["points"],
                    _j(slot.get("raw_stats") or {}),
                )
            )
    insert_rows(
        con,
        "box_score_slots",
        [
            "year",
            "matchup_id",
            "espn_team_id",
            "player_id",
            "scoring_period",
            "lineup_slot_id",
            "points",
            "raw_stats",
        ],
        slot_rows,
    )


def load_players(con: sqlite3.Connection, archive: dict[str, Any]) -> None:
    json_fields = ["eligible_slots", "games_played_by_position", "seasons_seen"]
    players = archive["players"]
    rows = [tuple(_j(p[f]) if f in json_fields else p[f] for f in p) for p in players]
    insert_rows(con, "players", list(players[0].keys()), rows)

    season_json_fields = ["eligible_slots", "games_played_by_position"]
    ps = archive["player_seasons"]
    # The processed shape carries no ownership field (cross-league ownership
    # lives in player_season_ownership.json) and omits fantasy_team_id when
    # null -- so bind via .get() against an explicit column list rather than
    # the row's own keys.
    ps_columns = [
        "year",
        "player_id",
        "player_name",
        "eligible_slots",
        "games_played_by_position",
        "default_position_id",
        "jersey",
        "injury_status",
        "injured",
        "pro_team_id",
        "fantasy_team_id",
    ]
    ps_rows = [
        tuple(
            _j(row.get(f)) if f in season_json_fields else row.get(f)
            for f in ps_columns
        )
        for row in ps
    ]
    insert_rows(con, "player_seasons", ps_columns, ps_rows)


def load_rollups(con: sqlite3.Connection, archive: dict[str, Any]) -> None:
    # player_season_points is deliberately NOT stored: it is exactly the
    # per-player roll-up of player_team_season_points (rebuild.py derives it
    # for validate_db, data.ts derives it client-side), so storing it too was
    # a second copy of one number. The processed JSON file remains the
    # pipeline's internal artifact and stays pinned by validate.py.
    ptsp = archive["player_team_season_points"]
    insert_rows(
        con,
        "player_team_season_points",
        [
            "year",
            "player_id",
            "owner_id",
            "espn_team_id",
            "player_name",
            "points",
            "counted_points",
            "bench_points",
        ],
        [
            (
                r["year"],
                r["player_id"],
                r["owner_id"],
                r["espn_team_id"],
                r["player_name"],
                r["points"],
                r["counted_points"],
                r["bench_points"],
            )
            for r in ptsp
        ],
    )
    backfill = archive["player_season_backfill"]
    insert_rows(
        con,
        "player_season_backfill",
        [
            "year",
            "player_id",
            "player_name",
            "points",
            "batting",
            "pitching",
            "eligible_slots",
            "default_position_id",
            "source",
        ],
        [
            (
                r["year"],
                r["player_id"],
                r["player_name"],
                r["points"],
                _j(r["batting"]) if r["batting"] is not None else None,
                _j(r["pitching"]) if r["pitching"] is not None else None,
                _j(r["eligible_slots"]),
                r["default_position_id"],
                r["source"],
            )
            for r in backfill
        ],
    )
    ownership = archive["player_season_ownership"]
    ownership_fields = [
        "percent_owned",
        "percent_started",
        "percent_change",
        "average_draft_position",
        "average_draft_position_percent_change",
        "auction_value_average",
        "auction_value_average_change",
    ]
    insert_rows(
        con,
        "player_season_ownership",
        ["year", "player_id", "player_name"] + ownership_fields,
        [
            (r["year"], r["player_id"], r["player_name"])
            + tuple(r[f] for f in ownership_fields)
            for r in ownership
        ],
    )


def load_draft_and_keepers(con: sqlite3.Connection, archive: dict[str, Any]) -> None:
    picks = archive["draft_picks"]
    pick_fields = list(picks[0].keys()) if picks else []
    insert_rows(
        con,
        "draft_picks",
        pick_fields,
        [
            tuple(
                int(p[f]) if f in ("keeper", "traded_pick") else p[f]
                for f in pick_fields
            )
            for p in picks
        ],
    )
    keepers = archive["keepers"]
    keeper_fields = list(keepers[0].keys()) if keepers else []
    insert_rows(
        con,
        "keepers",
        keeper_fields,
        [
            tuple(
                int(k[f]) if f == "validated_on_prior_roster" else k[f]
                for f in keeper_fields
            )
            for k in keepers
        ],
    )


def _item_rows(year: int, parent_id: str, items: list[dict[str, Any]]) -> list[tuple]:
    return [
        (
            year,
            parent_id,
            index,
            item["player_id"],
            item["item_type"],
            item.get("from_espn_team_id"),
            item.get("to_espn_team_id"),
            item.get("from_lineup_slot_id"),
            item.get("to_lineup_slot_id"),
        )
        for index, item in enumerate(items)
    ]


def load_transactions_and_trades(
    con: sqlite3.Connection, archive: dict[str, Any]
) -> None:
    tx_fields = [
        "year",
        "transaction_id",
        "transaction_type",
        "scoring_period_id",
        "week",
        "proposed_date",
        "espn_team_id",
        "owner_id",
        "acting_member_key",
        "status",
        "is_league_manager",
        "related_transaction_id",
        "bid_amount",
    ]
    txs = archive["transactions"]
    item_rows = []
    tx_rows = []
    for t in txs:
        tx_rows.append(
            tuple(int(t[f]) if f == "is_league_manager" else t[f] for f in tx_fields)
        )
        item_rows.extend(_item_rows(t["year"], t["transaction_id"], t["items"]))
    insert_rows(con, "transactions", tx_fields, tx_rows)
    insert_rows(
        con,
        "transaction_items",
        [
            "year",
            "transaction_id",
            "item_index",
            "player_id",
            "item_type",
            "from_espn_team_id",
            "to_espn_team_id",
            "from_lineup_slot_id",
            "to_lineup_slot_id",
        ],
        item_rows,
    )

    trades = archive["trades"]
    trade_rows = []
    trade_item_rows = []
    for tr in trades:
        trade_rows.append(
            (
                tr["year"],
                tr["trade_id"],
                tr["proposed_date"],
                tr["executed_date"],
                tr["team_a_espn_team_id"],
                tr["team_a_owner_id"],
                tr["team_b_espn_team_id"],
                tr["team_b_owner_id"],
                tr["acting_member_key"],
            )
        )
        for index, item in enumerate(tr["items"]):
            trade_item_rows.append(
                (
                    tr["year"],
                    tr["trade_id"],
                    index,
                    item["player_id"],
                    item["item_type"],
                    item.get("from_espn_team_id"),
                    item.get("to_espn_team_id"),
                    item.get("from_lineup_slot_id"),
                    item.get("to_lineup_slot_id"),
                    item["source"],
                )
            )
    insert_rows(
        con,
        "trades",
        [
            "year",
            "trade_id",
            "proposed_date",
            "executed_date",
            "team_a_espn_team_id",
            "team_a_owner_id",
            "team_b_espn_team_id",
            "team_b_owner_id",
            "acting_member_key",
        ],
        trade_rows,
    )
    insert_rows(
        con,
        "trade_items",
        [
            "year",
            "trade_id",
            "item_index",
            "player_id",
            "item_type",
            "from_espn_team_id",
            "to_espn_team_id",
            "from_lineup_slot_id",
            "to_lineup_slot_id",
            "source",
        ],
        trade_item_rows,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA)
    args = parser.parse_args()

    if args.db.exists():
        args.db.unlink()  # generated artifact: rebuild fresh every run

    con = sqlite3.connect(args.db)
    try:
        con.executescript(args.schema.read_text())
        # Box scores stream per year via build_archive's callback, but
        # owners.json is derived only after the whole year loop -- so owner_id
        # FK targets don't exist yet when line inserts run. Defer every FK
        # check to COMMIT (the pragma resets at each commit, hence after
        # schema creation); nothing commits until all inserts succeed, so
        # integrity is fully enforced.
        con.execute("PRAGMA defer_foreign_keys = ON")

        def on_box_scores(year: int, lines: list[dict[str, Any]]) -> None:
            load_box_scores(con, year, lines)

        archive = build_archive(on_box_scores=on_box_scores)

        mlb = archive["mlb_teams"]
        insert_rows(
            con,
            "mlb_teams",
            ["pro_team_id", "abbrev", "name"],
            [(m["pro_team_id"], m["abbrev"], m["name"]) for m in mlb],
        )
        load_seasons(con, archive["seasons"])
        load_owners(con, archive)
        load_achievements(con, archive)
        load_manual_overrides(con)
        load_teams(con, archive["teams"])
        load_matchups(con, archive["matchups"])
        load_players(con, archive)
        load_rollups(con, archive)
        load_draft_and_keepers(con, archive)
        load_transactions_and_trades(con, archive)

        # Fail before committing: a run with mapping errors must not leave a
        # complete-looking database behind (mirrors how a failed normalize
        # shouldn't present partial output as usable).
        if archive["errors"]:
            con.rollback()
            print("\nErrors:")
            for e in archive["errors"]:
                print(f"  {e}")
            sys.exit(1)

        con.commit()

        counts = {
            table: con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for (table,) in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )
        }
        width = max(len(name) for name in counts)
        for name, count in counts.items():
            print(f"  {name:<{width}}  {count:>8}")
        print(f"\nLoaded {args.db}")

    finally:
        con.close()


if __name__ == "__main__":
    main()
