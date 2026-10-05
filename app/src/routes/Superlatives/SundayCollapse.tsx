import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Board } from "../../components/Board";
import { CoverageBadge } from "../../components/CoverageBadge";
import { PartialCoverageNote } from "../../components/PartialCoverageNote";
import { SectionHeading } from "../../components/SectionHeading";
import { SortHeader } from "../../components/SortHeader";
import { TickerText } from "../../components/TickerText";
import { useAsync } from "../../hooks/useAsync";
import { useSortableRows } from "../../hooks/useSortableRows";
import { summarizeCoverage } from "../../lib/coverage";
import { loadBoxScoresPartial } from "../../lib/data";
import { formatOwnerNames, formatPoints } from "../../lib/format";
import { getBiggestSundayCollapses, type SundayCollapseEntry } from "../../lib/superlatives";
import type { BoxScoreEntry, Matchup, Owner, Season, Team } from "../../types";

interface SundayCollapseProps {
  teams: Team[];
  owners: Owner[];
  matchups: Matchup[];
  seasons: Season[];
}

export function SundayCollapse({ teams, owners, matchups, seasons }: SundayCollapseProps) {
  const coveredYears = useMemo(() => summarizeCoverage(seasons, "stat_lines").coveredYears, [seasons]);
  const state = useAsync(() => loadBoxScoresPartial(coveredYears), [coveredYears]);
  const failedYears = useMemo(
    () => (state.status === "success" ? coveredYears.filter(y => !state.data.has(y)) : []),
    [coveredYears, state]
  );

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <SectionHeading>You Blew it, Boy...You Really Blew it</SectionHeading>
        <CoverageBadge seasons={seasons} domain="stat_lines" />
      </div>
      <p className="mb-4 text-xs text-ink-faint">Led the matchup entering its final day and lost.</p>
      {state.status === "loading" && <p className="text-ink-dim">Loading box scores…</p>}
      {state.status === "error" && <p className="text-ink-dim">Couldn't load box scores. Try refreshing the page.</p>}
      {state.status === "success" && (
        <>
          <PartialCoverageNote failedYears={failedYears} />
          <SundayCollapseTable boxScoresByYear={state.data} matchups={matchups} teams={teams} owners={owners} />
        </>
      )}
    </div>
  );
}

type CollapseSortKey = "team" | "week" | "winner" | "lead" | "margin";

function collapseSortValue(row: SundayCollapseEntry, key: CollapseSortKey): number | string {
  switch (key) {
    case "team":
      return formatOwnerNames(row.collapsed.owners);
    case "week":
      return row.year * 100 + row.week;
    case "winner":
      return formatOwnerNames(row.winner.owners);
    case "lead":
      return row.leadBeforeFinalDay;
    case "margin":
      return row.finalMargin;
  }
}

function SundayCollapseTable({
  boxScoresByYear,
  matchups,
  teams,
  owners,
}: {
  boxScoresByYear: Map<number, BoxScoreEntry[]>;
  matchups: Matchup[];
  teams: Team[];
  owners: Owner[];
}) {
  const rows = getBiggestSundayCollapses(boxScoresByYear, matchups, teams, owners, 10);
  const { sorted, sortKey, direction, toggleSort } = useSortableRows<SundayCollapseEntry, CollapseSortKey>(
    rows,
    collapseSortValue,
    "lead",
    "desc"
  );
  if (rows.length === 0) {
    return <p className="text-ink-dim">No Sunday collapses found yet.</p>;
  }

  return (
    <Board>
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-1/5" />
          <col className="w-1/5" />
          <col className="w-1/5" />
          <col className="w-1/5" />
          <col className="w-1/5" />
        </colgroup>
        <thead>
          <tr>
            <SortHeader
              label="Team"
              sortKey="team"
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
              align="left"
            />
            <SortHeader
              label="Lost To"
              sortKey="winner"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="left"
            />
            <SortHeader
              label="Lead Blown"
              sortKey="lead"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
            <SortHeader
              label="Final Margin"
              sortKey="margin"
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
                <TickerText className="min-w-0 flex-1">
                  <Link to={`/matchup/${row.year}/${row.matchupId}`} className="hover:underline">
                    {formatOwnerNames(row.collapsed.owners)}
                  </Link>
                </TickerText>
              </td>
              <td className="px-3 py-2 text-left text-ink-dim">
                <Link to={`/matchup/${row.year}/${row.matchupId}`} className="hover:underline">
                  {row.year} Wk {row.week}
                </Link>
              </td>
              <td className="px-3 py-2 text-ink-dim">
                <TickerText text={formatOwnerNames(row.winner.owners)} className="min-w-0 flex-1" />
              </td>
              <td className="px-3 py-2 text-center font-semibold text-diverge-neg tabular-nums">
                {formatPoints(row.leadBeforeFinalDay)}
              </td>
              <td className="px-3 py-2 text-center text-ink-dim tabular-nums">{formatPoints(row.finalMargin)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Board>
  );
}
