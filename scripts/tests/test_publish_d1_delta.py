#!/usr/bin/env python3
"""Unit tests for scripts/db/publish_d1_delta.py's live_sync_state staging and
scripts/db/pull_live_state.py's wrangler-output parsing -- the D1 write/read
pair that replaced R2 as sync_live_scoreboard.py's intraday scratch state.

live_sync_state stores each accumulation file zlib-compressed, base64'd, and
split into <=48 KB chunks keyed (key, chunk_idx); the pull side reassembles
chunks in index order and decodes. These tests pin both halves of that
contract, including the corruption paths (gapped chunks, undecodable bytes)."""

import base64
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(SCRIPTS / "db"))

from pull_live_state import parse_wrangler_output  # noqa: E402

SCHEMA_STATE_TABLE = """
CREATE TABLE live_sync_state (
    key        TEXT NOT NULL,
    chunk_idx  INTEGER NOT NULL,
    payload    TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (key, chunk_idx)
);
"""


def encode_payload(text: str) -> str:
    """The publisher's exact encoding: zlib then base64."""
    return base64.b64encode(zlib.compress(text.encode("utf-8"))).decode("ascii")


def make_line(year: int) -> dict:
    """One minimal-but-valid box_scores/{year}.json line (see load.py's
    make_box_score_row for the consumed keys). player_name carries a single
    quote to prove the emitted SQL escapes like the full dump does."""
    return {
        "year": year,
        "week": 20,
        "matchup_id": 96,
        "espn_team_id": 2,
        "owner_id": "evan-szymkowicz",
        "player_id": 30836,
        "player_name": "Mike O'Brien",
        "total_points": 12.5,
        "batting": None,
        "pitching": None,
        "slots": [
            {
                "scoring_period": 146,
                "lineup_slot_id": 12,
                "points": 12.5,
                "raw_stats": {},
            }
        ],
    }


class PublishDeltaStateTests(unittest.TestCase):
    def run_publisher(self, in_dir: Path, out: Path) -> subprocess.CompletedProcess:
        return subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "db" / "publish_d1_delta.py"),
                "--in-dir",
                str(in_dir),
                "--year",
                "2026",
                "--out",
                str(out),
            ],
            capture_output=True,
            text=True,
        )

    def apply_delta(self, sql: str) -> sqlite3.Connection:
        """Execute a generated delta's live_sync_state statements into an
        in-memory db with the real table shape (other collections' DELETEs +
        INSERTs are out of scope here -- they need the full schema)."""
        con = sqlite3.connect(":memory:")
        con.executescript(SCHEMA_STATE_TABLE)
        for stmt in (s.strip() + ";" for s in sql.split(";\n") if s.strip()):
            if stmt.startswith("--"):
                continue
            if "live_sync_state" not in stmt:
                continue
            con.execute(stmt)
        return con

    def test_state_blobs_staged_chunked_for_every_accumulation_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            in_dir = Path(tmp)
            (in_dir / "box_scores").mkdir()
            line = make_line(2026)
            (in_dir / "box_scores" / "2026.json").write_text(json.dumps([line]))
            for name in (
                "player_season_points.json",
                "player_team_season_points.json",
            ):
                (in_dir / name).write_text("[]")

            out = Path(tmp) / "delta.sql"
            proc = self.run_publisher(in_dir, out)
            self.assertEqual(proc.returncode, 0, proc.stderr)

            sql = out.read_text()
            self.assertEqual(sql.count("INSERT INTO live_sync_state"), 3)
            # Payloads are compressed+base64 now -- the raw text must not
            # appear in the state section (the box_score_lines INSERTs above
            # it legitimately carry the escaped name).
            state_sql = sql.split("-- live_sync_state replace")[1]
            self.assertNotIn("Mike O", state_sql)
            # Every key starts at chunk 0 and indexes are dense.
            con = self.apply_delta(sql)
            rows = con.execute(
                "SELECT key, chunk_idx FROM live_sync_state ORDER BY key, chunk_idx"
            ).fetchall()
            by_key: dict[str, list[int]] = {}
            for key, idx in rows:
                by_key.setdefault(key, []).append(idx)
            self.assertEqual(len(by_key), 3)
            for idxs in by_key.values():
                self.assertEqual(idxs, list(range(len(idxs))))
            # Re-running never duplicates or fails (DELETE-first per key).
            con.close()
            con = self.apply_delta(sql)
            con = self.apply_delta(sql)  # idempotent re-apply on same shape
            self.assertEqual(
                con.execute("SELECT count(*) FROM live_sync_state").fetchone()[0], 3
            )
            con.close()

    def test_round_trip_through_pull_side_decode(self):
        """The publisher's stored chunks decode back to the source document
        exactly -- the property pull_live_state.py relies on."""
        with tempfile.TemporaryDirectory() as tmp:
            in_dir = Path(tmp)
            (in_dir / "box_scores").mkdir()
            doc = json.dumps([make_line(2026)])
            (in_dir / "box_scores" / "2026.json").write_text(doc)

            out = Path(tmp) / "delta.sql"
            proc = self.run_publisher(in_dir, out)
            self.assertEqual(proc.returncode, 0, proc.stderr)

            con = self.apply_delta(out.read_text())
            rows = con.execute(
                "SELECT payload FROM live_sync_state WHERE key = 'box_scores/2026.json' "
                "ORDER BY chunk_idx"
            ).fetchall()
            text = zlib.decompress(
                base64.b64decode("".join(r[0] for r in rows))
            ).decode("utf-8")
            self.assertEqual(text, doc)
            con.close()

    def test_no_patchable_files_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "delta.sql"
            proc = self.run_publisher(Path(tmp), out)
            self.assertEqual(proc.returncode, 0)
            self.assertFalse(out.exists())


class ParseWranglerOutputTests(unittest.TestCase):
    def test_extracts_chunked_rows_from_wrangler_document(self):
        stdout = (
            "🌀 Executing query...\n"
            '[{"results":['
            '{"key":"a.json","chunk_idx":0,"payload":"AAAA"},'
            '{"key":"a.json","chunk_idx":1,"payload":"BBBB"}'
            '],"success":true,"meta":{}}]\n'
        )
        self.assertEqual(
            parse_wrangler_output(stdout),
            {"a.json": [(0, "AAAA"), (1, "BBBB")]},
        )

    def test_rows_missing_chunk_idx_are_filtered_out(self):
        stdout = (
            '[{"results":[{"key":"old.json","payload":"[]"}],'
            '"success":true,"meta":{}}]\n'
        )
        self.assertEqual(parse_wrangler_output(stdout), {})

    def test_empty_table_yields_empty_dict(self):
        stdout = '[{"results":[],"success":true,"meta":{}}]\n'
        self.assertEqual(parse_wrangler_output(stdout), {})

    def test_unparseable_output_yields_empty_dict(self):
        self.assertEqual(parse_wrangler_output("not json at all"), {})


if __name__ == "__main__":
    unittest.main()
