import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getJerseyHistory, getPlayerSeasonPositions } from "./playerPositions";
import type { DraftPick, MlbTeam, PlayerSeason } from "../types";

const appDir = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

function readProcessed<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(appDir, "public/data", name), "utf-8")) as T;
}

function makePlayerSeason(
  year: number,
  playerId: number,
  eligibleSlots: number[],
  gamesPlayedByPosition: Record<string, number>,
  defaultPositionId: number
): PlayerSeason {
  return {
    year,
    player_id: playerId,
    player_name: "Test Player",
    eligible_slots: eligibleSlots,
    games_played_by_position: gamesPlayedByPosition,
    default_position_id: defaultPositionId,
    jersey: null,
    injury_status: null,
    injured: null,
    pro_team_id: null,
  };
}

// Real player_seasons.json rows (Ben Rice, player_id 5016968) -- catcher
// (position id 2) eligibility carries from 2025's 36 games into 2026 despite
// zero 2026 catcher games.
const BEN_RICE_SEASONS: PlayerSeason[] = [
  makePlayerSeason(2024, 5016968, [0, 1, 7, 12, 16, 17, 19], { "2": 1, "3": 49 }, 3),
  makePlayerSeason(2025, 5016968, [0, 1, 7, 11, 12, 16, 17, 19], { "2": 36, "3": 50, "10": 48, "12": 15 }, 3),
  makePlayerSeason(2026, 5016968, [0, 1, 7, 11, 12, 16, 17, 19], { "3": 53, "10": 50, "12": 6 }, 3),
];

// Real player_seasons.json rows (Ryan Zimmerman, player_id 6389) -- LF
// (position id 7) eligibility carries from 2014's 30 games into 2015, then
// lapses in 2016 (2015 only logged 1 LF game, not enough to carry forward again).
const ZIMMERMAN_SEASONS: PlayerSeason[] = [
  makePlayerSeason(2014, 6389, [3, 5, 7, 8, 12, 16, 17, 19], { "3": 5, "5": 23, "7": 30, "10": 2 }, 5),
  makePlayerSeason(2015, 6389, [1, 3, 5, 7, 8, 12, 16, 17, 19], { "3": 93, "7": 1 }, 5),
  makePlayerSeason(2016, 6389, [1, 7, 12, 16, 17, 19], { "3": 114, "10": 1 }, 3),
];

describe("getPlayerSeasonPositions -- eligible", () => {
  it("keeps catcher eligible in 2026 despite zero 2026 catcher games, carried from 2025's 36 games", () => {
    const positions = getPlayerSeasonPositions(5016968, BEN_RICE_SEASONS);
    const byYear = new Map(positions.map(p => [p.year, p]));

    // eligible trusts ESPN's own eligible_slots wholesale, including this
    // 2024 case (only 1 catcher game, but already ESPN-eligible -- exactly
    // the "far more loosely granted" behavior playerPositions.ts's `played`
    // deliberately avoids, but which is correct for real fantasy slotting).
    expect(byYear.get(2024)?.eligible).toContain(2);
    expect(byYear.get(2025)?.eligible).toContain(2); // C -- 36 games this season
    expect(byYear.get(2026)?.eligible).toContain(2); // C -- carried over, 0 games this season
  });

  it("keeps LF eligible in 2014 and 2015 but not 2016", () => {
    const positions = getPlayerSeasonPositions(6389, ZIMMERMAN_SEASONS);
    const byYear = new Map(positions.map(p => [p.year, p]));

    expect(byYear.get(2014)?.eligible).toContain(7); // LF -- 30 games this season
    expect(byYear.get(2015)?.eligible).toContain(7); // LF -- carried over, only 1 game this season
    expect(byYear.get(2016)?.eligible).not.toContain(7); // LF -- eligibility lapsed
  });

  it("does not disturb played/secondary/allAppearances, which stay games-derived only", () => {
    const positions = getPlayerSeasonPositions(5016968, BEN_RICE_SEASONS);
    const season2026 = positions.find(p => p.year === 2026);

    // eligible carries catcher into 2026, but played/allAppearances must not,
    // since they answer a different, games-actually-played question.
    expect(season2026?.eligible).toContain(2);
    expect(season2026?.played.some(p => p.positionId === 2)).toBe(false);
    expect(season2026?.allAppearances.some(p => p.positionId === 2)).toBe(false);
  });
});

describe("getJerseyHistory", () => {
  it("shows Kyle Schwarber on the Cubs in 2020, not the Nationals", () => {
    const playerId = 33712;
    const playerSeasons = readProcessed<PlayerSeason[]>("player_seasons.json").filter(
      ps => ps.player_id === playerId
    );
    const draftPicks = readProcessed<DraftPick[]>("draft_picks.json").filter(
      dp => dp.player_id === playerId
    );
    const mlbTeams = readProcessed<MlbTeam[]>("mlb_teams.json");

    const seasonPositions = getPlayerSeasonPositions(playerId, playerSeasons);
    const proTeamIdByYear = new Map(
      draftPicks.map(dp => [dp.year, dp.pro_team_id as number])
    );
    const mlbTeamById = new Map(mlbTeams.map(t => [t.pro_team_id, t]));
    const runs = getJerseyHistory(seasonPositions, proTeamIdByYear, mlbTeamById);

    const run2020 = runs.find(r => r.startYear <= 2020 && r.endYear >= 2020);
    expect(run2020).toBeDefined();
    expect(run2020?.proTeamId).toBe(16); // Chicago Cubs
    expect(run2020?.abbrev).toBe("CHC");
  });
});
