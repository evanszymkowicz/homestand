import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Board, TEN_ROWS } from "../../components/Board";
import { CoverageBadge } from "../../components/CoverageBadge";
import { RouteLoading } from "../../components/RouteLoading";
import { SectionHeading } from "../../components/SectionHeading";
import { SegmentedToggle } from "../../components/SegmentedToggle";
import { useAsync, useAsyncList } from "../../hooks/useAsync";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { formatWeekRuns, getMatchupILStints, getMatchupSideEntries, hasAccumulatedStats } from "../../lib/boxScore";
import { loadBoxScores, loadMatchups, loadOwners, loadSeasons, loadTeams, loadTransactions } from "../../lib/data";
import { formatPoints } from "../../lib/format";
import { findTeam, PLAYOFF_TIER_LABELS } from "../../lib/schedule";
import { teamOwnerNames } from "../../lib/stats";
import { getMatchupTransactionMarkers } from "../../lib/transactions";
import type { BoxScoreEntry, Matchup, MatchupSide, Owner, Season, Team, Transaction } from "../../types";
import { BoxScoreTable } from "./BoxScoreTable";
import { PointsPerDay } from "./PointsPerDay";

interface MatchupDetailData {
  seasons: Season[];
  teams: Team[];
  owners: Owner[];
  matchups: Matchup[];
  boxScores: BoxScoreEntry[];
  transactions: Transaction[];
}

// loadBoxScores(year) is the lazy-load boundary
async function loadMatchupDetailData(year: number): Promise<MatchupDetailData> {
  const [seasons, teams, owners, matchups, boxScores, transactions] = await Promise.all([
    loadSeasons(),
    loadTeams(),
    loadOwners(),
    loadMatchups(),
    loadBoxScores(year),
    loadTransactions(),
  ]);
  return { seasons, teams, owners, matchups, boxScores, transactions };
}

function roundLabel(matchup: Matchup): string {
  return matchup.playoff_tier === null
    ? `Week ${matchup.week}`
    : `${PLAYOFF_TIER_LABELS[matchup.playoff_tier] ?? matchup.playoff_tier} · Week ${matchup.week}`;
}

interface SideHeaderProps {
  side: MatchupSide;
  year: number;
  teams: Team[];
  owners: Owner[];
  isWinner: boolean;
}

/** Bigger sibling of MatchupCard's SideRow for the matchup's own page — same
 * font-weight-only winner emphasis, never color alone. */
function SideHeader({ side, year, teams, owners, isWinner }: SideHeaderProps) {
  const team = findTeam(teams, year, side.espn_team_id);
  return (
    <div className="flex-1 rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className={`text-lg ${isWinner ? "font-bold text-ink" : "text-ink-dim"}`}>
        {team?.team_name ?? "Unknown team"}
      </div>
      <div className="text-sm text-ink-faint">{team ? teamOwnerNames(team, owners) : "—"}</div>
      <div className={`mt-2 text-3xl tabular-nums ${isWinner ? "font-extrabold text-ink" : "text-ink-dim"}`}>
        {formatPoints(side.score)}
      </div>
    </div>
  );
}

export default function MatchupRoute() {
  const { year: yearParam, matchupId: matchupIdParam } = useParams<{ year: string; matchupId: string }>();
  const year = yearParam ? Number(yearParam) : NaN;
  const matchupId = matchupIdParam ? Number(matchupIdParam) : NaN;
  const paramsValid = Boolean(yearParam) && Boolean(matchupIdParam) && !Number.isNaN(year) && !Number.isNaN(matchupId);

  const state = useAsync(() => loadMatchupDetailData(year), [year], paramsValid);

  // Hooks must run unconditionally on every render, so these are derived
  // before the invalid-param/loading/error/not-found early returns below.
  const seasons = useAsyncList(state, d => d.seasons);
  const teams = useAsyncList(state, d => d.teams);
  const owners = useAsyncList(state, d => d.owners);
  const matchups = useAsyncList(state, d => d.matchups);
  const boxScores = useAsyncList(state, d => d.boxScores);
  const transactions = useAsyncList(state, d => d.transactions);

  const matchup = useMemo(
    () => matchups.find(m => m.year === year && m.matchup_id === matchupId),
    [matchups, year, matchupId]
  );
  useDocumentTitle(matchup ? roundLabel(matchup) : `Matchup · ${year}`);

  const homeEntries = useMemo(
    () => (matchup ? getMatchupSideEntries(boxScores, matchup.matchup_id, matchup.home.espn_team_id ?? -1) : []),
    [boxScores, matchup]
  );
  const awayEntries = useMemo(
    () =>
      matchup?.away && matchup.away.espn_team_id !== null
        ? getMatchupSideEntries(boxScores, matchup.matchup_id, matchup.away.espn_team_id)
        : [],
    [boxScores, matchup]
  );

  // Gated so an uncovered year renders no markers instead of a false "nothing happened."
  const transactionsCovered = seasons.find(s => s.year === year)?.coverage.transactions !== "missing";
  const homeMarkers = useMemo(
    () =>
      matchup && transactionsCovered
        ? getMatchupTransactionMarkers(transactions, year, matchup.week, matchup.home.espn_team_id ?? -1)
        : undefined,
    [transactions, year, matchup, transactionsCovered]
  );
  const awayMarkers = useMemo(
    () =>
      matchup?.away && matchup.away.espn_team_id !== null && transactionsCovered
        ? getMatchupTransactionMarkers(transactions, year, matchup.week, matchup.away.espn_team_id)
        : undefined,
    [transactions, year, matchup, transactionsCovered]
  );

  // 2018's slots are a season-end snapshot, not day-accurate, so this requires "full" (2019+), not just "not missing".
  const slotsAreDayAccurate = seasons.find(s => s.year === year)?.coverage.stat_lines === "full";
  // Scans the whole season's box scores, so it must not rerun on a side/stat toggle.
  const ilStints = useMemo(
    () =>
      matchup && slotsAreDayAccurate
        ? getMatchupILStints(
            boxScores,
            matchup.week,
            [matchup.home.espn_team_id, matchup.away?.espn_team_id].filter((id): id is number => id != null)
          )
        : [],
    [boxScores, matchup, slotsAreDayAccurate]
  );

  const [selectedSide, setSelectedSide] = useState<"home" | "away">("home");

  if (!paramsValid) {
    return <p className="text-ink-dim">Invalid matchup link.</p>;
  }
  if (state.status === "loading") {
    return <RouteLoading label="Loading box score…" />;
  }
  if (state.status === "error") {
    return <p className="text-ink-dim">Couldn't load box score. Try refreshing the page.</p>;
  }
  if (!matchup) {
    return (
      <p className="text-ink-dim">
        No matchup found for {yearParam}, pick {matchupIdParam}.{" "}
        <Link to={`/season/${yearParam}`} className="text-accent underline">
          Back to {yearParam}
        </Link>
        .
      </p>
    );
  }

  const homeTeamName = findTeam(teams, year, matchup.home.espn_team_id)?.team_name ?? "Home";
  const awayTeamName = matchup.away ? (findTeam(teams, year, matchup.away.espn_team_id)?.team_name ?? "Away") : null;

  const activeSide = selectedSide === "away" && matchup.away ? "away" : "home";
  // IL-only rows carry no production and live in the Injured List board instead.
  const activeEntries = (activeSide === "away" ? awayEntries : homeEntries).filter(hasAccumulatedStats);
  const activeMarkers = activeSide === "away" ? awayMarkers : homeMarkers;
  //  For years with missing statlines
  const statLinesCovered = seasons.find(s => s.year === year)?.coverage.stat_lines !== "missing";
  const teamNameById = new Map(
    [
      [matchup.home.espn_team_id, homeTeamName] as const,
      ...(matchup.away && awayTeamName ? [[matchup.away.espn_team_id, awayTeamName] as const] : []),
    ].filter((pair): pair is readonly [number, string] => pair[0] !== null)
  );

  return (
    <div>
      <Link to={`/season/${year}`} className="text-xs text-ink-faint hover:text-ink">
        ← {year}
      </Link>
      <h2 className="mt-2 text-xl font-bold">{roundLabel(matchup)}</h2>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <SideHeader
          side={matchup.home}
          year={year}
          teams={teams}
          owners={owners}
          isWinner={matchup.winner === "HOME"}
        />
        {matchup.away ? (
          <SideHeader
            side={matchup.away}
            year={year}
            teams={teams}
            owners={owners}
            isWinner={matchup.winner === "AWAY"}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-4 text-sm text-ink-faint italic">
            Bye
          </div>
        )}
      </div>

      <div className="mt-7 mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SectionHeading as="h3">Box Score</SectionHeading>
          <CoverageBadge seasons={seasons} domain="stat_lines" />
          {/* The badge describes the stat-line and slot columns this matchup's
              season does NOT have (both correctly gated off below), not the
              points and bench it does show. On a pre-2019 matchup that read as
              "since 2019" over an entirely 2015 table with no explanation. */}
          {!statLinesCovered && (
            <span className="text-xs text-ink-faint">Points and bench shown; stat lines and slots start in 2019.</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {matchup.away && awayTeamName && (
            <SegmentedToggle
              ariaLabel="Team"
              value={activeSide}
              onChange={setSelectedSide}
              options={[
                { key: "home", label: homeTeamName },
                { key: "away", label: awayTeamName },
              ]}
            />
          )}
        </div>
      </div>

      <BoxScoreTable
        title={activeSide === "away" && awayTeamName ? awayTeamName : homeTeamName}
        entries={activeEntries}
        droppedPlayerIds={activeMarkers?.droppedPlayerIds}
        addedPlayerIds={activeMarkers?.addedPlayerIds}
        tradedAwayPlayerIds={activeMarkers?.tradedAwayPlayerIds}
        showSlots={slotsAreDayAccurate}
        showStats={statLinesCovered}
      />
      <p className="mt-2 text-[0.66rem] text-ink-faint">
        {activeMarkers && (
          <>
            {"Grayed out = dropped to waivers/free agency."}
            <br />
            <span className="font-bold">+</span>
            {" = added from free agency/waivers."}
            <br />
            <span className="font-bold text-diverge-pos text-[0.6em]">●</span>
            {" = placed on the IL during the matchup."}
            <br />
            <span className="font-bold">-</span>
            {" = traded away during the matchup."}
          </>
        )}
      </p>

      {slotsAreDayAccurate && ilStints.length > 0 && (
        <div className="mt-4">
          <Board title="Injured List" maxHeight={TEN_ROWS}>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {["Player", "Team", "Weeks on IL"].map(label => (
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
                {ilStints.map(stint => (
                  <tr
                    key={`${stint.espnTeamId}:${stint.playerId}`}
                    className="border-t border-border hover:bg-surface-2">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Link to={`/player/${stint.playerId}`} className="hover:underline">
                        {stint.playerName}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-ink-dim">{teamNameById.get(stint.espnTeamId) ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {stint.weeks.length}
                      <span className="ml-1.5 text-[0.66rem] text-ink-faint">wk {formatWeekRuns(stint.weeks)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Board>
        </div>
      )}

      <div className="mt-8">
        {matchup.away && awayTeamName ? (
          <PointsPerDay
            homeLabel={homeTeamName}
            awayLabel={awayTeamName}
            homeEntries={homeEntries}
            awayEntries={awayEntries}
          />
        ) : (
          <p className="text-sm text-ink-faint italic">No opponent this week (bye) — nothing to compare.</p>
        )}
      </div>
    </div>
  );
}
