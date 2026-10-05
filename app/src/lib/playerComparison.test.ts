import { describe, expect, it } from "vitest";
import {
	buildComparisonIndex,
	comparePlayerSeason,
	compareTradeSides,
	computeLetterGrade,
	computePlayoffSplit,
	computeWeeklyConsistency,
	isFairTrade,
	type ComparisonIndex,
} from "./playerComparison";
import type { BoxScoreEntry, DraftPick, PlayerSeason, PlayerSeasonPoints } from "../types";

function points(playerId: number, year: number, value: number): PlayerSeasonPoints {
	return { year, player_id: playerId, player_name: `Player ${playerId}`, points: value };
}

function playerSeason(playerId: number, year: number, defaultPositionId = 3): PlayerSeason {
	return {
		year,
		player_id: playerId,
		player_name: `Player ${playerId}`,
		eligible_slots: [],
		games_played_by_position: { "3": 150 },
		default_position_id: defaultPositionId,
		jersey: null,
		injury_status: null,
		injured: null,
		pro_team_id: null,
	};
}

function pick(playerId: number, year: number, overall: number): DraftPick {
	return {
		year,
		overall_pick_number: overall,
		round_id: Math.ceil(overall / 10),
		round_pick_number: ((overall - 1) % 10) + 1,
		espn_team_id: 1,
		owner_id: "owner-1",
		player_id: playerId,
		player_name: `Player ${playerId}`,
		keeper: false,
		traded_pick: false,
		traded_from_espn_team_id: null,
		pro_team_id: null,
	};
}

function boxEntry(playerId: number, year: number, week: number, total: number): BoxScoreEntry {
	return {
		year,
		week,
		matchup_id: 1,
		owner_id: "owner-1",
		espn_team_id: 1,
		player_id: playerId,
		player_name: `Player ${playerId}`,
		total_points: total,
		batting: null,
		pitching: null,
		slots: [],
	};
}

function season(year: number, regularSeasonWeeks: number) {
	return { year, regular_season_weeks: regularSeasonWeeks };
}

/** Four players in 2024 at 100/200/300/400 points, one drafted 1st overall. */
function makeIndex(): ComparisonIndex {
	return buildComparisonIndex(
		[points(1, 2024, 100), points(2, 2024, 200), points(3, 2024, 300), points(4, 2024, 400)],
		[playerSeason(1, 2024), playerSeason(2, 2024), playerSeason(3, 2024), playerSeason(4, 2024)],
		[pick(1, 2024, 1), pick(4, 2024, 100)],
		[season(2024, 21)]
	);
}

const seasonStats = new Map([[2024, { year: 2024, mean: 250, stdev: 100, count: 4 }]]);
const positionStats = new Map<string, never>();

describe("computeWeeklyConsistency", () => {
	it("computes mean, stdev, and CV across weeks", () => {
		const result = computeWeeklyConsistency([
			boxEntry(1, 2024, 1, 10),
			boxEntry(1, 2024, 2, 20),
			boxEntry(1, 2024, 3, 30),
		])!;
		expect(result.weeks).toBe(3);
		expect(result.mean).toBe(20);
		expect(result.stdev).toBeCloseTo(8.1650, 4);
		expect(result.cv).toBeCloseTo(0.4082, 4);
	});

	it("sums multiple lines within the same week", () => {
		const result = computeWeeklyConsistency([
			boxEntry(1, 2024, 1, 10),
			boxEntry(1, 2024, 1, 5),
			boxEntry(1, 2024, 2, 15),
		])!;
		expect(result.weeks).toBe(2);
		// Both weeks total 15, so mean is 15 AND stdev is 0 — asserting only the
		// mean would pass for an implementation that took the median or dropped
		// the duplicate line.
		expect(result.mean).toBe(15);
		expect(result.stdev).toBe(0);
		expect(result.cv).toBe(0);
	});

	it("returns null for a season with fewer than two scored weeks", () => {
		expect(computeWeeklyConsistency([boxEntry(1, 2024, 1, 10)])).toBeNull();
		expect(computeWeeklyConsistency([])).toBeNull();
	});

	it("reports a steadier player as having a lower CV", () => {
		const steady = computeWeeklyConsistency([boxEntry(1, 2024, 1, 20), boxEntry(1, 2024, 2, 20)])!;
		const streaky = computeWeeklyConsistency([boxEntry(1, 2024, 1, 0), boxEntry(1, 2024, 2, 40)])!;
		expect(steady.mean).toBe(streaky.mean);
		expect(steady.cv).toBeLessThan(streaky.cv);
	});
});

describe("computePlayoffSplit", () => {
	it("splits on the season's own regular-season length", () => {
		const entries = [
			boxEntry(1, 2024, 20, 10),
			boxEntry(1, 2024, 21, 20),
			boxEntry(1, 2024, 22, 30),
			boxEntry(1, 2024, 23, 40),
		];
		const split = computePlayoffSplit(entries, 21)!;
		expect(split.regularSeasonPoints).toBe(30);
		expect(split.playoffPoints).toBe(70);
		expect(split.regularSeasonWeeks).toBe(2);
		expect(split.playoffWeeks).toBe(2);
	});

	it("respects a shortened season rather than a hardcoded cutoff", () => {
		// 2020 ran 8 regular-season weeks; week 9 is playoffs, not week 22.
		const entries = [boxEntry(1, 2020, 8, 50), boxEntry(1, 2020, 9, 60)];
		const split = computePlayoffSplit(entries, 8)!;
		expect(split.regularSeasonPoints).toBe(50);
		expect(split.playoffPoints).toBe(60);
	});

	it("returns null when there are no entries at all", () => {
		expect(computePlayoffSplit([], 21)).toBeNull();
	});
});

describe("comparePlayerSeason", () => {
	it("resolves points, percentile, and z-score for a known season", () => {
		const result = comparePlayerSeason({ playerId: 4, year: 2024 }, makeIndex(), seasonStats, positionStats);
		expect(result.points).toBe(400);
		expect(result.percentile).toBe(100);
		expect(result.zscore).toBeCloseTo(1.5, 5);
	});

	it("returns nulls rather than zeros for a player-season with no data", () => {
		const result = comparePlayerSeason({ playerId: 99, year: 2024 }, makeIndex(), seasonStats, positionStats);
		expect(result.points).toBeNull();
		expect(result.zscore).toBeNull();
		expect(result.percentile).toBeNull();
		expect(result.draftPosition).toBeNull();
	});

	it("scores a late pick who produced as a positive draft value", () => {
		// Player 4: 100th of 100 picks (0th percentile of capital), 100th percentile of production.
		const result = comparePlayerSeason({ playerId: 4, year: 2024 }, makeIndex(), seasonStats, positionStats);
		expect(result.draftPosition).toBe(100);
		expect(result.draftValueOverReplacement).toBeCloseTo(100, 5);
	});

	it("measures draft capital against the full board, matching production data", () => {
		// The real archive numbers all 300 slots per year: keepers take 1-50, live
		// picks 51-300. Pairing that numerator with a live-only denominator (250)
		// would put the last pick at -20%, so the denominator must be the full board.
		const index = buildComparisonIndex(
			[points(1, 2024, 100), points(2, 2024, 400)],
			[playerSeason(1, 2024), playerSeason(2, 2024)],
			[pick(1, 2024, 51), pick(2, 2024, 300)],
			[season(2024, 21)]
		);
		const lastPick = comparePlayerSeason({ playerId: 2, year: 2024 }, index, seasonStats, positionStats);
		expect(lastPick.draftValueOverReplacement).toBeGreaterThanOrEqual(0);
		expect(lastPick.draftValueOverReplacement).toBeLessThanOrEqual(100);

		const earlyLivePick = comparePlayerSeason({ playerId: 1, year: 2024 }, index, seasonStats, positionStats);
		expect(earlyLivePick.draftValueOverReplacement).toBeGreaterThanOrEqual(-100);
		expect(earlyLivePick.draftValueOverReplacement).toBeLessThanOrEqual(0);
	});

	it("scores a 1st-overall pick who busted as a negative draft value", () => {
		// Player 1: 1st of 100 picks (99th percentile of capital), 0th percentile of production.
		const result = comparePlayerSeason({ playerId: 1, year: 2024 }, makeIndex(), seasonStats, positionStats);
		expect(result.draftPosition).toBe(1);
		expect(result.draftValueOverReplacement).toBeCloseTo(-99, 5);
	});

	it("leaves weekly dimensions null outside box-score coverage", () => {
		const result = comparePlayerSeason({ playerId: 4, year: 2024 }, makeIndex(), seasonStats, positionStats);
		expect(result.weeklyConsistency).toBeNull();
		expect(result.playoffSplit).toBeNull();
	});

	it("fills weekly dimensions when box scores are supplied", () => {
		const boxScores = [boxEntry(4, 2024, 1, 10), boxEntry(4, 2024, 2, 30), boxEntry(4, 2024, 22, 25)];
		const result = comparePlayerSeason({ playerId: 4, year: 2024 }, makeIndex(), seasonStats, positionStats, boxScores);
		expect(result.weeklyConsistency!.weeks).toBe(3);
		expect(result.playoffSplit!.regularSeasonPoints).toBe(40);
		expect(result.playoffSplit!.playoffPoints).toBe(25);
	});

	it("ignores other players' box-score lines", () => {
		const boxScores = [boxEntry(4, 2024, 1, 10), boxEntry(1, 2024, 1, 999)];
		const result = comparePlayerSeason({ playerId: 4, year: 2024 }, makeIndex(), seasonStats, positionStats, boxScores);
		expect(result.weeklyConsistency).toBeNull(); // only one week for player 4
		expect(result.playoffSplit!.regularSeasonPoints).toBe(10);
	});
});

describe("computeLetterGrade", () => {
	it("grades from side A's perspective", () => {
		expect(computeLetterGrade(200, 100)).toBe("A+"); // +100%
		expect(computeLetterGrade(130, 100)).toBe("A"); // +30%
		expect(computeLetterGrade(115, 100)).toBe("B"); // +15%
		expect(computeLetterGrade(105, 100)).toBe("C"); // +5%
		expect(computeLetterGrade(100, 100)).toBe("C");
	});

	it("mirrors the scale when the sides are swapped", () => {
		expect(computeLetterGrade(100, 200)).toBe("F");
		expect(computeLetterGrade(100, 115)).toBe("D");
		expect(computeLetterGrade(100, 105)).toBe("C");
	});

	it("measures the margin against the smaller side", () => {
		// 150 vs 100 is +50% of the smaller side, not +33% of the larger.
		expect(computeLetterGrade(150, 100)).toBe("A");
		expect(computeLetterGrade(151, 100)).toBe("A+");
	});

	it("handles a side that scored nothing without dividing by zero", () => {
		expect(computeLetterGrade(100, 0)).toBe("A+");
		expect(computeLetterGrade(0, 100)).toBe("F");
		expect(computeLetterGrade(0, 0)).toBe("C");
	});

	it("grades the 25-50%-less band the spec originally left undefined", () => {
		// -33%: worse than D's floor but better than the old ">50% less" F.
		expect(computeLetterGrade(300, 400)).toBe("F");
		expect(computeLetterGrade(80, 100)).toBe("D"); // -20%, still D
		expect(computeLetterGrade(74, 100)).toBe("F"); // -26%, past D's floor
	});

	it("leaves no ratio ungraded across the whole scale", () => {
		for (let a = 0; a <= 300; a += 5) {
			expect(["A+", "A", "B", "C", "D", "F"]).toContain(computeLetterGrade(a, 100));
		}
	});
});

describe("isFairTrade", () => {
	it("calls a trade within 10% fair", () => {
		expect(isFairTrade(100, 100)).toBe(true);
		expect(isFairTrade(110, 100)).toBe(true);
		expect(isFairTrade(100, 110)).toBe(true);
	});

	it("calls a lopsided trade unfair", () => {
		expect(isFairTrade(200, 100)).toBe(false);
		expect(isFairTrade(100, 200)).toBe(false);
	});

	it("treats two empty sides as fair and one empty side as not", () => {
		expect(isFairTrade(0, 0)).toBe(true);
		expect(isFairTrade(100, 0)).toBe(false);
	});
});

describe("compareTradeSides", () => {
	it("sums a package rather than averaging it", () => {
		const result = compareTradeSides(
			[{ playerId: 1, year: 2024 }, { playerId: 2, year: 2024 }],
			[{ playerId: 4, year: 2024 }],
			makeIndex(),
			seasonStats,
			positionStats
		);
		expect(result.sideA).toHaveLength(2);
		expect(result.aggregate.sideAPoints).toBe(300); // 100 + 200
		expect(result.aggregate.sideBPoints).toBe(400);
		expect(result.aggregate.letterGrade).toBe("F"); // -33% against the smaller side
	});

	it("reports a balanced 1v1 as fair", () => {
		const result = compareTradeSides(
			[{ playerId: 3, year: 2024 }],
			[{ playerId: 3, year: 2024 }],
			makeIndex(),
			seasonStats,
			positionStats
		);
		expect(result.aggregate.surplusZscore).toBe(0);
		expect(result.aggregate.isFair).toBe(true);
		expect(result.aggregate.letterGrade).toBe("C");
	});

	it("keeps unrankable players on the side, contributing zero", () => {
		const result = compareTradeSides(
			[{ playerId: 4, year: 2024 }, { playerId: 99, year: 2024 }],
			[{ playerId: 4, year: 2024 }],
			makeIndex(),
			seasonStats,
			positionStats
		);
		expect(result.sideA).toHaveLength(2);
		expect(result.aggregate.sideAPoints).toBe(400);
		expect(result.aggregate.surplusZscore).toBe(0);
	});

	it("handles an empty side without producing NaN", () => {
		const result = compareTradeSides(
			[{ playerId: 4, year: 2024 }],
			[],
			makeIndex(),
			seasonStats,
			positionStats
		);
		expect(result.aggregate.sideBPoints).toBe(0);
		expect(Number.isNaN(result.aggregate.surplusZscore)).toBe(false);
		expect(result.aggregate.letterGrade).toBe("A+");
	});
});
