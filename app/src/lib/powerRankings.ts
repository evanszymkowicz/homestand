import type { Matchup, Team } from "../types";

export interface TeamRanking {
  espnTeamId: number;
  cumulativePoints: number;
  rank: number;
}

export interface WeeklyRanking {
  week: number;
  rankings: TeamRanking[];
}

export interface WeeklyPowerRanking {
  weeks: WeeklyRanking[];
}

/** Build cumulative point totals week-by-week for one season, ranking teams by
 * total points scored through each week. Uses `matchups.json`, so it covers the
 * full archive with no coverage gate. Ties are broken by `espn_team_id` for a
 * stable, deterministic ordering.
 *
 * Regular season only (`playoff_tier === null`), matching how every other
 * season-points figure in the app is derived -- see `stats.ts` on `overall` and
 * `divergingViews`. Two consequences: the final week's `cumulativePoints`
 * equals `teams.json`'s `overall.points_for` for each team, and the ranking
 * cannot drift from the standings. Including playoff games would inflate the
 * total past `overall` and leave playoff weeks adding nothing to the ordering. */
export function computeWeeklyPowerRankings(year: number, matchups: Matchup[], teams: Team[]): WeeklyPowerRanking {
  const yearTeams = teams.filter(t => t.year === year);
  const yearMatchups = matchups.filter(m => m.year === year && m.playoff_tier === null);
  const weeks = Array.from(new Set(yearMatchups.map(m => m.week))).sort((a, b) => a - b);

  const cumulative = new Map<number, number>();

  const weeklyRankings: WeeklyRanking[] = [];
  for (const week of weeks) {
    for (const m of yearMatchups.filter(m => m.week === week)) {
      if (m.home.espn_team_id !== null) {
        cumulative.set(m.home.espn_team_id, (cumulative.get(m.home.espn_team_id) ?? 0) + m.home.score);
      }
      if (m.away?.espn_team_id != null) {
        cumulative.set(m.away.espn_team_id, (cumulative.get(m.away.espn_team_id) ?? 0) + m.away.score);
      }
    }

    const rankings = yearTeams
      .map(team => ({ team, points: cumulative.get(team.espn_team_id) ?? 0 }))
      .sort((a, b) => b.points - a.points || a.team.espn_team_id - b.team.espn_team_id)
      .map(({ team, points }, index) => ({
        espnTeamId: team.espn_team_id,
        cumulativePoints: points,
        rank: index + 1,
      }));

    weeklyRankings.push({ week, rankings });
  }

  return { weeks: weeklyRankings };
}
