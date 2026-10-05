import { Link } from "react-router-dom";
import { Board, TEN_ROWS } from "../../components/Board";
import { CoverageBadge } from "../../components/CoverageBadge";
import { OwnerScopeToggle, type OwnerScope } from "../../components/OwnerScopeToggle";
import { RankBadge } from "../../components/RankBadge";
import { SectionHeading } from "../../components/SectionHeading";
import { SortHeader } from "../../components/SortHeader";
import { useSortableRows } from "../../hooks/useSortableRows";
import { formatPoints } from "../../lib/format";
import { PTS_SEMANTICS_TOOLTIP_SEASON_SHORT } from "../../lib/ptsSemantics";
import type { NeverKeptEntry, OwnerKeeperPoints, PlayerKeeperPoints } from "../../lib/keepers";
import type { Season } from "../../types";

interface PointsLeaderboardsProps {
  search: string;
  seasons: Season[];
  byOwner: OwnerKeeperPoints[];
  byPlayer: PlayerKeeperPoints[];
  neverKept: NeverKeptEntry[];
  ownerScope: OwnerScope;
  onOwnerScopeChange: (value: OwnerScope) => void;
}

type OwnerPointsSortKey = "owner" | "points" | "keeperSeasons" | "uniquePlayers";

function OwnerPointsTable({ rows }: { rows: OwnerKeeperPoints[] }) {
  function getValue(row: OwnerKeeperPoints, key: OwnerPointsSortKey): number | string {
    switch (key) {
      case "owner":
        return row.owner.name;
      case "points":
        return row.points;
      case "keeperSeasons":
        return row.keeperSeasons;
      case "uniquePlayers":
        return row.uniquePlayers;
    }
  }

  const { sorted, sortKey, direction, toggleSort } = useSortableRows<OwnerKeeperPoints, OwnerPointsSortKey>(
    rows,
    getValue,
    "points",
    "desc"
  );

  return (
    <Board maxHeight={TEN_ROWS}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky top-0 z-10 bg-surface px-3 py-2 text-center text-[0.66rem] font-semibold tracking-wide text-ink-faint uppercase"></th>
            <SortHeader
              label="Owner"
              sortKey="owner"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="left"
            />
            <SortHeader
              label="Points"
              sortKey="points"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
              tooltip={PTS_SEMANTICS_TOOLTIP_SEASON_SHORT}
            />
            <SortHeader
              label="Seasons"
              sortKey="keeperSeasons"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
            <SortHeader
              label="Unique Players"
              sortKey="uniquePlayers"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={row.owner.ownerId} className="border-t border-border hover:bg-surface-2">
              <td className="px-3 py-2 text-center">
                <RankBadge rank={i + 1} plain />
              </td>
              <td className="px-3 py-2 font-semibold">{row.owner.name}</td>
              <td className="px-3 py-2 text-center tabular-nums">{formatPoints(row.points)}</td>
              <td className="px-3 py-2 text-center text-ink-dim tabular-nums">{row.keeperSeasons}</td>
              <td className="px-3 py-2 text-center text-ink-dim tabular-nums">{row.uniquePlayers}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Board>
  );
}

type PlayerPointsSortKey = "rank" | "player" | "points" | "keeperSeasons" | "uniqueOwners";

function playerPointsSortValue(row: PlayerKeeperPoints & { rank: number }, key: PlayerPointsSortKey): number | string {
  switch (key) {
    case "rank":
      return row.rank;
    case "player":
      return row.playerName;
    case "points":
      return row.points;
    case "keeperSeasons":
      return row.keeperSeasons;
    case "uniqueOwners":
      return row.uniqueOwners;
  }
}

function PlayerPointsTable({ rows }: { rows: (PlayerKeeperPoints & { rank: number })[] }) {
  const { sorted, sortKey, direction, toggleSort } = useSortableRows<
    PlayerKeeperPoints & { rank: number },
    PlayerPointsSortKey
  >(rows, playerPointsSortValue, "rank", "asc");

  return (
    <Board maxHeight={TEN_ROWS}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <SortHeader
              label="Rank"
              sortKey="rank"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
            <SortHeader
              label="Player"
              sortKey="player"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="left"
            />
            <SortHeader
              label="Points"
              sortKey="points"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
              tooltip={PTS_SEMANTICS_TOOLTIP_SEASON_SHORT}
            />
            <SortHeader
              label="Seasons"
              sortKey="keeperSeasons"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
            <SortHeader
              label="Unique Owners"
              sortKey="uniqueOwners"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map(p => (
            <tr key={p.playerId} className="border-t border-border hover:bg-surface-2">
              <td className="px-3 py-2 text-center">
                <RankBadge rank={p.rank} plain />
              </td>
              <td className="px-3 py-2 font-semibold">
                <Link to={`/player/${p.playerId}`} className="hover:underline">
                  {p.playerName}
                </Link>
              </td>
              <td className="px-3 py-2 text-center tabular-nums">{formatPoints(p.points)}</td>
              <td className="px-3 py-2 text-center text-ink-dim tabular-nums">{p.keeperSeasons}</td>
              <td className="px-3 py-2 text-center text-ink-dim tabular-nums">{p.uniqueOwners}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Board>
  );
}

type NeverKeptSortKey = "player" | "careerPoints" | "seasonsSeen" | "rosterDays";

function neverKeptSortValue(row: NeverKeptEntry, key: NeverKeptSortKey): number | string {
  switch (key) {
    case "player":
      return row.playerName;
    case "careerPoints":
      return row.careerPoints;
    case "seasonsSeen":
      return row.seasonsSeen;
    case "rosterDays":
      return row.rosterDays;
  }
}

function NeverKeptTable({ rows }: { rows: NeverKeptEntry[] }) {
  const { sorted, sortKey, direction, toggleSort } = useSortableRows<NeverKeptEntry, NeverKeptSortKey>(
    rows,
    neverKeptSortValue,
    "seasonsSeen",
    "desc"
  );

  return (
    <Board maxHeight={TEN_ROWS}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky top-0 z-10 bg-surface px-3 py-2 text-center text-[0.66rem] font-semibold tracking-wide text-ink-faint uppercase"></th>
            <SortHeader
              label="Player"
              sortKey="player"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="left"
            />
            <SortHeader
              label="Career Points"
              sortKey="careerPoints"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
              tooltip={PTS_SEMANTICS_TOOLTIP_SEASON_SHORT}
            />
            <SortHeader
              label="Seasons"
              sortKey="seasonsSeen"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
            <SortHeader
              label="Days Rostered"
              sortKey="rosterDays"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
              ariaLabel="Days Rostered since 2019 -- distinct days on any fantasy roster; daily rosters only exist in the archive from 2019 on, so earlier seasons don't count here."
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => (
            <tr key={p.playerId} className="border-t border-border hover:bg-surface-2">
              <td className="px-3 py-2 text-center">
                <RankBadge rank={i + 1} plain />
              </td>
              <td className="px-3 py-2 font-semibold">
                <Link to={`/player/${p.playerId}`} className="hover:underline">
                  {p.playerName}
                </Link>
              </td>
              <td className="px-3 py-2 text-center tabular-nums">{formatPoints(p.careerPoints)}</td>
              <td className="px-3 py-2 text-center tabular-nums">{p.seasonsSeen}</td>
              <td className="px-3 py-2 text-center text-ink-dim tabular-nums">
                {p.rosterDays > 0 ? p.rosterDays : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Board>
  );
}

/** The Keepers page's owner-centric tab: consolidates what used to be two
 * separate tabs (a points-only "Keeper Points" leaderboard and a
 * distinct-player-count-only "By Owner" leaderboard) into one sortable
 * owner table -- Unique Players folds the old count table's only unique
 * information into a column here rather than keeping a near-duplicate
 * table around. Keeper Points by Player and Most Played, Never Kept (moved
 * in from the old "By Owner" tab) round out the page; all three sum the
 * same per-keeper-season points computation (lib/keepers.ts's
 * getPlayerSeasonPoints), which reads the precomputed season totals in
 * player_season_points.json rather than re-aggregating box scores
 * client-side. No "box_scores" coverage badge on the points tables: that
 * domain's "partial" status flags team/lineup attribution issues, neither of
 * which affects a player's own season point total. */
export function PointsLeaderboards({
  search,
  seasons,
  byOwner,
  byPlayer,
  neverKept,
  ownerScope,
  onOwnerScopeChange,
}: PointsLeaderboardsProps) {
  const q = search.trim().toLowerCase();
  const rankedPlayers = byPlayer.map((p, i) => ({ ...p, rank: i + 1 }));
  const filteredPlayers = q ? rankedPlayers.filter(p => p.playerName.toLowerCase().includes(q)) : rankedPlayers;
  const filteredNeverKept = q ? neverKept.filter(p => p.playerName.toLowerCase().includes(q)) : neverKept;

  return (
    <div className="space-y-8">
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <SectionHeading>Keeper Points by Owner</SectionHeading>
          <OwnerScopeToggle value={ownerScope} onChange={onOwnerScopeChange} />
        </div>
        <OwnerPointsTable rows={byOwner} />
      </div>

      <div>
        <SectionHeading className="mb-3">Keeper Points by Player</SectionHeading>
        {filteredPlayers.length === 0 ? (
          <p className="text-sm text-ink-dim">No players match this search.</p>
        ) : (
          <PlayerPointsTable rows={filteredPlayers} />
        )}
      </div>

      <div>
        <div className="mb-3 flex items-center gap-2">
          <SectionHeading>Most Played, Never Kept</SectionHeading>
          <CoverageBadge seasons={seasons} domain="draft" />
        </div>
        {filteredNeverKept.length === 0 ? (
          <p className="text-sm text-ink-dim">No players match this search.</p>
        ) : (
          <NeverKeptTable rows={filteredNeverKept} />
        )}
      </div>
    </div>
  );
}
