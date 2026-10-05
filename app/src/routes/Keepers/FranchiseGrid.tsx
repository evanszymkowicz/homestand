import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CoverageBadge } from "../../components/CoverageBadge";
import { SectionHeading } from "../../components/SectionHeading";
import { SegmentedToggle } from "../../components/SegmentedToggle";
import type { FranchiseKeeperGroup, FranchiseKeeperPlayer } from "../../lib/keepers";
import { MLB_TEAM_COLORS } from "../../lib/mlbColors";
import type { Season } from "../../types";

interface FranchiseGridProps {
  seasons: Season[];
  groups: FranchiseKeeperGroup[];
  search: string;
}

type SortMode = "count" | "alpha";

/** ~10 rows of this list's py-1.5/text-sm player buttons before the accent
 * scrollbar takes over -- keeps a 60-keeper-season franchise (Dodgers) from
 * stretching its whole grid row to match, same row-cap pattern as Board's
 * TEN_ROWS. */
const FRANCHISE_LIST_MAX_HEIGHT = "20rem";

const SORT_OPTIONS: { key: SortMode; label: string }[] = [
  { key: "count", label: "Most Keeper-Seasons" },
  { key: "alpha", label: "A–Z" },
];

function matchesSearch(group: FranchiseKeeperGroup, q: string): boolean {
  if (!q) return true;
  if (group.franchiseName.toLowerCase().includes(q)) return true;
  if (group.abbrev.toLowerCase().includes(q)) return true;
  return group.players.some(p => p.playerName.toLowerCase().includes(q));
}

/** Centered overlay card for one clicked player: who (fantasy owner) kept
 * them and in which year, one line per keeper season, newest first. Backdrop
 * click or Esc closes. */
function PlayerKeeperCard({ player, onClose }: { player: FranchiseKeeperPlayer; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Keeper history for ${player.playerName}`}>
      <div
        className="w-full max-w-xs rounded-xl border border-border bg-surface shadow-lg"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <div className="font-extrabold">{player.playerName}</div>
            <div className="text-xs text-ink-faint tabular-nums">
              {player.count} keeper-season{player.count === 1 ? "" : "s"}
            </div>
            <Link to={`/player/${player.playerId}`} onClick={onClose} className="text-xs text-accent hover:underline">
              View full player history →
            </Link>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-ink-faint hover:bg-surface-2 hover:text-ink">
            ✕
          </button>
        </div>
        <ul className="scrollbar-accent max-h-72 overflow-y-auto py-1.5">
          {[...player.seasons].reverse().map(s => (
            <li key={s.year} className="flex items-baseline justify-between gap-3 px-4 py-1.5 text-sm">
              <span className="text-ink-faint tabular-nums">{s.year}</span>
              <span className="font-semibold">{s.owner.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function FranchiseGrid({ seasons, groups, search }: FranchiseGridProps) {
  const [sort, setSort] = useState<SortMode>("count");
  const [selected, setSelected] = useState<FranchiseKeeperPlayer | null>(null);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    const matched = groups.filter(g => matchesSearch(g, q));
    return sort === "alpha" ? [...matched].sort((a, b) => a.franchiseName.localeCompare(b.franchiseName)) : matched;
  }, [groups, q, sort]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SectionHeading>Keepers by MLB Franchise</SectionHeading>
          <CoverageBadge seasons={seasons} domain="draft" />
        </div>
        <SegmentedToggle ariaLabel="Sort franchises" size="sm" value={sort} onChange={setSort} options={SORT_OPTIONS} />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-ink-dim">No franchises match this search.</p>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))" }}>
          {filtered.map(group => {
            const color = group.isFreeAgent ? undefined : MLB_TEAM_COLORS[group.abbrev];
            const players = q ? group.players.filter(p => matchesSearch({ ...group, players: [p] }, q)) : group.players;
            return (
              <div
                key={group.proTeamId}
                className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
                <div
                  className={`flex flex-col gap-0.5 border-b border-border px-3.5 py-3 ${
                    group.isFreeAgent ? "border-l-4 border-l-border border-dashed" : "border-l-4"
                  }`}
                  style={color ? { borderLeftColor: color } : undefined}>
                  <div className="text-[1.02rem] font-extrabold">{group.franchiseName}</div>
                  <div className="text-xs font-semibold text-ink-dim tabular-nums">
                    {group.totalKeeperSeasons} keeper-season{group.totalKeeperSeasons === 1 ? "" : "s"}
                  </div>
                </div>
                <ul
                  className="scrollbar-accent flex-1 overflow-y-auto py-1.5"
                  style={{ maxHeight: FRANCHISE_LIST_MAX_HEIGHT }}>
                  {players.map(p => (
                    <li key={p.playerId}>
                      <button
                        type="button"
                        onClick={() => setSelected(p)}
                        title={`Show who kept ${p.playerName}`}
                        className="flex w-full items-baseline gap-2 px-3.5 py-1.5 text-left hover:bg-surface-2">
                        <span className="flex-1 truncate text-sm">{p.playerName}</span>
                        <span className="flex-none text-xs whitespace-nowrap text-ink-faint tabular-nums">
                          <b className="text-accent">{p.count}×</b>{" "}
                          {p.firstYear === p.lastYear ? p.firstYear : `${p.firstYear}–${p.lastYear}`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {selected && <PlayerKeeperCard player={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
