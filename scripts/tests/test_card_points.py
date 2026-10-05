#!/usr/bin/env python3
"""Unit tests for normalize.py's build_card_points (ESPN player-card season
totals from each kona file's real season block) and validate.py's
check_card_points gate."""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from normalize import build_card_points
from validate import Failure, check_card_points


class FakeRegistry:
    """PlayerRegistry stand-in: canonical_id is the identity unless remapped."""

    def __init__(self, remaps: dict[int, int] | None = None):
        self.remaps = remaps or {}

    def canonical_id(self, raw_id: int) -> int:
        return self.remaps.get(raw_id, raw_id)


def kona_player(raw_id: int, name: str, blocks: list[dict]) -> dict:
    return {"player": {"id": raw_id, "fullName": name, "stats": blocks}}


def season_block(season: int, total: float | None) -> dict:
    return {
        "statSourceId": 0,
        "statSplitTypeId": 0,
        "seasonId": season,
        "appliedTotal": total,
    }


def run_builder(
    files: dict[int, dict], points_keys: set[tuple[int, int]], registry=None
) -> list[dict]:
    registry = registry or FakeRegistry()
    points = [{"year": y, "player_id": pid} for (y, pid) in sorted(points_keys)]
    with patch("normalize.load_view", side_effect=lambda year, _name: files.get(year)):
        return build_card_points(sorted(files), registry, points)


class BuildCardPointsTests(unittest.TestCase):
    def test_harvests_real_season_block_rounded(self):
        files = {
            2026: {
                "players": [
                    kona_player(1, "Max Scherzer", [season_block(2026, 19.019)])
                ]
            }
        }

        rows = run_builder(files, {(2026, 1)})

        self.assertEqual(
            rows,
            [
                {
                    "year": 2026,
                    "player_id": 1,
                    "player_name": "Max Scherzer",
                    "card_points": 19.02,
                }
            ],
        )

    def test_ignores_non_season_blocks_and_bad_years(self):
        files = {
            2026: {
                "players": [
                    kona_player(
                        1,
                        "Shohei Ohtani",
                        [
                            {
                                "statSourceId": 1,
                                "statSplitTypeId": 0,
                                "seasonId": 2026,
                                "appliedTotal": 359.5,
                            },
                            {
                                "statSourceId": 0,
                                "statSplitTypeId": 1,
                                "seasonId": 2026,
                                "appliedTotal": 22.2,
                            },
                            {
                                "statSourceId": 0,
                                "statSplitTypeId": 0,
                                "seasonId": "2026",
                                "appliedTotal": 99.9,
                            },
                            season_block(2026, 478.5),
                        ],
                    )
                ]
            }
        }

        rows = run_builder(files, {(2026, 1)})

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["card_points"], 478.5)

    def test_emits_only_consumed_keys(self):
        files = {
            2026: {
                "players": [
                    kona_player(1, "Rostered", [season_block(2026, 10.0)]),
                    kona_player(2, "Never Rostered", [season_block(2026, 20.0)]),
                ]
            }
        }

        rows = run_builder(files, {(2026, 1)})

        self.assertEqual([r["player_id"] for r in rows], [1])

    def test_later_kona_file_wins_for_overlapping_seasons(self):
        old = {"players": [kona_player(1, "Star", [season_block(2025, 400.0)])]}
        new = {"players": [kona_player(1, "Star", [season_block(2025, 401.5)])]}

        rows = run_builder({2025: old, 2026: new}, {(2025, 1)})

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["card_points"], 401.5)

    def test_applies_registry_canonical_ids(self):
        files = {
            2026: {"players": [kona_player(99, "Remapped", [season_block(2026, 5.0)])]}
        }

        rows = run_builder(files, {(2026, 7)}, FakeRegistry({99: 7}))

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["player_id"], 7)

    def test_empty_years_and_missing_kona(self):
        self.assertEqual(run_builder({}, set()), [])
        self.assertEqual(run_builder({2026: None}, {(2026, 1)}), [])

    def test_output_sorted_by_year_then_player(self):
        files = {
            2026: {
                "players": [
                    kona_player(2, "B", [season_block(2026, 2.0)]),
                    kona_player(1, "A", [season_block(2026, 1.0)]),
                ]
            },
            2025: {"players": [kona_player(9, "C", [season_block(2025, 9.0)])]},
        }

        rows = run_builder(files, {(2026, 2), (2026, 1), (2025, 9)})

        self.assertEqual(
            [(r["year"], r["player_id"]) for r in rows],
            [(2025, 9), (2026, 1), (2026, 2)],
        )


def gate_data(card_rows: list[dict]) -> dict:
    return {
        "players": [{"player_id": 1}, {"player_id": 2}],
        "player_season_points": [
            {"year": 2026, "player_id": 1},
            {"year": 2026, "player_id": 2},
        ],
        "card_points": card_rows,
    }


def card_row(year: int, player_id: int, value, name: str = "P") -> dict:
    return {
        "year": year,
        "player_id": player_id,
        "player_name": name,
        "card_points": value,
    }


class CheckCardPointsTests(unittest.TestCase):
    def test_clean_file_passes(self):
        data = gate_data([card_row(2026, 1, 19.0), card_row(2026, 2, 0.0)])

        self.assertEqual(check_card_points(data), [])

    def test_duplicate_unknown_player_and_orphan_fail(self):
        data = gate_data(
            [
                card_row(2026, 1, 19.0),
                card_row(2026, 1, 19.0),
                card_row(2026, 999, 5.0),
            ]
        )

        details = [f.detail for f in check_card_points(data)]
        self.assertTrue(any("duplicate" in d for d in details))
        self.assertTrue(any("not in players.json" in d for d in details))
        self.assertTrue(any("no matching" in d for d in details))

    def test_non_numeric_and_malformed_rows_fail_cleanly(self):
        data = gate_data(
            [
                card_row(2026, 1, "lots"),
                card_row(2026, 1, float("nan")),
                card_row(2026, 1, True),
                {"year": 2026, "player_id": "x", "card_points": 1.0},
                {"year": 2026, "player_id": 2},
            ]
        )

        failures = check_card_points(data)
        self.assertTrue(all(isinstance(f, Failure) for f in failures))
        self.assertTrue(any("not a finite number" in f.detail for f in failures))
        self.assertTrue(any("bad player_id" in f.detail for f in failures))

    def test_thin_season_warns_instead_of_failing(self):
        data = {
            "players": [{"player_id": i} for i in range(20)],
            "player_season_points": [{"year": 2026, "player_id": i} for i in range(20)],
            "card_points": [card_row(2026, 1, 5.0)],
        }

        failures = check_card_points(data)
        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0].level, "warn")


if __name__ == "__main__":
    unittest.main()
