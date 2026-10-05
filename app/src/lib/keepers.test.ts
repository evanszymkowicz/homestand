import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getActiveStreaks,
  getKeeperHeatIndex,
  getKeeperPointsByOwner,
  getKeeperPointsByPlayer,
  getKeepersByFranchise,
  getLongestKeptAnyOwner,
  getLongestKeptSameOwner,
  getLongestKeptSameTeamSlot,
  getMostPlayedNeverKept,
  heatIndexBackground,
} from "./keepers";
import type { RenumberedPick } from "./draft";
import { buildSeasonPercentiles } from "./stats";
import type { Keeper, MlbTeam, Owner, Player, PlayerSeasonPoints } from "../types";

function makeRenumberedPick(
  overrides: Partial<RenumberedPick> & Pick<RenumberedPick, "year" | "player_id" | "live_round">
): RenumberedPick {
  return {
    overall_pick_number: overrides.live_round,
    round_id: overrides.live_round,
    round_pick_number: 1,
    espn_team_id: 1,
    owner_id: "owner-a",
    player_name: `Player ${overrides.player_id}`,
    keeper: false,
    traded_pick: false,
    traded_from_espn_team_id: null,
    pro_team_id: 1,
    live_overall_pick: overrides.live_round,
    ...overrides,
  };
}

function makeOwner(id: string): Owner {
  return {
    owner_id: id,
    canonical_name: id,
    team_names_by_year: {},
    espn_member_keys: [],
    co_owners: [],
    last_active_year: 0,
    absent_from_latest_season: false,
  };
}

const OWNERS: Owner[] = [makeOwner("owner-a"), makeOwner("owner-b"), makeOwner("owner-c")];

function makeKeeper(overrides: Partial<Keeper> & Pick<Keeper, "year" | "player_id" | "owner_id">): Keeper {
  return {
    espn_team_id: 1,
    player_name: `Player ${overrides.player_id}`,
    round_id: 1,
    overall_pick_number: 1,
    validated_on_prior_roster: true,
    pro_team_id: 1,
    ...overrides,
  };
}

describe("getLongestKeptSameOwner / getLongestKeptSameTeamSlot", () => {
  it("runs a contiguous streak, breaking on a gap year", () => {
    const keepers: Keeper[] = [
      makeKeeper({ year: 2019, player_id: 1, owner_id: "owner-a", espn_team_id: 1 }),
      makeKeeper({ year: 2020, player_id: 1, owner_id: "owner-a", espn_team_id: 1 }),
      // gap at 2021
      makeKeeper({ year: 2022, player_id: 1, owner_id: "owner-a", espn_team_id: 1 }),
    ];
    const streaks = getLongestKeptSameOwner(keepers, OWNERS);
    expect(streaks).toHaveLength(2);
    expect(streaks[0]).toMatchObject({ startYear: 2019, endYear: 2020, length: 2, ownershipTransferred: false });
    expect(streaks[1]).toMatchObject({ startYear: 2022, endYear: 2022, length: 1 });
  });

  it("diverges the two variants when a team slot changes owners mid-streak", () => {
    const keepers: Keeper[] = [
      makeKeeper({ year: 2019, player_id: 1, owner_id: "owner-a", espn_team_id: 1 }),
      makeKeeper({ year: 2020, player_id: 1, owner_id: "owner-b", espn_team_id: 1 }),
      makeKeeper({ year: 2021, player_id: 1, owner_id: "owner-b", espn_team_id: 1 }),
    ];

    const byOwner = getLongestKeptSameOwner(keepers, OWNERS);
    expect(byOwner).toHaveLength(2);
    const ownerA = byOwner.find(s => s.owners[0].ownerId === "owner-a");
    const ownerB = byOwner.find(s => s.owners[0].ownerId === "owner-b");
    expect(ownerA).toMatchObject({ length: 1, ownershipTransferred: false });
    expect(ownerB).toMatchObject({ length: 2, ownershipTransferred: false });

    const bySlot = getLongestKeptSameTeamSlot(keepers, OWNERS);
    expect(bySlot).toHaveLength(1);
    expect(bySlot[0]).toMatchObject({ startYear: 2019, endYear: 2021, length: 3, ownershipTransferred: true });
    expect(bySlot[0].owners.map(o => o.ownerId)).toEqual(["owner-a", "owner-b"]);
  });

  it("does not extend a same-team-slot streak across a different player on the same slot", () => {
    const keepers: Keeper[] = [
      makeKeeper({ year: 2019, player_id: 1, owner_id: "owner-a", espn_team_id: 1 }),
      makeKeeper({ year: 2020, player_id: 2, owner_id: "owner-a", espn_team_id: 1 }),
    ];
    const bySlot = getLongestKeptSameTeamSlot(keepers, OWNERS);
    expect(bySlot).toHaveLength(2);
    expect(bySlot.every(s => s.length === 1)).toBe(true);
  });
});

describe("getLongestKeptAnyOwner", () => {
  it("does not break the streak across a trade or ownership transfer, unlike the other two variants", () => {
    const keepers: Keeper[] = [
      makeKeeper({ year: 2019, player_id: 1, owner_id: "owner-a", espn_team_id: 1 }),
      makeKeeper({ year: 2020, player_id: 1, owner_id: "owner-b", espn_team_id: 2 }),
      makeKeeper({ year: 2021, player_id: 1, owner_id: "owner-c", espn_team_id: 2 }),
    ];
    const streaks = getLongestKeptAnyOwner(keepers, OWNERS);
    expect(streaks).toHaveLength(1);
    expect(streaks[0]).toMatchObject({ startYear: 2019, endYear: 2021, length: 3, ownershipTransferred: true });
    expect(streaks[0].owners.map(o => o.ownerId)).toEqual(["owner-a", "owner-b", "owner-c"]);
  });

  it("still breaks on a gap year", () => {
    const keepers: Keeper[] = [
      makeKeeper({ year: 2019, player_id: 1, owner_id: "owner-a" }),
      // gap at 2020
      makeKeeper({ year: 2021, player_id: 1, owner_id: "owner-b" }),
    ];
    const streaks = getLongestKeptAnyOwner(keepers, OWNERS);
    expect(streaks).toHaveLength(2);
    expect(streaks.every(s => s.length === 1)).toBe(true);
  });
});

describe("getActiveStreaks", () => {
  it("keeps only streaks ending on the latest keeper year on record", () => {
    const keepers: Keeper[] = [
      makeKeeper({ year: 2019, player_id: 1, owner_id: "owner-a" }),
      makeKeeper({ year: 2020, player_id: 1, owner_id: "owner-a" }),
      makeKeeper({ year: 2018, player_id: 2, owner_id: "owner-b" }),
    ];
    const streaks = getLongestKeptSameOwner(keepers, OWNERS);
    const active = getActiveStreaks(streaks, keepers);
    expect(active).toHaveLength(1);
    expect(active[0].playerId).toBe(1);
  });
});

describe("getKeeperPointsByOwner / getKeeperPointsByPlayer", () => {
  const keepers: Keeper[] = [
    makeKeeper({ year: 2019, player_id: 1, owner_id: "owner-a" }),
    makeKeeper({ year: 2020, player_id: 1, owner_id: "owner-b" }),
  ];
  const seasonPoints: PlayerSeasonPoints[] = [
    { year: 2019, player_id: 1, player_name: "Player 1", points: 100 },
    { year: 2020, player_id: 1, player_name: "Player 1", points: 50 },
  ];

  it("sums each owner's keeper-seasons, including owners with no keepers", () => {
    const byOwner = getKeeperPointsByOwner(keepers, seasonPoints, OWNERS);
    expect(byOwner.find(o => o.owner.ownerId === "owner-a")).toMatchObject({ points: 100, keeperSeasons: 1 });
    expect(byOwner.find(o => o.owner.ownerId === "owner-b")).toMatchObject({ points: 50, keeperSeasons: 1 });
    expect(byOwner.find(o => o.owner.ownerId === "owner-c")).toMatchObject({ points: 0, keeperSeasons: 0 });
  });

  it("counts distinct players per owner, not keeper-seasons", () => {
    const repeated: Keeper[] = [
      makeKeeper({ year: 2019, player_id: 1, owner_id: "owner-a" }),
      makeKeeper({ year: 2020, player_id: 1, owner_id: "owner-a" }),
      makeKeeper({ year: 2020, player_id: 2, owner_id: "owner-a" }),
    ];
    const byOwner = getKeeperPointsByOwner(repeated, seasonPoints, OWNERS);
    expect(byOwner.find(o => o.owner.ownerId === "owner-a")?.uniquePlayers).toBe(2);
    expect(byOwner.find(o => o.owner.ownerId === "owner-c")?.uniquePlayers).toBe(0);
  });

  it("sums a player's total across every owner who ever kept them", () => {
    const byPlayer = getKeeperPointsByPlayer(keepers, seasonPoints);
    expect(byPlayer).toEqual([{ playerId: 1, playerName: "Player 1", points: 150, keeperSeasons: 2, uniqueOwners: 2 }]);
  });

  it("falls back to 0 for a keeper-season with no box-score points on record", () => {
    const noPoints = getKeeperPointsByPlayer([makeKeeper({ year: 2025, player_id: 9, owner_id: "owner-a" })], []);
    expect(noPoints[0].points).toBe(0);
  });
});

function makePlayer(overrides: Partial<Player> & Pick<Player, "player_id" | "full_name">): Player {
  return {
    default_position_id: 1,
    eligible_slots: [],
    games_played_by_position: {},
    active: null,
    pro_team_id: null,
    jersey: null,
    droppable: null,
    seasons_seen: [],
    roster_days: 0,
    ...overrides,
  };
}

describe("getMostPlayedNeverKept", () => {
  const players: Player[] = [
    makePlayer({
      player_id: 1,
      full_name: "Never Kept, Long Career",
      seasons_seen: [2010, 2011, 2012],
      roster_days: 120,
    }),
    makePlayer({ player_id: 2, full_name: "Kept Once", seasons_seen: [2010, 2011, 2012, 2013] }),
    makePlayer({ player_id: 3, full_name: "Never Kept, Short Career", seasons_seen: [2010] }),
  ];
  const keepers: Keeper[] = [makeKeeper({ year: 2013, player_id: 2, owner_id: "owner-a" })];

  it("ranks players never in keepers.json by seasons_seen, excluding anyone ever kept", () => {
    const result = getMostPlayedNeverKept(players, keepers, []);
    expect(result.map(r => r.playerId)).toEqual([1, 3]);
    expect(result[0].seasonsSeen).toBe(3);
  });

  it("carries career points (summed across all seasons) and roster days per player", () => {
    const seasonPoints: PlayerSeasonPoints[] = [
      { year: 2010, player_id: 1, player_name: "Never Kept, Long Career", points: 100 },
      { year: 2011, player_id: 1, player_name: "Never Kept, Long Career", points: 50.5 },
      { year: 2010, player_id: 2, player_name: "Kept Once", points: 999 }, // excluded player, must not leak
    ];
    const result = getMostPlayedNeverKept(players, keepers, seasonPoints);
    expect(result[0]).toMatchObject({ playerId: 1, careerPoints: 150.5, rosterDays: 120 });
    expect(result[1]).toMatchObject({ playerId: 3, careerPoints: 0, rosterDays: 0 });
  });
});

describe("getKeepersByFranchise", () => {
  const mlbTeams: MlbTeam[] = [
    { pro_team_id: 0, abbrev: "FA", name: "Free Agent/No Team On File" },
    { pro_team_id: 10, abbrev: "NYY", name: "New York Yankees" },
  ];

  it("groups by pro_team_id, nests per-player counts, and ranks by total keeper-seasons", () => {
    const keepers: Keeper[] = [
      makeKeeper({ year: 2019, player_id: 1, owner_id: "owner-a", pro_team_id: 10 }),
      makeKeeper({ year: 2020, player_id: 1, owner_id: "owner-a", pro_team_id: 10 }),
      makeKeeper({ year: 2021, player_id: 2, owner_id: "owner-b", pro_team_id: 10 }),
      makeKeeper({ year: 2022, player_id: 3, owner_id: "owner-c", pro_team_id: 0 }),
    ];
    const groups = getKeepersByFranchise(keepers, mlbTeams, OWNERS);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      proTeamId: 10,
      franchiseName: "New York Yankees",
      totalKeeperSeasons: 3,
      isFreeAgent: false,
    });
    expect(groups[0].players.find(p => p.playerId === 1)).toMatchObject({ count: 2, firstYear: 2019, lastYear: 2020 });
    expect(groups[1]).toMatchObject({ proTeamId: 0, isFreeAgent: true, totalKeeperSeasons: 1 });
  });

  it("lists each player's keeper seasons with the owner who kept them that year", () => {
    const keepers: Keeper[] = [
      makeKeeper({ year: 2019, player_id: 1, owner_id: "owner-a", pro_team_id: 10 }),
      makeKeeper({ year: 2020, player_id: 1, owner_id: "owner-b", pro_team_id: 10 }),
    ];
    const groups = getKeepersByFranchise(keepers, mlbTeams, OWNERS);
    const player = groups[0].players.find(p => p.playerId === 1);
    expect(player?.seasons.map(s => ({ year: s.year, ownerId: s.owner.ownerId }))).toEqual([
      { year: 2019, ownerId: "owner-a" },
      { year: 2020, ownerId: "owner-b" },
    ]);
  });
});

describe("getKeeperHeatIndex", () => {
  const positionByPlayerId = new Map([
    [1, "SP"],
    [2, "1B"],
  ]);

  it("computes percentile change vs. the prior season and sorts best-to-worst", () => {
    const keepers: Keeper[] = [
      makeKeeper({ year: 2020, player_id: 1, owner_id: "owner-a" }),
      makeKeeper({ year: 2020, player_id: 2, owner_id: "owner-b" }),
    ];
    const seasonPoints: PlayerSeasonPoints[] = [
      { year: 2019, player_id: 1, player_name: "Player 1", points: 100 },
      { year: 2020, player_id: 1, player_name: "Player 1", points: 150 }, // was tied 50th pctile, now the league's top score
      { year: 2019, player_id: 2, player_name: "Player 2", points: 100 },
      { year: 2020, player_id: 2, player_name: "Player 2", points: 20 }, // was tied 50th pctile, now the league's bottom score
    ];
    const percentiles = buildSeasonPercentiles(seasonPoints);
    const entries = getKeeperHeatIndex(keepers, seasonPoints, positionByPlayerId, new Map(), percentiles, 2020);
    expect(entries.map(e => e.keeper.player_id)).toEqual([1, 2]);
    expect(entries[0].percentileChange).toBeCloseTo(50);
    expect(entries[1].percentileChange).toBeCloseTo(-50);
  });

  it("renders a keeper with no prior-season total as null and sorts it last, not as a fake 0", () => {
    const keepers: Keeper[] = [
      makeKeeper({ year: 2020, player_id: 1, owner_id: "owner-a" }),
      makeKeeper({ year: 2020, player_id: 2, owner_id: "owner-b" }),
    ];
    const seasonPoints: PlayerSeasonPoints[] = [
      { year: 2020, player_id: 1, player_name: "Player 1", points: 10 }, // no 2019 entry at all
      { year: 2019, player_id: 2, player_name: "Player 2", points: 50 },
      { year: 2019, player_id: 99, player_name: "Filler", points: 10 }, // gives 2019 a two-player field to rank within
      { year: 2020, player_id: 2, player_name: "Player 2", points: 40 },
    ];
    const percentiles = buildSeasonPercentiles(seasonPoints);
    const entries = getKeeperHeatIndex(keepers, seasonPoints, positionByPlayerId, new Map(), percentiles, 2020);
    expect(entries[0].keeper.player_id).toBe(2);
    expect(entries[1]).toMatchObject({ priorYearPoints: null, percentileChange: null });
  });

  it("scopes to a single year or, when year is null, every keeper-season ever", () => {
    const keepers: Keeper[] = [
      makeKeeper({ year: 2019, player_id: 1, owner_id: "owner-a" }),
      makeKeeper({ year: 2020, player_id: 1, owner_id: "owner-a" }),
    ];
    expect(getKeeperHeatIndex(keepers, [], positionByPlayerId, new Map(), new Map(), 2019)).toHaveLength(1);
    expect(getKeeperHeatIndex(keepers, [], positionByPlayerId, new Map(), new Map(), null)).toHaveLength(2);
  });

  it("labels each entry with the player's most recent live draft slot at or before the keeper year", () => {
    const keepers: Keeper[] = [makeKeeper({ year: 2021, player_id: 1, owner_id: "owner-a" })];
    const boardsByYear = new Map<number, RenumberedPick[]>([
      [2018, [makeRenumberedPick({ year: 2018, player_id: 1, live_round: 10 })]],
      [2020, [makeRenumberedPick({ year: 2020, player_id: 1, live_round: 4 })]],
      [2021, []],
    ]);
    const entries = getKeeperHeatIndex(keepers, [], positionByPlayerId, boardsByYear, new Map(), 2021);
    // Most recent live pick at or before 2021 is the 2020 one, not the earlier 2018 pick.
    expect(entries[0].originalDraftSlot).toEqual({ year: 2020, round: 4, ownerId: "owner-a", overallPick: 4 });
  });

  it("labels a keeper with no live-draft history as undrafted", () => {
    const keepers: Keeper[] = [makeKeeper({ year: 2021, player_id: 9, owner_id: "owner-a" })];
    const entries = getKeeperHeatIndex(keepers, [], positionByPlayerId, new Map(), new Map(), 2021);
    expect(entries[0].originalDraftSlot).toBeNull();
  });

  it("computes draft ROI from original draft position and actual season percentile", () => {
    const keepers: Keeper[] = [makeKeeper({ year: 2020, player_id: 1, owner_id: "owner-a" })];
    const seasonPoints: PlayerSeasonPoints[] = [
      { year: 2020, player_id: 1, player_name: "Player 1", points: 150 }, // top score -> 100th percentile
      { year: 2020, player_id: 2, player_name: "Player 2", points: 100 },
      { year: 2020, player_id: 3, player_name: "Player 3", points: 50 },
    ];
    const boardsByYear = new Map<number, RenumberedPick[]>([
      [
        2020,
        [
          makeRenumberedPick({ year: 2020, player_id: 3, live_round: 1, live_overall_pick: 1 }),
          makeRenumberedPick({ year: 2020, player_id: 2, live_round: 2, live_overall_pick: 2 }),
          makeRenumberedPick({ year: 2020, player_id: 1, live_round: 3, live_overall_pick: 3 }),
        ],
      ],
    ]);
    const percentiles = buildSeasonPercentiles(seasonPoints);
    const entries = getKeeperHeatIndex(keepers, seasonPoints, positionByPlayerId, boardsByYear, percentiles, 2020);
    // Player 1 was last pick (0th draft-position percentile) and finished 100th percentile -> +100 ROI.
    expect(entries[0].draftRoi).toBeCloseTo(100);
  });

  it("returns null draft ROI when the keeper was undrafted", () => {
    const keepers: Keeper[] = [makeKeeper({ year: 2020, player_id: 1, owner_id: "owner-a" })];
    const seasonPoints: PlayerSeasonPoints[] = [
      { year: 2020, player_id: 1, player_name: "Player 1", points: 100 },
      { year: 2020, player_id: 2, player_name: "Player 2", points: 50 },
    ];
    const percentiles = buildSeasonPercentiles(seasonPoints);
    const entries = getKeeperHeatIndex(keepers, seasonPoints, positionByPlayerId, new Map(), percentiles, 2020);
    expect(entries[0].draftRoi).toBeNull();
  });
});

describe("heatIndexBackground", () => {
  it("is neutral for null and a flat 0-point swing, and picks the diverging pole otherwise", () => {
    expect(heatIndexBackground(null)).toEqual({});
    expect(heatIndexBackground(0)).toEqual({});
    expect(heatIndexBackground(20).backgroundColor).toContain("--color-diverge-pos");
    expect(heatIndexBackground(-20).backgroundColor).toContain("--color-diverge-neg");
  });
});

describe("hand-verification against real processed data", () => {
  // Satisfies the Phase 5 acceptance criterion "keeper-points aggregation
  // verified by hand against at least one known player-season": Jacob deGrom,
  // kept by evan-szymkowicz in 2022, scored 123.8 points that season per
  // data/processed/player_season_points.json -- confirmed by hand 2026-07-19.
  it("credits evan-szymkowicz with deGrom's real 2022 season total for that one keeper-season", () => {
    const appDir = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
    const keepers: Keeper[] = JSON.parse(readFileSync(path.join(appDir, "public/data/keepers.json"), "utf-8"));
    const seasonPoints: PlayerSeasonPoints[] = JSON.parse(
      readFileSync(path.join(appDir, "public/data/player_season_points.json"), "utf-8")
    );

    const degromKeeper = keepers.find(k => k.year === 2022 && k.player_name === "Jacob deGrom");
    expect(degromKeeper).toBeDefined();
    expect(degromKeeper?.owner_id).toBe("evan-szymkowicz");

    const isolated = degromKeeper ? [degromKeeper] : [];
    const byOwner = getKeeperPointsByOwner(isolated, seasonPoints, [makeOwner("evan-szymkowicz")]);
    expect(byOwner[0]).toMatchObject({ points: 123.8, keeperSeasons: 1 });
  });
});
