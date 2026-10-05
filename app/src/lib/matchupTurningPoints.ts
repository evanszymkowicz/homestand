import { BENCH_AND_IR_SLOT_IDS } from "./lineupSlots";
import { findTeam } from "./schedule";
import type { BoxScoreEntry, Matchup, Team } from "../types";

export type TurningPointType = "biggest_differential" | "upset" | "comeback";

export interface MatchupTurningPoint {
  matchupId: number;
  type: TurningPointType;
  description: string;
  value: number;
}

/** [winner, loser] for a decided matchup, or null for a tie or undecided. */
type MatchupSides = [{ espnTeamId: number; score: number }, { espnTeamId: number; score: number }] | null;

function getMatchupSides(matchup: Matchup): MatchupSides {
  if (!matchup.away || matchup.winner === "TIE" || matchup.winner === "UNDECIDED") return null;
  if (matchup.winner === "HOME") {
    return [
      { espnTeamId: matchup.home.espn_team_id ?? 0, score: matchup.home.score },
      { espnTeamId: matchup.away.espn_team_id ?? 0, score: matchup.away.score },
    ];
  }
  return [
    { espnTeamId: matchup.away.espn_team_id ?? 0, score: matchup.away.score },
    { espnTeamId: matchup.home.espn_team_id ?? 0, score: matchup.home.score },
  ];
}

/** [winnerRank, loserRank] when the winner finished below the loser, else null.
 * Lower final_rank means higher finish. */
function upsetRanks(matchup: Matchup, teams: Team[]): [number, number] | null {
  const sides = getMatchupSides(matchup);
  if (!sides) return null;
  const winnerTeam = findTeam(teams, matchup.year, sides[0].espnTeamId);
  const loserTeam = findTeam(teams, matchup.year, sides[1].espnTeamId);
  if (!winnerTeam || !loserTeam) return null;
  return loserTeam.final_rank < winnerTeam.final_rank ? [winnerTeam.final_rank, loserTeam.final_rank] : null;
}

/** Max deficit (in points) the winner overcame during the matchup week, or null
 * if the winner never trailed. Uses day-level box-score slots and only counts
 * started (non-bench/IR) points.
 *
 * Requires at least two scoring periods. Pre-2019 box scores record every slot
 * as `lineup_slot_id: 0` under a single scoring period, so there is no
 * intra-week shape to measure -- and a one-period comparison is actively wrong:
 * it reports the winner's full-week deficit as an in-week comeback. Keying off
 * the shape rather than the year means a partial or truncated fetch can never
 * manufacture a comeback, whatever the year.
 *
 * This is a floor, not the coverage policy. Whether a given season's box scores
 * are trustworthy enough to show at all is decided by the caller against
 * `seasons.json` coverage; see `WeekScoreboard`. */
function getComebackDeficit(matchup: Matchup, boxScores: BoxScoreEntry[]): number | null {
  const sides = getMatchupSides(matchup);
  if (!sides) return null;

  const winnerEntries = boxScores.filter(
    e => e.year === matchup.year && e.week === matchup.week && e.espn_team_id === sides[0].espnTeamId
  );
  const loserEntries = boxScores.filter(
    e => e.year === matchup.year && e.week === matchup.week && e.espn_team_id === sides[1].espnTeamId
  );
  if (winnerEntries.length === 0 || loserEntries.length === 0) return null;

  const dayPoints = (entries: BoxScoreEntry[]) => {
    const byDay = new Map<number, number>();
    for (const entry of entries) {
      for (const slot of entry.slots) {
        if (BENCH_AND_IR_SLOT_IDS.has(slot.lineup_slot_id)) continue;
        byDay.set(slot.scoring_period, (byDay.get(slot.scoring_period) ?? 0) + slot.points);
      }
    }
    return byDay;
  };

  const winnerByDay = dayPoints(winnerEntries);
  const loserByDay = dayPoints(loserEntries);
  const periods = Array.from(new Set([...winnerByDay.keys(), ...loserByDay.keys()])).sort((a, b) => a - b);
  if (periods.length < 2) return null;

  let winnerCumulative = 0;
  let loserCumulative = 0;
  let maxDeficit = 0;
  for (const period of periods) {
    winnerCumulative += winnerByDay.get(period) ?? 0;
    loserCumulative += loserByDay.get(period) ?? 0;
    if (winnerCumulative < loserCumulative) {
      maxDeficit = Math.max(maxDeficit, loserCumulative - winnerCumulative);
    }
  }

  return maxDeficit > 0 ? maxDeficit : null;
}

/** Compute a turning point for a single matchup. Returns null for ties or
 * matchups with no notable turning point. */
export function computeMatchupTurningPoint(
  matchup: Matchup,
  boxScores: BoxScoreEntry[],
  teams: Team[]
): MatchupTurningPoint | null {
  const id = matchup.matchup_id;

  const comeback = getComebackDeficit(matchup, boxScores);
  if (comeback !== null) {
    return {
      matchupId: id,
      type: "comeback",
      description: `Comeback: trailed by ${comeback.toFixed(1)} points during the week`,
      value: comeback,
    };
  }

  const upset = upsetRanks(matchup, teams);
  if (upset) {
    const [winnerRank, loserRank] = upset;
    return {
      matchupId: id,
      type: "upset",
      description: `Upset: #${winnerRank} beat #${loserRank}`,
      value: Math.abs(loserRank - winnerRank),
    };
  }

  return null;
}

/** Compute turning points for every matchup: comebacks (wherever box scores
 * resolve per day), upsets (all years), and the single biggest differential (all
 * years). A matchup is tagged with at most one turning point, with priority
 * comeback > upset > biggest differential.
 *
 * Callers pass one season's matchups, but the biggest-differential pass is keyed
 * on (year, matchup_id) rather than `matchup_id` alone: ESPN matchup ids are
 * per-year, so a bare id match would tag a different season's matchup when a
 * caller hands over the whole archive. */
export function computeMatchupTurningPoints(
  matchups: Matchup[],
  boxScoresByYear: Map<number, BoxScoreEntry[]>,
  teams: Team[]
): MatchupTurningPoint[] {
  let biggest: { matchup: Matchup; margin: number } | null = null;
  for (const matchup of matchups) {
    const sides = getMatchupSides(matchup);
    if (!sides) continue;
    const margin = sides[0].score - sides[1].score;
    if (!biggest || margin > biggest.margin) {
      biggest = { matchup, margin };
    }
  }

  const results: MatchupTurningPoint[] = [];
  for (const matchup of matchups) {
    const boxScores = boxScoresByYear.get(matchup.year) ?? [];
    const turningPoint = computeMatchupTurningPoint(matchup, boxScores, teams);
    if (turningPoint) {
      results.push(turningPoint);
    } else if (biggest && matchup.year === biggest.matchup.year && matchup.matchup_id === biggest.matchup.matchup_id) {
      results.push({
        matchupId: matchup.matchup_id,
        type: "biggest_differential",
        description: `Biggest blowout: ${biggest.margin.toFixed(1)} points`,
        value: biggest.margin,
      });
    }
  }
  return results;
}
