import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { formatPoints } from "../../lib/format";
import type { PlayerSeason, PlayerSeasonPoints } from "../../types";

interface PositionScarcityProps {
  seasonPoints: PlayerSeasonPoints[];
  playerSeasons: PlayerSeason[];
  year: number | undefined;
}

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

interface PlayerEntry {
  playerName: string;
  playerId: number;
  points: number;
}

interface DensityCurve {
  groupKey: string;
  label: string;
  color: string;
  points: { x: number; y: number }[];
  median: number;
  count: number;
  players: PlayerEntry[];
}

function gaussianKDE(data: number[], bandwidth: number): (x: number) => number {
  const n = data.length;
  return (x: number) => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const z = (x - data[i]) / bandwidth;
      sum += Math.exp(-0.5 * z * z);
    }
    return sum / (n * bandwidth * Math.sqrt(2 * Math.PI));
  };
}

function buildDensityCurves(
  seasonPoints: PlayerSeasonPoints[],
  playerSeasons: PlayerSeason[],
  year: number,
): DensityCurve[] {
  const psByPlayerId = new Map<number, PlayerSeason>();
  for (const ps of playerSeasons) {
    if (ps.year === year) psByPlayerId.set(ps.player_id, ps);
  }

  const byGroup = new Map<string, PlayerEntry[]>();
  for (const g of POSITION_GROUPS) byGroup.set(g.key, []);

  for (const p of seasonPoints) {
    if (p.year !== year) continue;
    const ps = psByPlayerId.get(p.player_id);
    if (!ps) continue;
    const positionId = ps.default_position_id;
    const group = POSITION_GROUPS.find(g => g.positionIds.includes(positionId));
    if (!group) continue;
    byGroup.get(group.key)!.push({ playerName: p.player_name, playerId: p.player_id, points: p.points });
  }

  const curves: DensityCurve[] = [];
  for (const group of POSITION_GROUPS) {
    const players = byGroup.get(group.key)!.sort((a, b) => a.points - b.points);
    if (players.length < 3) continue;
    const scores = players.map(p => p.points);

    const min = scores[0];
    const max = scores[scores.length - 1];
    const range = max - min || 1;
    const bandwidth = range * 0.15;
    const kde = gaussianKDE(scores, bandwidth);

    const pad = range * 0.1;
    const lo = Math.max(0, min - pad);
    const hi = max + pad;
    const steps = 80;
    const stepSize = (hi - lo) / steps;
    const raw = Array.from({ length: steps + 1 }, (_, i) => {
      const x = lo + i * stepSize;
      return { x, y: kde(x) };
    });

    const maxY = Math.max(...raw.map(p => p.y));
    const points = raw.map(p => ({ x: p.x, y: maxY > 0 ? p.y / maxY : 0 }));

    const median = scores[Math.floor(scores.length / 2)];
    curves.push({
      groupKey: group.key,
      label: group.label,
      color: group.color,
      points,
      median,
      count: players.length,
      players: players.sort((a, b) => b.points - a.points),
    });
  }

  return curves.sort((a, b) => a.median - b.median);
}

const CHART_W = 680;
const CHART_H = 420;
const MARGIN = { top: 44, right: 40, bottom: 44, left: 56 };
const PLOT_W = CHART_W - MARGIN.left - MARGIN.right;
const PLOT_H = CHART_H - MARGIN.top - MARGIN.bottom;
const RIDGE_OVERLAP = 0.55;

function buildAreaPath(
  curve: DensityCurve,
  xScale: (v: number) => number,
  bandH: number,
  baseline: number,
): string {
  const pts = curve.points;
  if (pts.length === 0) return "";
  const first = `${xScale(pts[0].x)},${baseline}`;
  const top = pts.map(p => `${xScale(p.x)},${baseline - p.y * bandH}`).join(" L");
  const last = pts[pts.length - 1];
  const bottom = `${xScale(last.x)},${baseline}`;
  return `M${first} L${top} L${bottom} Z`;
}

function niceScale(lo: number, hi: number, maxTicks: number): number[] {
  const range = hi - lo;
  if (range <= 0) return [lo];
  const roughStep = range / (maxTicks - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const residual = roughStep / mag;
  let niceStep: number;
  if (residual <= 1.5) niceStep = 1 * mag;
  else if (residual <= 3) niceStep = 2 * mag;
  else if (residual <= 7) niceStep = 5 * mag;
  else niceStep = 10 * mag;
  const niceLo = Math.floor(lo / niceStep) * niceStep;
  const niceHi = Math.ceil(hi / niceStep) * niceStep;
  const ticks: number[] = [];
  for (let v = niceLo; v <= niceHi + niceStep * 0.5; v += niceStep) {
    ticks.push(Math.round(v * 1000) / 1000);
  }
  return ticks;
}

const HANDLE_R = 6;

export function PositionScarcity({ seasonPoints, playerSeasons, year }: PositionScarcityProps) {
  const curves = useMemo(
    () => (year ? buildDensityCurves(seasonPoints, playerSeasons, year) : []),
    [seasonPoints, playerSeasons, year],
  );
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [slider, setSlider] = useState<{ groupKey: string; value: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const dragging = useRef(false);

  const allScores = useMemo(() => {
    const psByPlayerId = new Map<number, PlayerSeason>();
    for (const ps of playerSeasons) {
      if (ps.year === year) psByPlayerId.set(ps.player_id, ps);
    }
    return seasonPoints
      .filter(p => p.year === year && psByPlayerId.has(p.player_id))
      .map(p => p.points);
  }, [seasonPoints, playerSeasons, year]);

  const rawMin = Math.min(...allScores);
  const rawMax = Math.max(...allScores);
  const xLo = Math.max(0, rawMin - 10);
  const xHi = rawMax + (rawMax - rawMin) * 0.35;
  const xScale = (v: number) => MARGIN.left + ((v - xLo) / (xHi - xLo)) * PLOT_W;
  const xScaleInvert = (svgX: number) => xLo + ((svgX - MARGIN.left) / PLOT_W) * (xHi - xLo);

  const bandH = PLOT_H / curves.length / (1 - RIDGE_OVERLAP);
  const rowH = PLOT_H / curves.length;
  const xTicks = niceScale(xLo, xHi, 6);

  const curveForRow = useCallback(
    (svgY: number): DensityCurve | null => {
      const idx = Math.floor((svgY - MARGIN.top) / rowH);
      if (idx < 0 || idx >= curves.length) return null;
      return curves[idx];
    },
    [curves, rowH],
  );

  const handleSvgMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const scaleX = CHART_W / rect.width;
      const scaleY = CHART_H / rect.height;
      const svgX = (e.clientX - rect.left) * scaleX;
      const svgY = (e.clientY - rect.top) * scaleY;

      if (svgX < MARGIN.left || svgX > CHART_W - MARGIN.right) return;
      if (svgY < MARGIN.top || svgY > CHART_H - MARGIN.bottom) return;

      const curve = curveForRow(svgY);
      if (!curve) return;

      const dataX = xScaleInvert(svgX);
      setSlider({ groupKey: curve.groupKey, value: dataX });
      setExpanded(false);
    },
    [curveForRow, xScaleInvert],
  );

  const handleSvgMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });

      if (!dragging.current || !slider) return;
      const scaleX = CHART_W / rect.width;
      const svgX = (e.clientX - rect.left) * scaleX;
      const clamped = Math.max(MARGIN.left, Math.min(CHART_W - MARGIN.right, svgX));
      setSlider(s => (s ? { ...s, value: xScaleInvert(clamped) } : s));
    },
    [slider, xScaleInvert],
  );

  useEffect(() => {
    if (!dragging.current) return;
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, []);

  if (!year) {
    return <p className="text-sm text-ink-dim">Select a season to view position scarcity analysis.</p>;
  }
  if (curves.length === 0) {
    return <p className="text-sm text-ink-dim">No position data available for this season.</p>;
  }

  const activeCurve = slider ? curves.find(c => c.groupKey === slider.groupKey) ?? null : null;
  const activeAbove = activeCurve && slider
    ? activeCurve.players.filter(p => p.points >= slider.value)
    : [];
  const activeAboveMax10 = activeAbove.slice(0, 10);

  return (
    <div>
      <p className="mb-3 text-xs text-ink-faint">
        Density curves for each position — steeper, narrower peaks mean the position is more scarce. Wider, flatter
        curves mean scoring is evenly distributed. Sorted by median (lowest at top).{" "}
        <span className="text-ink-dim">Click a curve to place a threshold slider.</span>
      </p>
      <div className="relative overflow-hidden rounded-xl border border-border bg-surface shadow-sm p-4">
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="w-full select-none"
          onMouseDown={handleSvgMouseDown}
          onMouseMove={handleSvgMouseMove}
          onMouseLeave={() => { setHovered(null); if (dragging.current) dragging.current = false; }}>
          {xTicks.map(tick => (
            <g key={tick}>
              <line
                x1={xScale(tick)} y1={MARGIN.top} x2={xScale(tick)} y2={CHART_H - MARGIN.bottom}
                stroke="var(--color-border)" strokeDasharray="3 3" />
              <text
                x={xScale(tick)} y={CHART_H - MARGIN.bottom + 16}
                textAnchor="middle" fill="var(--color-ink-faint)" fontSize={10}
                fontFamily="var(--font-mono)">
                {Math.round(tick)}
              </text>
            </g>
          ))}
          <text
            x={MARGIN.left + PLOT_W / 2} y={CHART_H - 6}
            textAnchor="middle" fill="var(--color-ink-faint)" fontSize={10}>
            Points
          </text>

          {curves.map((curve, i) => {
            const baseline = MARGIN.top + rowH * i + rowH;
            const isHovered = hovered === curve.groupKey;
            const isActive = slider?.groupKey === curve.groupKey;
            return (
              <g
                key={curve.groupKey}
                onMouseEnter={() => setHovered(curve.groupKey)}
                style={{ cursor: "crosshair" }}>
                <path
                  d={buildAreaPath(curve, xScale, bandH, baseline)}
                  fill={curve.color}
                  fillOpacity={isHovered || isActive ? 0.85 : 0.6}
                  stroke={curve.color}
                  strokeWidth={isHovered || isActive ? 2 : 1}
                  strokeOpacity={isHovered || isActive ? 1 : 0.8}
                />
                <text
                  x={MARGIN.left - 8} y={baseline - bandH * 0.3}
                  textAnchor="end" dominantBaseline="middle"
                  fill={isHovered || isActive ? curve.color : "var(--color-ink)"}
                  fontSize={11} fontWeight={isHovered || isActive ? 700 : 600}>
                  {curve.label}
                </text>
                <line
                  x1={xScale(curve.median)} y1={baseline}
                  x2={xScale(curve.median)} y2={baseline - bandH * 0.5}
                  stroke={curve.color} strokeWidth={1.5} strokeDasharray="3 2" opacity={0.7} />
              </g>
            );
          })}

          {slider && activeCurve && (() => {
            const sx = xScale(slider.value);
            return (
              <g style={{ pointerEvents: "none" }}>
                <line
                  x1={sx} y1={MARGIN.top} x2={sx} y2={CHART_H - MARGIN.bottom}
                  stroke={activeCurve.color} strokeWidth={1.5} strokeDasharray="4 3" opacity={0.8} />
                <circle
                  cx={sx} cy={CHART_H - MARGIN.bottom}
                  r={HANDLE_R}
                  fill={activeCurve.color}
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                  style={{ pointerEvents: "all", cursor: "ew-resize" }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    dragging.current = true;
                  }}
                />
                <rect
                  x={sx - 28} y={CHART_H - MARGIN.bottom - 22}
                  width={56} height={16} rx={4}
                  fill={activeCurve.color} fillOpacity={0.9} />
                <text
                  x={sx} y={CHART_H - MARGIN.bottom - 11}
                  textAnchor="middle" dominantBaseline="middle"
                  fill="#fff" fontSize={9} fontWeight={700} fontFamily="var(--font-mono)">
                  {activeAbove.length} left
                </text>
              </g>
            );
          })()}
        </svg>

        {hovered && !slider && (
          <div
            className="pointer-events-none absolute z-40 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: tooltipPos.x + 12, top: tooltipPos.y - 8 }}>
            <div className="font-bold" style={{ color: curves.find(c => c.groupKey === hovered)?.color }}>
              {curves.find(c => c.groupKey === hovered)?.label}
            </div>
            <div className="text-ink-dim">{curves.find(c => c.groupKey === hovered)?.count} players</div>
            <div className="mt-0.5">
              Median: <span className="tabular-nums font-semibold">{formatPoints(curves.find(c => c.groupKey === hovered)?.median ?? 0)}</span>
            </div>
          </div>
        )}

        {slider && activeCurve && !dragging.current && (
          <div
            className="absolute z-40 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: Math.min(tooltipPos.x + 12, 260), top: tooltipPos.y - 8 }}>
            <div className="font-bold" style={{ color: activeCurve.color }}>
              {activeCurve.label} ≥ {formatPoints(slider.value)}
            </div>
            <div className="text-ink-dim">
              {activeAbove.length} of {activeCurve.count} players
            </div>
            <button
              type="button"
              className="mt-1 text-accent hover:underline"
              onClick={(e) => { e.stopPropagation(); setExpanded(x => !x); }}>
              {expanded ? "Collapse" : "Show players"}
            </button>
          </div>
        )}

        {slider && activeCurve && expanded && (
          <div
            className="absolute z-50 max-h-64 overflow-y-auto scrollbar-accent rounded-lg border border-border bg-surface shadow-lg"
            style={{ left: Math.min(tooltipPos.x + 12, 220), top: tooltipPos.y + 32, width: 200 }}>
            <div className="px-2.5 py-1.5 text-[0.64rem] font-semibold text-ink-faint border-b border-border">
              ≥ {formatPoints(slider.value)} ({activeAbove.length})
            </div>
            <ul className="py-0.5">
              {activeAboveMax10.map(p => (
                <li key={p.playerId}>
                  <Link
                    to={`/player/${p.playerId}`}
                    className="flex items-baseline justify-between gap-2 px-2.5 py-1 text-xs hover:bg-surface-2">
                    <span className="truncate">{p.playerName}</span>
                    <span className="tabular-nums text-ink-faint">{formatPoints(p.points)}</span>
                  </Link>
                </li>
              ))}
              {activeAbove.length > 10 && (
                <li className="px-2.5 py-1 text-[0.64rem] text-ink-faint">+{activeAbove.length - 10} more</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
