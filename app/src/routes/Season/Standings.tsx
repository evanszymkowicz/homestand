import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Board } from "../../components/Board";
import { ChampionBadge } from "../../components/ChampionBadge";
import { RankBadge } from "../../components/RankBadge";
import { SectionHeading } from "../../components/SectionHeading";
import { SegmentedToggle } from "../../components/SegmentedToggle";
import { SortHeader } from "../../components/SortHeader";
import { TickerText } from "../../components/TickerText";
import { TrophyCard } from "../../components/TrophyCard";
import { useAsync } from "../../hooks/useAsync";
import { useSortableRows } from "../../hooks/useSortableRows";
import { aggregateTeamSeasonStatLine, getSeasonTeamEntries, type TeamSeasonStatLine } from "../../lib/boxScore";
import { finalYearTeams } from "../../lib/coverage";
import { loadBoxScores } from "../../lib/data";
import { formatInnings, formatOwnerNames, formatRecord, formatPoints, formatWinPct } from "../../lib/format";
import {
  getChampionshipGameResult,
  getDivisionStandings,
  getFinalStandings,
  type DivisionStandingRow,
} from "../../lib/schedule";
import { getChampionshipsByYear, teamOwnerNames, winPct } from "../../lib/stats";
import { teamMoves } from "../../lib/transactions";
import type { Matchup, Owner, Season, Team } from "../../types";

interface StandingsProps {
  season: Season;
  seasons: Season[];
  teams: Team[];
  owners: Owner[];
  matchups: Matchup[];
}

/**
 * final_rank is ESPN's actual finish and is meaningful once a season is over.
 * mid-season every team's final_rank is 0
 */
function displayRank(team: Team, isInProgress: boolean): number {
  return isInProgress ? (team.current_projected_rank ?? 0) : team.final_rank;
}

function currentStandingsOrder(teams: Team[], year: number): Team[] {
  return teams
    .filter(t => t.year === year)
    .sort((a, b) => (a.current_projected_rank ?? 999) - (b.current_projected_rank ?? 999));
}

/** Owner ids of the most recently completed season's champion(s), so an
 * in-progress season can crown whichever current team carries that owner
 * forward -- past seasons show their own champion via the Champion TrophyCard
 * instead, so they don't need a row-level crown. */
function reigningChampionOwnerIds(teams: Team[], seasons: Season[], currentYear: number): Set<string> {
  const priorFinalYears = seasons.filter(s => s.status === "final" && s.year < currentYear).map(s => s.year);
  if (priorFinalYears.length === 0) return new Set();
  const lastCompletedYear = Math.max(...priorFinalYears);
  return new Set(teams.filter(t => t.year === lastCompletedYear && t.final_rank === 1).flatMap(t => t.owner_ids));
}

type DivisionSortKey = "wins" | "losses" | "ties" | "pointsFor" | "pointsAgainst" | "winPct" | "moves";

function divisionSortValue(row: DivisionStandingRow, key: DivisionSortKey): number {
  switch (key) {
    case "wins":
      return row.team.overall.wins;
    case "losses":
      return row.team.overall.losses;
    case "ties":
      return row.team.overall.ties;
    case "pointsFor":
      return row.team.overall.points_for;
    case "pointsAgainst":
      return row.team.overall.points_against;
    case "winPct":
      return row.winPct;
    case "moves":
      return teamMoves(row.team);
  }
}

interface DivisionStandingsBoardProps {
  rows: DivisionStandingRow[];
  owners: Owner[];
  isInProgress: boolean;
  reigningOwnerIds: Set<string> | null;
}

/** Rank lives here now that Overall Standings shows season stats instead; the reigning-champion
 * crown sits next to the team name so the rank column stays a fixed width whether or not a row
 * carries it. */
function DivisionStandingsBoard({ rows, owners, isInProgress, reigningOwnerIds }: DivisionStandingsBoardProps) {
  const { sorted, sortKey, direction, toggleSort } = useSortableRows<DivisionStandingRow, DivisionSortKey>(
    rows,
    divisionSortValue,
    "winPct",
    "desc"
  );

  return (
    <Board>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th
              scope="col"
              className="w-px px-3 py-2 text-center text-[0.66rem] font-semibold tracking-wide whitespace-nowrap text-ink-faint uppercase">
              Rank
            </th>
            <th
              scope="col"
              className="px-3 py-2 text-left text-[0.66rem] font-semibold tracking-wide text-ink-faint uppercase">
              Team
            </th>
            <SortHeader
              label="W"
              sortKey="wins"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
            <SortHeader
              label="L"
              sortKey="losses"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
            <SortHeader
              label="T"
              sortKey="ties"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
            <SortHeader
              label="PF"
              sortKey="pointsFor"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
            <SortHeader
              label="PA"
              sortKey="pointsAgainst"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
            <SortHeader
              label="Win%"
              sortKey="winPct"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
            <SortHeader
              label="Moves"
              sortKey="moves"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
              ariaLabel="Roster moves: acquisitions plus drops"
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ team, winPct: teamWinPct }) => (
            <tr key={team.espn_team_id} className="border-t border-border hover:bg-surface-2">
              <td className="w-px px-3 py-2 text-center whitespace-nowrap">
                <RankBadge rank={displayRank(team, isInProgress)} provisional={isInProgress} />
              </td>
              <td className="px-3 py-2">
                <Link to={`/season/${team.year}/team/${team.espn_team_id}`} className="hover:underline">
                  <div className="flex items-center gap-1.5 font-semibold">
                    {team.team_name}
                    {reigningOwnerIds && team.owner_ids.some(id => reigningOwnerIds.has(id)) && (
                      <ChampionBadge label="Defending champion" />
                    )}
                  </div>
                </Link>
                <div className="text-xs text-ink-faint">{teamOwnerNames(team, owners)}</div>
              </td>
              <td className="px-3 py-2 text-center tabular-nums">{team.overall.wins}</td>
              <td className="px-3 py-2 text-center tabular-nums">{team.overall.losses}</td>
              <td className="px-3 py-2 text-center tabular-nums">{team.overall.ties}</td>
              <td className="px-3 py-2 text-center tabular-nums">{formatPoints(team.overall.points_for)}</td>
              <td className="px-3 py-2 text-center tabular-nums">{formatPoints(team.overall.points_against)}</td>
              <td className="px-3 py-2 text-center tabular-nums">{formatWinPct(teamWinPct)}</td>
              <td className="px-3 py-2 text-center tabular-nums">{teamMoves(team)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Board>
  );
}

interface StatColumnDef {
  key: string;
  label: string;
  /** Distinguishes batting vs. pitching "BB"/"K", where both share the bare label otherwise. */
  ariaLabel?: string;
  value: (stat: TeamSeasonStatLine) => string;
  sortValue: (stat: TeamSeasonStatLine) => number;
}

function statCell(value: number | undefined, hasLine: boolean): string {
  return hasLine ? String(value ?? 0) : "—";
}

const BATTING_STAT_COLUMNS: StatColumnDef[] = [
  {
    key: "ab",
    label: "AB",
    value: s => statCell(s.batting?.ab, s.batting !== null),
    sortValue: s => s.batting?.ab ?? 0,
  },
  { key: "r", label: "R", value: s => statCell(s.batting?.r, s.batting !== null), sortValue: s => s.batting?.r ?? 0 },
  {
    key: "1b",
    label: "1B",
    value: s => statCell(s.batting?.singles, s.batting !== null),
    sortValue: s => s.batting?.singles ?? 0,
  },
  {
    key: "2b",
    label: "2B",
    value: s => statCell(s.batting?.doubles, s.batting !== null),
    sortValue: s => s.batting?.doubles ?? 0,
  },
  {
    key: "3b",
    label: "3B",
    value: s => statCell(s.batting?.triples, s.batting !== null),
    sortValue: s => s.batting?.triples ?? 0,
  },
  {
    key: "hr",
    label: "HR",
    value: s => statCell(s.batting?.hr, s.batting !== null),
    sortValue: s => s.batting?.hr ?? 0,
  },
  {
    key: "rbi",
    label: "RBI",
    value: s => statCell(s.batting?.rbi, s.batting !== null),
    sortValue: s => s.batting?.rbi ?? 0,
  },
  {
    key: "bat_bb",
    label: "BB",
    ariaLabel: "Batting walks",
    value: s => statCell(s.batting?.bb, s.batting !== null),
    sortValue: s => s.batting?.bb ?? 0,
  },
  {
    key: "bat_k",
    label: "K",
    ariaLabel: "Batting strikeouts",
    value: s => statCell(s.batting?.k, s.batting !== null),
    sortValue: s => s.batting?.k ?? 0,
  },
  {
    key: "hbp",
    label: "HBP",
    value: s => statCell(s.batting?.hbp, s.batting !== null),
    sortValue: s => s.batting?.hbp ?? 0,
  },
  {
    key: "sb",
    label: "SB",
    value: s => statCell(s.batting?.sb, s.batting !== null),
    sortValue: s => s.batting?.sb ?? 0,
  },
  {
    key: "cs",
    label: "CS",
    value: s => statCell(s.batting?.cs, s.batting !== null),
    sortValue: s => s.batting?.cs ?? 0,
  },
  {
    key: "gidp",
    label: "GIDP",
    value: s => statCell(s.batting?.gidp, s.batting !== null),
    sortValue: s => s.batting?.gidp ?? 0,
  },
];

const PITCHING_STAT_COLUMNS: StatColumnDef[] = [
  {
    key: "ip",
    label: "IP",
    value: s => (s.pitching !== null ? formatInnings(s.pitching.outs) : "—"),
    sortValue: s => s.pitching?.outs ?? 0,
  },
  {
    key: "h",
    label: "H",
    value: s => statCell(s.pitching?.h, s.pitching !== null),
    sortValue: s => s.pitching?.h ?? 0,
  },
  {
    key: "ra",
    label: "RA",
    value: s => statCell(s.pitching?.r, s.pitching !== null),
    sortValue: s => s.pitching?.r ?? 0,
  },
  {
    key: "er",
    label: "ER",
    value: s => statCell(s.pitching?.er, s.pitching !== null),
    sortValue: s => s.pitching?.er ?? 0,
  },
  {
    key: "pit_bb",
    label: "BB",
    ariaLabel: "Pitching walks allowed",
    value: s => statCell(s.pitching?.bb, s.pitching !== null),
    sortValue: s => s.pitching?.bb ?? 0,
  },
  {
    key: "hb",
    label: "HB",
    value: s => statCell(s.pitching?.hb, s.pitching !== null),
    sortValue: s => s.pitching?.hb ?? 0,
  },
  {
    key: "pit_k",
    label: "K",
    ariaLabel: "Pitching strikeouts",
    value: s => statCell(s.pitching?.k, s.pitching !== null),
    sortValue: s => s.pitching?.k ?? 0,
  },
  {
    key: "so",
    label: "SO",
    ariaLabel: "Shutouts",
    value: s => statCell(s.pitching?.sho, s.pitching !== null),
    sortValue: s => s.pitching?.sho ?? 0,
  },
  {
    key: "nh",
    label: "NH",
    ariaLabel: "No-hitters",
    value: s => statCell(s.pitching?.nh, s.pitching !== null),
    sortValue: s => s.pitching?.nh ?? 0,
  },
  {
    key: "pg",
    label: "PG",
    ariaLabel: "Perfect games",
    value: s => statCell(s.pitching?.pg, s.pitching !== null),
    sortValue: s => s.pitching?.pg ?? 0,
  },
  {
    key: "w",
    label: "W",
    value: s => statCell(s.pitching?.wins, s.pitching !== null),
    sortValue: s => s.pitching?.wins ?? 0,
  },
  {
    key: "l",
    label: "L",
    value: s => statCell(s.pitching?.losses, s.pitching !== null),
    sortValue: s => s.pitching?.losses ?? 0,
  },
];

const STAT_TABLE_COLUMNS = [...BATTING_STAT_COLUMNS, ...PITCHING_STAT_COLUMNS];

interface TeamStatRow {
  team: Team;
  stat: TeamSeasonStatLine;
}

type StatSortKey = "team" | (typeof STAT_TABLE_COLUMNS)[number]["key"];

function statSortValue(row: TeamStatRow, key: StatSortKey): number | string {
  if (key === "team") return row.team.team_name;
  return STAT_TABLE_COLUMNS.find(c => c.key === key)?.sortValue(row.stat) ?? 0;
}

/** PG (perfect games) reading 0 for every team is correct -- it's never occurred in this league. */
function OverallStatTable({
  rows,
  owners,
  isInProgress,
}: {
  rows: TeamStatRow[];
  owners: Owner[];
  isInProgress: boolean;
}) {
  const { sorted, sortKey, direction, toggleSort } = useSortableRows<TeamStatRow, StatSortKey>(
    rows,
    statSortValue,
    "team",
    "asc"
  );

  return (
    <Board>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th
              scope="col"
              className="w-px px-3 py-2 text-center text-[0.66rem] font-semibold tracking-wide whitespace-nowrap text-ink-faint uppercase">
              Rank
            </th>
            <SortHeader
              label="Team"
              sortKey="team"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="left"
              stickyLeft
              className="border-r border-border"
            />
            {STAT_TABLE_COLUMNS.map(col => (
              <SortHeader
                key={col.key}
                label={col.label}
                ariaLabel={col.ariaLabel}
                sortKey={col.key}
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
                align="center"
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ team, stat }) => (
            <tr key={team.espn_team_id} className="group border-t border-border hover:bg-surface-2">
              <td className="w-px px-3 py-2 text-center whitespace-nowrap">
                <RankBadge rank={displayRank(team, isInProgress)} plain />
              </td>
              <td className="sticky left-0 z-10 border-r border-border bg-surface px-3 py-2 whitespace-nowrap group-hover:bg-surface-2">
                <Link to={`/season/${team.year}/team/${team.espn_team_id}`} className="hover:underline">
                  <div className="font-semibold">{team.team_name}</div>
                </Link>
                <div className="text-xs text-ink-faint">{teamOwnerNames(team, owners)}</div>
              </td>
              {STAT_TABLE_COLUMNS.map(col => (
                <td key={col.key} className="px-3 py-2 text-center tabular-nums">
                  {col.value(stat)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Board>
  );
}

/** season.divisions plus any division_id getDivisionStandings had to bucket
 * under a fallback key (a team whose division_id doesn't match any known
 * division) — so a data mismatch surfaces as an extra section instead of
 * silently dropping that team from the page. */
function divisionsToRender(season: Season, byDivision: Map<number, unknown>): { division_id: number; name: string }[] {
  const known = new Set(season.divisions.map(d => d.division_id));
  const extra = Array.from(byDivision.keys())
    .filter(id => !known.has(id))
    .map(id => ({ division_id: id, name: `Division ${id}` }));
  return [...season.divisions, ...extra];
}

export function Standings({ season, seasons, teams, owners, matchups }: StandingsProps) {
  const byDivision = getDivisionStandings(teams, season);
  const divisions = divisionsToRender(season, byDivision);
  const [selectedDivisionId, setSelectedDivisionId] = useState<string | null>(null);
  const activeDivisionId = divisions.some(d => String(d.division_id) === selectedDivisionId)
    ? selectedDivisionId
    : divisions[0]
      ? String(divisions[0].division_id)
      : null;
  const isInProgress = season.status === "in_progress";
  // final_rank isn't computed until a season ends (it reads 0 for every team
  // mid-season) -- an in-progress season orders by ESPN's live
  // current_projected_rank instead (see displayRank/currentStandingsOrder).
  const finalStandings = isInProgress
    ? currentStandingsOrder(teams, season.year)
    : getFinalStandings(teams, season.year);
  // Championship podiums require the season to be over -- an in-progress
  // season's final_rank is a live/provisional value, not a real result yet.
  const championshipsByYear = getChampionshipsByYear(finalYearTeams(teams, seasons), owners);
  const inProgressSeasons = seasons.filter(s => s.status === "in_progress").sort((a, b) => b.year - a.year);

  const highlightedYearRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    highlightedYearRef.current?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [season.year]);

  const reigningOwnerIds = isInProgress ? reigningChampionOwnerIds(teams, seasons, season.year) : null;

  const champion = finalStandings.find(t => displayRank(t, isInProgress) === 1);
  const runnerUp = finalStandings.find(t => displayRank(t, isInProgress) === 2);
  const championshipGame = champion && !isInProgress ? getChampionshipGameResult(matchups, teams, season.year) : null;
  const bestRecord = [...finalStandings].sort(
    (a, b) => winPct(b.overall) - winPct(a.overall) || b.overall.wins - a.overall.wins
  )[0];
  // A shared best record (identical W-L) can't be broken by the sort's
  // secondary key — attribute the honor to every co-holder, not array order.
  const bestRecordCoHolders = bestRecord
    ? finalStandings.filter(
        t =>
          winPct(t.overall) === winPct(bestRecord.overall) &&
          t.overall.wins === bestRecord.overall.wins &&
          t.overall.losses === bestRecord.overall.losses
      )
    : [];
  const pointsLeader = [...finalStandings].sort((a, b) => b.overall.points_for - a.overall.points_for)[0];

  // Fetched on demand for just this one year, same pattern as TeamSeasonRosterModal.tsx.
  const boxScoresState = useAsync(() => loadBoxScores(season.year), [season.year]);
  const statsCoverage = season.coverage.stat_lines;
  const teamStatRows: TeamStatRow[] = useMemo(() => {
    if (boxScoresState.status !== "success" || statsCoverage !== "full") return [];
    const boxScores = boxScoresState.data;
    return finalStandings.map(team => ({
      team,
      stat: aggregateTeamSeasonStatLine(getSeasonTeamEntries(boxScores, team.espn_team_id)),
    }));
  }, [boxScoresState, statsCoverage, finalStandings]);

  return (
    <div className="space-y-8">
      {(championshipsByYear.length > 0 || inProgressSeasons.length > 0) && (
        <div>
          <SectionHeading as="h3" className="mb-3">
            Season Champions
          </SectionHeading>
          <div className="scrollbar-accent flex gap-3 overflow-x-auto pb-4">
            {inProgressSeasons.map(s => {
              const current = currentStandingsOrder(teams, s.year).slice(0, 3);
              return (
                <Link
                  key={s.year}
                  ref={s.year === season.year ? highlightedYearRef : undefined}
                  to={`/season/${s.year}`}
                  className={`scorebook-card flex w-44 flex-none flex-col gap-2 p-3.5 hover:bg-surface-2 ${
                    s.year === season.year ? "" : "border-dashed"
                  }`}
                  style={{ borderColor: s.year === season.year ? "var(--color-accent)" : undefined }}>
                  <div className="flex items-center gap-1.5 text-sm font-extrabold">
                    {s.year}
                    <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[0.62rem] font-semibold text-ink-faint uppercase">
                      In progress
                    </span>
                  </div>
                  {current.map((team, i) => (
                    <div key={team.espn_team_id} className="flex items-center gap-2 text-[0.78rem]">
                      <RankBadge rank={i + 1} provisional />
                      <TickerText className="min-w-0 flex-1">{teamOwnerNames(team, owners)}</TickerText>
                    </div>
                  ))}
                </Link>
              );
            })}
            {championshipsByYear.map(y => (
              <Link
                key={y.year}
                ref={y.year === season.year ? highlightedYearRef : undefined}
                to={`/season/${y.year}`}
                className={`scorebook-card flex w-44 flex-none flex-col gap-2 p-3.5 hover:bg-surface-2`}
                style={{ borderColor: y.year === season.year ? "var(--color-accent)" : undefined }}>
                <div className="text-sm font-extrabold">{y.year}</div>
                <div className="flex items-center gap-2 text-[0.78rem]">
                  <RankBadge rank={1} />
                  <TickerText className="min-w-0 flex-1">{formatOwnerNames(y.champion)}</TickerText>
                </div>
                <div className="flex items-center gap-2 text-[0.78rem]">
                  <RankBadge rank={2} />
                  <TickerText className="min-w-0 flex-1">{formatOwnerNames(y.runnerUp)}</TickerText>
                </div>
                <div className="flex items-center gap-2 text-[0.78rem]">
                  <RankBadge rank={3} />
                  <TickerText className="min-w-0 flex-1">{formatOwnerNames(y.third)}</TickerText>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {finalStandings.length > 0 && (
        <div className="space-y-3.5">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            {champion &&
              (isInProgress ? (
                <TrophyCard
                  tone="gold"
                  dashed
                  hollow
                  label="Current Leader"
                  value={champion.team_name}
                  detail={teamOwnerNames(champion, owners)}
                  to={`/season/${season.year}/team/${champion.espn_team_id}`}
                />
              ) : (
                <TrophyCard
                  tone="gold"
                  label={
                    <>
                      <ChampionBadge label={`${season.year} league champion`} /> Champion
                    </>
                  }
                  value={champion.team_name}
                  to={championshipGame ? `/matchup/${season.year}/${championshipGame.matchupId}` : undefined}
                  detail={
                    <>
                      {teamOwnerNames(champion, owners)}
                      {championshipGame && runnerUp && (
                        <>
                          {" · beat "}
                          {teamOwnerNames(runnerUp, owners)}, {formatPoints(championshipGame.championScore)}–
                          {formatPoints(championshipGame.runnerUpScore)}
                        </>
                      )}
                    </>
                  }
                />
              ))}
            {bestRecord && (
              <TrophyCard
                tone="accent"
                dashed={isInProgress}
                hollow={isInProgress}
                label="Best Record"
                value={formatRecord(bestRecord.overall.wins, bestRecord.overall.losses, bestRecord.overall.ties)}
                detail={bestRecordCoHolders.map(t => teamOwnerNames(t, owners)).join(" · ")}
                to={`/season/${season.year}/team/${bestRecord.espn_team_id}`}
              />
            )}
            {pointsLeader && (
              <TrophyCard
                tone="red"
                dashed={isInProgress}
                hollow={isInProgress}
                label="Points Leader"
                value={formatPoints(pointsLeader.overall.points_for)}
                detail={teamOwnerNames(pointsLeader, owners)}
                to={`/season/${season.year}/team/${pointsLeader.espn_team_id}`}
              />
            )}
          </div>
        </div>
      )}

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <SectionHeading as="h3">Division Standings</SectionHeading>
          {divisions.length > 1 && (
            <SegmentedToggle
              ariaLabel="Division"
              value={activeDivisionId ?? ""}
              onChange={setSelectedDivisionId}
              options={divisions.map(d => ({ key: String(d.division_id), label: d.name }))}
            />
          )}
        </div>
        {activeDivisionId !== null && (
          <DivisionStandingsBoard
            rows={byDivision.get(Number(activeDivisionId)) ?? []}
            owners={owners}
            isInProgress={isInProgress}
            reigningOwnerIds={reigningOwnerIds}
          />
        )}
      </div>

      <div>
        <SectionHeading as="h3" className="mb-3">
          Overall Standings
        </SectionHeading>
        {statsCoverage !== "full" ? (
          <p className="text-sm text-ink-dim">
            No full batting/pitching stat line on file for {season.year} — this table needs box-score coverage
            {seasons.some(s => s.coverage.stat_lines === "full") ? " (available from 2019 on)." : "."}
          </p>
        ) : boxScoresState.status === "loading" ? (
          <p className="text-sm text-ink-dim">Loading season stats…</p>
        ) : boxScoresState.status === "error" ? (
          <p className="text-sm text-ink-dim">Couldn't load season stats. Try refreshing the page.</p>
        ) : (
          <OverallStatTable rows={teamStatRows} owners={owners} isInProgress={isInProgress} />
        )}
      </div>
    </div>
  );
}
