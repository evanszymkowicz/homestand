import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { Board, TEN_ROWS } from "../../components/Board";
import { RouteLoading } from "../../components/RouteLoading";
import { SectionHeading } from "../../components/SectionHeading";
import { SortHeader } from "../../components/SortHeader";
import { StatCard } from "../../components/StatCard";
import { useAsync, useAsyncList } from "../../hooks/useAsync";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { useSortableRows } from "../../hooks/useSortableRows";
import { loadMatchups, loadOwners, loadTeams } from "../../lib/data";
import { formatDifferential, formatPoints, formatRecord, formatWinPct } from "../../lib/format";
import { buildTeamOwnersIndex, getPairSummary, pairOwnerRefs, type Meeting } from "../../lib/h2h";
import { winPct } from "../../lib/stats";
import type { Matchup, Owner, Team } from "../../types";

type MeetingSortKey = "date" | "round" | "aScore" | "bScore" | "result";

/** Owner's record / per meeting. Names ending in s take a bare apostrophe, so a
 *  league full of owners doesn't produce "Chitters's" and "James's". */
function possessive(name: string): string {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

function meetingSortValue(meeting: Meeting, key: MeetingSortKey): number | string {
  switch (key) {
    case "date":
      return meeting.year * 1000 + meeting.week;
    case "round":
      return (meeting.playoffTier ? 1000 : 0) + meeting.week;
    case "aScore":
      return meeting.aScore;
    case "bScore":
      return meeting.bScore;
    case "result":
      return meeting.result;
  }
}

interface PairDetailData {
  owners: Owner[];
  teams: Team[];
  matchups: Matchup[];
}

async function loadPairDetailData(): Promise<PairDetailData> {
  const [owners, teams, matchups] = await Promise.all([loadOwners(), loadTeams(), loadMatchups()]);
  return { owners, teams, matchups };
}

function meetingLabel(meeting: Meeting): string {
  return meeting.playoffTier === null ? `Week ${meeting.week}` : `Playoffs · Week ${meeting.week}`;
}

export default function PairDetail() {
  const { ownerA, ownerB } = useParams<{ ownerA: string; ownerB: string }>();
  const state = useAsync(loadPairDetailData, []);

  // Hooks must run unconditionally on every render so these will derive first before returning data.
  // Failed hooks run with an empty data set so they fail silently instead of taking down the whole site.
  const teams = useAsyncList(state, d => d.teams);
  const matchups = useAsyncList(state, d => d.matchups);
  const teamOwnersIndex = useMemo(() => buildTeamOwnersIndex(teams), [teams]);
  const title = useMemo(() => {
    if (state.status !== "success" || !ownerA || !ownerB) return "Head-to-Head";
    const a = state.data.owners.find(o => o.owner_id === ownerA)?.canonical_name;
    const b = state.data.owners.find(o => o.owner_id === ownerB)?.canonical_name;
    return a && b ? `${a} vs ${b}` : "Head-to-Head";
  }, [state, ownerA, ownerB]);
  useDocumentTitle(title);
  const summary = useMemo(
    () => getPairSummary(matchups, teamOwnersIndex, ownerA ?? "", ownerB ?? ""),
    [matchups, teamOwnersIndex, ownerA, ownerB]
  );

  if (state.status === "loading") {
    return <RouteLoading label="Loading matchup history…" />;
  }
  if (state.status === "error") {
    return <p className="text-ink-dim">Couldn't load matchup history. Try refreshing the page.</p>;
  }
  if (!ownerA || !ownerB) {
    return <p className="text-ink-dim">No owners specified.</p>;
  }

  const { owners } = state.data;
  const knownIds = new Set(owners.map(o => o.owner_id));
  if (!knownIds.has(ownerA) || !knownIds.has(ownerB)) {
    return (
      <p className="text-ink-dim">
        Unknown owner.{" "}
        <Link to="/head-to-head" className="text-accent underline">
          Back to the grid
        </Link>
        .
      </p>
    );
  }

  const [a, b] = pairOwnerRefs(owners, ownerA, ownerB);

  if (summary.meetings.length === 0) {
    return (
      <div>
        <Link to="/head-to-head" className="text-xs text-ink-faint hover:text-ink">
          ← Head-to-Head Grid
        </Link>
        <h2 className="mt-2 text-xl font-bold">
          {a.name} vs. {b.name}
        </h2>
        <p className="mt-2 text-ink-dim">These two have never faced each other.</p>
      </div>
    );
  }

  return <PairDetailBody a={a} b={b} summary={summary} />;
}

function PairDetailBody({
  a,
  b,
  summary,
}: {
  a: ReturnType<typeof pairOwnerRefs>[0];
  b: ReturnType<typeof pairOwnerRefs>[0];
  summary: ReturnType<typeof getPairSummary>;
}) {
  const { sorted, sortKey, direction, toggleSort } = useSortableRows<Meeting, MeetingSortKey>(
    summary.meetings,
    meetingSortValue,
    "date",
    "desc"
  );

  const streakText = summary.streak
    ? `${summary.streak.result === "W" ? a.name : b.name} has won ${summary.streak.length} straight`
    : null;

  return (
    <div>
      <Link to="/head-to-head" className="text-xs text-ink-faint hover:text-ink">
        ← Head-to-Head Grid
      </Link>
      <h2 className="mt-2 text-xl font-bold">
        {a.name} vs. {b.name}
      </h2>
      <p className="mt-1 text-ink-dim">
        {formatRecord(summary.overall.wins, summary.overall.losses, summary.overall.ties)} (
        {formatWinPct(winPct(summary.overall))}) All-Time
        {streakText ? ` · ${streakText}` : ""}
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Regular Season"
          value={`${formatRecord(summary.regular.wins, summary.regular.losses, summary.regular.ties)} (${formatWinPct(winPct(summary.regular))})`}
          detail={`${possessive(a.name)} record`}
        />
        <StatCard
          label="Playoffs"
          value={`${formatRecord(summary.playoffs.wins, summary.playoffs.losses, summary.playoffs.ties)} (${formatWinPct(winPct(summary.playoffs))})`}
          detail={`${possessive(a.name)} record`}
        />
        <StatCard label={`${a.name} PF`} value={formatPoints(summary.pointsForA)} detail="All meetings" />
        <StatCard label={`${b.name} PF`} value={formatPoints(summary.pointsForB)} detail="All meetings" />
        <StatCard
          label="Avg Margin"
          value={formatDifferential(summary.averageMargin)}
          detail={`${possessive(a.name)} per meeting`}
        />
      </div>

      <SectionHeading as="h3" className="mt-7 mb-3">
        Every Meeting ({summary.meetings.length})
      </SectionHeading>
      <Board maxHeight={TEN_ROWS}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <SortHeader
                label="Year"
                sortKey="date"
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
                align="center"
              />
              <SortHeader
                label="Round"
                sortKey="round"
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
                align="center"
              />
              <SortHeader
                label={a.name}
                sortKey="aScore"
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
                align="center"
              />
              <SortHeader
                label={b.name}
                sortKey="bScore"
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
                align="center"
              />
              <SortHeader
                label="Result"
                sortKey="result"
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map(meeting => (
              <tr key={`${meeting.year}-${meeting.matchupId}`} className="border-t border-border hover:bg-surface-2">
                <td className="px-3 py-2 text-center">
                  <Link to={`/matchup/${meeting.year}/${meeting.matchupId}`} className="hover:underline">
                    {meeting.year}
                  </Link>
                </td>
                <td className="px-3 py-2 text-center text-ink-dim">{meetingLabel(meeting)}</td>
                <td className="px-3 py-2 text-center tabular-nums">{formatPoints(meeting.aScore)}</td>
                <td className="px-3 py-2 text-center tabular-nums">{formatPoints(meeting.bScore)}</td>
                <td className="px-3 py-2 text-left font-semibold">
                  {meeting.result === "T" ? "Tie" : meeting.result === "W" ? `${a.name} W` : `${b.name} W`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Board>
    </div>
  );
}
