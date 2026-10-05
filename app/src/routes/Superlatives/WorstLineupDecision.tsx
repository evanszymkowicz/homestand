import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Board } from "../../components/Board";
import { CoverageBadge } from "../../components/CoverageBadge";
import { PartialCoverageNote } from "../../components/PartialCoverageNote";
import { SectionHeading } from "../../components/SectionHeading";
import { SortHeader } from "../../components/SortHeader";
import { useAsync } from "../../hooks/useAsync";
import { useSortableRows } from "../../hooks/useSortableRows";
import { summarizeCoverage } from "../../lib/coverage";
import { loadBoxScoresPartial } from "../../lib/data";
import { formatOwnerNames, formatPoints } from "../../lib/format";
import { getWorstLineupDecisions, type WorstLineupDecisionEntry } from "../../lib/superlatives";
import type { BoxScoreEntry, Owner, Season, Team } from "../../types";

interface WorstLineupDecisionProps {
  teams: Team[];
  owners: Owner[];
  seasons: Season[];
}
//  Create function props instead of promise chaining
export function WorstLineupDecision({ teams, owners, seasons }: WorstLineupDecisionProps) {
  // Every year with real per-day slot data loads, including an in-progress
  // season -- getWorstLineupDecisions is the one that excludes just that
  // season's still-in-progress current week, not this loader.
  const coveredYears = useMemo(() => summarizeCoverage(seasons, "stat_lines").coveredYears, [seasons]);
  const state = useAsync(() => loadBoxScoresPartial(coveredYears), [coveredYears]);
  const failedYears = useMemo(
    () => (state.status === "success" ? coveredYears.filter(y => !state.data.has(y)) : []),
    [coveredYears, state]
  );

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <SectionHeading>The Biggest Do-overs</SectionHeading>
        <CoverageBadge seasons={seasons} domain="stat_lines" />
      </div>
      <p className="mb-4 text-xs text-ink-faint">
        A benched player is compared only against a lineup spot they could have started at.
      </p>
      {state.status === "loading" && <p className="text-ink-dim">Loading box scores…</p>}
      {state.status === "error" && <p className="text-ink-dim">Couldn't load box scores. Try refreshing the page.</p>}
      {state.status === "success" && (
        <>
          <PartialCoverageNote failedYears={failedYears} />
          <LineupDecisionTable boxScoresByYear={state.data} teams={teams} owners={owners} seasons={seasons} />
        </>
      )}
    </div>
  );
}

type LineupSortKey = "owner" | "week" | "benched" | "started" | "gap";

function lineupSortValue(row: WorstLineupDecisionEntry, key: LineupSortKey): number | string {
  switch (key) {
    case "owner":
      return formatOwnerNames(row.owners);
    case "week":
      return row.year * 100 + row.week;
    case "benched":
      return row.benchedPoints;
    case "started":
      return row.startedPoints;
    case "gap":
      return row.gap;
  }
}

function LineupDecisionTable({
  boxScoresByYear,
  teams,
  owners,
  seasons,
}: {
  boxScoresByYear: Map<number, BoxScoreEntry[]>;
  teams: Team[];
  owners: Owner[];
  seasons: Season[];
}) {
  const rows = getWorstLineupDecisions(boxScoresByYear, teams, owners, seasons, 10);
  const { sorted, sortKey, direction, toggleSort } = useSortableRows<WorstLineupDecisionEntry, LineupSortKey>(
    rows,
    lineupSortValue,
    "gap",
    "desc"
  );
  if (rows.length === 0) {
    return <p className="text-ink-dim">No lineup-decision data available yet.</p>;
  }

  return (
    <Board>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <SortHeader
              label="Owner"
              sortKey="owner"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="left"
            />
            <SortHeader
              label="Week"
              sortKey="week"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
            <SortHeader
              label="Benched"
              sortKey="benched"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
            <SortHeader
              label="Started"
              sortKey="started"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
            <SortHeader
              label="Gap"
              sortKey="gap"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i} className="border-t border-border">
              <td className="px-3 py-2 font-semibold">
                <Link to={`/matchup/${row.year}/${row.matchupId}`} className="hover:underline">
                  {formatOwnerNames(row.owners)}
                </Link>
              </td>
              <td className="px-3 py-2 text-center text-ink-dim">
                {row.year} Wk {row.week}
              </td>
              <td className="px-3 py-2 text-center text-ink-dim">
                <Link to={`/player/${row.benchedPlayerId}`} className="hover:underline">
                  {row.benchedPlayerName}
                </Link>{" "}
                ({formatPoints(row.benchedPoints)})
              </td>
              <td className="px-3 py-2 text-center text-ink-dim">
                {row.startedPlayerId === null ? (
                  "empty slot"
                ) : (
                  <Link to={`/player/${row.startedPlayerId}`} className="hover:underline">
                    {row.startedPlayerName}
                  </Link>
                )}{" "}
                ({formatPoints(row.startedPoints)})
              </td>
              <td className="px-3 py-2 text-center font-semibold text-diverge-neg tabular-nums">
                {formatPoints(row.gap)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Board>
  );
}
