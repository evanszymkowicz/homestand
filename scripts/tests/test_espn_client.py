#!/usr/bin/env python3
"""Unit tests for scripts/lib/espn_client.py's decided_week_periods() -- the
week -> scoring-period map extract.py's --refresh-decided-weeks uses to
re-fetch just-finished weeks against ESPN's post-revision finals.

Fixtures are synthetic but mirror the real mMatchupScore schedule[] shape
(matchupPeriodId / playoffTierType / winner / per-side pointsByScoringPeriod);
the committed data/raw/2026/mMatchupScore.json is exercised too when present,
giving a full-season regression fixture with decided weeks 1-19 and an
UNDECIDED week 20."""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.espn_client import decided_week_periods, determine_season_status


def game(
    week: int,
    winner: str = "HOME",
    tier: str | None = "NONE",
    periods: tuple[int, ...] = (1, 2, 3),
    game_id: int = 101,
) -> dict[str, object]:
    return {
        "id": game_id,
        "matchupPeriodId": week,
        "playoffTierType": tier,
        "winner": winner,
        "home": {"pointsByScoringPeriod": {str(p): 1.0 for p in periods}},
        "away": {"pointsByScoringPeriod": {str(p): 0.5 for p in periods}},
    }


def matchup_game(
    week: int,
    winner: str = "HOME",
    game_id: int = 101,
) -> dict[str, object]:
    """An mMatchup-style schedule entry (no pointsByScoringPeriod)."""
    return {
        "id": game_id,
        "matchupPeriodId": week,
        "winner": winner,
        "home": {"teamId": 1},
        "away": {"teamId": 2},
    }


def payload(
    *games: dict[str, object], wrapped: bool = False
) -> dict[str, object] | list[dict[str, object]]:
    p = {"schedule": list(games)}
    return [p] if wrapped else p


class DecidedWeekPeriodsTests(unittest.TestCase):
    def test_decided_week_maps_to_its_scoring_days(self):
        result = decided_week_periods(payload(game(20)))
        self.assertEqual(result, {20: {1, 2, 3}})

    def test_undecided_game_disqualifies_whole_week(self):
        result = decided_week_periods(
            payload(game(20, winner="HOME"), game(20, winner="UNDECIDED"))
        )
        self.assertEqual(result, {})

    def test_playoff_tiers_included(self):
        result = decided_week_periods(
            payload(game(21, tier="WINNERS_BRACKET"), game(22, tier="NONE"))
        )
        self.assertEqual(list(result), [21, 22])

    def test_period_union_across_sides_and_games(self):
        g1 = game(20, periods=(146, 147))
        g1["away"]["pointsByScoringPeriod"]["148"] = 0.0
        g2 = game(20, periods=(149,))
        result = decided_week_periods(payload(g1, g2))
        self.assertEqual(result, {20: {146, 147, 148, 149}})

    def test_non_numeric_period_keys_ignored(self):
        g = game(20)
        g["home"]["pointsByScoringPeriod"]["live"] = 9.9
        result = decided_week_periods(payload(g))
        self.assertEqual(result, {20: {1, 2, 3}})

    def test_missing_winner_defaults_to_undecided(self):
        g = game(20)
        del g["winner"]
        self.assertEqual(decided_week_periods(payload(g)), {})

    def test_leagueHistory_list_wrapping_unwrapped(self):
        result = decided_week_periods(payload(game(20), wrapped=True))
        self.assertEqual(result, {20: {1, 2, 3}})

    def test_matchup_fallback_decides_lagging_scoreboard(self):
        """mMatchup can report a winner while mMatchupScore still says UNDECIDED."""
        score = payload(game(24, winner="UNDECIDED", periods=(174, 175, 176)))
        matchup = payload(matchup_game(24, winner="HOME"))
        result = decided_week_periods(score, matchup)
        self.assertEqual(result, {24: {174, 175, 176}})

    def test_matchup_fallback_does_not_add_unknown_weeks(self):
        """A week only in mMatchup cannot contribute periods, so it is ignored."""
        score = payload(game(24, winner="UNDECIDED", game_id=101))
        matchup = payload(matchup_game(25, winner="HOME", game_id=102))
        self.assertEqual(decided_week_periods(score, matchup), {})

    def test_matchup_fallback_still_skips_truly_undecided_weeks(self):
        """If neither view reports a winner, the week stays undecided."""
        score = payload(game(24, winner="UNDECIDED"))
        matchup = payload(matchup_game(24, winner="UNDECIDED"))
        self.assertEqual(decided_week_periods(score, matchup), {})

    def test_empty_and_malformed_payloads(self):
        self.assertEqual(decided_week_periods({}), {})
        self.assertEqual(decided_week_periods({"schedule": None}), {})
        self.assertEqual(decided_week_periods({"schedule": ["junk", 42]}), {})


def settings_payload(current_period: int, total_periods: int) -> dict[str, object]:
    return {
        "status": {"currentMatchupPeriod": current_period},
        "settings": {
            "scheduleSettings": {
                "matchupPeriods": {str(i): [] for i in range(1, total_periods + 1)}
            }
        },
    }


class DetermineSeasonStatusTests(unittest.TestCase):
    def test_in_progress_when_current_period_before_total(self):
        self.assertEqual(
            determine_season_status(settings_payload(20, 24)),
            "in_progress",
        )

    def test_final_when_current_period_after_total(self):
        self.assertEqual(
            determine_season_status(settings_payload(25, 24)),
            "final",
        )

    def test_final_when_current_equals_total_and_all_active_matchups_decided(self):
        matchupscore = payload(
            {
                "matchupPeriodId": 24,
                "winner": "HOME",
                "home": {"teamId": 1},
                "away": {"teamId": 2},
            },
            {
                "matchupPeriodId": 24,
                "winner": "AWAY",
                "home": {"teamId": 3},
                "away": {"teamId": 4},
            },
        )
        self.assertEqual(
            determine_season_status(settings_payload(24, 24), matchupscore),
            "final",
        )

    def test_in_progress_when_current_equals_total_but_active_matchup_undecided(self):
        matchupscore = payload(
            {
                "matchupPeriodId": 24,
                "winner": "HOME",
                "home": {"teamId": 1},
                "away": {"teamId": 2},
            },
            {
                "matchupPeriodId": 24,
                "winner": "UNDECIDED",
                "home": {"teamId": 3},
                "away": {"teamId": 4},
            },
        )
        self.assertEqual(
            determine_season_status(settings_payload(24, 24), matchupscore),
            "in_progress",
        )

    def test_bye_week_treated_as_decided(self):
        matchupscore = payload(
            {
                "matchupPeriodId": 24,
                "winner": "UNDECIDED",
                "home": {"teamId": 1},
                "away": None,
            },
            {
                "matchupPeriodId": 24,
                "winner": "HOME",
                "home": {"teamId": 3},
                "away": {"teamId": 4},
            },
        )
        self.assertEqual(
            determine_season_status(settings_payload(24, 24), matchupscore),
            "final",
        )

    def test_backward_compatible_without_matchupscore(self):
        """Callers that omit matchupscore keep the old settings-only behavior."""
        self.assertEqual(
            determine_season_status(settings_payload(24, 24)),
            "final",
        )
        self.assertEqual(
            determine_season_status(settings_payload(23, 24)),
            "in_progress",
        )


class Committed2026FixtureTests(unittest.TestCase):
    """Regression against the real in-progress season archive."""

    def test_2026_decided_regular_season_weeks(self):
        path = (
            Path(__file__).resolve().parent.parent.parent
            / "data"
            / "raw"
            / "2026"
            / "mMatchupScore.json"
        )
        if not path.exists():
            self.skipTest("data/raw/2026/mMatchupScore.json not available")
        result = decided_week_periods(json.loads(path.read_bytes()))
        self.assertTrue(result)
        # The archive advances as the season progresses (week 20 flipped
        # decided between this test's writing and its first refresh), so pin
        # only what can't drift: the first 19 weeks are long-decided and
        # every listed week carries a plausible day count (~7 days/week).
        self.assertTrue(
            {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19}
            <= set(result)
        )
        for week, periods in result.items():
            self.assertGreaterEqual(len(periods), 6, f"week {week}: {periods}")


if __name__ == "__main__":
    unittest.main()
