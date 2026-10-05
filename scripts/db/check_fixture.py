#!/usr/bin/env python3
"""Golden-fixture parity check: SQLite database vs data/processed/ JSON.

Usage:
    python scripts/db/check_fixture.py [--db PATH]

Reconstructs every processed collection from the DB (scripts/db/rebuild.py,
the reverse of load.py's row mapping) and asserts exact equality against the
JSON files -- same rows, same order, same values. Floats survive identically
on both sides (IEEE 754 doubles end to end), so comparison is plain ==.

This is db-migration-scoring-spec.md's central acceptance criterion: the DB
loader drives build_archive() -- the pipeline's one counting pass -- so any
mismatch means the row mapping (load.py/schema.sql/rebuild.py) lost something,
and any future drift between writers fails loudly here.
"""

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from rebuild import build_data_from_db, select_all  # noqa: E402

REPO_ROOT = SCRIPTS_DIR.parent
PROCESSED_DIR = REPO_ROOT / "data" / "processed"
MANUAL_DIR = REPO_ROOT / "data" / "manual"
DEFAULT_DB = REPO_ROOT / "data" / "wsob.db"


def find_type_mismatch(expected: Any, actual: Any, path: str) -> str | None:
    """First path where expected and actual differ in *type*, not just value.

    Python's `True == 1` (and `1 == 1.0`) makes plain `==` blind to
    bool-coercion drift between load.py and rebuild.py -- exactly the class of
    bug vitest's Object.is-based toEqual DOES catch. This walker closes that
    gap: bool must match bool, and numeric types must match numerics exactly.
    """
    if isinstance(expected, bool) != isinstance(actual, bool):
        return f"{path}: bool/type drift {expected!r} ({type(expected).__name__}) vs {actual!r} ({type(actual).__name__})"
    if isinstance(expected, (int, float)) != isinstance(actual, (int, float)):
        return f"{path}: numeric/other type drift {expected!r} vs {actual!r}"
    if isinstance(expected, bool):
        return None  # both bools, equality already established by caller gate
    if isinstance(expected, dict) and isinstance(actual, dict):
        for key in expected:
            mismatch = find_type_mismatch(expected[key], actual[key], f"{path}.{key}")
            if mismatch:
                return mismatch
        return None
    if isinstance(expected, list) and isinstance(actual, list):
        for i, (exp_item, act_item) in enumerate(zip(expected, actual)):
            mismatch = find_type_mismatch(exp_item, act_item, f"{path}[{i}]")
            if mismatch:
                return mismatch
        return None
    return None


def check(name: str, expected: list | dict, actual: list | dict) -> str:
    if expected == actual:
        # Value-equal is not type-equal (True == 1): enforce matching types on
        # top, so load/rebuild boolean handling can't silently drift.
        if isinstance(expected, list) and isinstance(actual, list):
            for i, (exp_row, act_row) in enumerate(zip(expected, actual)):
                mismatch = find_type_mismatch(exp_row, act_row, f"{name}[{i}]")
                if mismatch:
                    return f"FAIL {name}: type drift at row {i}\n  {mismatch}"
        return f"PASS {name} ({len(actual)} rows)"
    # Locate the first difference for diagnosis before failing.
    if isinstance(expected, list) and isinstance(actual, list):
        if len(expected) != len(actual):
            return f"FAIL {name}: row count {len(actual)} != {len(expected)}"
        for i, (exp_row, act_row) in enumerate(zip(expected, actual)):
            if exp_row != act_row:
                return (
                    f"FAIL {name}: first mismatch at row {i}\n"
                    f"  json: {json.dumps(exp_row)[:400]}\n"
                    f"   db:  {json.dumps(act_row)[:400]}"
                )
    return f"FAIL {name}: content differs"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    args = parser.parse_args()

    con = sqlite3.connect(args.db)
    con.row_factory = sqlite3.Row

    def load_json(name: str) -> Any:
        return json.loads((PROCESSED_DIR / name).read_text())

    db_data = build_data_from_db(con)

    # Manual-input tables (load.py syncs data/manual/ directly; rowid
    # preserves file order). Served unwrapped, mirroring data.ts. The files
    # omit optional keys where the tables carry NULL -- fill from each
    # table's actual columns so comparison matches load.py's .get() mapping.
    def manual_rows(table: str, filename: str) -> tuple[list[str], list[dict]]:
        cols = [d[1] for d in con.execute(f"PRAGMA table_info({table})")]
        overrides = json.loads((MANUAL_DIR / filename).read_text())["overrides"]
        return cols, [{col: row.get(col) for col in cols} for row in overrides]

    jersey_cols, jersey_expected = manual_rows(
        "jersey_history_overrides", "jersey-history-overrides.json"
    )
    position_cols, position_expected = manual_rows(
        "position_overrides", "position-overrides.json"
    )

    results = [
        check(
            "mlb_teams.json",
            load_json("mlb_teams.json"),
            select_all(con, "SELECT * FROM mlb_teams"),
        ),
        check("seasons.json", load_json("seasons.json"), db_data["seasons"]),
        check("owners.json", load_json("owners.json"), db_data["owners"]),
        check(
            "achievements.json",
            load_json("achievements.json"),
            db_data["achievements"],
        ),
        check("teams.json", load_json("teams.json"), db_data["teams"]),
        check("matchups.json", load_json("matchups.json"), db_data["matchups"]),
        check("players.json", load_json("players.json"), db_data["players"]),
        check(
            "player_seasons.json",
            load_json("player_seasons.json"),
            db_data["player_seasons"],
        ),
        # player_season_points.json is NOT compared: the DB no longer stores
        # that roll-up (rebuild.py derives it from player_team_season_points
        # for validate_db only), and nothing serves it. The JSON file remains
        # a pipeline artifact pinned by scripts/validate.py.
        check(
            "player_team_season_points.json",
            load_json("player_team_season_points.json"),
            db_data["player_team_season_points"],
        ),
        check(
            "player_season_backfill.json",
            load_json("player_season_backfill.json"),
            db_data["player_season_backfill"],
        ),
        check(
            "player_season_ownership.json",
            load_json("player_season_ownership.json"),
            db_data["player_season_ownership"],
        ),
        check(
            "draft_picks.json", load_json("draft_picks.json"), db_data["draft_picks"]
        ),
        check("keepers.json", load_json("keepers.json"), db_data["keepers"]),
        check(
            "transactions.json", load_json("transactions.json"), db_data["transactions"]
        ),
        check("trades.json", load_json("trades.json"), db_data["trades"]),
        check(
            "jersey-history-overrides.json",
            jersey_expected,
            select_all(con, "SELECT * FROM jersey_history_overrides"),
        ),
        check(
            "position-overrides.json",
            position_expected,
            select_all(con, "SELECT * FROM position_overrides"),
        ),
    ]

    for year, lines in db_data["box_scores"].items():
        expected = json.loads(
            (PROCESSED_DIR / "box_scores" / f"{year}.json").read_text()
        )
        results.append(check(f"box_scores/{year}.json", expected, lines))

    con.close()

    failures = [r for r in results if r.startswith("FAIL")]
    for r in results:
        print(r)
    print(f"\n{len(results) - len(failures)} passed, {len(failures)} failed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
