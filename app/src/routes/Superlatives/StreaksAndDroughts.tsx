import { useState } from "react";
import { Link } from "react-router-dom";
import { Board, TEN_ROWS } from "../../components/Board";
import { ChampionBadge } from "../../components/ChampionBadge";
import { OwnerScopeToggle, type OwnerScope } from "../../components/OwnerScopeToggle";
import { SectionHeading } from "../../components/SectionHeading";
import { SortHeader } from "../../components/SortHeader";
import { useSortableRows } from "../../hooks/useSortableRows";
import { formatOwnerNames } from "../../lib/format";
import { finalYearTeams } from "../../lib/coverage";
import { getYearRuns } from "../../lib/ownerHistory";
import {
  getChampionshipDroughts,
  getPlayoffDroughts,
  getPlayoffStreaks,
  type ChampionshipDroughtEntry,
} from "../../lib/superlatives";
import type { PlayoffStreakEntry } from "../../lib/superlatives";
import type { Owner, Season, Team } from "../../types";

interface StreaksAndDroughtsProps {
  teams: Team[];
  owners: Owner[];
  seasons: Season[];
}

function formatYears(years: number[]): string {
  return getYearRuns(years)
    .map(r => (r.start === r.end ? `${r.start}` : `${r.start}–${r.end}`))
    .join(", ");
}

type StreakSortKey = "owner" | "length" | "seasons";

function streakSortValue(entry: PlayoffStreakEntry, key: StreakSortKey): number | string {
  switch (key) {
    case "owner":
      return formatOwnerNames(entry.owners);
    case "length":
      return entry.length;
    case "seasons":
      return entry.years[entry.years.length - 1];
  }
}

function StreakTable({
  title,
  entries,
  scope,
  onScopeChange,
}: {
  title: string;
  entries: PlayoffStreakEntry[];
  scope: OwnerScope;
  onScopeChange: (scope: OwnerScope) => void;
}) {
  const { sorted, sortKey, direction, toggleSort } = useSortableRows<PlayoffStreakEntry, StreakSortKey>(
    entries,
    streakSortValue,
    "length",
    "desc"
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionHeading as="h3">{title}</SectionHeading>
        <OwnerScopeToggle value={scope} onChange={onScopeChange} />
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-ink-dim">None on record.</p>
      ) : (
        <Board maxHeight={TEN_ROWS}>
          <table className="w-full table-fixed border-collapse text-sm">
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
                  label="Length"
                  sortKey="length"
                  activeKey={sortKey}
                  direction={direction}
                  onSort={toggleSort}
                  align="center"
                />
                <SortHeader
                  label="Seasons"
                  sortKey="seasons"
                  activeKey={sortKey}
                  direction={direction}
                  onSort={toggleSort}
                  align="left"
                />
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="w-1/3 px-3 py-2 font-semibold">
                    <Link to={`/season/${entry.years[entry.years.length - 1]}`} className="hover:underline">
                      {formatOwnerNames(entry.owners)}
                    </Link>
                  </td>
                  <td className="w-1/3 px-3 py-2 text-center tabular-nums">{entry.length}</td>
                  <td className="w-1/3 px-3 py-2 text-ink-dim">{formatYears(entry.years)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Board>
      )}
    </div>
  );
}

type ChampionshipDroughtSortKey = "owner" | "titles" | "runnerUps" | "yearsSince";

function championshipDroughtSortValue(row: ChampionshipDroughtEntry, key: ChampionshipDroughtSortKey): number | string {
  switch (key) {
    case "owner":
      return row.owner.name;
    case "titles":
      return row.titles;
    case "runnerUps":
      return row.runnerUps;
    case "yearsSince":
      return row.yearsSince ?? Infinity;
  }
}

function ChampionshipDroughtsTable({ rows }: { rows: ChampionshipDroughtEntry[] }) {
  const { sorted, sortKey, direction, toggleSort } = useSortableRows<
    ChampionshipDroughtEntry,
    ChampionshipDroughtSortKey
  >(rows, championshipDroughtSortValue, "yearsSince", "desc");

  return (
    <Board maxHeight={TEN_ROWS}>
      <table className="w-full table-fixed border-collapse text-sm">
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
              label="Titles"
              sortKey="titles"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
            <SortHeader
              label="Runner-ups"
              sortKey="runnerUps"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
            <SortHeader
              label="Years Since"
              sortKey="yearsSince"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => (
            <tr key={row.owner.ownerId} className="border-t border-border">
              <td className="w-1/4 px-3 py-2 font-semibold">{row.owner.name}</td>
              <td className="w-1/4 px-3 py-2 text-center tabular-nums">
                <span className="inline-flex items-center gap-1.5">
                  {row.titles > 0 && <ChampionBadge label={`${row.titles} title${row.titles > 1 ? "s" : ""}`} />}
                  {row.titles}
                </span>
              </td>
              <td className="w-1/4 px-3 py-2 text-center tabular-nums">{row.runnerUps}</td>
              <td className="w-1/4 px-3 py-2 text-center tabular-nums">
                {row.yearsSince === null ? "never" : row.yearsSince}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Board>
  );
}

export function StreaksAndDroughts({ teams, owners, seasons }: StreaksAndDroughtsProps) {
  const finalTeams = finalYearTeams(teams, seasons);
  const droughts = getPlayoffDroughts(finalTeams, owners, seasons);
  const streaks = getPlayoffStreaks(finalTeams, owners, seasons);
  const activeDroughts = droughts.filter(d => d.active);
  const activeStreaks = streaks.filter(s => s.active);
  const championshipDroughts = getChampionshipDroughts(finalTeams, owners);

  const [droughtScope, setDroughtScope] = useState<OwnerScope>("current");
  const [streakScope, setStreakScope] = useState<OwnerScope>("current");

  return (
    <div className="space-y-8">
      <StreakTable
        title="Playoff Droughts"
        entries={droughtScope === "current" ? activeDroughts : droughts}
        scope={droughtScope}
        onScopeChange={setDroughtScope}
      />
      <StreakTable
        title="Playoff Streaks"
        entries={streakScope === "current" ? activeStreaks : streaks}
        scope={streakScope}
        onScopeChange={setStreakScope}
      />

      <div>
        <SectionHeading className="mb-3" as="h3">
          Championship Droughts
        </SectionHeading>
        <ChampionshipDroughtsTable rows={championshipDroughts} />
      </div>
    </div>
  );
}
