import { getRenumberedBoardsByYear } from "./draft";
import { formatRecord } from "./format";
import { buildSeasonPercentiles, draftSlotPercentile } from "./stats";
import type { DraftPick, Matchup, PlayerSeasonPoints, Team, Trade } from "../types";
import type { RenumberedPick } from "./draft";

/** The party behind a recap line: every owner id on the team, plus the ESPN team
 * id for `/season/:year/team/:teamId`. Ids only -- names resolve at render time
 * through `OwnerLink`, as everywhere else in the app, so a co-owned team links
 * each partner instead of one pre-joined string.
 *
 * `ownerIds` is in archive order, which is NOT primary-first: every co-owned row
 * in the archive lists the primary owner last. Do not index into `ownerIds`
 * expecting the primary. */
export interface SeasonRecapParty {
  ownerIds: string[];
  teamId: number;
}

export interface SeasonRecapChampion extends SeasonRecapParty {
  record: string;
  points: number;
}

export interface SeasonRecapBiggestMover extends SeasonRecapParty {
  improvement: number;
  fromRank: number;
  toRank: number;
}

export interface SeasonRecapHighestScoringWeek extends SeasonRecapParty {
  week: number;
  points: number;
}

/** A player moving in a trade, or the bare string "picks" when a side moved
 * draft picks instead. `playerId` is null in that case -- nothing to link. */
export interface SeasonRecapTradeAsset {
  playerId: number | null;
  name: string;
}

export interface SeasonRecapTrade {
  ownerAIds: string[];
  ownerBIds: string[];
  gave: SeasonRecapTradeAsset[];
  received: SeasonRecapTradeAsset[];
}

export interface SeasonRecapBreakoutPlayer {
  playerId: number;
  playerName: string;
  ownerId: string;
  draftPosition: number;
  finalPercentile: number;
  valueShift: number;
}

export interface SeasonRecap {
  year: number;
  champion: SeasonRecapChampion;
  runnerUp: SeasonRecapChampion;
  biggestMover: SeasonRecapBiggestMover | null;
  highestScoringWeek: SeasonRecapHighestScoringWeek;
  notableTrades: SeasonRecapTrade[];
  breakoutPlayers: SeasonRecapBreakoutPlayer[];
}

function teamRecord(team: Team): string {
  return formatRecord(team.overall.wins, team.overall.losses, team.overall.ties);
}

function asChampion(team: Team): SeasonRecapChampion {
  return {
    ownerIds: team.owner_ids,
    teamId: team.espn_team_id,
    record: teamRecord(team),
    points: team.overall.points_for,
  };
}

function findTeamByRank(teams: Team[], rank: number): Team | undefined {
  return teams.find(t => t.final_rank === rank);
}

function findBiggestMover(year: number, teams: Team[]): SeasonRecapBiggestMover | null {
  const currentYearTeams = teams.filter(t => t.year === year);
  const prevYearTeams = teams.filter(t => t.year === year - 1);

  let best: SeasonRecapBiggestMover | null = null;
  for (const team of currentYearTeams) {
    const primaryOwnerId = team.primary_owner_id;
    const prevTeam = prevYearTeams.find(t => t.primary_owner_id === primaryOwnerId);
    if (!prevTeam) continue;
    const improvement = prevTeam.final_rank - team.final_rank;
    if (improvement <= 0) continue;
    if (!best || improvement > best.improvement) {
      best = {
        ownerIds: team.owner_ids,
        teamId: team.espn_team_id,
        improvement,
        fromRank: prevTeam.final_rank,
        toRank: team.final_rank,
      };
    }
  }
  return best;
}

function findHighestScoringWeek(
  year: number,
  matchups: Matchup[],
  teams: Team[]
): SeasonRecapHighestScoringWeek | null {
  let best: { team: Team; week: number; score: number } | null = null;
  for (const m of matchups) {
    if (m.year !== year || m.winner === "UNDECIDED") continue;
    for (const side of [m.home, m.away]) {
      if (!side || side.owner_id === null) continue;
      const team = teams.find(t => t.year === year && t.primary_owner_id === side.owner_id);
      if (!team) continue;
      if (!best || side.score > best.score) {
        best = { team, week: m.week, score: side.score };
      }
    }
  }
  if (!best) return null;
  return {
    ownerIds: best.team.owner_ids,
    teamId: best.team.espn_team_id,
    week: best.week,
    points: best.score,
  };
}

const PICKS_ASSET: SeasonRecapTradeAsset[] = [{ playerId: null, name: "picks" }];

function summarizeTrade(
  trade: Trade,
  year: number,
  yearTeams: Team[],
  points: PlayerSeasonPoints[]
): SeasonRecapTrade | null {
  const teamA = yearTeams.find(t => t.espn_team_id === trade.team_a_espn_team_id);
  const teamB = yearTeams.find(t => t.espn_team_id === trade.team_b_espn_team_id);
  if (!teamA || !teamB) return null;

  const sideA: SeasonRecapTradeAsset[] = [];
  const sideB: SeasonRecapTradeAsset[] = [];
  for (const item of trade.items) {
    if (item.item_type !== "TRADE") continue;
    const row = points.find(r => r.year === year && r.player_id === item.player_id);
    const asset: SeasonRecapTradeAsset = {
      playerId: item.player_id,
      name: row?.player_name ?? `Player ${item.player_id}`,
    };
    if (item.from_espn_team_id === trade.team_a_espn_team_id && item.to_espn_team_id === trade.team_b_espn_team_id) {
      sideA.push(asset);
    } else if (
      item.from_espn_team_id === trade.team_b_espn_team_id &&
      item.to_espn_team_id === trade.team_a_espn_team_id
    ) {
      sideB.push(asset);
    }
  }

  return {
    ownerAIds: teamA.owner_ids,
    ownerBIds: teamB.owner_ids,
    gave: sideA.length > 0 ? sideA : PICKS_ASSET,
    received: sideB.length > 0 ? sideB : PICKS_ASSET,
  };
}

function findBreakoutPlayers(
  year: number,
  boardsByYear: Map<number, RenumberedPick[]>,
  playerSeasonPoints: PlayerSeasonPoints[]
): SeasonRecapBreakoutPlayer[] {
  const yearPicks = boardsByYear.get(year) ?? [];
  if (yearPicks.length === 0) return [];

  const totalPicks = yearPicks.length;
  const percentiles = buildSeasonPercentiles(playerSeasonPoints);
  const entries: SeasonRecapBreakoutPlayer[] = [];

  for (const pick of yearPicks) {
    const pointsRow = playerSeasonPoints.find(r => r.year === year && r.player_id === pick.player_id);
    if (!pointsRow) continue;
    const finalPercentile = percentiles.get(`${year}:${pick.player_id}`);
    if (finalPercentile === undefined) continue;
    // A single-pick board has no percentile range, so the drafter gets the
    // full 100 and nothing can show as value gained.
    const draftPositionPercentile = draftSlotPercentile(totalPicks, pick.live_overall_pick) ?? 100;
    const valueShift = finalPercentile - draftPositionPercentile;
    entries.push({
      playerId: pick.player_id,
      playerName: pick.player_name,
      ownerId: pick.owner_id,
      draftPosition: pick.live_overall_pick,
      finalPercentile,
      valueShift,
    });
  }

  return entries.sort((a, b) => b.valueShift - a.valueShift).slice(0, 3);
}

/** Generate a season recap for a specific year.
 *
 * Takes no `owners`: the recap is built entirely from ids so every owner and
 * player name can resolve to a link at render time. */
export function generateSeasonRecap(
  year: number,
  teams: Team[],
  matchups: Matchup[],
  trades: Trade[],
  playerSeasonPoints: PlayerSeasonPoints[],
  draftPicks: DraftPick[]
): SeasonRecap | null {
  const yearTeams = teams.filter(t => t.year === year);
  const championTeam = findTeamByRank(yearTeams, 1);
  const runnerUpTeam = findTeamByRank(yearTeams, 2);
  if (!championTeam || !runnerUpTeam) return null;

  const highestScoringWeek = findHighestScoringWeek(year, matchups, yearTeams);
  if (!highestScoringWeek) return null;

  const notableTrades = trades
    .filter(t => t.year === year)
    .map(t => summarizeTrade(t, year, yearTeams, playerSeasonPoints))
    .filter((t): t is SeasonRecapTrade => t !== null);

  const boardsByYear = getRenumberedBoardsByYear(draftPicks, teams);
  const breakoutPlayers = findBreakoutPlayers(year, boardsByYear, playerSeasonPoints);

  const recap: SeasonRecap = {
    year,
    champion: asChampion(championTeam),
    runnerUp: asChampion(runnerUpTeam),
    biggestMover: findBiggestMover(year, teams),
    highestScoringWeek,
    notableTrades,
    breakoutPlayers,
  };
  return recap;
}
