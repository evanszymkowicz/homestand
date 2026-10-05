import type { Matchup, Season, Team } from "../types";
import { winPct } from "./stats";

/**
 * Season-scoped schedule/standings derivations: weeks, weekly matchups, playoff
 * brackets, and division/final standings. Every count is read from seasons.json
 * metadata rather than assumed, so a shortened season (2020: 8 regular weeks, 1
 * playoff week, 2 playoff teams, no WINNERS_CONSOLATION_LADDER) renders correctly
 * without special-casing.
 */

export function getSeasonWeeks(season: Season): number[] {
  return Array.from({ length: season.regular_season_weeks }, (_, i) => i + 1);
}

export function getPlayoffWeeksFromMatchups(matchups: Matchup[], year: number): number[] {
  const weeks = new Set<number>();
  for (const m of matchups) {
    if (m.year === year && m.playoff_tier !== null) {
      weeks.add(m.week);
    }
  }
  return [...weeks].sort((a, b) => a - b);
}

export function getWeekMatchups(matchups: Matchup[], year: number, week: number): Matchup[] {
  return matchups
    .filter(m => m.year === year && m.week === week && m.playoff_tier === null)
    .sort((a, b) => a.matchup_id - b.matchup_id);
}

export interface BracketRound {
  week: number;
  matchups: Matchup[];
}

/** Columns for one playoff bracket, one per week that bracket actually has games
 * in (never an assumed round count) — so a single-round bracket (2020) renders as
 * one column and a bye-laden opening round still lines up correctly. */
export function getBracketRounds(matchups: Matchup[], year: number, tier: string): BracketRound[] {
  const tierMatchups = matchups.filter(m => m.year === year && m.playoff_tier === tier);
  const weeks = Array.from(new Set(tierMatchups.map(m => m.week))).sort((a, b) => a - b);
  return weeks.map(week => ({
    week,
    matchups: tierMatchups.filter(m => m.week === week).sort((a, b) => a.matchup_id - b.matchup_id),
  }));
}

export interface DivisionStandingRow {
  team: Team;
  winPct: number;
}

/** division_id -> teams sorted win% desc, tie-broken by wins then points_for. */
export function getDivisionStandings(teams: Team[], season: Season): Map<number, DivisionStandingRow[]> {
  const byDivision = new Map<number, DivisionStandingRow[]>();
  for (const division of season.divisions) {
    byDivision.set(division.division_id, []);
  }

  for (const team of teams.filter(t => t.year === season.year)) {
    const row = { team, winPct: winPct(team.overall) };
    const rows = byDivision.get(team.division_id);
    if (rows) {
      rows.push(row);
    } else {
      // A team whose division_id isn't in season.divisions shouldn't vanish
      // from standings — surface it under its own bucket instead.
      byDivision.set(team.division_id, [row]);
    }
  }

  for (const rows of byDivision.values()) {
    rows.sort(
      (a, b) =>
        b.winPct - a.winPct ||
        b.team.overall.wins - a.team.overall.wins ||
        b.team.overall.points_for - a.team.overall.points_for
    );
  }

  return byDivision;
}

export function getFinalStandings(teams: Team[], year: number): Team[] {
  return teams.filter(t => t.year === year).sort((a, b) => a.final_rank - b.final_rank);
}

/** Joins a MatchupSide (only espn_team_id/owner_id/score) back to its full
 * team-season record (name, playoff_seed, owner_ids). Null on a bye side. */
export function findTeam(teams: Team[], year: number, espnTeamId: number | null): Team | undefined {
  if (espnTeamId === null) return undefined;
  return teams.find(t => t.year === year && t.espn_team_id === espnTeamId);
}

/** The team that won a playoff bracket: among the winning sides of the final
 * round's matchups, the one whose team finished with the best (lowest)
 * final_rank. The last week of a consolation ladder has several games, so
 * "won its final-week game" alone doesn't identify the ladder winner. Null
 * when the bracket has no rounds or no decided final-week game. */
export function getBracketChampionTeamId(rounds: BracketRound[], teams: Team[], year: number): number | null {
  const finalRound = rounds[rounds.length - 1];
  if (!finalRound) return null;

  let champion: { teamId: number; finalRank: number } | null = null;
  for (const matchup of finalRound.matchups) {
    const winningSide = matchup.winner === "HOME" ? matchup.home : matchup.winner === "AWAY" ? matchup.away : null;
    if (!winningSide || winningSide.espn_team_id === null) continue;
    const team = findTeam(teams, year, winningSide.espn_team_id);
    if (!team) continue;
    if (!champion || team.final_rank < champion.finalRank) {
      champion = { teamId: team.espn_team_id, finalRank: team.final_rank };
    }
  }
  return champion?.teamId ?? null;
}

export interface ChampionshipGameResult {
  matchupId: number;
  championScore: number;
  runnerUpScore: number;
}

/** The winners-bracket final's score, matched against the season's actual
 * final_rank===1 team rather than assumed from bracket position alone (a
 * multi-game final week, or a bracket that for some reason doesn't crown the
 * true champion, falls through to null instead of mislabeling a score). */
export function getChampionshipGameResult(
  matchups: Matchup[],
  teams: Team[],
  year: number
): ChampionshipGameResult | null {
  const rounds = getBracketRounds(matchups, year, "WINNERS_BRACKET");
  const finalRound = rounds[rounds.length - 1];
  if (!finalRound) return null;

  for (const m of finalRound.matchups) {
    if (m.winner !== "HOME" && m.winner !== "AWAY") continue;
    const winningSide = m.winner === "HOME" ? m.home : m.away;
    const losingSide = m.winner === "HOME" ? m.away : m.home;
    if (!winningSide || !losingSide) continue;
    const winningTeam = findTeam(teams, year, winningSide.espn_team_id);
    if (winningTeam?.final_rank === 1) {
      return { matchupId: m.matchup_id, championScore: winningSide.score, runnerUpScore: losingSide.score };
    }
  }
  return null;
}

/** Narrative order for the Playoffs tab (winners bracket first), independent of
 * season.playoff_brackets' array order in the data. */
export const PLAYOFF_TIER_ORDER = ["WINNERS_BRACKET", "WINNERS_CONSOLATION_LADDER", "LOSERS_CONSOLATION_LADDER"];

export const PLAYOFF_TIER_LABELS: Record<string, string> = {
  WINNERS_BRACKET: "Winners Bracket",
  WINNERS_CONSOLATION_LADDER: "Winners Consolation Ladder",
  LOSERS_CONSOLATION_LADDER: "Losers Consolation Ladder",
};
