import { SectionHeading } from "../../components/SectionHeading";
import { StatCard } from "../../components/StatCard";
import { finalYearTeams } from "../../lib/coverage";
import { formatDifferential, formatPoints, formatRecord, formatWinPct } from "../../lib/format";
import {
  getBestCareerWinPcts,
  getBestSeasonDifferentials,
  getBestSeasonPoints,
  getBestSeasonPointsPerGame,
  getBestSingleSeasons,
  getBestWinStreaks,
  getCareerStandings,
  getWorstCareerWinPcts,
  getWorstLossStreaks,
  getWorstSeasonDifferentials,
  getWorstSeasonPoints,
  getWorstSingleSeasons,
  isShortenedSeason,
  MIN_SEASONS_FOR_CAREER_WIN_PCT,
} from "../../lib/stats";
import {
  getBestRecordsToMissTitle,
  getBiggestBlowouts,
  getBiggestOverachievers,
  getBiggestUnderachievers,
  getClosestMatchups,
  getHighestScoringLosses,
  getHighestSingleWeekScores,
  getLowestScoringWins,
  getLowestSingleWeekScores,
  getTheOneTie,
  getWorstRecordsToWinTitle,
} from "../../lib/superlatives";
import type { Matchup, Owner, Season, Team } from "../../types";

interface TriviaProps {
  teams: Team[];
  owners: Owner[];
  matchups: Matchup[];
  seasons: Season[];
}

function findTeamForOwnerYear(teams: Team[], ownerId: string, year: number): Team | undefined {
  return teams.find(t => t.year === year && t.owner_ids.includes(ownerId));
}

function formatStreak(length: number): string {
  return `${length} game${length === 1 ? "" : "s"}`;
}

const matchupTo = (year: number, matchupId: number) => `/matchup/${year}/${matchupId}`;
const seasonTo = (year: number) => `/season/${year}`;

/** League trivia and single-season/career extremes, all in one place --
 * moved here from Superlatives and merged with the former "Best & Worst"
 * tab, since both were flavors of the same "notable records" idea. */
export function Trivia({ teams, owners, matchups, seasons }: TriviaProps) {
  const inProgressYears = new Set(seasons.filter(s => s.status === "in_progress").map(s => s.year));
  const yearLabel = (year: number) => {
    const suffix = `${isShortenedSeason(seasons, year) ? "*" : ""}${inProgressYears.has(year) ? "†" : ""}`;
    return `${year}${suffix}`;
  };

  const blowouts = getBiggestBlowouts(matchups, teams, owners);
  const closestMatchups = getClosestMatchups(matchups, teams, owners);
  const highestWeeks = getHighestSingleWeekScores(matchups, teams, owners);
  const lowestWeeks = getLowestSingleWeekScores(matchups, teams, owners);
  const finalTeams = finalYearTeams(teams, seasons);
  const bestToMissList = getBestRecordsToMissTitle(finalTeams, owners);
  const worstToWinList = getWorstRecordsToWinTitle(finalTeams, owners);
  const overachievers = getBiggestOverachievers(finalTeams, owners);
  const underachievers = getBiggestUnderachievers(finalTeams, owners);
  const highestLosses = getHighestScoringLosses(matchups, teams, owners);
  const lowestWins = getLowestScoringWins(matchups, teams, owners);
  const theOneTie = getTheOneTie(matchups);

  const [blowout, ...blowoutRunnersUp] = blowouts;
  const [closest, ...closestRunnersUp] = closestMatchups;
  const [highestWeek, ...highestWeekRunnersUp] = highestWeeks;
  const [lowestWeek, ...lowestWeekRunnersUp] = lowestWeeks;
  const [bestToMiss, ...bestToMissRunnersUp] = bestToMissList;
  const [worstToWin, ...worstToWinRunnersUp] = worstToWinList;
  const [overachiever, ...overachieverRunnersUp] = overachievers;
  const [underachiever, ...underachieverRunnersUp] = underachievers;
  const [highestLoss, ...highestLossRunnersUp] = highestLosses;
  const [lowestWin, ...lowestWinRunnersUp] = lowestWins;

  const bestRecords = getBestSingleSeasons(teams, owners);
  const worstRecords = getWorstSingleSeasons(teams, owners);
  const bestDiffs = getBestSeasonDifferentials(teams, owners);
  const worstDiffs = getWorstSeasonDifferentials(teams, owners);
  const winStreaks = getBestWinStreaks(teams, owners, matchups);
  const lossStreaks = getWorstLossStreaks(teams, owners, matchups);
  const bestCareers = getBestCareerWinPcts(getCareerStandings(teams, owners));
  const worstCareers = getWorstCareerWinPcts(getCareerStandings(teams, owners));
  const bestSeasonPointsList = getBestSeasonPoints(teams, owners);
  const worstSeasonPointsList = getWorstSeasonPoints(teams, owners);
  const bestPerGameList = getBestSeasonPointsPerGame(teams, owners);

  const [bestRecord, ...bestRecordRunnersUp] = bestRecords;
  const [worstRecord, ...worstRecordRunnersUp] = worstRecords;
  const [bestDiff, ...bestDiffRunnersUp] = bestDiffs;
  const [worstDiff, ...worstDiffRunnersUp] = worstDiffs;
  const [winStreak, ...winStreakRunnersUp] = winStreaks;
  const [lossStreak, ...lossStreakRunnersUp] = lossStreaks;
  const [bestCareer, ...bestCareerRunnersUp] = bestCareers;
  const [worstCareer, ...worstCareerRunnersUp] = worstCareers;
  const [bestSeasonPoints, ...bestSeasonPointsRunnersUp] = bestSeasonPointsList;
  const [worstSeasonPoints, ...worstSeasonPointsRunnersUp] = worstSeasonPointsList;
  const [bestPerGame, ...bestPerGameRunnersUp] = bestPerGameList;

  const shownYears = [
    ...blowouts,
    ...closestMatchups,
    ...highestWeeks,
    ...lowestWeeks,
    ...highestLosses,
    ...lowestWins,
    ...bestToMissList,
    ...worstToWinList,
    ...overachievers,
    ...underachievers,
    ...bestRecords,
    ...worstRecords,
    ...bestDiffs,
    ...worstDiffs,
    ...winStreaks,
    ...lossStreaks,
    ...bestSeasonPointsList,
    ...worstSeasonPointsList,
    ...bestPerGameList,
  ].map(r => r.year);
  const flaggedShortSeasons = seasons.filter(s => shownYears.includes(s.year) && isShortenedSeason(seasons, s.year));
  const flaggedInProgressSeasons = seasons.filter(s => shownYears.includes(s.year) && s.status === "in_progress");

  return (
    <div>
      {theOneTie && theOneTie.away && (
        <div className="mb-7">
          <SectionHeading className="mb-3">The One Tie</SectionHeading>
          <StatCard
            label="A Moment of Silence"
            value={`${formatPoints(theOneTie.home.score)} – ${formatPoints(theOneTie.away.score)}`}
            accent="gold"
            to={matchupTo(theOneTie.year, theOneTie.matchup_id)}
            detail={
              <>
                There has been one tie in 18 years of this league's history: Week {theOneTie.week}, {theOneTie.year}.
                Never forget.
              </>
            }
          />
        </div>
      )}

      <SectionHeading className="mb-3">League Records</SectionHeading>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {blowout && (
          <StatCard
            label="Biggest Blowout"
            value={formatPoints(blowout.margin)}
            accent="gold"
            to={matchupTo(blowout.year, blowout.matchupId)}
            detail={
              <>
                <b className="text-ink">{blowout.winner.teamName}</b> over{" "}
                <b className="text-ink">{blowout.loser.teamName}</b> · {yearLabel(blowout.year)} Wk {blowout.week}
              </>
            }
            runnersUp={blowoutRunnersUp.map(r => (
              <>
                <b className="text-ink">{r.winner.teamName}</b> over <b className="text-ink">{r.loser.teamName}</b> ·{" "}
                {yearLabel(r.year)} · {formatPoints(r.margin)}
              </>
            ))}
          />
        )}
        {closest && (
          <StatCard
            label="Closest Matchup"
            value={formatPoints(closest.margin)}
            accent="gold"
            to={matchupTo(closest.year, closest.matchupId)}
            detail={
              <>
                <b className="text-ink">{closest.winner.teamName}</b> over{" "}
                <b className="text-ink">{closest.loser.teamName}</b> · {yearLabel(closest.year)} Wk {closest.week}
              </>
            }
            runnersUp={closestRunnersUp.map(r => (
              <>
                <b className="text-ink">{r.winner.teamName}</b> over <b className="text-ink">{r.loser.teamName}</b> ·{" "}
                {yearLabel(r.year)} · {formatPoints(r.margin)}
              </>
            ))}
          />
        )}
        {highestWeek && (
          <StatCard
            label="Highest Single-Week Score"
            value={formatPoints(highestWeek.team.score)}
            accent="positive"
            to={matchupTo(highestWeek.year, highestWeek.matchupId)}
            detail={
              <>
                <b className="text-ink">{highestWeek.team.teamName}</b> · {yearLabel(highestWeek.year)} Wk{" "}
                {highestWeek.week}
              </>
            }
            runnersUp={highestWeekRunnersUp.map(r => (
              <>
                <b className="text-ink">{r.team.teamName}</b> · {yearLabel(r.year)} Wk {r.week} ·{" "}
                {formatPoints(r.team.score)}
              </>
            ))}
          />
        )}
        {lowestWeek && (
          <StatCard
            label="Lowest Single-Week Score"
            value={formatPoints(lowestWeek.team.score)}
            accent="negative"
            to={matchupTo(lowestWeek.year, lowestWeek.matchupId)}
            detail={
              <>
                <b className="text-ink">{lowestWeek.team.teamName}</b> · {yearLabel(lowestWeek.year)} Wk{" "}
                {lowestWeek.week}
              </>
            }
            runnersUp={lowestWeekRunnersUp.map(r => (
              <>
                <b className="text-ink">{r.team.teamName}</b> · {yearLabel(r.year)} Wk {r.week} ·{" "}
                {formatPoints(r.team.score)}
              </>
            ))}
          />
        )}
        {highestLoss && (
          <StatCard
            label="Highest-Scoring Loss"
            value={formatPoints(highestLoss.team.score)}
            accent="negative"
            to={matchupTo(highestLoss.year, highestLoss.matchupId)}
            detail={
              <>
                <b className="text-ink">{highestLoss.team.teamName}</b> · {yearLabel(highestLoss.year)} Wk{" "}
                {highestLoss.week} · lost {formatPoints(highestLoss.team.score)}–
                {formatPoints(highestLoss.opponentScore)}
              </>
            }
            runnersUp={highestLossRunnersUp.map(r => (
              <>
                <b className="text-ink">{r.team.teamName}</b> · {yearLabel(r.year)} Wk {r.week} · lost{" "}
                {formatPoints(r.team.score)}–{formatPoints(r.opponentScore)}
              </>
            ))}
          />
        )}
        {lowestWin && (
          <StatCard
            label="Lowest-Scoring Win"
            value={formatPoints(lowestWin.team.score)}
            accent="positive"
            to={matchupTo(lowestWin.year, lowestWin.matchupId)}
            detail={
              <>
                <b className="text-ink">{lowestWin.team.teamName}</b> · {yearLabel(lowestWin.year)} Wk {lowestWin.week}{" "}
                · won {formatPoints(lowestWin.team.score)}–{formatPoints(lowestWin.opponentScore)}
              </>
            }
            runnersUp={lowestWinRunnersUp.map(r => (
              <>
                <b className="text-ink">{r.team.teamName}</b> · {yearLabel(r.year)} Wk {r.week} · won{" "}
                {formatPoints(r.team.score)}–{formatPoints(r.opponentScore)}
              </>
            ))}
          />
        )}
        {bestCareer && (
          <StatCard
            label={`Highest win percentage (min. ${MIN_SEASONS_FOR_CAREER_WIN_PCT} seasons)`}
            value={formatWinPct(bestCareer.winPct)}
            accent="positive"
            detail={<b className="text-ink">{bestCareer.owner.name}</b>}
            runnersUp={bestCareerRunnersUp.map(r => (
              <>
                <b className="text-ink">{r.owner.name}</b> · {formatWinPct(r.winPct)}
              </>
            ))}
          />
        )}
        {worstCareer && (
          <StatCard
            label={`Lowest win percentage (min. ${MIN_SEASONS_FOR_CAREER_WIN_PCT} seasons)`}
            value={formatWinPct(worstCareer.winPct)}
            accent="negative"
            detail={<b className="text-ink">{worstCareer.owner.name}</b>}
            runnersUp={worstCareerRunnersUp.map(r => (
              <>
                <b className="text-ink">{r.owner.name}</b> · {formatWinPct(r.winPct)}
              </>
            ))}
          />
        )}
      </div>

      <SectionHeading className="mt-7 mb-3">Single-Season</SectionHeading>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {bestRecord && (
          <StatCard
            label="Best record"
            value={`${formatRecord(bestRecord.wins, bestRecord.losses, bestRecord.ties)} (${formatWinPct(bestRecord.winPct)})`}
            accent="positive"
            detail={
              <>
                <b className="text-ink">{bestRecord.teamName}</b> · {yearLabel(bestRecord.year)}
              </>
            }
            to={(() => {
              const team = findTeamForOwnerYear(teams, bestRecord.owners[0].ownerId, bestRecord.year);
              return team ? `/season/${team.year}/team/${team.espn_team_id}` : undefined;
            })()}
            runnersUp={bestRecordRunnersUp.map(r => (
              <>
                <b className="text-ink">{r.teamName}</b> · {yearLabel(r.year)} ·{" "}
                {formatRecord(r.wins, r.losses, r.ties)} ({formatWinPct(r.winPct)})
              </>
            ))}
          />
        )}
        {worstRecord && (
          <StatCard
            label="Fewest wins"
            value={`${formatRecord(worstRecord.wins, worstRecord.losses, worstRecord.ties)} (${formatWinPct(worstRecord.winPct)})`}
            accent="negative"
            detail={
              <>
                <b className="text-ink">{worstRecord.teamName}</b> · {yearLabel(worstRecord.year)}
              </>
            }
            to={(() => {
              const team = findTeamForOwnerYear(teams, worstRecord.owners[0].ownerId, worstRecord.year);
              return team ? `/season/${team.year}/team/${team.espn_team_id}` : undefined;
            })()}
            runnersUp={worstRecordRunnersUp.map(r => (
              <>
                <b className="text-ink">{r.teamName}</b> · {yearLabel(r.year)} ·{" "}
                {formatRecord(r.wins, r.losses, r.ties)} ({formatWinPct(r.winPct)})
              </>
            ))}
          />
        )}
        {bestToMiss && (
          <StatCard
            label="Best Record to Not Win the Title"
            value={`${formatRecord(bestToMiss.wins, bestToMiss.losses, bestToMiss.ties)} (${formatWinPct(bestToMiss.winPct)})`}
            accent="positive"
            to={seasonTo(bestToMiss.year)}
            detail={
              <>
                <b className="text-ink">{bestToMiss.teamName}</b> · {yearLabel(bestToMiss.year)} · Finished No.{" "}
                {bestToMiss.finalRank}
              </>
            }
            runnersUp={bestToMissRunnersUp.map(r => (
              <>
                <b className="text-ink">{r.teamName}</b> · {yearLabel(r.year)} ·{" "}
                {formatRecord(r.wins, r.losses, r.ties)} ({formatWinPct(r.winPct)}) · Finished No. {r.finalRank}
              </>
            ))}
          />
        )}
        {worstToWin && (
          <StatCard
            label="Worst Record to Win the Title"
            value={`${formatRecord(worstToWin.wins, worstToWin.losses, worstToWin.ties)} (${formatWinPct(worstToWin.winPct)})`}
            accent="negative"
            to={seasonTo(worstToWin.year)}
            detail={
              <>
                <b className="text-ink">{worstToWin.teamName}</b> · {yearLabel(worstToWin.year)}
              </>
            }
            runnersUp={worstToWinRunnersUp.map(r => (
              <>
                <b className="text-ink">{r.teamName}</b> · {yearLabel(r.year)} ·{" "}
                {formatRecord(r.wins, r.losses, r.ties)} ({formatWinPct(r.winPct)})
              </>
            ))}
          />
        )}
        {overachiever && (
          <StatCard
            label="Biggest Overachiever"
            value={`+${overachiever.gap}`}
            accent="positive"
            to={seasonTo(overachiever.year)}
            detail={
              <>
                <b className="text-ink">{overachiever.teamName}</b> · {yearLabel(overachiever.year)} · No.{" "}
                {overachiever.seed} Seed → Finished No. {overachiever.finalRank}
              </>
            }
            runnersUp={overachieverRunnersUp.map(r => (
              <>
                <b className="text-ink">{r.teamName}</b> · {yearLabel(r.year)} · No {r.seed} → Finished No.{" "}
                {r.finalRank} ({r.gap >= 0 ? "+" : ""}
                {r.gap})
              </>
            ))}
          />
        )}
        {underachiever && (
          <StatCard
            label="Biggest Underachiever"
            value={String(underachiever.gap)}
            accent="negative"
            to={seasonTo(underachiever.year)}
            detail={
              <>
                <b className="text-ink">{underachiever.teamName}</b> · {yearLabel(underachiever.year)} · No.{" "}
                {underachiever.seed} → Finished No. {underachiever.finalRank}
              </>
            }
            runnersUp={underachieverRunnersUp.map(r => (
              <>
                <b className="text-ink">{r.teamName}</b> · {yearLabel(r.year)} · No. {r.seed} → Finished No.{" "}
                {r.finalRank} ({r.gap})
              </>
            ))}
          />
        )}
        {bestDiff && (
          <StatCard
            label="Best Single Season Point Differential"
            value={formatDifferential(bestDiff.differential)}
            accent="positive"
            detail={
              <>
                <b className="text-ink">{bestDiff.teamName}</b> · {yearLabel(bestDiff.year)}
              </>
            }
            to={(() => {
              const team = findTeamForOwnerYear(teams, bestDiff.owners[0].ownerId, bestDiff.year);
              return team ? `/season/${team.year}/team/${team.espn_team_id}` : undefined;
            })()}
            runnersUp={bestDiffRunnersUp.map(r => (
              <>
                <b className="text-ink">{r.teamName}</b> · {yearLabel(r.year)} · {formatDifferential(r.differential)}
              </>
            ))}
          />
        )}
        {worstDiff && (
          <StatCard
            label="Worst Single Season Point Differential"
            value={formatDifferential(worstDiff.differential)}
            accent="negative"
            detail={
              <>
                <b className="text-ink">{worstDiff.teamName}</b> · {yearLabel(worstDiff.year)}
              </>
            }
            to={(() => {
              const team = findTeamForOwnerYear(teams, worstDiff.owners[0].ownerId, worstDiff.year);
              return team ? `/season/${team.year}/team/${team.espn_team_id}` : undefined;
            })()}
            runnersUp={worstDiffRunnersUp.map(r => (
              <>
                <b className="text-ink">{r.teamName}</b> · {yearLabel(r.year)} · {formatDifferential(r.differential)}
              </>
            ))}
          />
        )}
        {bestSeasonPoints && (
          <StatCard
            label="Most points in a season"
            value={formatPoints(bestSeasonPoints.points)}
            accent="positive"
            detail={
              <>
                <b className="text-ink">{bestSeasonPoints.teamName}</b> · {yearLabel(bestSeasonPoints.year)}
              </>
            }
            to={(() => {
              const team = findTeamForOwnerYear(teams, bestSeasonPoints.owners[0].ownerId, bestSeasonPoints.year);
              return team ? `/season/${team.year}/team/${team.espn_team_id}` : undefined;
            })()}
            runnersUp={bestSeasonPointsRunnersUp.map(r => (
              <>
                <b className="text-ink">{r.teamName}</b> · {yearLabel(r.year)} · {formatPoints(r.points)}
              </>
            ))}
          />
        )}
        {worstSeasonPoints && (
          <StatCard
            label="Fewest points in a season"
            value={formatPoints(worstSeasonPoints.points)}
            accent="negative"
            detail={
              <>
                <b className="text-ink">{worstSeasonPoints.teamName}</b> · {yearLabel(worstSeasonPoints.year)}
              </>
            }
            to={(() => {
              const team = findTeamForOwnerYear(teams, worstSeasonPoints.owners[0].ownerId, worstSeasonPoints.year);
              return team ? `/season/${team.year}/team/${team.espn_team_id}` : undefined;
            })()}
            runnersUp={worstSeasonPointsRunnersUp.map(r => (
              <>
                <b className="text-ink">{r.teamName}</b> · {yearLabel(r.year)} · {formatPoints(r.points)}
              </>
            ))}
          />
        )}
        {bestPerGame && (
          <StatCard
            label="Points-per-game"
            value={formatPoints(bestPerGame.pointsPerGame)}
            detail={
              <>
                <b className="text-ink">{bestPerGame.teamName}</b> · {yearLabel(bestPerGame.year)}
              </>
            }
            to={(() => {
              const team = findTeamForOwnerYear(teams, bestPerGame.owners[0].ownerId, bestPerGame.year);
              return team ? `/season/${team.year}/team/${team.espn_team_id}` : undefined;
            })()}
            runnersUp={bestPerGameRunnersUp.map(r => (
              <>
                <b className="text-ink">{r.teamName}</b> · {yearLabel(r.year)} · {formatPoints(r.pointsPerGame)}
              </>
            ))}
          />
        )}
        {winStreak && (
          <StatCard
            label="Longest Win Streak"
            value={formatStreak(winStreak.length)}
            accent="positive"
            to={(() => {
              const team = findTeamForOwnerYear(teams, winStreak.owners[0].ownerId, winStreak.year);
              return team ? `/season/${team.year}/team/${team.espn_team_id}` : seasonTo(winStreak.year);
            })()}
            detail={
              <>
                <b className="text-ink">{winStreak.teamName}</b> · {yearLabel(winStreak.year)}
              </>
            }
            runnersUp={winStreakRunnersUp.map(r => (
              <>
                <b className="text-ink">{r.teamName}</b> · {yearLabel(r.year)} · {formatStreak(r.length)}
              </>
            ))}
          />
        )}
        {lossStreak && (
          <StatCard
            label="Longest Losing Streak"
            value={formatStreak(lossStreak.length)}
            accent="negative"
            to={(() => {
              const team = findTeamForOwnerYear(teams, lossStreak.owners[0].ownerId, lossStreak.year);
              return team ? `/season/${team.year}/team/${team.espn_team_id}` : seasonTo(lossStreak.year);
            })()}
            detail={
              <>
                <b className="text-ink">{lossStreak.teamName}</b> · {yearLabel(lossStreak.year)}
              </>
            }
            runnersUp={lossStreakRunnersUp.map(r => (
              <>
                <b className="text-ink">{r.teamName}</b> · {yearLabel(r.year)} · {formatStreak(r.length)}
              </>
            ))}
          />
        )}
      </div>
      {(flaggedShortSeasons.length > 0 || flaggedInProgressSeasons.length > 0) && (
        <p className="mt-2 text-xs text-ink-faint">
          {[
            ...flaggedShortSeasons.map(s => `*The ${s.year} major league season was ${s.regular_season_weeks} weeks.`),
            ...flaggedInProgressSeasons.map(
              s =>
                `†The ${s.year} season is still in progress (through Week ${s.current_week}) — this record may still change.`
            ),
          ].join(" ")}
        </p>
      )}
    </div>
  );
}
