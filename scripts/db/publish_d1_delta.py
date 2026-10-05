#!/usr/bin/env python3
"""Generate a scoped D1 delta from sync_live_scoreboard.py's patched files.

Usage:
    python scripts/db/publish_d1_delta.py --in-dir live-scoreboard-out \
        --year 2026 [--out d1-delta.sql]

The lightweight refresh runs patch six JSON files (matchups, seasons, teams,
box_scores/{year}, player_season_points, player_team_season_points). This
script carries the same patch into D1 so /api/data/* stays fresh between the
daily heavy rebuilds:

    python3 scripts/db/publish_d1_delta.py --in-dir ... --year ...
    npx wrangler d1 execute wsob-record-book --remote --file=... -y

It also stages the three accumulation files verbatim into live_sync_state
(keyed by relative path) -- sync_live_scoreboard.py's scratch state for the
next run, read back by scripts/db/pull_live_state.py. Since Phase C removed
the R2 JSON copies, D1 is the only home this intraday state has.

Write strategy per patched file present under --in-dir:

- PARENT tables (seasons, teams, matchups) are UPSERTED
  (INSERT ... ON CONFLICT DO UPDATE), never DELETEd. Deleting a parent while
  untouched child tables still reference it trips D1's immediate FK
  enforcement mid-file -- the deferred-FK pragma does not survive wrangler's
  statement batching (learned the hard way: run 32677498831 rolled back).
  Upserts leave parents permanently valid; key sets are stable across runs.
- CHILD tables (team_owners, matchup_sides) are DELETEd + re-inserted from
  their parent's file. Nothing references them, so clearing is safe. Their
  parent files are complete copies, so a full child replace matches exactly.
- Box scores are scoped to --year: slots then lines for that year only.
- The two season rollups are full DELETE + INSERT (nothing references them).
- live_sync_state rows are DELETEd + re-inserted per patched accumulation
  file, zlib-compressed, base64'd, and split into <=48 KB chunks (D1 rejects
  SQL statements over 100 KB and the raw documents run to multiple MB).

Files NOT present under --in-dir are skipped entirely -- their D1 rows keep
the values an earlier run published, so a light run that didn't patch a
collection can never regress it with a stale git-committed copy.

Correctness rules inherited from the heavy pipeline: no math here, just row
mapping onto load.py's loaders; values are read back out of a temp SQLite
and emitted via dump_d1.quote(), so escaping and typing match the full dump
exactly.

Writes nothing when --in-dir contains none of the supported files (the
caller decides whether that is worth a wrangler round-trip).
"""

import argparse
import base64
import json
import sqlite3
import sys
import time
import zlib
from pathlib import Path
from typing import Any

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))

from dump_d1 import quote  # noqa: E402
from load import (  # noqa: E402
    DEFAULT_SCHEMA,
    load_box_scores,
    load_matchups,
    load_seasons,
    load_teams,
)

# The accumulation files sync_live_scoreboard.py patches across the day's
# runs. They land in live_sync_state (keyed by relative path) so the next run
# can resume from D1 -- the only home this scratch state has since R2's JSON
# copies went away.
STATE_FILES = (
    "player_season_points.json",
    "player_team_season_points.json",
)

# live_sync_state chunking. Raw JSON is zlib-compressed (~75-80% smaller),
# base64'd (+33%), then split so each emitted INSERT stays far below D1's
# hard 100 KB statement limit; the guard below fails generation-time instead.
CHUNK_RAW_BYTES = 48 * 1024
MAX_STATEMENT_BYTES = 90 * 1024

# Rollup tables a delta rewrites. player_season_points is NOT among them:
# that roll-up is no longer stored (it derives from
# player_team_season_points), but its patched JSON is still staged verbatim
# into live_sync_state below -- sync_live_scoreboard.py's accumulation state.
ROLLUP_COLUMNS = {
    "player_team_season_points": [
        "year",
        "player_id",
        "owner_id",
        "espn_team_id",
        "player_name",
        "points",
        "counted_points",
        "bench_points",
    ],
}

# Parent table -> its PRIMARY KEY columns (schema.sql). Non-key columns are
# updated from excluded.* on conflict.
PARENT_KEYS = {
    "seasons": ["year"],
    "teams": ["year", "espn_team_id"],
    "matchups": ["year", "matchup_id"],
}


def _emit_inserts(
    con: sqlite3.Connection, parts: list[str], table: str, where: str = ""
) -> None:
    columns = [row[1] for row in con.execute(f"PRAGMA table_info({table})")]
    rows = con.execute(f"SELECT * FROM {table} {where}").fetchall()
    if not rows:
        return
    col_list = ", ".join(columns)
    parts.append(f"-- {table} ({len(rows)} rows)")
    insert = f"INSERT INTO {table} ({col_list}) VALUES ({{}});"
    batch: list[str] = []
    for row in rows:
        batch.append(insert.format(", ".join(quote(v) for v in tuple(row))))
        if len(batch) >= 500:
            parts.extend(batch)
            batch.clear()
    parts.extend(batch)
    parts.append("")


def _emit_upsert(con: sqlite3.Connection, parts: list[str], table: str) -> None:
    """INSERT ... ON CONFLICT(pk) DO UPDATE over every row staged in `con`.

    Never deletes: referencing children stay valid at every statement
    boundary, which immediate FK enforcement requires.
    """
    columns = [row[1] for row in con.execute(f"PRAGMA table_info({table})")]
    keys = PARENT_KEYS[table]
    updates = ", ".join(f"{c} = excluded.{c}" for c in columns if c not in keys)
    rows = con.execute(f"SELECT * FROM {table}").fetchall()
    if not rows:
        return
    parts.append(f"-- {table} upsert ({len(rows)} rows)")
    insert = (
        f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({{}}) "
        f"ON CONFLICT ({', '.join(keys)}) DO UPDATE SET {updates};"
    )
    batch: list[str] = []
    for row in rows:
        batch.append(insert.format(", ".join(quote(v) for v in tuple(row))))
        if len(batch) >= 500:
            parts.extend(batch)
            batch.clear()
    parts.extend(batch)
    parts.append("")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--in-dir", type=Path, required=True)
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--out", type=Path, default=Path("d1-delta.sql"))
    args = parser.parse_args()

    def patched(name: str) -> Any | None:
        path = args.in_dir / name
        if not path.exists():
            return None
        return json.loads(path.read_text())

    seasons = patched("seasons.json")
    teams = patched("teams.json")
    matchups = patched("matchups.json")
    box_lines = patched(f"box_scores/{args.year}.json")
    psp = patched("player_season_points.json")
    ptsp = patched("player_team_season_points.json")
    # Parsed exactly once each; every later stage reuses these.
    rollups = {"player_team_season_points": ptsp}

    included: list[str] = [
        name
        for name, data in (
            ("seasons.json", seasons),
            ("teams.json", teams),
            ("matchups.json", matchups),
            (f"box_scores/{args.year}.json", box_lines),
            ("player_season_points.json", psp),
            ("player_team_season_points.json", ptsp),
        )
        if data is not None
    ]
    if not included:
        print("No patched files found -- nothing to publish.")
        sys.exit(0)

    # Temp DB holds ONLY the patched collections; FK enforcement stays off
    # because parents like owners/players aren't loaded. Rows are read back
    # purely to be re-quoted into SQL.
    con = sqlite3.connect(":memory:")
    try:
        con.executescript(DEFAULT_SCHEMA.read_text())
        con.execute("PRAGMA foreign_keys = OFF")

        if seasons is not None:
            load_seasons(con, seasons)
        if teams is not None:
            load_teams(con, teams)
        if matchups is not None:
            load_matchups(con, matchups)
        if box_lines is not None:
            load_box_scores(con, args.year, box_lines)
        # player_season_points.json has no table to land in (see
        # ROLLUP_COLUMNS) -- it only rides along as live_sync_state below.
        for name, columns in ROLLUP_COLUMNS.items():
            data = rollups[name]
            if data is None:
                continue
            placeholders = ", ".join("?" for _ in columns)
            con.executemany(
                f"INSERT INTO {name} ({', '.join(columns)}) VALUES ({placeholders})",
                [tuple(row[f] for f in columns) for row in data],
            )

        parts = [
            "-- Generated by scripts/db/publish_d1_delta.py -- do not edit.",
            f"-- Patched files: {', '.join(included)}",
            "",
        ]
        # Child clears first (nothing references them, so this is safe under
        # immediate FKs); parents are upserted, never deleted.
        if teams is not None:
            parts.append("DELETE FROM team_owners;")
        if matchups is not None:
            parts.append("DELETE FROM matchup_sides;")
        if box_lines is not None:
            parts.append(f"DELETE FROM box_score_slots WHERE year = {args.year};")
            parts.append(f"DELETE FROM box_score_lines WHERE year = {args.year};")
        for name in ROLLUP_COLUMNS:
            if rollups[name] is not None:
                parts.append(f"DELETE FROM {name};")
        parts.append("")
        # Parents before children on insert.
        if seasons is not None:
            _emit_upsert(con, parts, "seasons")
        if teams is not None:
            _emit_upsert(con, parts, "teams")
            _emit_inserts(con, parts, "team_owners")
        if matchups is not None:
            _emit_upsert(con, parts, "matchups")
            _emit_inserts(con, parts, "matchup_sides")
        if box_lines is not None:
            _emit_inserts(con, parts, "box_score_lines", f"WHERE year = {args.year}")
            _emit_inserts(con, parts, "box_score_slots", f"WHERE year = {args.year}")
        # Rollup rows come from the already-parsed JSON (see `rollups`).
        for name in ROLLUP_COLUMNS:
            if rollups[name] is not None:
                _emit_inserts(con, parts, name)

        # Scratch-state blobs for the next run's read-back (see STATE_FILES).
        # zlib + base64 + chunking keeps every statement under D1's 100 KB
        # cap; the DELETE-first clears any stale chunks an earlier, larger
        # version of the same key left behind (upserts can't shrink a key).
        now_ms = int(time.time() * 1000)
        state_rows: list[tuple[str, int, str]] = []

        def stage_state(key: str, text: str) -> None:
            encoded = base64.b64encode(zlib.compress(text.encode("utf-8")))
            for idx in range(0, len(encoded), CHUNK_RAW_BYTES):
                state_rows.append(
                    (
                        key,
                        idx // CHUNK_RAW_BYTES,
                        encoded[idx : idx + CHUNK_RAW_BYTES].decode("ascii"),
                    )
                )

        if box_lines is not None:
            stage_state(
                f"box_scores/{args.year}.json",
                (args.in_dir / f"box_scores/{args.year}.json").read_text(),
            )
        for name in STATE_FILES:
            if patched(name) is not None:
                stage_state(name, (args.in_dir / name).read_text())
        if state_rows:
            keys = sorted({key for key, _, _ in state_rows})
            parts.append(
                f"-- live_sync_state replace ({len(keys)} keys, {len(state_rows)} chunks)"
            )
            for key in keys:
                parts.append(f"DELETE FROM live_sync_state WHERE key = {quote(key)};")
            insert = (
                "INSERT INTO live_sync_state (key, chunk_idx, payload, updated_at) VALUES ({}) "
                "ON CONFLICT (key, chunk_idx) DO UPDATE SET payload = excluded.payload, "
                "updated_at = excluded.updated_at;"
            )
            for key, idx, payload in state_rows:
                statement = insert.format(
                    ", ".join(quote(v) for v in (key, idx, payload, now_ms))
                )
                if len(statement) > MAX_STATEMENT_BYTES:
                    sys.exit(
                        f"live_sync_state statement for {key} chunk {idx} is "
                        f"{len(statement)} bytes -- over the {MAX_STATEMENT_BYTES} guard. "
                        "CHUNK_RAW_BYTES needs shrinking."
                    )
                parts.append(statement)
            parts.append("")

        args.out.write_text("\n".join(parts))
        size_kb = args.out.stat().st_size / 1e3
        print(f"Wrote {args.out} ({size_kb:.0f} KB) from: {', '.join(included)}")
    finally:
        con.close()


if __name__ == "__main__":
    main()
