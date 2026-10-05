import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FilterBar } from "../../components/FilterBar";
import { FilterSelect } from "../../components/FilterSelect";
import { SectionHeading } from "../../components/SectionHeading";
import { formatPoints } from "../../lib/format";
import type { PlayerSeason, PlayerSeasonPoints } from "../../types";

interface Top10ByPositionProps {
  seasonPoints: PlayerSeasonPoints[];
  playerSeasons: PlayerSeason[];
  year: number | undefined;
}

const MIN_OPTIONS = [0, 25, 50, 100, 150, 200];

const POSITION_GROUPS: { key: string; label: string; positionIds: number[]; color: string }[] = [
  { key: "sp", label: "SP", positionIds: [1], color: "#ff6b6b" },
  { key: "c", label: "C", positionIds: [2], color: "#ffd93d" },
  { key: "1b", label: "1B", positionIds: [3], color: "#6bcb77" },
  { key: "2b", label: "2B", positionIds: [4], color: "#4d96ff" },
  { key: "3b", label: "3B", positionIds: [5], color: "#9b59b6" },
  { key: "ss", label: "SS", positionIds: [6], color: "#1abc9c" },
  { key: "of", label: "OF", positionIds: [7, 8, 9], color: "#e17055" },
  { key: "dh", label: "DH", positionIds: [10], color: "#fdcb6e" },
  { key: "rp", label: "RP", positionIds: [11], color: "#00b894" },
];

interface BoxPlotStats {
  count: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

interface PositionData {
  players: { playerId: number; playerName: string; points: number }[];
  stats: BoxPlotStats;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function getPositionGroup(positionId: number): string | null {
  for (const group of POSITION_GROUPS) {
    if (group.positionIds.includes(positionId)) return group.key;
  }
  return null;
}

export default function Top10ByPosition({ seasonPoints, playerSeasons, year }: Top10ByPositionProps) {
  const [minPoints, setMinPoints] = useState(25);

  const grouped = useMemo(() => {
    if (!year) return new Map<string, PositionData>();

    const psByPlayerId = new Map<number, PlayerSeason>();
    for (const ps of playerSeasons) {
      if (ps.year === year) psByPlayerId.set(ps.player_id, ps);
    }
    const pointsByPlayerId = new Map<number, number>();
    for (const p of seasonPoints) {
      if (p.year === year) pointsByPlayerId.set(p.player_id, p.points);
    }

    const raw = new Map<string, { playerId: number; playerName: string; points: number }[]>();
    for (const group of POSITION_GROUPS) raw.set(group.key, []);
    for (const [playerId, ps] of psByPlayerId) {
      const positionId = ps.default_position_id;
      const groupKey = getPositionGroup(positionId);
      if (!groupKey) continue;
      const points = pointsByPlayerId.get(playerId) ?? 0;
      if (points < minPoints) continue;
      raw.get(groupKey)!.push({ playerId, playerName: ps.player_name, points });
    }

    const result = new Map<string, PositionData>();
    for (const [key, players] of raw) {
      players.sort((a, b) => b.points - a.points);
      const top = players.slice(0, 50);
      const scores = top.map(p => p.points).sort((a, b) => a - b);
      const stats: BoxPlotStats =
        scores.length === 0
          ? { count: 0, min: 0, q1: 0, median: 0, q3: 0, max: 0 }
          : {
              count: scores.length,
              min: scores[0],
              q1: percentile(scores, 25),
              median: percentile(scores, 50),
              q3: percentile(scores, 75),
              max: scores[scores.length - 1],
            };
      result.set(key, { players: top, stats });
    }
    return result;
  }, [seasonPoints, playerSeasons, year, minPoints]);

  if (!year) {
    return (
      <div className="mt-6">
        <div className="mb-3 flex items-center gap-2">
          <SectionHeading>Top Performing Players By Position</SectionHeading>
        </div>
        <p className="text-sm text-ink-dim">Select a season to view top players by position.</p>
      </div>
    );
  }

  const hasAnyPlayers = POSITION_GROUPS.some(g => grouped.get(g.key)!.stats.count > 0);
  if (!hasAnyPlayers) {
    return (
      <div className="mt-6">
        <div className="mb-3 flex items-center gap-2">
          <SectionHeading>Top Performing Players By Position</SectionHeading>
        </div>
        <p className="text-sm text-ink-dim">No players meet the minimum points threshold for this season.</p>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center gap-2">
        <SectionHeading>Top Performing Players By Position</SectionHeading>
      </div>
      <FilterBar>
        <span className="text-xs text-ink-faint self-center">Min pts:</span>
        <FilterSelect
          value={minPoints}
          onChange={e => setMinPoints(Number(e.target.value))}
          aria-label="Minimum points filter">
          {MIN_OPTIONS.map(opt => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </FilterSelect>
      </FilterBar>

      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))" }}>
        {POSITION_GROUPS.map(group => {
          const { players, stats } = grouped.get(group.key)!;
          return (
            <div
              key={group.key}
              className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
              <div className="border-b border-border px-3.5 py-3 border-l-4" style={{ borderLeftColor: group.color }}>
                <div className="text-[1.02rem] font-extrabold">{group.label}</div>
                <div className="mt-1 grid grid-cols-5 gap-x-1 text-center text-[0.62rem] tabular-nums">
                  <div>
                    <div className="text-ink-faint">Min</div>
                    <div className="font-semibold">{stats.count > 0 ? formatPoints(stats.min) : "—"}</div>
                  </div>
                  <div>
                    <div className="text-ink-faint">Q1</div>
                    <div className="font-semibold">{stats.count > 0 ? formatPoints(stats.q1) : "—"}</div>
                  </div>
                  <div>
                    <div className="text-ink-faint">Med</div>
                    <div className="font-bold text-accent">{stats.count > 0 ? formatPoints(stats.median) : "—"}</div>
                  </div>
                  <div>
                    <div className="text-ink-faint">Q3</div>
                    <div className="font-semibold">{stats.count > 0 ? formatPoints(stats.q3) : "—"}</div>
                  </div>
                  <div>
                    <div className="text-ink-faint">Max</div>
                    <div className="font-semibold">{stats.count > 0 ? formatPoints(stats.max) : "—"}</div>
                  </div>
                </div>
              </div>
              <ul className="scrollbar-accent flex-1 overflow-y-auto py-1.5" style={{ maxHeight: "20rem" }}>
                {players.map(entry => (
                  <li key={entry.playerId}>
                    <Link
                      to={`/player/${entry.playerId}`}
                      className="flex w-full items-baseline gap-2 px-3.5 py-1.5 text-left hover:bg-surface-2">
                      <span className="flex-1 truncate text-sm">{entry.playerName}</span>
                      <span className="flex-none text-xs whitespace-nowrap text-ink-faint tabular-nums">
                        <b className="text-accent">{formatPoints(entry.points)}</b>
                      </span>
                    </Link>
                  </li>
                ))}
                {players.length === 0 && <li className="px-3.5 py-1.5 text-sm text-ink-dim">—</li>}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="mt-6">
        <div className="mb-3 flex items-center gap-2">
          <SectionHeading>Position Scarcity</SectionHeading>
          <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[0.64rem] font-semibold text-ink-faint">
            Coming soon
          </span>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 text-sm text-ink-dim">
          Position scarcity analysis will compare roster slot availability against high-performing players at each
          position.
        </div>
      </div>
    </div>
  );
}
