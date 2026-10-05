#!/usr/bin/env python3
"""Unit tests for validate.py's per-player aggregation gates
(player_season_points_reconciliation, player_team_points) and their
undecided-week exemption.

The exemption exists because ESPN's cumulative rosterForMatchupPeriod
snapshot and per-day feeds disagree intraday mid-week -- and since 2026
week 21 the per-player week-to-date pool totals can freeze outright while
the daily blocks keep advancing. Stored season rows are internally
consistent with normalize's snapshot-anchored semantics (points = counted
snapshot + bench slots), yet their slot split no longer matches the
per-day slot sums. The gates must tolerate exactly that provisional drift
while still failing loudly on decided-week drift."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from validate import (
    check_player_season_points_reconciliation,
    check_player_team_points,
)


def make_line(
    year: int,
    week: int,
    player_id: int,
    player_name: str = "Player",
    owner_id: str = "owner-a",
    espn_team_id: int = 1,
    slots: list[dict] | None = None,
    total_points: float | None = None,
) -> dict:
    """A box-score line in the real processed shape. Defaults to one active
    (slot 5) day worth 10.0 points, counted == points."""
    if slots is None:
        slots = [
            {
                "scoring_period": week,
                "lineup_slot_id": 5,
                "points": 10.0,
                "raw_stats": {},
            }
        ]
    if total_points is None:
        # normalize's anchor semantics: total_points = counted snapshot plus
        # the bench add-back, so a consistent line's total covers every slot.
        total_points = sum(s["points"] for s in slots)
    return {
        "year": year,
        "week": week,
        "matchup_id": week,
        "owner_id": owner_id,
        "espn_team_id": espn_team_id,
        "player_id": player_id,
        "player_name": player_name,
        "total_points": total_points,
        "batting": None,
        "pitching": None,
        "slots": slots,
    }


def aggregate(lines: list[dict]) -> dict:
    """Build the stored-row shape normalize's aggregation pass produces:
    points sums total_points, counted/bench the slot split."""
    from validate import slot_split  # local import keeps the builder readable

    points = counted = bench = 0.0
    for line in lines:
        c, b = slot_split(line)
        points += line["total_points"]
        counted += c
        bench += b
    return {
        "points": round(points, 2),
        "counted_points": round(counted, 2),
        "bench_points": round(bench, 2),
    }


def make_data(
    lines: list[dict],
    undecided_weeks: tuple[tuple[int, int], ...] = (),
    in_progress_years: tuple[int, ...] = (),
) -> dict:
    """Assemble the data dict both checks consume. `undecided_weeks` lists the
    (year, week) pairs to mark UNDECIDED in matchups; `in_progress_years` the
    seasons whose status is "in_progress" -- the exemption only applies where
    the two overlap (historical UNDECIDED weeks stay strict)."""
    seasons = sorted({line["year"] for line in lines})
    return {
        "seasons": [
            {
                "year": year,
                "status": "in_progress" if year in set(in_progress_years) else "final",
            }
            for year in seasons
        ],
        "matchups": [
            {
                "year": year,
                "week": week,
                "matchup_id": week,
                "winner": "UNDECIDED"
                if (year, week) in set(undecided_weeks)
                else "HOME",
            }
            for year in seasons
            for week in sorted({line["week"] for line in lines if line["year"] == year})
        ],
        "box_scores": {
            year: [line for line in lines if line["year"] == year] for year in seasons
        },
        "owners": [{"owner_id": "owner-a"}, {"owner_id": "owner-b"}],
        "teams": [
            {"year": year, "espn_team_id": team}
            for year, team in sorted(
                {(line["year"], line["espn_team_id"]) for line in lines}
            )
        ],
        "player_season_points": [],
        "player_team_season_points": [],
    }


def seed_rows(data: dict, lines: list[dict]) -> None:
    """Fill the two stored aggregation files the way normalize would."""
    by_player = {}
    by_team = {}
    for line in lines:
        key = (line["year"], line["player_id"])
        by_player.setdefault(key, []).append(line)
        tkey = key + (line["owner_id"], line["espn_team_id"])
        by_team.setdefault(tkey, []).append(line)
    for (year, player_id), player_lines in sorted(by_player.items()):
        row = {
            "year": year,
            "player_id": player_id,
            "player_name": player_lines[0]["player_name"],
            **aggregate(player_lines),
        }
        data["player_season_points"].append(row)
    for (year, player_id, owner_id, team_id), team_lines in sorted(by_team.items()):
        row = {
            "year": year,
            "player_id": player_id,
            "player_name": team_lines[0]["player_name"],
            "owner_id": owner_id,
            "espn_team_id": team_id,
            **aggregate(team_lines),
        }
        data["player_team_season_points"].append(row)


class DecidedWeeksTests(unittest.TestCase):
    def test_consistent_decided_data_passes(self):
        lines = [
            make_line(2025, 5, 100),
            make_line(
                2025,
                6,
                100,
                slots=[
                    {
                        "scoring_period": 6,
                        "lineup_slot_id": 5,
                        "points": 4.0,
                        "raw_stats": {},
                    },
                    {
                        "scoring_period": 6,
                        "lineup_slot_id": 16,
                        "points": 2.5,
                        "raw_stats": {},
                    },
                ],
            ),
        ]
        data = make_data(lines)
        seed_rows(data, lines)
        self.assertEqual(check_player_season_points_reconciliation(data), [])
        self.assertEqual(check_player_team_points(data), [])

    def test_decided_drift_still_fails(self):
        """The core invariant: a stored row that stops matching its lines in
        a DECIDED week must still fail both gates."""
        lines = [make_line(2025, 5, 100)]
        data = make_data(lines)
        seed_rows(data, lines)
        data["player_season_points"][0]["points"] += 1.0
        self.assertTrue(check_player_season_points_reconciliation(data))
        data2 = make_data(lines)
        seed_rows(data2, lines)
        data2["player_team_season_points"][0]["points"] += 1.0
        self.assertTrue(check_player_team_points(data2))

    def test_missing_and_extra_rows_still_fail(self):
        lines = [make_line(2025, 5, 100)]
        data = make_data(lines)
        seed_rows(data, lines)
        data["player_season_points"] = []  # every line now has no stored row
        self.assertEqual(len(check_player_season_points_reconciliation(data)), 1)
        extra = make_data(lines)
        seed_rows(extra, lines)
        extra["player_season_points"].append(
            {
                "year": 2025,
                "player_id": 999,
                "player_name": "Ghost",
                "points": 1.0,
                "counted_points": 1.0,
                "bench_points": 0.0,
            }
        )
        self.assertEqual(len(check_player_season_points_reconciliation(extra)), 1)


class UndecidedWeekTests(unittest.TestCase):
    def test_snapshot_vs_slots_drift_in_undecided_week_passes(self):
        """The 2026 week-21 shape: snapshot-anchored total_points (2.4) while
        the per-day slots carry the real production (7.0). Stored rows are
        internally consistent with normalize's semantics, so both gates must
        pass despite the provisional drift."""
        drifted = make_line(
            2026,
            21,
            200,
            slots=[
                {
                    "scoring_period": 154,
                    "lineup_slot_id": 1,
                    "points": 2.4,
                    "raw_stats": {},
                },
                {
                    "scoring_period": 155,
                    "lineup_slot_id": 1,
                    "points": 4.8,
                    "raw_stats": {},
                },
                {
                    "scoring_period": 156,
                    "lineup_slot_id": 1,
                    "points": -0.2,
                    "raw_stats": {},
                },
            ],
            total_points=2.4,
        )
        decided = make_line(2026, 20, 200)
        lines = [decided, drifted]
        data = make_data(
            lines, undecided_weeks=((2026, 21),), in_progress_years=(2026,)
        )
        seed_rows(data, lines)
        self.assertEqual(check_player_season_points_reconciliation(data), [])
        self.assertEqual(check_player_team_points(data), [])

    def test_undecided_drift_in_both_directions_passes(self):
        """Team-level evidence showed per-player drift in both directions
        (some snapshots lag, some lead). Neither direction may fail."""
        lagging = make_line(2026, 21, 201, total_points=1.0)  # slots say 10.0
        leading = make_line(
            2026, 21, 202, owner_id="owner-b", total_points=12.0
        )  # slots say 10.0
        decided = [
            make_line(2026, 20, 201),
            make_line(2026, 20, 202, owner_id="owner-b"),
        ]
        data = make_data(
            decided + [lagging, leading],
            undecided_weeks=((2026, 21),),
            in_progress_years=(2026,),
        )
        seed_rows(data, decided + [lagging, leading])
        self.assertEqual(check_player_season_points_reconciliation(data), [])
        self.assertEqual(check_player_team_points(data), [])

    def test_undecided_only_player_passes_set_checks(self):
        """A player whose only lines fall in the undecided week exists in
        both stored files but has no decided contribution -- the set checks
        must not flag him and the residuals must cancel to zero."""
        lines = [make_line(2026, 21, 300, total_points=3.0)]
        data = make_data(
            lines, undecided_weeks=((2026, 21),), in_progress_years=(2026,)
        )
        seed_rows(data, lines)
        self.assertEqual(check_player_season_points_reconciliation(data), [])
        self.assertEqual(check_player_team_points(data), [])

    def test_undecided_drift_does_not_mask_decided_drift(self):
        """Exempting the provisional week must not weaken the decided-week
        gate: drift in BOTH weeks still fails."""
        drifted = make_line(2026, 21, 200, total_points=2.4)
        decided = make_line(2026, 20, 200)
        data = make_data(
            [decided, drifted], undecided_weeks=((2026, 21),), in_progress_years=(2026,)
        )
        seed_rows(data, [decided, drifted])
        data["player_season_points"][0]["points"] += 5.0
        self.assertTrue(check_player_season_points_reconciliation(data))
        data2 = make_data(
            [decided, drifted], undecided_weeks=((2026, 21),), in_progress_years=(2026,)
        )
        seed_rows(data2, [decided, drifted])
        data2["player_team_season_points"][0]["points"] += 5.0
        self.assertTrue(check_player_team_points(data2))

    def test_undecided_week_only_in_one_team_stint_rolls_up(self):
        """A mid-season tradee with an undecided-week line under his new team
        must still roll up exactly to the season row on the decided residual."""
        stint_a = make_line(2026, 19, 400, owner_id="owner-a", espn_team_id=1)
        stint_b = make_line(
            2026, 21, 400, owner_id="owner-b", espn_team_id=2, total_points=2.4
        )
        data = make_data(
            [stint_a, stint_b],
            undecided_weeks=((2026, 21),),
            in_progress_years=(2026,),
        )
        seed_rows(data, [stint_a, stint_b])
        self.assertEqual(check_player_team_points(data), [])

    def test_historical_undecided_week_stays_strict(self):
        """matchups.json carries UNDECIDED winners for some historical playoff
        weeks too (ESPN never finalized them in the archived responses). Those
        seasons are final -- no refresh will re-capture them -- so their drift
        must keep failing both gates, in-progress exemption or not."""
        drifted = make_line(2025, 23, 500, total_points=1.0)  # slots say 10.0
        data = make_data([drifted], undecided_weeks=((2025, 23),))
        seed_rows(data, [drifted])
        self.assertTrue(check_player_season_points_reconciliation(data))
        self.assertTrue(check_player_team_points(data))


if __name__ == "__main__":
    unittest.main()
