import { Link } from "react-router-dom";
import { Board, TEN_ROWS } from "../../components/Board";
import { CoverageBadge } from "../../components/CoverageBadge";
import { RankBadge } from "../../components/RankBadge";
import { SectionHeading } from "../../components/SectionHeading";
import { SortHeader } from "../../components/SortHeader";
import { useSortableRows } from "../../hooks/useSortableRows";
import type { KeeperHandoffEntry, KeeperStreakEntry } from "../../lib/keepers";
import type { Season } from "../../types";

interface StreakLeaderboardsProps {
  seasons: Season[];
  search: string;
  longestKept: KeeperStreakEntry[];
  activeStreaks: KeeperStreakEntry[];
  handoffs: KeeperHandoffEntry[];
}

const LEADERBOARD_SIZE = 10;

const th =
  "sticky top-0 z-10 bg-surface px-3 py-2 text-left text-[0.66rem] font-semibold tracking-wide text-ink-faint uppercase";
const thCenter =
  "sticky top-0 z-10 bg-surface px-3 py-2 text-center text-[0.66rem] font-semibold tracking-wide text-ink-faint uppercase";

function matches(entry: KeeperStreakEntry, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return entry.playerName.toLowerCase().includes(q) || entry.owners.some(o => o.name.toLowerCase().includes(q));
}

/** Both top-row cards render inside a Board capped at the same fixed height,
 * so they always sit as equally sized boxes: Kept Players holds its top 10
 * (no scrolling needed), Longest Active Streak lists every active run and
 * scrolls the overflow behind the accent scrollbar. */
function StreakTable({ entries, search, limit }: { entries: KeeperStreakEntry[]; search: string; limit?: number }) {
  const filtered = entries.filter(e => matches(e, search));
  const shown = limit === undefined ? filtered : filtered.slice(0, limit);

  return (
    <div>
      {filtered.length === 0 ? (
        <p className="text-sm text-ink-faint">No keepers match this search.</p>
      ) : (
        <Board maxHeight={TEN_ROWS}>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className={thCenter}></th>
                <th scope="col" className={th}>
                  Player
                </th>
                <th scope="col" className={thCenter}>
                  Years
                </th>
                <th scope="col" className={thCenter}>
                  Seasons
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e, i) => (
                <tr key={`${e.playerId}-${e.startYear}`} className="border-t border-border hover:bg-surface-2">
                  <td className="px-3 py-2 text-center">
                    <RankBadge rank={i + 1} />
                  </td>
                  <td className="px-3 py-2 font-semibold whitespace-nowrap">
                    <Link to={`/player/${e.playerId}`} className="hover:underline">
                      {e.playerName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-center whitespace-nowrap text-ink-dim tabular-nums">
                    {e.startYear === e.endYear ? e.startYear : `${e.startYear}–${e.endYear}`}
                  </td>
                  <td className="px-3 py-2 text-center font-semibold tabular-nums">{e.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Board>
      )}
    </div>
  );
}

function matchesHandoff(entry: KeeperHandoffEntry, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return (
    entry.playerName.toLowerCase().includes(q) ||
    entry.fromOwner.name.toLowerCase().includes(q) ||
    entry.toOwner.name.toLowerCase().includes(q)
  );
}

type HandoffSortKey = "player" | "handoff" | "years" | "kind";

function handoffSortValue(e: KeeperHandoffEntry, key: HandoffSortKey): number | string {
  switch (key) {
    case "player":
      return e.playerName;
    case "handoff":
      return `${e.fromOwner.name} ${e.toOwner.name}`;
    case "years":
      return e.fromYear;
    case "kind":
      return e.kind;
  }
}

function HandoffTable({ entries, search }: { entries: KeeperHandoffEntry[]; search: string }) {
  const filtered = entries.filter(e => matchesHandoff(e, search));
  const { sorted, sortKey, direction, toggleSort } = useSortableRows<KeeperHandoffEntry, HandoffSortKey>(
    filtered,
    handoffSortValue,
    "years",
    "desc"
  );

  return filtered.length === 0 ? (
    <p className="text-sm text-ink-faint">No keepers match this search.</p>
  ) : (
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
              label="From → To"
              sortKey="handoff"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="left"
            />
            <SortHeader
              label="Years"
              sortKey="years"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
            <SortHeader
              label="How"
              sortKey="kind"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="left"
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((e, i) => (
            <tr key={`${e.playerId}-${e.toYear}-${i}`} className="border-t border-border hover:bg-surface-2">
              <td className="px-3 py-2 font-semibold">
                <Link to={`/player/${e.playerId}`} className="hover:underline">
                  {e.playerName}
                </Link>
              </td>
              <td className="px-3 py-2 text-ink-dim">
                {e.fromOwner.name} → {e.toOwner.name}
              </td>
              <td className="px-3 py-2 text-center text-ink-dim tabular-nums">
                {e.fromYear}–{e.toYear}
              </td>
              <td className="px-3 py-2">
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[0.6rem] font-bold ${
                    e.kind === "trade" ? "bg-gold-soft text-gold" : "bg-surface-2 text-ink-dim"
                  }`}>
                  {e.kind === "trade" ? "trade" : "ownership transfer"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Board>
  );
}

/** Kept-players and longest-active-streak leaderboards sit in the top row,
 * followed by a list of the year-over-year owner changes a kept player lived
 * through -- a trade (moved to a different team slot) or an ownership
 * transfer (same team slot, franchise changed hands), per lib/keepers.ts's
 * getKeeperHandoffs. */
export function StreakLeaderboards({ seasons, search, longestKept, activeStreaks, handoffs }: StreakLeaderboardsProps) {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <SectionHeading>Longest Kept Players</SectionHeading>
            <CoverageBadge seasons={seasons} domain="draft" />
          </div>
          <StreakTable entries={longestKept} search={search} limit={LEADERBOARD_SIZE} />
        </div>

        <div>
          <div className="mb-3 flex items-center gap-2">
            <SectionHeading>Longest Active Streak</SectionHeading>
            <CoverageBadge seasons={seasons} domain="draft" />
          </div>
          <StreakTable entries={activeStreaks} search={search} />
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center gap-2">
          <SectionHeading>Changed Hands While Kept</SectionHeading>
          <CoverageBadge seasons={seasons} domain="draft" />
        </div>
        <HandoffTable entries={handoffs} search={search} />
      </div>
    </div>
  );
}
