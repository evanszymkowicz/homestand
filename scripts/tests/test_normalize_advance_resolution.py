#!/usr/bin/env python3
"""Tests for normalize.py's in-progress cumulative-advance resolution.

Reproduces the 2026 wk21 capture regime that corrupted day-level slots before
the fix (normalize.py's advance handling): a pre-week capture with no
cumulative, a batch of files captured on one day sharing a frozen cumulative
that spans several scoring periods, then files whose cumulative advances by
one covered day at a time. The per-day wave and the cumulative wave must not
clobber each other -- residuals land on the span's uncovered day, exactly
where ESPN's own pointsByScoringPeriod says the production sits."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import normalize
from lib.box_score_lines import (
    counted_slot_contribution,
    counted_slot_days,
    merge_residual_into_slot,
    new_line_entry,
)
from lib.mapping import OwnerMap, PlayerRegistry

YEAR = 2026
WEEK = 21
MATCHUP_ID = 101
HOME_TEAM = 3
AWAY_TEAM = 4
PERIODS = list(range(153, 160))


def day_block(spid, total, applied, raw):
    """One per-day stat block as mBoxscore carries it inside player.stats."""
    return {
        "seasonId": YEAR,
        "statSourceId": 0,
        "statSplitTypeId": 5,
        "scoringPeriodId": spid,
        "appliedTotal": total,
        "appliedStats": applied,
        "stats": raw,
    }


def cumulative_block(total, applied, raw):
    """The matchup-cumulative block: statSplitTypeId 5, scoringPeriodId 0."""
    return {
        "seasonId": YEAR,
        "statSourceId": 0,
        "statSplitTypeId": 5,
        "scoringPeriodId": 0,
        "appliedTotal": total,
        "appliedStats": applied,
        "stats": raw,
    }


def rsc_entry(pid, slot, total, blocks):
    return {
        "lineupSlotId": slot,
        "playerId": pid,
        "playerPoolEntry": {
            "appliedStatTotal": total,
            "player": {
                "id": pid,
                "fullName": f"Player {pid}",
                "defaultPositionId": 10,
                "stats": blocks,
            },
        },
    }


def rmp_entry(pid, slot, total, blocks):
    return {
        "lineupSlotId": slot,
        "playerId": pid,
        "playerPoolEntry": {
            "appliedStatTotal": total,
            "player": {
                "id": pid,
                "fullName": f"Player {pid}",
                "defaultPositionId": 10,
                "stats": blocks,
            },
        },
    }


def side(team_id, rsc_entries, rmp_entries, rmp_total, pbsp):
    return {
        "teamId": team_id,
        "pointsByScoringPeriod": pbsp,
        "rosterForCurrentScoringPeriod": {"entries": rsc_entries},
        "rosterForMatchupPeriod": {
            "appliedStatTotal": rmp_total,
            "entries": rmp_entries,
        },
    }


def build_payload(period, home_side, away_side):
    return {
        "schedule": [
            {
                "id": MATCHUP_ID,
                "matchupPeriodId": WEEK,
                "home": home_side,
                "away": away_side,
            }
        ]
    }


def write_week(root, payloads_by_period):
    year_dir = root / str(YEAR)
    year_dir.mkdir(parents=True, exist_ok=True)
    for period, payload in payloads_by_period.items():
        (year_dir / f"mBoxscore-period{period}.json").write_text(json.dumps(payload))


# Player 100: batter whose rsc day lines are complete for every played day.
# Player 200: the Ohtani stand-in -- real rsc lines Tue-Thu, none Fri/Sat, so
# Fri/Sat production reaches the archive only through the advancing cumulative.
# Player 300: Monday-only production that exists exclusively in the cumulative
# (the pre-week capture saw nothing), the residual-placement case.
EMPTY_RMP = {"appliedStatTotal": 0.0, "entries": []}
BATCH_PBSP = {"153": 3.0, "154": 3.2, "155": 5.4, "156": -2.5}


def batched_week_rsc(period):
    """rsc day lines from the batch-fetched files (154-157, all captured on
    one day): real lines for 154/155/156, empty for the not-yet-played 157."""
    if period == 154:
        return [
            rsc_entry(100, 12, 2.0, [day_block(154, 2.0, {"0": 2.0}, {"0": 4})]),
            rsc_entry(200, 12, 1.2, [day_block(154, 1.2, {"0": 1.2}, {"0": 4})]),
        ]
    if period == 155:
        return [
            rsc_entry(100, 12, 1.0, [day_block(155, 1.0, {"0": 1.0}, {"0": 3})]),
            rsc_entry(200, 12, 4.4, [day_block(155, 4.4, {"0": 4.4}, {"0": 3})]),
        ]
    if period == 156:
        return [
            rsc_entry(
                100,
                12,
                -0.5,
                [day_block(156, -0.5, {"0": -0.5, "27": 0.0}, {"0": 2, "27": 1})],
            ),
            rsc_entry(200, 12, -2.0, [day_block(156, -2.0, {"0": -2.0}, {"0": 2})]),
        ]
    return []  # 157: pre-game / no stats yet


# Frozen through-Thursday cumulative shared by files 154-157.
BATCH_RMP_ENTRIES = [
    rmp_entry(100, 12, 2.5, [cumulative_block(2.5, {"0": 2.5}, {"0": 9})]),
    rmp_entry(200, 12, 3.6, [cumulative_block(3.6, {"0": 3.6}, {"0": 9})]),
    rmp_entry(300, 12, 3.0, [cumulative_block(3.0, {"0": 3.0}, {"0": 6})]),
]


def week_payloads():
    """The seven files of the wk21-shaped week."""
    empty_side_4 = side(AWAY_TEAM, [], [], 0.0, {})
    payloads = {}

    # 153: pre-week capture -- empty cumulative, empty day scores.
    payloads[153] = build_payload(
        153,
        side(HOME_TEAM, [], [], 0.0, {}),
        empty_side_4,
    )

    # 154-157: batch-fetched, cumulative frozen at through-154..156 coverage.
    for period in range(154, 158):
        payloads[period] = build_payload(
            period,
            side(
                HOME_TEAM,
                batched_week_rsc(period),
                BATCH_RMP_ENTRIES,
                9.1,
                dict(BATCH_PBSP),
            ),
            empty_side_4,
        )

    # 158: cumulative advances through 157 (Friday: player 200 -1.8);
    # rsc carries Saturday (day 158) lines for player 100.
    payloads[158] = build_payload(
        158,
        side(
            HOME_TEAM,
            [rsc_entry(100, 12, 0.5, [day_block(158, 0.5, {"0": 0.5}, {"0": 2})])],
            [
                rmp_entry(100, 12, 2.5, [cumulative_block(2.5, {"0": 2.5}, {"0": 9})]),
                rmp_entry(200, 12, 1.8, [cumulative_block(1.8, {"0": 1.8}, {"0": 13})]),
                rmp_entry(300, 12, 3.0, [cumulative_block(3.0, {"0": 3.0}, {"0": 6})]),
            ],
            7.3,
            {"153": 3.0, "154": 3.2, "155": 5.4, "156": -2.5, "157": -1.8},
        ),
        empty_side_4,
    )

    # 159: cumulative advances through 158 (Saturday: 100 +0.5, 200 -0.4).
    payloads[159] = build_payload(
        159,
        side(
            HOME_TEAM,
            [],
            [
                rmp_entry(100, 12, 3.0, [cumulative_block(3.0, {"0": 3.0}, {"0": 11})]),
                rmp_entry(200, 12, 1.4, [cumulative_block(1.4, {"0": 1.4}, {"0": 17})]),
                rmp_entry(300, 12, 3.0, [cumulative_block(3.0, {"0": 3.0}, {"0": 6})]),
            ],
            7.4,
            {
                "153": 3.0,
                "154": 3.2,
                "155": 5.4,
                "156": -2.5,
                "157": -1.8,
                "158": 0.1,
            },
        ),
        empty_side_4,
    )
    return payloads


def slots_by_day(line):
    return {s["scoring_period"]: s for s in line["slots"]}


class AdvanceResolutionTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._old_raw_dir = normalize.RAW_DIR
        normalize.RAW_DIR = Path(self._tmp.name)
        normalize._view_cache.clear()
        normalize._view_cache_year = None
        write_week(Path(self._tmp.name), week_payloads())
        self.owner_map = OwnerMap(
            owners_by_id={},
            name_index={},
            team_seasons={
                (YEAR, HOME_TEAM): {"primary_owner_id": "owner-a"},
                (YEAR, AWAY_TEAM): {"primary_owner_id": "owner-b"},
            },
        )
        self.registry = PlayerRegistry()

    def tearDown(self):
        normalize.RAW_DIR = self._old_raw_dir
        normalize._view_cache.clear()
        normalize._view_cache_year = None
        self._tmp.cleanup()

    def build(self, anchor_to_snapshots):
        return normalize.build_box_scores(
            YEAR,
            PERIODS,
            self.owner_map,
            self.registry,
            anchor_to_snapshots=anchor_to_snapshots,
        )

    def lines_for(self, lines, pid):
        return next(
            line
            for line in lines
            if line["player_id"] == pid and line["espn_team_id"] == HOME_TEAM
        )


class PerDayNotClobberedTests(AdvanceResolutionTestBase):
    def test_batch_cumulative_does_not_replace_per_day_line(self):
        """The wk21 bug: the through-Thursday cumulative was dumped onto day
        154 and accumulate()'s upsert replaced the real 1.2-point day line
        with the whole multi-day delta. The per-day line must survive."""
        lines = self.build(anchor_to_snapshots=True)
        twoway = slots_by_day(self.lines_for(lines, 200))
        self.assertEqual(twoway[154]["points"], 1.2)
        self.assertEqual(twoway[154]["raw_stats"], {"0": 4})

    def test_slot_sum_reconciles_to_anchored_total(self):
        """counted_points == points requires slots to sum to the snapshot-
        anchored total -- the phantom gap the old stitching left behind."""
        lines = self.build(anchor_to_snapshots=True)
        for pid, total in ((100, 3.0), (200, 1.4), (300, 3.0)):
            line = self.lines_for(lines, pid)
            self.assertEqual(line["total_points"], total)
            self.assertAlmostEqual(
                sum(s["points"] for s in line["slots"]), total, places=2
            )

    def test_residual_lands_on_uncovered_day(self):
        """Friday/Saturday production reaches the archive only through the
        advancing cumulative (no rsc line exists), so the advance deltas land
        on exactly those uncovered days."""
        lines = self.build(anchor_to_snapshots=True)
        twoway = slots_by_day(self.lines_for(lines, 200))
        self.assertAlmostEqual(twoway[157]["points"], -1.8, places=6)
        self.assertAlmostEqual(twoway[158]["points"], -0.4, places=6)

    def test_monday_only_production_lands_on_day_153(self):
        """Player 300's production exists only in the cumulative (the pre-week
        capture saw nothing), so the first advance's residual places it on the
        span's earliest uncovered day."""
        lines = self.build(anchor_to_snapshots=True)
        monday = slots_by_day(self.lines_for(lines, 300))
        self.assertEqual(monday[153]["points"], 3.0)

    def test_team_day_sums_match_official_day_scores(self):
        """The property validate.py's box_score_day_reconciliation checks:
        counted slot sums per team-day equal the official pointsByScoringPeriod
        scores for every covered day."""
        lines = self.build(anchor_to_snapshots=True)
        actual = {}
        for line in lines:
            if line["espn_team_id"] != HOME_TEAM:
                continue
            for slot in line["slots"]:
                day = slot["scoring_period"]
                actual[day] = actual.get(day, 0.0) + slot["points"]
        pbsp = week_payloads()[159]["schedule"][0]["home"]["pointsByScoringPeriod"]
        for day_str, score in pbsp.items():
            self.assertAlmostEqual(actual[int(day_str)], score, places=2)


class LegacyPathPreservedTests(AdvanceResolutionTestBase):
    def test_completed_seasons_keep_legacy_attribution(self):
        """anchor_to_snapshots=False (completed seasons) must keep the legacy
        behavior byte-for-byte: the off-day branch dumps the advance delta onto
        the current period, replacing the per-day line. Documented here as the
        behavior the in-progress path exists to avoid."""
        lines = self.build(anchor_to_snapshots=False)
        batter = slots_by_day(self.lines_for(lines, 100))
        # The through-Thursday delta (2.5) replaced the real 2.0 day line.
        self.assertEqual(batter[154]["points"], 2.5)
        # No anchoring: totals are the raw accumulation, drift and all.
        line = self.lines_for(lines, 100)
        self.assertAlmostEqual(
            line["total_points"], sum(s["points"] for s in line["slots"]), places=2
        )

    def test_frozen_backfilled_week_is_per_day_authoritative(self):
        """The decided-week regime (all files sharing one frozen cumulative):
        per-day blocks are authoritative and no advance ever fires."""
        self._tmp.cleanup()
        self._tmp = tempfile.TemporaryDirectory()
        normalize.RAW_DIR = Path(self._tmp.name)
        normalize._view_cache.clear()
        payloads = {}
        for period in range(154, 158):
            payloads[period] = build_payload(
                period,
                side(
                    HOME_TEAM,
                    batched_week_rsc(period),
                    BATCH_RMP_ENTRIES,
                    9.1,
                    dict(BATCH_PBSP),
                ),
                side(AWAY_TEAM, [], [], 0.0, {}),
            )
        write_week(Path(self._tmp.name), payloads)
        lines = self.build(anchor_to_snapshots=True)
        batter = slots_by_day(self.lines_for(lines, 100))
        self.assertEqual(batter[154]["points"], 2.0)
        self.assertEqual(batter[155]["points"], 1.0)
        self.assertEqual(batter[156]["points"], -0.5)
        self.assertNotIn(153, batter)


class CountedSlotHelperTests(unittest.TestCase):
    def make_entry(self):
        return new_line_entry(2026, 21, 101, "owner-a", 3, 200, "Player 200")

    def test_counted_slot_contribution_sums_counted_slots_only(self):
        entry = self.make_entry()
        entry["slots"] = [
            {
                "scoring_period": 154,
                "lineup_slot_id": 12,
                "points": 1.2,
                "raw_stats": {"0": 4},
            },
            {
                "scoring_period": 154,
                "lineup_slot_id": 16,
                "points": 6.0,
                "raw_stats": {"0": 8},
            },
            {
                "scoring_period": 155,
                "lineup_slot_id": 12,
                "points": -0.4,
                "raw_stats": {"0": 1},
            },
        ]
        points, stats = counted_slot_contribution(entry, 154)
        self.assertEqual(points, 1.2)
        self.assertEqual(stats, {"0": 4})
        points, stats = counted_slot_contribution(entry, 155)
        self.assertEqual(points, -0.4)

    def test_counted_slot_contribution_handles_missing_entry(self):
        self.assertEqual(counted_slot_contribution(None, 154), (0.0, {}))

    def test_counted_slot_days_ignores_bench_and_ir(self):
        entry = self.make_entry()
        entry["slots"] = [
            {
                "scoring_period": 154,
                "lineup_slot_id": 12,
                "points": 1.0,
                "raw_stats": {},
            },
            {
                "scoring_period": 155,
                "lineup_slot_id": 17,
                "points": 0.0,
                "raw_stats": {},
            },
        ]
        self.assertEqual(counted_slot_days(entry), {154})
        self.assertEqual(counted_slot_days(None), set())

    def test_merge_residual_into_slot_folds_points_and_stats(self):
        entry = self.make_entry()
        entry["slots"] = [
            {
                "scoring_period": 154,
                "lineup_slot_id": 12,
                "points": 2.0,
                "raw_stats": {"0": 4},
            }
        ]
        merge_residual_into_slot(entry, 154, -0.5, {"0": -1, "27": 1})
        slot = entry["slots"][0]
        self.assertEqual(slot["points"], 1.5)
        self.assertEqual(slot["raw_stats"], {"0": 3, "27": 1})

    def test_merge_residual_into_slot_skips_bench(self):
        entry = self.make_entry()
        entry["slots"] = [
            {
                "scoring_period": 154,
                "lineup_slot_id": 16,
                "points": 1.0,
                "raw_stats": {},
            }
        ]
        # Only a bench slot on that day: nothing counted to merge into.
        merge_residual_into_slot(entry, 154, 1.0, {"0": 1})
        self.assertEqual(entry["slots"][0]["points"], 1.0)


class RetroRevisionTests(AdvanceResolutionTestBase):
    def test_same_horizon_revision_folds_into_last_covered_day(self):
        """A cumulative that advances WITHOUT new coverage (an overnight stat
        correction between captures) is a pure revision: its baseline is the
        snapshot the slots already reconcile to, so subtracting the span day's
        slot would strip that day's production. The revision must fold into
        the last covered day exactly once."""
        self._tmp.cleanup()
        self._tmp = tempfile.TemporaryDirectory()
        normalize.RAW_DIR = Path(self._tmp.name)
        normalize._view_cache.clear()
        payloads = week_payloads()
        # Period 160: same pbsp horizon as 159, cumulative revised +0.2 for
        # player 200 (1.4 -> 1.6, raw counts unchanged), rsc empty (pre-game).
        payloads[160] = build_payload(
            160,
            side(
                HOME_TEAM,
                [],
                [
                    rmp_entry(
                        100, 12, 3.0, [cumulative_block(3.0, {"0": 3.0}, {"0": 11})]
                    ),
                    rmp_entry(
                        200, 12, 1.6, [cumulative_block(1.6, {"0": 1.6}, {"0": 17})]
                    ),
                    rmp_entry(
                        300, 12, 3.0, [cumulative_block(3.0, {"0": 3.0}, {"0": 6})]
                    ),
                ],
                7.6,
                {
                    "153": 3.0,
                    "154": 3.2,
                    "155": 5.4,
                    "156": -2.5,
                    "157": -1.8,
                    "158": 0.1,
                },
            ),
            side(AWAY_TEAM, [], [], 0.0, {}),
        )
        write_week(Path(self._tmp.name), payloads)
        lines = normalize.build_box_scores(
            YEAR,
            PERIODS + [160],
            self.owner_map,
            self.registry,
            anchor_to_snapshots=True,
        )
        twoway = slots_by_day(self.lines_for(lines, 200))
        # -0.4 with the +0.2 revision folded in exactly once.
        self.assertAlmostEqual(twoway[158]["points"], -0.2, places=6)
        line = self.lines_for(lines, 200)
        self.assertAlmostEqual(line["total_points"], 1.6, places=6)
        self.assertAlmostEqual(
            sum(s["points"] for s in line["slots"]), line["total_points"], places=6
        )


class IlActivationTests(AdvanceResolutionTestBase):
    def test_activation_residual_respects_il_rows(self):
        """A player IL'd in the pre-week capture (slot-17 marker row) whose
        activation production reaches the archive only through the cumulative:
        the residual must land on a slot-less day (the activation day), never
        clobber the IL marker, and never carry a bench/IR label (the anchor
        would double-count it as bench production on top of the snapshot)."""
        self._tmp.cleanup()
        self._tmp = tempfile.TemporaryDirectory()
        normalize.RAW_DIR = Path(self._tmp.name)
        normalize._view_cache.clear()
        il_player = 400
        il_rmp = rmp_entry(
            il_player, 0, 1.0, [cumulative_block(1.0, {"0": 1.0}, {"0": 2})]
        )
        payloads = {}
        payloads[153] = build_payload(
            153,
            side(
                HOME_TEAM,
                [rsc_entry(il_player, 17, 0.0, [])],
                [],
                0.0,
                {},
            ),
            side(AWAY_TEAM, [], [], 0.0, {}),
        )
        for period in range(154, 158):
            payloads[period] = build_payload(
                period,
                side(
                    HOME_TEAM,
                    batched_week_rsc(period),
                    BATCH_RMP_ENTRIES + [il_rmp],
                    10.1,
                    {"153": 4.0, "154": 3.2, "155": 5.4, "156": -2.5},
                ),
                side(AWAY_TEAM, [], [], 0.0, {}),
            )
        payloads[158] = build_payload(
            158,
            side(
                HOME_TEAM,
                [rsc_entry(100, 12, 0.5, [day_block(158, 0.5, {"0": 0.5}, {"0": 2})])],
                [
                    rmp_entry(
                        100, 12, 2.5, [cumulative_block(2.5, {"0": 2.5}, {"0": 9})]
                    ),
                    rmp_entry(
                        200, 12, 1.8, [cumulative_block(1.8, {"0": 1.8}, {"0": 13})]
                    ),
                    rmp_entry(
                        300, 12, 3.0, [cumulative_block(3.0, {"0": 3.0}, {"0": 6})]
                    ),
                    il_rmp,
                ],
                8.3,
                {"153": 4.0, "154": 3.2, "155": 5.4, "156": -2.5, "157": -1.8},
            ),
            side(AWAY_TEAM, [], [], 0.0, {}),
        )
        payloads[159] = build_payload(
            159,
            side(
                HOME_TEAM,
                [],
                [
                    rmp_entry(
                        100, 12, 3.0, [cumulative_block(3.0, {"0": 3.0}, {"0": 11})]
                    ),
                    rmp_entry(
                        200, 12, 1.4, [cumulative_block(1.4, {"0": 1.4}, {"0": 17})]
                    ),
                    rmp_entry(
                        300, 12, 3.0, [cumulative_block(3.0, {"0": 3.0}, {"0": 6})]
                    ),
                    il_rmp,
                ],
                8.4,
                {
                    "153": 4.0,
                    "154": 3.2,
                    "155": 5.4,
                    "156": -2.5,
                    "157": -1.8,
                    "158": 0.1,
                },
            ),
            side(AWAY_TEAM, [], [], 0.0, {}),
        )
        write_week(Path(self._tmp.name), payloads)
        lines = self.build(anchor_to_snapshots=True)
        il_line = self.lines_for(lines, il_player)
        slots = slots_by_day(il_line)
        # IL marker intact on 153; production on the activation day, counted.
        self.assertEqual(slots[153]["lineup_slot_id"], 17)
        self.assertEqual(slots[153]["points"], 0.0)
        self.assertEqual(slots[154]["points"], 1.0)
        self.assertNotEqual(slots[154]["lineup_slot_id"], 17)
        # No bench double-count: total == the cumulative snapshot alone.
        self.assertAlmostEqual(il_line["total_points"], 1.0, places=6)
        self.assertAlmostEqual(
            sum(s["points"] for s in il_line["slots"]),
            il_line["total_points"],
            places=6,
        )


class FlushTests(AdvanceResolutionTestBase):
    def test_unresolved_span_flush_lands_on_uncovered_day(self):
        """An archive that ends mid-span (the resolution period never
        appeared) flushes the advance's residual to the span's earliest
        uncovered day instead of dropping the production."""
        self._tmp.cleanup()
        self._tmp = tempfile.TemporaryDirectory()
        normalize.RAW_DIR = Path(self._tmp.name)
        normalize._view_cache.clear()
        payloads = {}
        payloads[153] = week_payloads()[153]
        for period in (154, 155):
            payloads[period] = week_payloads()[period]
        write_week(Path(self._tmp.name), payloads)
        lines = self.build(anchor_to_snapshots=True)
        twoway = slots_by_day(self.lines_for(lines, 200))
        # Delta 3.6 minus the emitted 154/155 slots (1.2 + 4.4) = -2.0.
        self.assertAlmostEqual(twoway[153]["points"], -2.0, places=6)
        line = self.lines_for(lines, 200)
        # Anchored to the last seen snapshot; slots reconcile to it.
        self.assertAlmostEqual(line["total_points"], 3.6, places=6)
        self.assertAlmostEqual(
            sum(s["points"] for s in line["slots"]), line["total_points"], places=6
        )


if __name__ == "__main__":
    unittest.main()
