import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Board, TEN_ROWS } from "../../components/Board";
import { CoverageBadge } from "../../components/CoverageBadge";
import { PartialCoverageNote } from "../../components/PartialCoverageNote";
import { SectionHeading } from "../../components/SectionHeading";
import { SortHeader } from "../../components/SortHeader";
import { useAsync } from "../../hooks/useAsync";
import { useSortableRows } from "../../hooks/useSortableRows";
import { loadBoxScoresPartial } from "../../lib/data";
import { formatPoints } from "../../lib/format";
import {
  getBlownSaveHallOfShame,
  getIlStashLeaderboard,
  getKeeperBustHallOfFame,
  getPitchingFeats,
  type BlownSaveLeaderEntry,
  type IlStashEntry,
  type KeeperBustEntry,
  type PitchingFeatEntry,
} from "../../lib/hallOfFame";
import { ownerRef } from "../../lib/stats";
import type { BoxScoreEntry, Keeper, Owner, PlayerSeasonPoints, Season } from "../../types";

interface HallOfFameProps {
  owners: Owner[];
  seasons: Season[];
  keepers: Keeper[];
  seasonPoints: PlayerSeasonPoints[];
}

/** Years with real weekly pitching/batting counting stats -- broader than
 * the usual "stat_lines full" gate, since 2018's box scores do carry real
 * nh/sho/bs totals despite its slot-level day accuracy being unreliable
 * (that's a separate concern, only relevant to day-accurate views like the
 * IL stash leaderboard below). Excludes in-progress seasons: these are
 * all-time leaderboards (Phase 8), and a mid-season pitcher's blown-save/
 * no-hitter tally is a partial count, not a final one. */
function statLineYears(seasons: Season[]): number[] {
  return seasons.filter(s => s.coverage.stat_lines !== "missing" && s.status === "final").map(s => s.year);
}

/** Years with real day-accurate slots -- the subset of statLineYears where
 * per-day slot placement (not just weekly counting stats) can be trusted. */
function daySlotYears(seasons: Season[]): number[] {
  return seasons.filter(s => s.coverage.stat_lines === "full" && s.status === "final").map(s => s.year);
}

export function HallOfFame({ owners, seasons, keepers, seasonPoints }: HallOfFameProps) {
  const years = useMemo(() => statLineYears(seasons), [seasons]);
  const state = useAsync(() => loadBoxScoresPartial(years), [years]);
  const failedYears = useMemo(
    () => (state.status === "success" ? years.filter(y => !state.data.has(y)) : []),
    [years, state]
  );

  const finalYears = new Set(seasons.filter(s => s.status === "final").map(s => s.year));
  // A mid-season keeper's points are a partial total, not a confirmed bust.
  const finalKeepers = keepers.filter(k => finalYears.has(k.year));
  const keeperBusts = getKeeperBustHallOfFame(finalKeepers, seasonPoints);

  return (
    <div className="space-y-10">
      <PartialCoverageNote failedYears={failedYears} />
      <div>
        <div className="mb-3 flex items-center gap-2">
          <SectionHeading>No-Hitters &amp; Shutouts</SectionHeading>
          <CoverageBadge seasons={seasons} domain="stat_lines" />
        </div>
        <p className="mb-3 text-xs text-ink-faint">
          Box scores aggregate by week, so entries are shown the week they happened in.
        </p>
        {/* CoverageBadge reads "since 2019" because summarizeCoverage counts
            only stat_lines === "full" seasons, but these two boards are built
            from statLineYears, which deliberately includes 2018 (its box scores
            carry real counting totals). So the badge understated the span by a
            season and the no-hitter cell was blank for a reason the page never
            explained. Spelled out here rather than changing CoverageBadge --
            its other call sites are correct. */}
        <p className="mb-3 text-xs text-ink-faint">
          2018 shutouts and blown saves are included; no-hitter detection needs 2019+ stat lines.
        </p>
        {state.status === "loading" && <p className="text-ink-dim">Loading box scores…</p>}
        {state.status === "error" && <p className="text-ink-dim">Couldn't load box scores. Try refreshing the page.</p>}
        {state.status === "success" && <PitchingFeatsTable boxScoresByYear={state.data} owners={owners} />}
      </div>

      <div>
        <div className="mb-3 flex items-center gap-2">
          <SectionHeading>Blown-Save Hall of Shame</SectionHeading>
          <CoverageBadge seasons={seasons} domain="stat_lines" />
        </div>
        <p className="mb-3 text-xs text-ink-faint">Total blown saves while rostered.</p>
        {state.status === "success" && <BlownSaveTable boxScoresByYear={state.data} />}
      </div>

      <div>
        <div className="mb-3 flex items-center gap-2">
          <SectionHeading>IL/DL Stash Leaderboard</SectionHeading>
          <CoverageBadge seasons={seasons} domain="stat_lines" />
        </div>
        <p className="mb-3 text-xs text-ink-faint">
          Longest single-season stretches spent stashed on a manager's injured list.
        </p>
        {state.status === "success" && (
          <IlStashTable boxScoresByYear={state.data} owners={owners} years={daySlotYears(seasons)} />
        )}
      </div>

      <div>
        <SectionHeading className="mb-3">Keeper Bust Hall of Fame</SectionHeading>
        <p className="mb-3 text-xs text-ink-faint">Lowest fantasy points produced in a kept season.</p>
        <KeeperBustTable rows={keeperBusts} owners={owners} />
      </div>
    </div>
  );
}

type PitchingFeatSortKey = "pitcher" | "owner" | "week" | "noHitter";

function pitchingFeatSortValue(f: PitchingFeatEntry, owners: Owner[], key: PitchingFeatSortKey): number | string {
  switch (key) {
    case "pitcher":
      return f.playerName;
    case "owner":
      return ownerRef(owners, f.ownerId).name;
    case "week":
      return f.year * 100 + f.week;
    case "noHitter":
      return f.isPerfectGame ? 2 : f.isNoHitter ? 1 : 0;
  }
}

function PitchingFeatsTable({
  boxScoresByYear,
  owners,
}: {
  boxScoresByYear: Map<number, BoxScoreEntry[]>;
  owners: Owner[];
}) {
  const feats = getPitchingFeats(boxScoresByYear);
  const { sorted, sortKey, direction, toggleSort } = useSortableRows<PitchingFeatEntry, PitchingFeatSortKey>(
    feats,
    (f, key) => pitchingFeatSortValue(f, owners, key),
    "week",
    "desc"
  );
  if (feats.length === 0) {
    return <p className="text-sm text-ink-dim">No no-hitters or shutouts on record.</p>;
  }
  return (
    <Board maxHeight={TEN_ROWS}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <SortHeader
              label="Pitcher"
              sortKey="pitcher"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="left"
            />
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
              label="No-Hitter"
              ariaLabel="No-hitter or perfect game"
              sortKey="noHitter"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((f, i) => (
            <tr key={i} className="border-t border-border hover:bg-surface-2">
              <td className="px-3 py-2 font-semibold">
                <Link to={`/player/${f.playerId}`} className="hover:underline">
                  {f.playerName}
                </Link>
              </td>
              <td className="px-3 py-2 text-ink-dim">{ownerRef(owners, f.ownerId).name}</td>
              <td className="px-3 py-2 text-center text-ink-dim">
                <Link to={`/matchup/${f.year}/${f.matchupId}`} className="hover:underline">
                  {f.year} Wk {f.week}
                </Link>
              </td>
              <td className="px-3 py-2 text-left">
                {f.isPerfectGame ? (
                  <span className="rounded-full bg-gold-soft px-2 py-0.5 text-[0.64rem] font-bold text-gold">
                    Perfect Game
                  </span>
                ) : (
                  f.isNoHitter && (
                    <span className="rounded-full bg-gold-soft px-2 py-0.5 text-[0.64rem] font-bold text-gold">
                      No-Hitter
                    </span>
                  )
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Board>
  );
}

type BlownSaveSortKey = "pitcher" | "blownSaves";

function blownSaveSortValue(row: BlownSaveLeaderEntry, key: BlownSaveSortKey): number | string {
  return key === "pitcher" ? row.playerName : row.blownSaves;
}

function BlownSaveTable({ boxScoresByYear }: { boxScoresByYear: Map<number, BoxScoreEntry[]> }) {
  const rows = getBlownSaveHallOfShame(boxScoresByYear);
  const { sorted, sortKey, direction, toggleSort } = useSortableRows<BlownSaveLeaderEntry, BlownSaveSortKey>(
    rows,
    blownSaveSortValue,
    "blownSaves",
    "desc"
  );
  if (rows.length === 0) {
    return <p className="text-sm text-ink-dim">No blown saves on record.</p>;
  }
  return (
    <Board maxHeight={TEN_ROWS}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <SortHeader
              label="Pitcher"
              sortKey="pitcher"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="left"
            />
            <SortHeader
              label="Blown Saves"
              sortKey="blownSaves"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => (
            <tr key={row.playerId} className="border-t border-border hover:bg-surface-2">
              <td className="px-3 py-2 font-semibold">
                <Link to={`/player/${row.playerId}`} className="hover:underline">
                  {row.playerName}
                </Link>
              </td>
              <td className="px-3 py-2 text-center tabular-nums">{row.blownSaves}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Board>
  );
}

type IlStashSortKey = "player" | "owner" | "year" | "ilDays";

function ilStashSortValue(row: IlStashEntry, owners: Owner[], key: IlStashSortKey): number | string {
  switch (key) {
    case "player":
      return row.playerName;
    case "owner":
      return ownerRef(owners, row.ownerId).name;
    case "year":
      return row.year;
    case "ilDays":
      return row.ilDays;
  }
}

function IlStashTable({
  boxScoresByYear,
  owners,
  years,
}: {
  boxScoresByYear: Map<number, BoxScoreEntry[]>;
  owners: Owner[];
  years: number[];
}) {
  const filtered = new Map(Array.from(boxScoresByYear.entries()).filter(([year]) => years.includes(year)));
  const rows = getIlStashLeaderboard(filtered);
  const { sorted, sortKey, direction, toggleSort } = useSortableRows<IlStashEntry, IlStashSortKey>(
    rows,
    (row, key) => ilStashSortValue(row, owners, key),
    "ilDays",
    "desc"
  );
  if (rows.length === 0) {
    return <p className="text-sm text-ink-dim">No IL/DL stash data available yet.</p>;
  }
  return (
    <Board maxHeight={TEN_ROWS}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <SortHeader
              label="Player"
              sortKey="player"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="left"
            />
            <SortHeader
              label="Owner"
              sortKey="owner"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="left"
            />
            <SortHeader
              label="Year"
              sortKey="year"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
            <SortHeader
              label="IL Days"
              sortKey="ilDays"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => (
            <tr
              key={`${row.year}-${row.ownerId}-${row.playerId}`}
              className="border-t border-border hover:bg-surface-2">
              <td className="px-3 py-2 font-semibold">
                <Link to={`/player/${row.playerId}`} className="hover:underline">
                  {row.playerName}
                </Link>
              </td>
              <td className="px-3 py-2 text-ink-dim">{ownerRef(owners, row.ownerId).name}</td>
              <td className="px-3 py-2 text-center tabular-nums">{row.year}</td>
              <td className="px-3 py-2 text-center tabular-nums">{row.ilDays}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Board>
  );
}

type KeeperBustSortKey = "player" | "owner" | "year" | "points" | "priorYear";

function keeperBustSortValue(row: KeeperBustEntry, owners: Owner[], key: KeeperBustSortKey): number | string {
  switch (key) {
    case "player":
      return row.playerName;
    case "owner":
      return ownerRef(owners, row.ownerId).name;
    case "year":
      return row.year;
    case "points":
      return row.points;
    case "priorYear":
      return row.priorYearPoints ?? 0;
  }
}

function KeeperBustTable({ rows, owners }: { rows: KeeperBustEntry[]; owners: Owner[] }) {
  const { sorted, sortKey, direction, toggleSort } = useSortableRows<KeeperBustEntry, KeeperBustSortKey>(
    rows,
    (row, key) => keeperBustSortValue(row, owners, key),
    "points",
    "asc"
  );
  return (
    <Board maxHeight={TEN_ROWS}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <SortHeader
              label="Player"
              sortKey="player"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="left"
            />
            <SortHeader
              label="Owner"
              sortKey="owner"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="left"
            />
            <SortHeader
              label="Year"
              sortKey="year"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
            <SortHeader
              label="Points"
              sortKey="points"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
            <SortHeader
              label="Prior Year"
              sortKey="priorYear"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => (
            <tr key={`${row.year}-${row.playerId}`} className="border-t border-border hover:bg-surface-2">
              <td className="px-3 py-2 font-semibold">
                <Link to={`/player/${row.playerId}`} className="hover:underline">
                  {row.playerName}
                </Link>
              </td>
              <td className="px-3 py-2 text-ink-dim">{ownerRef(owners, row.ownerId).name}</td>
              <td className="px-3 py-2 text-center tabular-nums">{row.year}</td>
              <td className="px-3 py-2 text-center font-semibold text-diverge-neg tabular-nums">
                {formatPoints(row.points)}
              </td>
              <td className="px-3 py-2 text-center text-ink-faint tabular-nums">
                {row.priorYearPoints === null ? "—" : formatPoints(row.priorYearPoints)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Board>
  );
}
