import { useMemo, useState } from "react";
import { BracketTree } from "../../components/BracketTree";
import { SectionHeading } from "../../components/SectionHeading";
import { useAsync, useAsyncList } from "../../hooks/useAsync";
import { loadBoxScores } from "../../lib/data";
import { computeMatchupTurningPoints, type MatchupTurningPoint } from "../../lib/matchupTurningPoints";
import {
  getBracketChampionTeamId,
  getBracketRounds,
  getPlayoffWeeksFromMatchups,
  getSeasonWeeks,
  PLAYOFF_TIER_LABELS,
  PLAYOFF_TIER_ORDER,
} from "../../lib/schedule";
import type { Matchup, Owner, Season, Team } from "../../types";
import { MatchupCard, type ChampionTierBadge } from "../../components/MatchupCard";

interface WeekScoreboardProps {
  season: Season;
  teams: Team[];
  matchups: Matchup[];
  owners: Owner[];
}

/** Crown for the winners bracket champion, clown for the losers consolation. */
const TIER_BADGES: Record<string, { emoji: string; label: string }> = {
  WINNERS_BRACKET: { emoji: "👑", label: "League champion" },
  LOSERS_CONSOLATION_LADDER: { emoji: "🤡", label: "Losers consolation ladder winner" },
};

interface TierFinal {
  finalWeek: number;
  champion?: ChampionTierBadge;
}

function groupByWeek(season: Season, matchups: Matchup[], weeks: number[]): Map<number, Matchup[]> {
  const byWeek = new Map<number, Matchup[]>();
  for (const week of weeks) {
    byWeek.set(
      week,
      matchups
        .filter(m => m.year === season.year && m.week === week)
        .sort((a, b) => a.matchup_id - b.matchup_id)
    );
  }
  return byWeek;
}

/** For each playoff tier, its final round's week and champion badge (if the
 * final round has a decided winner) — used to show the crown/clown only on
 * the week that actually crowned the tier's winner. */
function getTierFinals(season: Season, matchups: Matchup[], teams: Team[]): Map<string, TierFinal> {
  const finals = new Map<string, TierFinal>();
  for (const tier of season.playoff_brackets) {
    const rounds = getBracketRounds(matchups, season.year, tier);
    const finalRound = rounds[rounds.length - 1];
    if (!finalRound) continue;
    const badge = TIER_BADGES[tier];
    const teamId = badge ? getBracketChampionTeamId(rounds, teams, season.year) : null;
    finals.set(tier, {
      finalWeek: finalRound.week,
      champion: badge && teamId !== null ? { teamId, ...badge } : undefined,
    });
  }
  return finals;
}

function tierSortIndex(tier: string): number {
  const i = PLAYOFF_TIER_ORDER.indexOf(tier);
  return i === -1 ? PLAYOFF_TIER_ORDER.length : i;
}

function latestWeekWithMatchups(weeks: number[], byWeek: Map<number, Matchup[]>): number {
  for (let i = weeks.length - 1; i >= 0; i--) {
    if ((byWeek.get(weeks[i]) ?? []).length > 0) {
      return weeks[i];
    }
  }
  return weeks[0] ?? 1;
}

function defaultWeek(season: Season, weeks: number[], byWeek: Map<number, Matchup[]>): number {
  return weeks.includes(season.current_week) ? season.current_week : latestWeekWithMatchups(weeks, byWeek);
}

/** Full-season scoreboard: a single week picker spans regular-season weeks
 * (from season.regular_season_weeks — never a hardcoded count) plus the weeks that actually have playoff matchups **/

export function WeekScoreboard({ season, teams, matchups, owners }: WeekScoreboardProps) {
  const playoffWeeks = useMemo(
    () => getPlayoffWeeksFromMatchups(matchups, season.year),
    [matchups, season.year]
  );
  const weeks = useMemo(
    () => [...getSeasonWeeks(season), ...playoffWeeks].sort((a, b) => a - b),
    [season, playoffWeeks]
  );
  const displayWeeks = useMemo(() => [...weeks].reverse(), [weeks]);
  const playoffWeekSet = useMemo(() => new Set(playoffWeeks), [playoffWeeks]);
  const byWeek = useMemo(() => groupByWeek(season, matchups, weeks), [season, matchups, weeks]);
  const tierFinals = useMemo(() => getTierFinals(season, matchups, teams), [season, matchups, teams]);
  const [week, setWeek] = useState(() => defaultWeek(season, weeks, byWeek));
  // Box scores feed comeback turning points only, and comebacks need stat lines
  // that resolve per day. Gate the fetch on the coverage flag rather than a
  // literal year so the load site and the coverage message below cannot drift
  // apart -- and so a 404-free pre-2019 season never pays for a fetch whose
  // data cannot produce a comeback.
  const comebackCovered = season.coverage.stat_lines === "full";
  const boxScoreState = useAsync(() => loadBoxScores(season.year), [season.year], comebackCovered);
  const boxScores = useAsyncList(boxScoreState, data => data);
  const turningPoints = useMemo(
    () =>
      computeMatchupTurningPoints(
        matchups.filter(m => m.year === season.year),
        new Map([[season.year, boxScores]]),
        teams
      ),
    [season.year, matchups, boxScores, teams]
  );
  const turningPointByMatchup = useMemo(
    () => new Map<number, MatchupTurningPoint>(turningPoints.map(tp => [tp.matchupId, tp] as const)),
    [turningPoints]
  );

  const weekMatchups = byWeek.get(week) ?? [];
  const isPlayoffWeek = playoffWeekSet.has(week);

  const tierGroups: [string, Matchup[]][] = [];
  if (isPlayoffWeek) {
    const byTier = new Map<string, Matchup[]>();
    for (const m of weekMatchups) {
      const tier = m.playoff_tier ?? "";
      byTier.set(tier, [...(byTier.get(tier) ?? []), m]);
    }
    tierGroups.push(...Array.from(byTier.entries()).sort((a, b) => tierSortIndex(a[0]) - tierSortIndex(b[0])));
  }

  return (
    <div>
      {!comebackCovered && (
        <p className="mb-3 text-xs text-ink-dim">
          Comeback turning points need day-by-day box scores, which this season does not have in full, so
          they are omitted.
        </p>
      )}
      {comebackCovered && boxScoreState.status === "error" && (
        <p className="mb-3 text-xs text-ink-dim">
          Box scores for {season.year} failed to load, so comeback turning points are unavailable this
          season.
        </p>
      )}
      <div className="scrollbar-accent mb-4 flex gap-2 overflow-x-auto pb-3">
        {displayWeeks.map(w => {
          const hasMatchups = (byWeek.get(w) ?? []).length > 0;
          const active = w === week;
          return (
            <button
              key={w}
              type="button"
              disabled={!hasMatchups}
              onClick={() => setWeek(w)}
              className={`flex-none rounded-full border px-3 py-1 text-xs font-semibold whitespace-nowrap transition-colors ${
                active
                  ? "border-accent bg-accent text-accent-ink"
                  : hasMatchups
                    ? "border-border bg-surface text-ink-dim hover:text-ink"
                    : "border-border bg-surface text-ink-faint opacity-50"
              }`}>
              {playoffWeekSet.has(w) ? `Playoffs Wk ${w}` : `Week ${w}`}
            </button>
          );
        })}
      </div>

      {weekMatchups.length === 0 ? (
        <p className="text-ink-dim">No matchups played yet for week {week}.</p>
      ) : isPlayoffWeek ? (
        <div className="scrollbar-accent overflow-x-auto pb-2">
          <div className="space-y-8">
            {tierGroups.map(([tier]) => (
              <div key={tier}>
                <SectionHeading as="h3" className="mb-3">
                  {PLAYOFF_TIER_LABELS[tier] ?? tier}
                </SectionHeading>
                <BracketTree
                  rounds={getBracketRounds(matchups, season.year, tier)}
                  teams={teams}
                  champion={tierFinals.get(tier)?.champion}
                  turningPointByMatchup={turningPointByMatchup}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {weekMatchups.map(matchup => (
            <MatchupCard
              key={matchup.matchup_id}
              matchup={matchup}
              teams={teams}
              owners={owners}
              turningPoint={turningPointByMatchup.get(matchup.matchup_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
