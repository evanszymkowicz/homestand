import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Board, TEN_ROWS } from "../../components/Board";
import { CoverageBadge } from "../../components/CoverageBadge";
import { Headshot } from "../../components/Headshot";
import { OwnerLink } from "../../components/OwnerLink";
import { SectionHeading } from "../../components/SectionHeading";
import { SortHeader } from "../../components/SortHeader";
import { useSortableRows } from "../../hooks/useSortableRows";
import { formatPoints } from "../../lib/format";
import { positionLabel } from "../../lib/positions";
import { ownerRef } from "../../lib/stats";
import {
  getJourneymen,
  getOwnerActivity,
  getVersatilePlayers,
  getWaiverPickups,
  type Journeyman,
  type OwnerActivity,
  type VersatilePlayer,
  type WaiverPickup,
} from "../../lib/transactions";
import type {
  DraftPick,
  Keeper,
  Owner,
  Player,
  PlayerSeasonPoints,
  PlayerTeamSeasonPoints,
  Season,
  Team,
  Transaction,
} from "../../types";

interface WireAndRosterProps {
  owners: Owner[];
  seasons: Season[];
  teams: Team[];
  players: Player[];
  seasonPoints: PlayerSeasonPoints[];
  teamSeasonPoints: PlayerTeamSeasonPoints[];
  draftPicks: DraftPick[];
  keepers: Keeper[];
  transactions: Transaction[];
}

function PlayerCell({
  playerId,
  playerName,
  headshot = true,
}: {
  playerId: number;
  playerName: string;
  /** False on the Wire/Journeymen boards, whose rows are dense enough without one. */
  headshot?: boolean;
}) {
  return (
    <Link to={`/player/${playerId}`} className="inline-flex items-center gap-2 hover:underline">
      {headshot && <Headshot playerId={playerId} playerName={playerName} size={28} />}
      <span className="font-semibold">{playerName}</span>
    </Link>
  );
}

type PickupSortKey = "player" | "year" | "owner" | "points";

function pickupSortValue(owners: Owner[], p: WaiverPickup, key: PickupSortKey): number | string {
  switch (key) {
    case "player":
      return p.playerName;
    case "year":
      return p.year * 100 + (p.week ?? 0);
    case "owner":
      return ownerRef(owners, p.ownerId).name;
    case "points":
      return p.ownerPoints;
  }
}

type ActivitySortKey = "owner" | "moves" | "perSeason" | "seasons" | "trades";

function activitySortValue(owners: Owner[], o: OwnerActivity, key: ActivitySortKey): number | string {
  switch (key) {
    case "owner":
      return ownerRef(owners, o.ownerId).name;
    case "moves":
      return o.moves;
    case "perSeason":
      return o.movesPerSeason;
    case "seasons":
      return o.seasonsCovered;
    case "trades":
      return o.trades;
  }
}

type JourneymanSortKey = "player" | "pickups" | "owners";

function journeymanSortValue(j: Journeyman, key: JourneymanSortKey): number | string {
  switch (key) {
    case "player":
      return j.playerName;
    case "pickups":
      return j.pickups;
    case "owners":
      return j.ownerIds.length;
  }
}

type VersatileSortKey = "player" | "positions" | "where";

function versatileSortValue(p: VersatilePlayer, key: VersatileSortKey): number | string {
  switch (key) {
    case "player":
      return p.playerName;
    case "positions":
      return p.positionCount;
    case "where":
      return p.totalGames;
  }
}

/**
 * Four leaderboards built on the data Phase 9 added. Their coverage differs and
 * the page says so per board rather than once at the top — three run on the
 * 2019+ transaction ledger, one runs on the full 2009-2025 archive, and
 * conflating them would misrepresent the 2019+ ones as all-time records.
 */
export function WireAndRoster({
  owners,
  seasons,
  teams,
  players,
  seasonPoints,
  teamSeasonPoints,
  draftPicks,
  keepers,
  transactions,
}: WireAndRosterProps) {
  const pickups = useMemo(
    () => getWaiverPickups(transactions, seasonPoints, teamSeasonPoints, draftPicks, keepers, 15),
    [transactions, seasonPoints, teamSeasonPoints, draftPicks, keepers]
  );
  const journeymen = useMemo(() => getJourneymen(transactions, players, 15), [transactions, players]);
  const activity = useMemo(() => getOwnerActivity(teams), [teams]);
  const versatile = useMemo(() => getVersatilePlayers(players, { limit: 15 }), [players]);

  const pickupsSort = useSortableRows<WaiverPickup, PickupSortKey>(
    pickups,
    (p, key) => pickupSortValue(owners, p, key),
    "points",
    "desc"
  );
  const journeymenSort = useSortableRows<Journeyman, JourneymanSortKey>(
    journeymen,
    journeymanSortValue,
    "pickups",
    "desc"
  );
  const activitySort = useSortableRows<OwnerActivity, ActivitySortKey>(
    activity,
    (o, key) => activitySortValue(owners, o, key),
    "moves",
    "desc"
  );
  const versatileSort = useSortableRows<VersatilePlayer, VersatileSortKey>(
    versatile,
    versatileSortValue,
    "positions",
    "desc"
  );

  return (
    <div className="space-y-10">
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SectionHeading>Best Wire Claims</SectionHeading>
          <CoverageBadge seasons={seasons} domain="transactions" />
        </div>
        <p className="mb-3 max-w-2xl text-xs text-ink-dim">
          Free-agent adds ranked by what the player scored <strong>while on that owner's roster</strong>, not their
          full-season total.
        </p>
        {pickups.length === 0 ? (
          <p className="text-sm text-ink-dim">No transaction data available.</p>
        ) : (
          <Board maxHeight={TEN_ROWS}>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <SortHeader
                    label="Player"
                    sortKey="player"
                    activeKey={pickupsSort.sortKey}
                    direction={pickupsSort.direction}
                    onSort={pickupsSort.toggleSort}
                    align="left"
                  />
                  <SortHeader
                    label="Year"
                    sortKey="year"
                    activeKey={pickupsSort.sortKey}
                    direction={pickupsSort.direction}
                    onSort={pickupsSort.toggleSort}
                    align="center"
                  />
                  <SortHeader
                    label="Claimed by"
                    sortKey="owner"
                    activeKey={pickupsSort.sortKey}
                    direction={pickupsSort.direction}
                    onSort={pickupsSort.toggleSort}
                    align="left"
                  />
                  <SortHeader
                    label="Points"
                    sortKey="points"
                    activeKey={pickupsSort.sortKey}
                    direction={pickupsSort.direction}
                    onSort={pickupsSort.toggleSort}
                    align="center"
                  />
                </tr>
              </thead>
              <tbody>
                {pickupsSort.sorted.map(p => (
                  <tr
                    key={`${p.year}-${p.playerId}-${p.ownerId}`}
                    className="border-t border-border hover:bg-surface-2">
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1">
                        <PlayerCell playerId={p.playerId} playerName={p.playerName} headshot={false} />
                        {p.nextYearStatus === "kept" && <span className="text-gold">*</span>}
                        {p.nextYearStatus === "drafted" && <span className="text-diverge-pos">↑</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums">
                      {p.year}
                      {p.week !== null && <span className="text-ink-faint"> wk {p.week}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <OwnerLink owners={owners} ownerId={p.ownerId} />
                    </td>
                    <td className="px-3 py-2 text-center font-semibold tabular-nums">{formatPoints(p.ownerPoints)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Board>
        )}
        {pickups.length > 0 && (
          <p className="mt-2 text-xs text-ink-faint">
            <span className="text-gold">*</span> kept the following season · <span className="text-diverge-pos">↑</span>{" "}
            redrafted the following season
          </p>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SectionHeading>Journeymen</SectionHeading>
          <CoverageBadge seasons={seasons} domain="transactions" />
        </div>
        <p className="mb-3 max-w-2xl text-xs text-ink-dim">
          Players picked up off the wire the most times over their careers. Counts every free-agent add across every
          owner and year in the ledger — a player dropped and re-claimed by the same owner counts twice, since each is a
          real pickup event.
        </p>
        {journeymen.length === 0 ? (
          <p className="text-sm text-ink-dim">No transaction data available.</p>
        ) : (
          <Board maxHeight={TEN_ROWS}>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <SortHeader
                    label="Player"
                    sortKey="player"
                    activeKey={journeymenSort.sortKey}
                    direction={journeymenSort.direction}
                    onSort={journeymenSort.toggleSort}
                    align="left"
                  />
                  <SortHeader
                    label="Claims"
                    sortKey="pickups"
                    activeKey={journeymenSort.sortKey}
                    direction={journeymenSort.direction}
                    onSort={journeymenSort.toggleSort}
                    align="center"
                  />
                  <SortHeader
                    label="Owners"
                    sortKey="owners"
                    activeKey={journeymenSort.sortKey}
                    direction={journeymenSort.direction}
                    onSort={journeymenSort.toggleSort}
                    align="center"
                  />
                </tr>
              </thead>
              <tbody>
                {journeymenSort.sorted.map(j => (
                  <tr key={j.playerId} className="border-t border-border hover:bg-surface-2">
                    <td className="px-3 py-2">
                      <PlayerCell playerId={j.playerId} playerName={j.playerName} headshot={false} />
                    </td>
                    <td className="px-3 py-2 text-center font-semibold tabular-nums">{j.pickups}</td>
                    <td className="px-3 py-2 text-center text-ink-dim tabular-nums">{j.ownerIds.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Board>
        )}
      </section>

      <section>
        <SectionHeading className="mb-3">The Tinkerers</SectionHeading>
        <p className="mb-3 max-w-2xl text-xs text-ink-dim">Roster moves per owner.</p>
        <Board maxHeight={TEN_ROWS}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <SortHeader
                  label="Owner"
                  sortKey="owner"
                  activeKey={activitySort.sortKey}
                  direction={activitySort.direction}
                  onSort={activitySort.toggleSort}
                  align="left"
                />
                <SortHeader
                  label="Moves"
                  sortKey="moves"
                  activeKey={activitySort.sortKey}
                  direction={activitySort.direction}
                  onSort={activitySort.toggleSort}
                  align="center"
                />
                <SortHeader
                  label="Per Season"
                  sortKey="perSeason"
                  activeKey={activitySort.sortKey}
                  direction={activitySort.direction}
                  onSort={activitySort.toggleSort}
                  align="center"
                />
                <SortHeader
                  label="Seasons"
                  sortKey="seasons"
                  activeKey={activitySort.sortKey}
                  direction={activitySort.direction}
                  onSort={activitySort.toggleSort}
                  align="center"
                />
                <SortHeader
                  label="Trades"
                  sortKey="trades"
                  activeKey={activitySort.sortKey}
                  direction={activitySort.direction}
                  onSort={activitySort.toggleSort}
                  align="center"
                />
              </tr>
            </thead>
            <tbody>
              {activitySort.sorted.map(o => (
                <tr key={o.ownerId} className="border-t border-border hover:bg-surface-2">
                  <td className="px-3 py-2 font-semibold">
                    <OwnerLink owners={owners} ownerId={o.ownerId} />
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums">{o.moves}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{o.movesPerSeason.toFixed(1)}</td>
                  <td className="px-3 py-2 text-center text-ink-dim tabular-nums">{o.seasonsCovered}</td>
                  <td className="px-3 py-2 text-center text-ink-dim tabular-nums">{o.trades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Board>
      </section>

      <section>
        <SectionHeading className="mb-3">Most Versatile</SectionHeading>
        <p className="mb-3 max-w-2xl text-xs text-ink-dim">
          Qualified positions in one season. Hitters must make at least 10 appearances at a position to qualify.
        </p>
        <Board maxHeight={TEN_ROWS}>
          <table className="w-full table-fixed border-collapse text-sm">
            <thead>
              <tr>
                <SortHeader
                  label="Player"
                  sortKey="player"
                  activeKey={versatileSort.sortKey}
                  direction={versatileSort.direction}
                  onSort={versatileSort.toggleSort}
                  align="left"
                />
                <SortHeader
                  label="Position"
                  sortKey="positions"
                  activeKey={versatileSort.sortKey}
                  direction={versatileSort.direction}
                  onSort={versatileSort.toggleSort}
                  align="center"
                />
                <SortHeader
                  label="Where"
                  sortKey="where"
                  activeKey={versatileSort.sortKey}
                  direction={versatileSort.direction}
                  onSort={versatileSort.toggleSort}
                  align="left"
                />
              </tr>
            </thead>
            <tbody>
              {versatileSort.sorted.map(p => (
                <tr key={p.playerId} className="border-t border-border hover:bg-surface-2">
                  <td className="w-1/3 px-3 py-2">
                    <PlayerCell playerId={p.playerId} playerName={p.playerName} />
                  </td>
                  <td className="w-1/3 px-3 py-2 text-center font-semibold tabular-nums">{p.positionCount}</td>
                  <td className="w-1/3 px-3 py-2">
                    <span className="flex flex-wrap gap-1">
                      {p.positions.map(pos => (
                        <span
                          key={pos.positionId}
                          className="rounded bg-surface-2 px-1.5 py-0.5 text-[0.68rem] text-ink-faint"
                          title={`${pos.games} appearances`}>
                          {positionLabel(pos.positionId)}
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Board>
      </section>
    </div>
  );
}
