#!/usr/bin/env python3
"""Run validate.py's reconciliation suite against the SQLite database.

Usage:
    python scripts/db/validate_db.py [--db PATH]

Imports validate.CHECKS unchanged and feeds them collections rebuilt from the
DB (scripts/db/rebuild.py) instead of data/processed/ JSON. This is the
db-migration-scoring-spec.md step-5 gate: the pipeline's invariants must hold
against storage no matter which writer produced it. Manual inputs
(season-notes, owner-map, jersey/pro-team overrides, retired owners) remain
file-backed -- they stay loader inputs after the cutover.

Output format and exit code mirror validate.py's main() exactly.
"""

import argparse
import json
import sqlite3
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from rebuild import build_data_from_db  # noqa: E402
from validate import (  # noqa: E402
    CHECKS,
    MANUAL_DIR,
    NEEDS_SEASON_NOTES,
    check_owner_mapping,
    derive_owners_from_owner_map,
    load_owner_map,
)

REPO_ROOT = SCRIPTS_DIR.parent
DEFAULT_DB = REPO_ROOT / "data" / "wsob.db"
PROCESSED_DIR = REPO_ROOT / "data" / "processed"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    args = parser.parse_args()

    con = sqlite3.connect(args.db)
    con.row_factory = sqlite3.Row
    try:
        data = build_data_from_db(con)
    finally:
        con.close()

    season_notes = json.loads((MANUAL_DIR / "season-notes.json").read_text())
    owner_map = load_owner_map(MANUAL_DIR / "owner-map.json")
    data["owner_map_derived"] = derive_owners_from_owner_map(owner_map)
    data["retired_owner_ids"] = json.loads(
        (MANUAL_DIR / "retired-owners.json").read_text()
    )["retired_owner_ids"]
    data["jersey_history_overrides"] = json.loads(
        (MANUAL_DIR / "jersey-history-overrides.json").read_text()
    )["overrides"]
    data["pro_team_overrides"] = json.loads(
        (MANUAL_DIR / "pro-team-overrides.json").read_text()
    )["overrides"]
    # card_points.json is not a DB table — it's a processed file derived from
    # box scores. Load it from disk so validate.py's check_card_points can run.
    data["card_points"] = json.loads((PROCESSED_DIR / "card_points.json").read_text())

    all_failures = []
    for name, check in CHECKS:
        if name in NEEDS_SEASON_NOTES:
            all_failures.extend(check(data, season_notes))
        else:
            all_failures.extend(check(data))
    all_failures.extend(check_owner_mapping(owner_map))

    by_check: dict[str, list] = {}
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
