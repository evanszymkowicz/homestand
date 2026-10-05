#!/usr/bin/env python3
"""Unit tests for scripts/lib/box_score_lines.py's stat-delta and
cumulative-snapshot anchoring helpers."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.box_score_lines import (
    ANCHOR_POINTS_TOLERANCE,
    anchor_entry_to_snapshot,
    derive_season_points,
    derive_team_season_points,
    new_line_entry,
    stat_dict_delta,
)


class StatDictDeltaTests(unittest.TestCase):
    def test_simple_addition(self):
        delta = stat_dict_delta({"0": 4, "7": 1}, {0: 2})
        self.assertEqual(delta, {"0": 2, "7": 1})

    def test_decrement(self):
        delta = stat_dict_delta({"0": 1}, {0: 4})
        self.assertEqual(delta, {"0": -3})

    def test_vanished_id_is_not_back_attributed(self):
        """A stat that vanished from the cumulative block must NOT become a
        negative delta on whatever day is being stitched -- historical
        revisions wash out through anchor_entry_to_snapshot instead."""
        self.assertEqual(stat_dict_delta({"0": 2}, {0: 2, 7: 1}), {})

    def test_no_change_is_empty(self):
        self.assertEqual(stat_dict_delta({"0": 2, "10": 1}, {0: 2, 10: 1}), {})


def make_entry(**overrides) -> dict:
    entry = new_line_entry(2026, 19, 91, "owner", 8, 4684778, "Jordan Walker")
    entry.update(overrides)
    return entry


class AnchorEntryToSnapshotTests(unittest.TestCase):
    def test_noop_when_already_consistent(self):
        entry = make_entry(
            total_points=6.2,
            stat_totals={0: 13, 7: 1},
            slots=[
                {
                    "scoring_period": 140,
                    "lineup_slot_id": 5,
                    "points": 6.2,
                    "raw_stats": {"0": 13, "7": 1},
                }
            ],
        )
        self.assertFalse(anchor_entry_to_snapshot(entry, 6.2, {0: 13, 7: 1}))
        self.assertEqual(entry["total_points"], 6.2)

    def test_float_noise_within_tolerance_is_noop(self):
        entry = make_entry(total_points=6.2, stat_totals={0: 13}, slots=[])
        self.assertFalse(anchor_entry_to_snapshot(entry, 6.2 + 1e-9, {0: 13}))

    def test_points_residual_folds_into_last_active_slot_with_stats(self):
        slot_a = {
            "scoring_period": 139,
            "lineup_slot_id": 5,
            "points": 0.2,
            "raw_stats": {"0": 4},
        }
        slot_b = {
            "scoring_period": 144,
            "lineup_slot_id": 5,
            "points": -2.0,
            "raw_stats": {"0": 4, "26": 1},
        }
        entry = make_entry(
            total_points=-1.8, stat_totals={0: 8, 26: 1}, slots=[slot_a, slot_b]
        )
        # ESPN's snapshot says the week produced -2.0 with one fewer AB.
        self.assertTrue(anchor_entry_to_snapshot(entry, -2.0, {0: 7, 26: 1}))
        self.assertEqual(entry["total_points"], -2.0)
        self.assertEqual(slot_b["points"], -2.2)
        self.assertEqual(slot_b["raw_stats"], {"0": 3, "26": 1})
        # Untouched earlier slot.
        self.assertEqual(slot_a["points"], 0.2)

    def test_stat_residual_lands_on_active_slot_not_bench(self):
        bench = {
            "scoring_period": 142,
            "lineup_slot_id": 16,
            "points": 0.0,
            "raw_stats": {},
        }
        active = {
            "scoring_period": 141,
            "lineup_slot_id": 5,
            "points": 1.4,
            "raw_stats": {"7": 1},
        }
        entry = make_entry(total_points=1.4, stat_totals={7: 1}, slots=[bench, active])
        # Phantom single: ESPN removed it after capture.
        self.assertTrue(anchor_entry_to_snapshot(entry, 0.0, {}))
        self.assertEqual(entry["stat_totals"], {})
        self.assertEqual(active["raw_stats"], {})
        self.assertEqual(active["points"], 0.0)
        self.assertEqual(bench["raw_stats"], {})

    def test_bench_production_survives_anchoring(self):
        """The anchor pins the COUNTED part to ESPN's counted-only snapshot
        and adds bench slot production back on top -- bench points/stats must
        never be folded away or double-counted."""
        active = {
            "scoring_period": 141,
            "lineup_slot_id": 5,
            "points": 1.4,
            "raw_stats": {"7": 1},
        }
        bench = {
            "scoring_period": 142,
            "lineup_slot_id": 16,
            "points": 2.0,
            "raw_stats": {"20": 1, "5": 1},
        }
        entry = make_entry(
            total_points=3.4, stat_totals={7: 1, 20: 1, 5: 1}, slots=[active, bench]
        )
        # Snapshot says the counted part is now 1.8 with one more single; the
        # bench run/HR are invisible to it and must survive.
        self.assertTrue(anchor_entry_to_snapshot(entry, 1.8, {7: 2}))
        self.assertAlmostEqual(entry["total_points"], 3.8)
        self.assertEqual(entry["stat_totals"], {7: 2, 20: 1, 5: 1})
        # Residual +0.4/+{7:1} lands on the active slot only.
        self.assertAlmostEqual(active["points"], 1.8)
        self.assertEqual(active["raw_stats"], {"7": 2})
        self.assertEqual(bench["points"], 2.0)
        self.assertEqual(bench["raw_stats"], {"20": 1, "5": 1})

    def test_bench_only_line_anchors_via_fallback_slot(self):
        """Degenerate path: a bench-only line has no active slot to carry the
        counted residual, so totals become snapshot + bench and the bench slot
        absorbs the difference (defensive only -- live captures never produce
        a snapshot for a player who was benched all week)."""
        bench = {
            "scoring_period": 141,
            "lineup_slot_id": 16,
            "points": 1.0,
            "raw_stats": {"20": 1},
        }
        entry = make_entry(total_points=1.0, stat_totals={20: 1}, slots=[bench])
        self.assertTrue(anchor_entry_to_snapshot(entry, 2.0, {20: 2}))
        # Target: 2.0 counted + 1.0 bench = 3.0 total, {20: 2} + {20: 1}; the
        # fallback carrier absorbs the whole residual.
        self.assertAlmostEqual(entry["total_points"], 3.0)
        self.assertEqual(entry["stat_totals"], {20: 3})
        self.assertAlmostEqual(bench["points"], 3.0)
        self.assertEqual(bench["raw_stats"], {"20": 3})

    def test_vanished_counted_stat_removed_but_bench_kept(self):
        """A count the snapshot no longer carries comes off the totals unless
        bench slots back it -- the union-keys rule now spans both sources."""
        active = {
            "scoring_period": 141,
            "lineup_slot_id": 5,
            "points": 1.4,
            "raw_stats": {"7": 1},
        }
        bench = {
            "scoring_period": 142,
            "lineup_slot_id": 16,
            "points": 1.0,
            "raw_stats": {"20": 1},
        }
        entry = make_entry(
            total_points=2.4, stat_totals={7: 1, 20: 1}, slots=[active, bench]
        )
        # The counted single was revised away; the bench run stays.
        self.assertTrue(anchor_entry_to_snapshot(entry, 0.0, {}))
        self.assertAlmostEqual(entry["total_points"], 1.0)
        self.assertEqual(entry["stat_totals"], {20: 1})
        self.assertEqual(active["points"], 0.0)
        self.assertEqual(active["raw_stats"], {})
        self.assertEqual(bench["points"], 1.0)

    def test_unmapped_stat_ids_are_dropped(self):
        entry = make_entry(total_points=0.0, stat_totals={}, slots=[])
        # id 8 (total bases) exists in ESPN's raw stat dicts but sits outside
        # the scored union, so it is not in the BATTING/PITCHING mappings.
        self.assertFalse(anchor_entry_to_snapshot(entry, 0.0, {8: 3}))
        self.assertEqual(entry["stat_totals"], {})

    def test_no_slots_sets_totals_directly(self):
        entry = make_entry(total_points=0.0, stat_totals={}, slots=[])
        self.assertTrue(anchor_entry_to_snapshot(entry, 2.4, {3: 1}))
        self.assertEqual(entry["total_points"], 2.4)
        self.assertEqual(entry["stat_totals"], {3: 1})

    def test_tolerance_boundary_still_corrects_stats(self):
        """Points within tolerance but stats drifted: stats must still be
        corrected so the line recomputes to its own total."""
        entry = make_entry(
            total_points=-1.0,
            stat_totals={0: 2, 7: 1, 27: 1},
            slots=[
                {
                    "scoring_period": 140,
                    "lineup_slot_id": 5,
                    "points": -1.0,
                    "raw_stats": {"0": 2, "7": 1, "27": 1},
                }
            ],
        )
        # Snapshot: same points, but the single was revised away.
        changed = anchor_entry_to_snapshot(entry, -1.0, {0: 2, 27: 1})
        self.assertTrue(changed)
        self.assertAlmostEqual(entry["total_points"], -1.0)
        self.assertEqual(entry["stat_totals"], {0: 2, 27: 1})

    def test_snapshot_supersedes_same_period_slot(self):
        """A real slot at the snapshot's own period does not block the anchor:
        the period-N file may have been captured after day N's games, making
        its cumulative the freshest evidence (the Pete Alonso week-19 case).
        Callers keep completed seasons out of anchoring instead."""
        entry = make_entry(
            total_points=19.2,
            stat_totals={0: 20, 7: 8},
            slots=[
                {
                    "scoring_period": 144,
                    "lineup_slot_id": 1,
                    "points": 7.0,
                    "raw_stats": {"0": 5, "5": 1, "7": 2, "20": 1, "21": 1},
                },
                {
                    "scoring_period": 145,
                    "lineup_slot_id": 1,
                    "points": 0.9,
                    "raw_stats": {"10": 1, "12": 1},
                },
            ],
        )
        self.assertTrue(anchor_entry_to_snapshot(entry, 21.1, {0: 21, 7: 9}))
        self.assertAlmostEqual(entry["total_points"], 21.1)
        self.assertEqual(entry["stat_totals"], {0: 21, 7: 9})

    def test_empty_husk_slot_does_not_block_anchor(self):
        """A live pre-game capture emits an empty slot for day N; the
        snapshot from period N supersedes it."""
        entry = make_entry(
            total_points=-1.8,
            stat_totals={0: 8},
            slots=[
                {
                    "scoring_period": 144,
                    "lineup_slot_id": 5,
                    "points": -1.8,
                    "raw_stats": {"0": 8},
                },
                {
                    "scoring_period": 145,
                    "lineup_slot_id": 5,
                    "points": 0.0,
                    "raw_stats": {},
                },
            ],
        )
        self.assertTrue(anchor_entry_to_snapshot(entry, -4.0, {0: 17}))
        self.assertAlmostEqual(entry["total_points"], -4.0)
        self.assertEqual(entry["stat_totals"], {0: 17})

    def test_tolerance_constant_is_validator_safe(self):
        """The no-op band must sit well inside validate.py's tolerance so a
        skipped anchor can never leave a failing line behind."""
        self.assertLess(ANCHOR_POINTS_TOLERANCE, 0.05)


def make_line(
    player_id: int,
    espn_team_id: int,
    total_points: float,
    slots: list[dict],
    owner_id: str = "owner-a",
) -> dict:
    return {
        "year": 2026,
        "week": 19,
        "matchup_id": 91,
        "owner_id": owner_id,
        "espn_team_id": espn_team_id,
        "player_id": player_id,
        "player_name": "Jordan Walker",
        "total_points": total_points,
        "slots": slots,
    }


class DeriveRollupSplitTests(unittest.TestCase):
    ACTIVE = {
        "scoring_period": 140,
        "lineup_slot_id": 5,
        "points": 6.2,
        "raw_stats": {},
    }
    BENCH = {
        "scoring_period": 141,
        "lineup_slot_id": 16,
        "points": 2.5,
        "raw_stats": {},
    }
    ACTIVE_SMALL = {
        "scoring_period": 142,
        "lineup_slot_id": 7,
        "points": 3.0,
        "raw_stats": {},
    }

    def test_season_rows_carry_explicit_split(self):
        rows = derive_season_points(
            2026,
            [
                make_line(1, 8, 8.7, [self.ACTIVE, self.BENCH]),
                # Same player on another team after an in-season trade.
                make_line(1, 9, 3.0, [dict(self.ACTIVE_SMALL)], owner_id="owner-b"),
            ],
        )
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertAlmostEqual(row["points"], 11.7)
        self.assertAlmostEqual(row["counted_points"], 9.2)
        self.assertAlmostEqual(row["bench_points"], 2.5)

    def test_team_rows_split_and_roll_up(self):
        rows = derive_team_season_points(
            2026,
            [
                make_line(1, 8, 8.7, [self.ACTIVE, self.BENCH]),
                make_line(1, 9, 3.0, [dict(self.ACTIVE_SMALL)], owner_id="owner-b"),
            ],
        )
        by_team = {r["espn_team_id"]: r for r in rows}
        self.assertAlmostEqual(by_team[8]["counted_points"], 6.2)
        self.assertAlmostEqual(by_team[8]["bench_points"], 2.5)
        self.assertAlmostEqual(by_team[9]["counted_points"], 3.0)
        self.assertEqual(by_team[9]["bench_points"], 0.0)
        for r in rows:
            self.assertAlmostEqual(r["counted_points"] + r["bench_points"], r["points"])

    def test_pre_slot_era_counts_as_all_active(self):
        """The synthetic single-slot era splits to (total, 0) -- bench points
        didn't exist as separable data before per-day captures."""
        legacy_slot = {
            "scoring_period": 0,
            "lineup_slot_id": 0,
            "points": 4.4,
            "raw_stats": {},
        }
        rows = derive_season_points(2012, [make_line(2, 3, 4.4, [legacy_slot])])
        self.assertEqual(rows[0]["counted_points"], 4.4)
        self.assertEqual(rows[0]["bench_points"], 0.0)


if __name__ == "__main__":
    unittest.main()
