import { useMemo } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { RouteLoading } from "../../components/RouteLoading";
import { SectionHeading } from "../../components/SectionHeading";
import { useAsync, useAsyncList } from "../../hooks/useAsync";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { Board, TEN_ROWS } from "../../components/Board";
import { aggregateSeasonRoster, formatWeekRuns, getSeasonTeamEntries, getTeamSeasonILWeeks } from "../../lib/boxScore";
import { loadBoxScores, loadKeepers, loadSeasons, loadTeams, loadTransactions } from "../../lib/data";
import { formatPoints, formatRecord, formatWinPct } from "../../lib/format";
import { winPct } from "../../lib/stats";
import { getSeasonRosterMarkers } from "../../lib/transactions";
import type { Keeper, Season, Team, Transaction } from "../../types";
import { SeasonRosterTables } from "../Owner/SeasonRosterTables";

interface SeasonTeamPageData {
  seasons: Season[];
  teams: Team[];
  keepers: Keeper[];
  transactions: Transaction[];
}

// loadTransactions() is cached module-wide by other routes, so this rarely adds a fetch.
async function loadSeasonTeamData(): Promise<SeasonTeamPageData> {
  const [seasons, teams, keepers, transactions] = await Promise.all([
    loadSeasons(),
    loadTeams(),
    loadKeepers(),
    loadTransactions(),
  ]);
  return { seasons, teams, keepers, transactions };
}

export default function SeasonTeamPage() {
  const { year: yearParam, teamId: teamIdParam } = useParams<{ year?: string; teamId?: string }>();
  const state = useAsync(loadSeasonTeamData, []);

  const seasons = useAsyncList(state, d => d.seasons);
  const teams = useAsyncList(state, d => d.teams);
  const keepers = useAsyncList(state, d => d.keepers);

  const parsedYear = yearParam ? Number(yearParam) : undefined;
  const parsedTeamId = teamIdParam ? Number(teamIdParam) : undefined;

  const season = useMemo(() => seasons.find(s => s.year === parsedYear), [seasons, parsedYear]);
  const team = useMemo(
    () => teams.find(t => t.year === parsedYear && t.espn_team_id === parsedTeamId),
    [teams, parsedYear, parsedTeamId]
  );
  useDocumentTitle(team ? `${team.team_name} · ${team.year}` : "Team");

  const boxScoresState = useAsync(
    () => {
      if (!team || !season || season.coverage.box_scores === "missing") return Promise.resolve([]);
      return loadBoxScores(team.year);
    },
    [team?.year, season?.coverage.box_scores]
  );

  const teamKeepers = useMemo(
    () =>
      team && season
        ? keepers.filter(k => k.year === season.year && k.espn_team_id === team.espn_team_id)
        : [],
    [keepers, team, season]
  );

  const teamEntries = useMemo(
    () =>
      team && boxScoresState.status === "success"
        ? getSeasonTeamEntries(boxScoresState.data, team.espn_team_id)
        : [],
    [boxScoresState, team]
  );
  const roster = useMemo(() => aggregateSeasonRoster(teamEntries), [teamEntries]);

  // 2018's slots are a season-end snapshot, not day-accurate, so IL needs "full".
  const slotsAreDayAccurate = season?.coverage.stat_lines === "full";
  const ilRows = useMemo(
    () => (slotsAreDayAccurate ? getTeamSeasonILWeeks(teamEntries) : []),
    [slotsAreDayAccurate, teamEntries]
  );

  // Undefined for uncovered years so no marker renders, rather than a false "nobody was dropped".
  const transactions = useAsyncList(state, d => d.transactions);
  const markers = useMemo(
    () =>
      team && season && season.coverage.transactions !== "missing"
        ? getSeasonRosterMarkers(transactions, team.year, team.espn_team_id)
        : undefined,
    [transactions, team, season]
  );

  if (state.status === "loading") {
    return <RouteLoading label="Loading team data…" />;
  }
  if (state.status === "error") {
    return <p className="text-ink-dim">Couldn't load team data. Try refreshing the page.</p>;
  }
  if (seasons.length === 0) {
    return <p className="text-ink-dim">No season data available yet.</p>;
  }

  if (!season || !team) {
    return <Navigate to="/season" replace />;
  }

  const boxScoresCovered = season.coverage.box_scores !== "missing";

  const wp = winPct(team.overall);

  return (
    <div>
      <div className="mb-6">
        <Link to={`/season/${season.year}`} className="text-xs text-ink-faint hover:underline">
          ← {season.year}
        </Link>
        <div className="mt-3">
          <h1 className="text-2xl font-extrabold">{team.team_name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-ink-faint tabular-nums">
            <span>
              {formatRecord(team.overall.wins, team.overall.losses, team.overall.ties)} ({formatWinPct(wp)})
            </span>
            <span>·</span>
            <span>{formatPoints(team.overall.points_for)} points</span>
          </div>
        </div>
      </div>

      <div className="space-y-8">
        {teamKeepers.length > 0 && (
          <section>
            <SectionHeading as="h2" className="mb-3">
              Keepers
            </SectionHeading>
            <div className="flex flex-wrap gap-1.5">
              {teamKeepers.map(k => (
                <Link
                  key={k.player_id}
                  to={`/player/${k.player_id}`}
                  className="rounded-full bg-gold-soft px-2.5 py-1 text-xs font-bold text-gold hover:opacity-80">
                  {k.player_name}
                </Link>
              ))}
            </div>
          </section>
        )}

        <section>
          <SectionHeading as="h2" className="mb-3">
            Roster
          </SectionHeading>

          {!boxScoresCovered && (
            <p className="text-sm text-ink-dim">No box-score data on file for {season.year}.</p>
          )}

          {boxScoresCovered && boxScoresState.status === "loading" && (
            <p className="text-ink-dim">Loading roster…</p>
          )}

          {boxScoresCovered && boxScoresState.status === "error" && (
            <p className="text-ink-dim">Couldn't load box scores. Try refreshing the page.</p>
          )}

          {boxScoresCovered && boxScoresState.status === "success" && roster.length === 0 && (
            <p className="text-sm text-ink-dim">No box-score activity on record for this team-season.</p>
          )}

          {boxScoresCovered && boxScoresState.status === "success" && roster.length > 0 && (
            <SeasonRosterTables roster={roster} markers={markers} slotsAreDayAccurate={slotsAreDayAccurate} />
          )}
        </section>

        {ilRows.length > 0 && (
          <section>
            <SectionHeading as="h2" className="mb-3">
              Injured List
            </SectionHeading>
            <Board maxHeight={TEN_ROWS}>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    {["Player", "Weeks"].map(label => (
                      <th
                        key={label}
                        scope="col"
                        className="sticky top-0 z-10 bg-surface px-3 py-2 text-left text-[0.66rem] font-semibold tracking-wide text-ink-faint uppercase">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ilRows.map(row => (
                    <tr key={row.playerId} className="border-t border-border hover:bg-surface-2">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Link to={`/player/${row.playerId}`} className="hover:underline">
                          {row.playerName}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-ink-dim tabular-nums">{formatWeekRuns(row.weeks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Board>
            <p className="mt-2 text-[0.66rem] text-ink-faint">
              Players and their time on the injured list for the season.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
