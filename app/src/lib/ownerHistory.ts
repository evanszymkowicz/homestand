import {
  getKeeperPointsByOwner,
  getLongestKeptSameOwner,
  getPlayerSeasonPoints,
  type KeeperStreakEntry,
  type OwnerKeeperPoints,
} from "./keepers";
import type { DraftPick, Keeper, Owner, PlayerSeasonPoints, Season, Team } from "../types";

export type KeeperSource = "draft" | "inherited with team" | "waiver/trade";

export function getKeeperSource(
  ownerId: string,
  keeper: Keeper,
  keepers: Keeper[],
  draftPicks: DraftPick[],
  teams: Team[]
): KeeperSource {
  const playerRecords = draftPicks
    .filter(p => p.player_id === keeper.player_id && p.year <= keeper.year)
    .sort((a, b) => a.year - b.year);

  const ownDraftIndex = playerRecords.findIndex(p => !p.keeper && p.owner_id === ownerId);
  if (ownDraftIndex !== -1) {
    const heldContinuously = playerRecords.slice(ownDraftIndex).every(p => p.owner_id === ownerId);
    if (heldContinuously) return "draft";
  }

  const origin = getKeeperStreakOrigin(ownerId, keeper, keepers);
  const currentTeam = teams.find(t => t.year === origin.year && t.espn_team_id === origin.espn_team_id);
  const priorTeam = teams.find(t => t.year === origin.year - 1 && t.espn_team_id === origin.espn_team_id);
  const tookOverTeamSlot =
    !!currentTeam && !!priorTeam && currentTeam.owner_ids.includes(ownerId) && !priorTeam.owner_ids.includes(ownerId);
  if (tookOverTeamSlot && origin.validated_on_prior_roster) return "inherited with team";

  return "waiver/trade";
}

function getKeeperStreakOrigin(ownerId: string, keeper: Keeper, keepers: Keeper[]): Keeper {
  const byYear = new Map(
    keepers.filter(k => k.player_id === keeper.player_id && k.owner_id === ownerId).map(k => [k.year, k])
  );
  let origin = keeper;
  for (;;) {
    const prior = byYear.get(origin.year - 1);
    if (!prior) return origin;
    origin = prior;
  }
}

interface OwnerKeeperHistoryEntry {
  year: number;
  playerId: number;
  playerName: string;
  source: KeeperSource;
}

export function getOwnerKeeperHistory(
  ownerId: string,
  keepers: Keeper[],
  draftPicks: DraftPick[],
  teams: Team[]
): OwnerKeeperHistoryEntry[] {
  return keepers
    .filter(k => k.owner_id === ownerId)
    .map(k => ({
      year: k.year,
      playerId: k.player_id,
      playerName: k.player_name,
      source: getKeeperSource(ownerId, k, keepers, draftPicks, teams),
    }))
    .sort((a, b) => b.year - a.year || a.playerName.localeCompare(b.playerName));
}

export interface OwnerKeeperPlayerSummary {
  playerId: number;
  playerName: string;
  /** Every year this owner kept the player, ascending. */
  years: number[];
  /** Distinct sources across those years, chronological -- usually one, but a
   * player can be re-acquired a different way between keeper stints. */
  sources: KeeperSource[];
  /** The player's summed season points across this owner's keeper years. */
  points: number;
}

export function getOwnerKeeperHistoryByPlayer(
  ownerId: string,
  keepers: Keeper[],
  draftPicks: DraftPick[],
  seasonPoints: PlayerSeasonPoints[],
  teams: Team[]
): OwnerKeeperPlayerSummary[] {
  const byPlayer = new Map<number, OwnerKeeperPlayerSummary>();
  const history = getOwnerKeeperHistory(ownerId, keepers, draftPicks, teams).sort((a, b) => a.year - b.year);
  for (const entry of history) {
    const summary = byPlayer.get(entry.playerId) ?? {
      playerId: entry.playerId,
      playerName: entry.playerName,
      years: [],
      sources: [],
      points: 0,
    };
    summary.years.push(entry.year);
    if (!summary.sources.includes(entry.source)) summary.sources.push(entry.source);
    summary.points += getPlayerSeasonPoints(seasonPoints, entry.year, entry.playerId) ?? 0;
    byPlayer.set(entry.playerId, summary);
  }
  return Array.from(byPlayer.values()).sort(
    (a, b) => b.years[b.years.length - 1] - a.years[a.years.length - 1] || a.playerName.localeCompare(b.playerName)
  );
}

/** Consecutive-year runs of a sorted year list -- [2019..2022, 2024] renders
 * as "2019–2022, 2024" instead of five separate years. */
export function getYearRuns(years: number[]): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  for (const year of years) {
    const last = runs[runs.length - 1];
    if (last && year === last.end + 1) {
      last.end = year;
    } else {
      runs.push({ start: year, end: year });
    }
  }
  return runs;
}

export interface OwnerKeeperTenureRow {
  playerId: number;
  playerName: string;
  years: number[];
  /** Consecutive-year runs within `years` -- a keeper with a gap (2019, 2022)
   * yields two runs, so the matrix draws two bars rather than one spanning the
   * years they weren't kept. */
  runs: { start: number; end: number }[];
  /** Length of the longest single run -- the "kept longest" measure. */
  longestRun: number;
}

export function getOwnerKeeperTenureRows(summaries: OwnerKeeperPlayerSummary[]): OwnerKeeperTenureRow[] {
  return summaries
    .map(summary => {
      const runs = getYearRuns(summary.years);
      const longestRun = runs.reduce((max, run) => Math.max(max, run.end - run.start + 1), 0);
      return { playerId: summary.playerId, playerName: summary.playerName, years: summary.years, runs, longestRun };
    })
    .sort(
      (a, b) =>
        b.longestRun - a.longestRun || b.years.length - a.years.length || a.playerName.localeCompare(b.playerName)
    );
}

export function getOwnerStreaks(ownerId: string, streaks: KeeperStreakEntry[]): KeeperStreakEntry[] {
  return streaks.filter(s => s.owners.some(o => o.ownerId === ownerId)).sort((a, b) => b.length - a.length);
}

export interface OwnerKeeperStreakAndPoints {
  sameOwnerStreaks: KeeperStreakEntry[];
  keeperPoints: OwnerKeeperPoints | undefined;
  hasFinalKeeperSeason: boolean;
}

export function getOwnerKeeperStreakAndPoints(
  ownerId: string,
  keepers: Keeper[],
  seasons: Pick<Season, "year" | "status">[],
  seasonPoints: PlayerSeasonPoints[],
  owners: Owner[]
): OwnerKeeperStreakAndPoints {
  const finalYears = new Set(seasons.filter(s => s.status === "final").map(s => s.year));
  const finalSeasonPoints = seasonPoints.filter(p => finalYears.has(p.year));
  return {
    sameOwnerStreaks: getOwnerStreaks(ownerId, getLongestKeptSameOwner(keepers, owners)),
    keeperPoints: getKeeperPointsByOwner(keepers, finalSeasonPoints, owners).find(p => p.owner.ownerId === ownerId),
    hasFinalKeeperSeason: keepers.some(k => k.owner_id === ownerId && finalYears.has(k.year)),
  };
}
