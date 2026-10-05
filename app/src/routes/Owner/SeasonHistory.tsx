import { useState } from "react";
import { Link } from "react-router-dom";
import { Board, TEN_ROWS } from "../../components/Board";
import { RankBadge } from "../../components/RankBadge";
import { SortHeader } from "../../components/SortHeader";
import { TickerText } from "../../components/TickerText";
import { useSortableRows } from "../../hooks/useSortableRows";
import { formatPoints, formatRecord, formatWinPct } from "../../lib/format";
import { getOwnerSeasons, ownerRef, winPct } from "../../lib/stats";
import type { Keeper, Owner, Season, Team } from "../../types";
import { TeamSeasonRosterModal } from "./TeamSeasonRosterModal";

interface SeasonHistoryProps {
  ownerId: string;
  teams: Team[];
  owners: Owner[];
  keepers: Keeper[];
  seasons: Season[];
}

type SeasonHistorySortKey = "year" | "team" | "finish" | "record" | "pointsFor" | "pointsAgainst";

function seasonHistorySortValue(team: Team, key: SeasonHistorySortKey): number | string {
  switch (key) {
    case "year":
      return team.year;
    case "team":
      return team.team_name;
    case "finish":
      return team.final_rank;
    case "record":
      return winPct(team.overall);
    case "pointsFor":
      return team.overall.points_for;
    case "pointsAgainst":
      return team.overall.points_against;
  }
}

/** Every team-season this owner is credited on, most recent first (reversed
 * from getOwnerSeasons' own oldest-first convention, which other per-entity
 * history tables like PairDetail's meetings table still use -- this is a
 * display-order choice local to this table, not a change to the shared
 * chronological-ascending utility). A co-owned team-season (e.g.
 * a shared-season record") notes the other credited owner(s) rather
 * than silently looking like a solo team. Clicking a row (anywhere but the
 * Year link, which still goes to the season page) opens that team-season's
 * full roster in TeamSeasonRosterModal. */
export function SeasonHistory({ ownerId, teams, owners, keepers, seasons: leagueSeasons }: SeasonHistoryProps) {
  const seasons = [...getOwnerSeasons(teams, ownerId)].reverse();
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const { sorted, sortKey, direction, toggleSort } = useSortableRows<Team, SeasonHistorySortKey>(
    seasons,
    seasonHistorySortValue,
    "year",
    "desc"
  );

  if (seasons.length === 0) {
    return <p className="text-ink-dim">No seasons on record yet.</p>;
  }

  return (
    <>
      <Board maxHeight={TEN_ROWS}>
        <table className="w-full table-fixed border-collapse text-sm" style={{ minWidth: "46rem" }}>
          <colgroup>
            <col className="w-1/6" />
            <col className="w-1/6" />
            <col className="w-1/6" />
            <col className="w-1/6" />
            <col className="w-1/6" />
            <col className="w-1/6" />
          </colgroup>
          <thead>
            <tr>
              <SortHeader
                label="Year"
                sortKey="year"
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
                align="center"
              />
              <SortHeader
                label="Team"
                sortKey="team"
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
                align="left"
              />
              <SortHeader
                label="Finish"
                sortKey="finish"
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
                align="center"
              />
              <SortHeader
                label="Record"
                sortKey="record"
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
                align="left"
              />
              <SortHeader
                label="PF"
                sortKey="pointsFor"
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
                align="left"
              />
              <SortHeader
                label="PA"
                sortKey="pointsAgainst"
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
                align="left"
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map(team => {
              const coOwners = team.owner_ids.filter(id => id !== ownerId).map(id => ownerRef(owners, id));
              return (
                <tr
                  key={team.year}
                  tabIndex={0}
                  role="button"
                  aria-label={`${team.year} full roster`}
                  onClick={() => setSelectedTeam(team)}
                  onKeyDown={e => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedTeam(team);
                    }
                  }}
                  className="cursor-pointer border-t border-border hover:bg-surface-2 focus-visible:bg-surface-2">
                  <td className="px-3 py-2 text-center">
                    <Link to={`/season/${team.year}`} onClick={e => e.stopPropagation()} className="hover:underline">
                      {team.year}
                    </Link>
                  </td>
                  <td className="min-w-0 px-3 py-2 text-left">
                    <TickerText className="font-semibold" text={team.team_name} />
                    {coOwners.length > 0 && (
                      <TickerText
                        className="text-xs text-ink-faint"
                        text={`with ${coOwners.map(o => o.name).join(" & ")}`}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <RankBadge rank={team.final_rank} />
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatRecord(team.overall.wins, team.overall.losses, team.overall.ties)} (
                    {formatWinPct(winPct(team.overall))})
                  </td>
                  <td className="px-3 py-2 tabular-nums">{formatPoints(team.overall.points_for)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatPoints(team.overall.points_against)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Board>
      {selectedTeam && (
        <TeamSeasonRosterModal
          team={selectedTeam}
          keepers={keepers}
          seasons={leagueSeasons}
          onClose={() => setSelectedTeam(null)}
        />
      )}
    </>
  );
}
