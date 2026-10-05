import type { FormStripYear } from "./divergingViews";
import { longestRun, regularSeasonResultsByTeam } from "./stats";
import { computeOwnerTransactionActivityForOwner } from "./transactionActivity";
import type { Matchup, PlayerTeamSeasonPoints, Season, Team, Transaction } from "../types";

export interface OwnerMilestone {
  label: string;
  value: string;
  season?: number;
  description?: string;
  tone?: "gold" | "blue" | "neutral";
}

export interface OwnerMilestones {
  ownerId: string;
  milestones: OwnerMilestone[];
}

export interface MilestoneInput {
  ownerId: string;
  teams: Team[];
  seasons: Season[];
  /** The full 2019+ ledger; busiest season is derived from it. */
  transactions: Transaction[];
  teamSeasonPoints: PlayerTeamSeasonPoints[];
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function computeOwnerStreaksByOwner(
  teams: Team[],
  matchups: Matchup[]
): Map<string, { wins: number; losses: number; winsYear: number | null; lossesYear: number | null }> {
  const resultsByTeam = regularSeasonResultsByTeam(matchups);
  const byOwner = new Map<
    string,
    { wins: number; losses: number; winsYear: number | null; lossesYear: number | null }
  >();

  for (const team of teams) {
    const results = resultsByTeam.get(`${team.year}:${team.espn_team_id}`);
    if (!results || results.length === 0) continue;
    const winRun = longestRun(results, "W");
    const lossRun = longestRun(results, "L");

    for (const ownerId of team.owner_ids) {
      const entry = byOwner.get(ownerId) ?? { wins: 0, losses: 0, winsYear: null, lossesYear: null };
      if (winRun > entry.wins) {
        entry.wins = winRun;
        entry.winsYear = team.year;
      }
      if (lossRun > entry.losses) {
        entry.losses = lossRun;
        entry.lossesYear = team.year;
      }
      byOwner.set(ownerId, entry);
    }
  }
  return byOwner;
}

function bestWeek(
  formStrips: FormStripYear[],
  ownerTeamKeys: Set<string>
): { score: number; year: number; week: number } | null {
  let best: { score: number; year: number; week: number } | null = null;
  for (const yearStrips of formStrips) {
    for (const row of yearStrips.rows) {
      if (!ownerTeamKeys.has(`${yearStrips.year}:${row.espnTeamId}`)) continue;
      for (const week of row.weeks) {
        if (best === null || week.score > best.score) {
          best = { score: week.score, year: yearStrips.year, week: week.week };
        }
      }
    }
  }
  return best;
}

export interface OwnerRosteredPlayers {
  /** Distinct players this owner fielded, counted per (year, espn_team_id). */
  count: number;
  /** Seasons that actually contributed a player to the count, ascending --
   * what the card states as the figure's range. */
  years: number[];
}

export function countOwnerRosteredPlayers(
  ownerId: string,
  teamSeasonPoints: PlayerTeamSeasonPoints[],
  teams: Team[]
): OwnerRosteredPlayers {
  const teamKeys = new Set<string>();
  for (const team of teams) {
    if (team.owner_ids.includes(ownerId)) teamKeys.add(`${team.year}:${team.espn_team_id}`);
  }

  const players = new Set<number>();
  const years = new Set<number>();
  for (const row of teamSeasonPoints) {
    if (!teamKeys.has(`${row.year}:${row.espn_team_id}`)) continue;
    players.add(row.player_id);
    years.add(row.year);
  }
  return { count: players.size, years: [...years].sort((a, b) => a - b) };
}

/**
 * Every milestone for one owner, or null when they have no team-season at all
 * (the caller skips the section rather than rendering an empty grid).
 */
export function computeOwnerMilestones(
  input: MilestoneInput & {
    formStrips: FormStripYear[];
    streaksByOwner: Map<string, { wins: number; losses: number; winsYear: number | null; lossesYear: number | null }>;
  }
): OwnerMilestones {
  const { ownerId, teams, seasons, transactions, teamSeasonPoints, formStrips, streaksByOwner } = input;

  const ownerTeams = teams.filter(t => t.owner_ids.includes(ownerId)).sort((a, b) => a.year - b.year);
  if (ownerTeams.length === 0) return { ownerId, milestones: [] };

  const ownerTeamKeys = new Set(ownerTeams.map(t => `${t.year}:${t.espn_team_id}`));
  const milestones: OwnerMilestone[] = [];

  // Career record, win% and points-for are not milestones -- they duplicate
  // the page-header stat cards. Same for title count, which the header's
  // "Titles" card already shows (with runner-up finishes).

  // --- Best / worst season finish ----------------------------------------
  const best = ownerTeams.reduce((a, b) => (a.final_rank <= b.final_rank ? a : b));
  const worst = ownerTeams.reduce((a, b) => (a.final_rank >= b.final_rank ? a : b));
  milestones.push({
    label: "Best Finish",
    value: ordinal(best.final_rank),
    season: best.year,
    tone: best.final_rank === 1 ? "gold" : "neutral",
  });
  if (worst.year !== best.year || worst.final_rank !== best.final_rank) {
    milestones.push({
      label: "Worst Finish",
      value: ordinal(worst.final_rank),
      season: worst.year,
      tone: "neutral",
    });
  }

  // --- Playoff appearances ----------------------------------------------
  const playoffAppearances = ownerTeams.filter(t => {
    const season = seasons.find(s => s.year === t.year);
    return season != null && t.playoff_seed <= season.playoff_team_count;
  }).length;
  if (playoffAppearances > 0) {
    milestones.push({
      label: "Playoff Appearances",
      value: String(playoffAppearances),
      description: `of ${ownerTeams.length} season${ownerTeams.length === 1 ? "" : "s"}`,
      tone: "neutral",
    });
  }

  // --- Longest streaks (matchup-derived, full 2009+ coverage) ------------
  const streaks = streaksByOwner.get(ownerId);
  if (streaks && streaks.wins > 0) {
    milestones.push({
      label: "Longest Win Streak",
      value: `${streaks.wins} game${streaks.wins === 1 ? "" : "s"}`,
      season: streaks.winsYear ?? undefined,
      tone: "blue",
    });
  }
  if (streaks && streaks.losses > 0) {
    milestones.push({
      label: "Longest Losing Streak",
      value: `${streaks.losses} game${streaks.losses === 1 ? "" : "s"}`,
      season: streaks.lossesYear ?? undefined,
      tone: "neutral",
    });
  }

  // --- Best single-week score (matchup weekly scores, full 2009+) --------
  const week = bestWeek(formStrips, ownerTeamKeys);
  if (week) {
    milestones.push({
      label: "Best Week",
      value: week.score.toFixed(1),
      season: week.year,
      description: `Week ${week.week}`,
      tone: "blue",
    });
  }

  // --- unique players owned (player_team_season_points, 2009-2026) --
  const rostered = countOwnerRosteredPlayers(ownerId, teamSeasonPoints, teams);
  if (rostered.count > 0) {
    const years = rostered.years;
    const span = years.length === 1 ? String(years[0]) : `${years[0]}–${years[years.length - 1]}`;
    const partialYears = years.filter(year => seasons.find(s => s.year === year)?.coverage.box_scores === "partial");
    milestones.push({
      label: "unique players owned",
      value: String(rostered.count),
      description: partialYears.length > 0 ? `${span} · ${partialYears.join(", ")} partial` : span,
      tone: "neutral",
    });
  }

  // --- Busiest season (2019+ ledger, matching the activity table) --------
  const activity = computeOwnerTransactionActivityForOwner(ownerId, transactions);
  let busiestYear = 0;
  let busiestMoves = -1;
  for (const [year, counts] of activity.bySeason) {
    if (counts.total > busiestMoves) {
      busiestMoves = counts.total;
      busiestYear = year;
    }
  }
  if (busiestMoves > 0) {
    milestones.push({
      label: "Busiest Season",
      value: String(busiestMoves),
      season: busiestYear,
      description: "moves · since 2019",
      tone: "neutral",
    });
  }

  return { ownerId, milestones };
}
