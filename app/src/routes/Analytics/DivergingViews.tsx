import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Board } from "../../components/Board";
import { CoverageBadge } from "../../components/CoverageBadge";
import { FilterSelect } from "../../components/FilterSelect";
import { OwnerScopeToggle, type OwnerScope } from "../../components/OwnerScopeToggle";
import { PartialCoverageNote } from "../../components/PartialCoverageNote";
import { SectionHeading } from "../../components/SectionHeading";
import { SegmentedToggle } from "../../components/SegmentedToggle";
import { useAsync, type AsyncState } from "../../hooks/useAsync";
import { loadBoxScoresPartial } from "../../lib/data";
import { divergingBackground, linearStrength } from "../../lib/diverging";
import {
  getBenchPointsLeftBehind,
  getHotColdFormStrips,
  getIdentityVsWinPct,
  getPitchingBattingIdentity,
  getPlayoffRiserChoker,
  getScoringRulesDrift,
  type BenchWeekYear,
  type FormStripYear,
  type IdentityWinRow,
} from "../../lib/divergingViews";
import { finalYearTeams } from "../../lib/coverage";
import { formatPoints } from "../../lib/format";
import { getCurrentPrimaryOwnerIds, ownerRef } from "../../lib/stats";
import type { BoxScoreEntry, Matchup, Owner, Season, Team } from "../../types";

interface DivergingViewsProps {
  teams: Team[];
  owners: Owner[];
  matchups: Matchup[];
  seasons: Season[];
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

const stickyTh =
  "sticky top-0 left-0 z-30 border-r border-b border-border bg-surface px-3 py-2 text-left text-[0.66rem] font-semibold tracking-wide text-ink-faint uppercase";
const stickyColTh =
  "sticky top-0 z-20 border-r border-b border-border bg-surface px-1 py-2 text-center text-[0.62rem] font-semibold tracking-wide text-ink-faint uppercase whitespace-nowrap";
const stickyRowTh =
  "sticky left-0 z-10 truncate border-r border-b border-border bg-surface px-3 py-2 text-left text-xs font-semibold whitespace-nowrap";

// Wide enough for the longest owner name at this type size. Under `auto` layout
// these grids are wider than the viewport, so the leftover width all landed in
// the name column and squeezed the cells; `table-fixed` plus this colgroup
// spends it on the cells instead.
const NAME_COL_WIDTH = "8.5rem";
const NAME_COL_PX = 136;

function NameColGroup({ dataColumns }: { dataColumns: number }) {
  return (
    <colgroup>
      <col style={{ width: NAME_COL_WIDTH }} />
      {Array.from({ length: dataColumns }, (_, i) => (
        <col key={i} />
      ))}
    </colgroup>
  );
}

export function DivergingViews({ teams, owners, matchups, seasons }: DivergingViewsProps) {
  const daySlotYears = useMemo(() => seasons.filter(s => s.coverage.stat_lines === "full").map(s => s.year), [seasons]);
  const boxScoreState = useAsync(() => loadBoxScoresPartial(daySlotYears), [daySlotYears]);
  const failedYears = useMemo(
    () => (boxScoreState.status === "success" ? daySlotYears.filter(y => !boxScoreState.data.has(y)) : []),
    [daySlotYears, boxScoreState]
  );
  const [identityScope, setIdentityScope] = useState<OwnerScope>("current");
  // Primary owners only: this grid's rows are keyed on primary_owner_id, so a
  // latest-season co-owner without a team of their own has no row to fill.
  const currentOwnerIds = getCurrentPrimaryOwnerIds(teams);
  const finalYears = new Set(seasons.filter(s => s.status === "final").map(s => s.year));
  const [benchYear, setBenchYear] = useState<number | null>(null);
  const benchYears = boxScoreState.status === "success" ? getBenchPointsLeftBehind(boxScoreState.data, teams) : [];
  const selectedBenchYear = benchYear ?? benchYears[0]?.year ?? null;
  const benchYearData = benchYears.find(y => y.year === selectedBenchYear);

  return (
    <div className="space-y-10">
      <PartialCoverageNote failedYears={failedYears} />
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <SectionHeading>Pitching vs. Batting Identity</SectionHeading>
            <CoverageBadge seasons={seasons} domain="stat_lines" />
          </div>
          <OwnerScopeToggle value={identityScope} onChange={setIdentityScope} />
        </div>
        <p className="mb-3 text-xs text-ink-faint">
          Pitching/hitting share of each owner-season's counted regular-season points, diverging around that year's
          league average. A two-way player's days are split by the slot they started in.
        </p>
        {boxScoreState.status === "loading" && <p className="text-ink-dim">Loading box scores…</p>}
        {boxScoreState.status === "error" && (
          <p className="text-ink-dim">Couldn't load box scores. Try refreshing the page.</p>
        )}
        {boxScoreState.status === "success" && (
          <IdentityGrid
            boxScoresByYear={boxScoreState.data}
            teams={teams}
            owners={owners}
            matchups={matchups}
            scope={identityScope}
            currentOwnerIds={currentOwnerIds}
          />
        )}
      </div>

      <IdentityWinSection
        boxScoreState={boxScoreState}
        teams={teams}
        owners={owners}
        matchups={matchups}
        seasons={seasons}
      />

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <SectionHeading>Bench Points Left Behind</SectionHeading>
            <CoverageBadge seasons={seasons} domain="stat_lines" />
          </div>
          {benchYears.length > 0 && (
            <FilterSelect
              value={selectedBenchYear ?? ""}
              onChange={e => setBenchYear(Number(e.target.value))}
              aria-label="Select season">
              {benchYears.map(y => (
                <option key={y.year} value={y.year}>
                  {y.year}
                </option>
              ))}
            </FilterSelect>
          )}
        </div>
        <p className="mb-3 text-xs text-ink-faint">
          Points scored while on a bench or IL slot per week, diverging around that season's average. Playoff matchups
          can span multiple scoring periods and exaggerate totals.
        </p>
        {boxScoreState.status === "loading" && <p className="text-ink-dim">Loading box scores…</p>}
        {boxScoreState.status === "error" && (
          <p className="text-ink-dim">Couldn't load box scores. Try refreshing the page.</p>
        )}
        {boxScoreState.status === "success" &&
          (benchYears.length === 0 ? (
            <p className="text-sm text-ink-dim">No data available yet.</p>
          ) : benchYearData ? (
            <BenchPointsGrid yearData={benchYearData} owners={owners} />
          ) : (
            <p className="text-sm text-ink-dim">No data for this season.</p>
          ))}
      </div>

      <FormStripsSection matchups={matchups} teams={teams} owners={owners} seasons={seasons} />

      <div>
        <SectionHeading className="mb-3">Playoff Riser/Choker Index</SectionHeading>
        <p className="mb-3 text-xs text-ink-faint">
          Winners-bracket win% minus regular-season win%, per owner, all time.
        </p>
        <RiserChoker
          matchups={matchups.filter(m => finalYears.has(m.year))}
          teams={finalYearTeams(teams, seasons)}
          owners={owners}
        />
      </div>

      <DriftSection seasons={seasons} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Pitching vs. batting identity
// ---------------------------------------------------------------------------

function IdentityGrid({
  boxScoresByYear,
  teams,
  owners,
  matchups,
  scope,
  currentOwnerIds,
}: {
  boxScoresByYear: Map<number, BoxScoreEntry[]>;
  teams: Team[];
  owners: Owner[];
  matchups: Matchup[];
  scope: OwnerScope;
  currentOwnerIds: Set<string>;
}) {
  const years = getPitchingBattingIdentity(boxScoresByYear, teams, matchups).sort((a, b) => a.year - b.year);
  if (years.length === 0) {
    return <p className="text-sm text-ink-dim">No data available yet.</p>;
  }

  const ownerIds = Array.from(new Set(years.flatMap(y => y.rows.map(r => r.ownerId))))
    .filter(id => scope === "all" || currentOwnerIds.has(id))
    .map(id => ownerRef(owners, id))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (ownerIds.length === 0) {
    return <p className="text-sm text-ink-dim">No data for this scope.</p>;
  }

  return (
    <Board maxHeight="32rem">
      <table
        className="w-full table-fixed border-collapse text-sm"
        style={{ minWidth: `${NAME_COL_PX + 72 * years.length}px` }}>
        <NameColGroup dataColumns={years.length} />
        <thead>
          <tr>
            <th scope="col" className={stickyTh}>
              Owner
            </th>
            {years.map(y => (
              <th key={y.year} scope="col" className={stickyColTh}>
                {y.year}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ownerIds.map(owner => (
            <tr key={owner.ownerId}>
              <th scope="row" className={stickyRowTh} title={owner.name}>
                {owner.name}
              </th>
              {years.map(y => {
                const row = y.rows.find(r => r.ownerId === owner.ownerId);
                return (
                  <td key={y.year} className="border-r border-b border-border p-0 text-center">
                    {row ? (
                      <div
                        className="flex h-8 items-center justify-center text-[0.68rem] font-semibold tabular-nums"
                        style={divergingBackground(linearStrength(row.share, y.mean, 0.15))}
                        title={`${owner.name} ${y.year}: ${formatPct(row.share)} pitching share (league avg ${formatPct(y.mean)})`}>
                        {formatPct(row.share)}
                      </div>
                    ) : (
                      <div className="h-8 bg-surface-2" />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Board>
  );
}

// ---------------------------------------------------------------------------
// 1b. Pitching/batting identity vs. team success
// ---------------------------------------------------------------------------

type ScatterRow = IdentityWinRow & { ownerName: string };

type SeasonSelection = number | "all";

type IdentityWinMetric = "winPct" | "points";

const IDENTITY_WIN_METRIC_OPTIONS: { key: IdentityWinMetric; label: string }[] = [
  { key: "winPct", label: "Win %" },
  { key: "points", label: "Points" },
];

const DOT_MIN_RADIUS = 4;
const DOT_MAX_RADIUS = 11;
const SIZE_LEGEND_ANCHORS = [0.85, 1, 1.15];

/** Points index -> radius on a sqrt scale, so dot *area* rather than radius
 * reads as magnitude. Domain is the visible rows, so a single season spreads
 * across the same band the whole archive does. */
function dotRadiusScale(rows: ScatterRow[]): (pointsIndex: number) => number {
  const indexes = rows.map(r => r.pointsIndex);
  const lo = Math.sqrt(Math.max(Math.min(...indexes), 0));
  const hi = Math.sqrt(Math.max(...indexes, 0));
  if (hi - lo < 1e-9) return () => (DOT_MIN_RADIUS + DOT_MAX_RADIUS) / 2;
  return pointsIndex => {
    const t = (Math.sqrt(Math.max(pointsIndex, 0)) - lo) / (hi - lo);
    const r = DOT_MIN_RADIUS + t * (DOT_MAX_RADIUS - DOT_MIN_RADIUS);
    return Math.min(DOT_MAX_RADIUS, Math.max(DOT_MIN_RADIUS, r));
  };
}

/** A diverging scale needs a neutral *gray* midpoint. divergingBackground mixes
 * toward the surface instead, which is right for grid cells (their borders still
 * bound them) but renders a dot at the league average invisible -- so the dots
 * mix toward this visible neutral rather than toward the surface. */
const NEUTRAL_DOT_FILL = "color-mix(in oklab, var(--color-ink-faint) 22%, var(--color-surface))";

function dotFill(share: number, meanShare: number): string {
  const strength = Math.max(-55, Math.min(55, Math.round(linearStrength(share, meanShare, 0.15))));
  if (strength === 0) return NEUTRAL_DOT_FILL;
  const pole = strength > 0 ? "var(--color-diverge-pos)" : "var(--color-diverge-neg)";
  return `color-mix(in oklab, ${pole} ${Math.abs(strength)}%, ${NEUTRAL_DOT_FILL})`;
}

function rowKey(row: ScatterRow): string {
  return `${row.year}:${row.espnTeamId}`;
}

/** SVG has no z-index -- what paints last sits on top. Plain dots first, then
 * crowns (a big neighbouring dot would otherwise bury a champion's hit
 * target), then whatever the cursor is on. */
function paintRank(row: ScatterRow, hoveredKey: string | null): number {
  if (hoveredKey !== null && rowKey(row) === hoveredKey) return 2;
  return row.isChampion ? 1 : 0;
}

/** Champion seasons render as a crown glyph; everyone else a dot tinted by the diverging scale. */
function IdentityWinDot(meanShare: number, radiusFor: (pointsIndex: number) => number, onHover: (key: string) => void) {
  return function Dot(props: { cx?: number; cy?: number; payload?: ScatterRow }) {
    const { cx, cy, payload } = props;
    if (cx === undefined || cy === undefined || !payload) return <g />;
    // Raising the hovered point re-sorts the data, which re-fires enter on the
    // moved node -- setting the same key is a no-op, so it settles. Clearing is
    // left to the chart's own onMouseLeave to avoid an enter/leave loop.
    const raise = () => onHover(rowKey(payload));
    if (payload.isChampion) {
      return (
        <g onMouseEnter={raise}>
          {/* Larger invisible hit target -- the emoji glyph alone is too thin to hover reliably. */}
          <circle cx={cx} cy={cy} r={9} fill="transparent" pointerEvents="all" />
          <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={15} pointerEvents="none">
            👑
          </text>
        </g>
      );
    }
    return (
      <circle
        cx={cx}
        cy={cy}
        r={radiusFor(payload.pointsIndex)}
        style={{ fill: dotFill(payload.share, meanShare) }}
        stroke="var(--color-surface)"
        strokeWidth={2}
        onMouseEnter={raise}
      />
    );
  };
}

function IdentityWinTooltip({ active, payload }: { active?: boolean; payload?: { payload: ScatterRow }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  // Batting is the residual of the official points_for so the two rows always
  // sum to the total in the headline.
  const battingPoints = row.points - row.pitchingPoints;
  return (
    <div className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-md">
      <div className="font-bold">
        {row.ownerName} · {row.year}
        {row.isChampion && " 👑"}
      </div>
      <div className="font-bold">
        <span className="tabular-nums">{formatPoints(row.points)}</span> pts ·{" "}
        <span className="tabular-nums">{formatPct(row.winPct)}</span> win
      </div>
      {/* justify-start stops the auto tracks absorbing the width the longer
          headline sets -- without it the columns spread to fill it. */}
      <div className="mt-1 grid grid-cols-[auto_auto_auto] justify-start gap-x-3 text-ink-dim">
        <span>Pitching</span>
        <span className="text-right tabular-nums">{formatPoints(row.pitchingPoints)} pts</span>
        <span className="text-right tabular-nums">{formatPct(row.share)}</span>
        <span>Batting</span>
        <span className="text-right tabular-nums">{formatPoints(battingPoints)} pts</span>
        <span className="text-right tabular-nums">{formatPct(1 - row.share)}</span>
      </div>
    </div>
  );
}

/** Anchor circles for the size channel, labeled in whichever unit the current
 * selection makes readable -- plain points for one season, multiples of the
 * league average when seasons of different lengths share the chart. */
function DotSizeLegend({
  radiusFor,
  season,
  meanPoints,
}: {
  radiusFor: (pointsIndex: number) => number;
  season: SeasonSelection;
  meanPoints: number;
}) {
  return (
    <div className="flex items-center justify-end gap-3 border-t border-border px-3 py-2 text-[0.66rem] text-ink-faint">
      {SIZE_LEGEND_ANCHORS.map(anchor => (
        <span key={anchor} className="flex items-center gap-1.5">
          <svg width={2 * DOT_MAX_RADIUS} height={2 * DOT_MAX_RADIUS} aria-hidden="true">
            <circle
              cx={DOT_MAX_RADIUS}
              cy={DOT_MAX_RADIUS}
              r={radiusFor(anchor)}
              fill={NEUTRAL_DOT_FILL}
              stroke="var(--color-surface)"
              strokeWidth={2}
            />
          </svg>
          <span className="tabular-nums">
            {season === "all"
              ? `${anchor.toFixed(2).replace(/0$/, "")}×`
              : (Math.round((anchor * meanPoints) / 50) * 50).toLocaleString()}
          </span>
        </span>
      ))}
      <span>{season === "all" ? "league-average points" : "pts"}</span>
    </div>
  );
}

function IdentityWinSection({
  boxScoreState,
  teams,
  owners,
  matchups,
  seasons,
}: {
  boxScoreState: AsyncState<Map<number, BoxScoreEntry[]>>;
  teams: Team[];
  owners: Owner[];
  matchups: Matchup[];
  seasons: Season[];
}) {
  const [season, setSeason] = useState<SeasonSelection>("all");
  const [metric, setMetric] = useState<IdentityWinMetric>("winPct");
  // Memoized so changing the season only re-filters -- the aggregation walks
  // every loaded box-score entry and doesn't depend on the selection.
  const allRows: ScatterRow[] = useMemo(
    () =>
      boxScoreState.status === "success"
        ? getIdentityVsWinPct(boxScoreState.data, teams, matchups).map(r => ({
            ...r,
            ownerName: ownerRef(owners, r.ownerId).name,
          }))
        : [],
    [boxScoreState, teams, matchups, owners]
  );
  const years = Array.from(new Set(allRows.map(r => r.year))).sort((a, b) => b - a);
  const rows = season === "all" ? allRows : allRows.filter(r => r.year === season);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SectionHeading>Identity vs. Team Success</SectionHeading>
          <CoverageBadge seasons={seasons} domain="stat_lines" />
        </div>
        {years.length > 0 && (
          <div className="flex items-center gap-2">
            <SegmentedToggle
              ariaLabel="Y-axis metric"
              size="sm"
              value={metric}
              onChange={setMetric}
              options={IDENTITY_WIN_METRIC_OPTIONS}
            />
            <FilterSelect
              value={season}
              onChange={e => setSeason(e.target.value === "all" ? "all" : Number(e.target.value))}
              aria-label="Select season">
              <option value="all">All-Time</option>
              {years.map(y => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </FilterSelect>
          </div>
        )}
      </div>
      <p className="mb-3 text-xs text-ink-faint">
        One dot = One season. Pitching share of that team&apos;s regular-season points (X) against that season&apos;s{" "}
        {metric === "winPct" ? "win% (Y)" : "points (Y)"}, sized by total points scored
        {season === "all" ? " relative to that season's average." : "."}
        {season === "all" && metric === "points" && (
          <>
            {" "}
            Point totals aren&apos;t comparable across all seasons. Scoring rules and schedule lengths change year to
            year, so cross-season position is approximate.
          </>
        )}{" "}
        Championship seasons are marked 👑 at a fixed size.
      </p>
      {boxScoreState.status === "loading" && <p className="text-ink-dim">Loading box scores…</p>}
      {boxScoreState.status === "error" && (
        <p className="text-ink-dim">Couldn't load box scores. Try refreshing the page.</p>
      )}
      {boxScoreState.status === "success" &&
        (rows.length === 0 ? (
          <p className="text-sm text-ink-dim">No data available yet.</p>
        ) : (
          <IdentityWinScatter rows={rows} season={season} metric={metric} />
        ))}
    </div>
  );
}

function IdentityWinScatter({
  rows,
  season,
  metric,
}: {
  rows: ScatterRow[];
  season: SeasonSelection;
  metric: IdentityWinMetric;
}) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  // Recomputed over the visible rows so a single season tints against its own
  // average rather than the all-time one.
  const meanShare = rows.reduce((sum, r) => sum + r.share, 0) / rows.length;
  const meanPoints = rows.reduce((sum, r) => sum + r.points, 0) / rows.length;
  const radiusFor = dotRadiusScale(rows);
  // Fixed at a clean 60% for even tick spacing; only expands past that if real data ever exceeds it.
  const maxShare = Math.max(0.6, Math.max(...rows.map(r => r.share)) * 1.05);
  // Sort is stable, so equal-rank points keep their original order.
  const painted = [...rows].sort((a, b) => paintRank(a, hoveredKey) - paintRank(b, hoveredKey));

  return (
    <div>
      <div style={{ height: 400 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 16, right: 16, bottom: 28, left: 4 }} onMouseLeave={() => setHoveredKey(null)}>
            <CartesianGrid stroke="var(--color-border)" />
            <XAxis
              type="number"
              dataKey="share"
              domain={[0, maxShare]}
              tickFormatter={v => formatPct(v)}
              tick={{ fill: "var(--color-ink-faint)", fontSize: 11 }}
              axisLine={{ stroke: "var(--color-border)" }}
              tickLine={{ stroke: "var(--color-border)" }}
              label={{
                value: "Pitching share of points",
                position: "insideBottom",
                offset: -14,
                fill: "var(--color-ink-faint)",
                fontSize: 11,
              }}
            />
            <YAxis
              type="number"
              dataKey={metric}
              domain={metric === "winPct" ? [0, 1] : ["auto", "auto"]}
              tickFormatter={v => (metric === "winPct" ? formatPct(v) : Math.round(v).toLocaleString())}
              tick={{ fill: "var(--color-ink-faint)", fontSize: 11 }}
              axisLine={{ stroke: "var(--color-border)" }}
              tickLine={{ stroke: "var(--color-border)" }}
              label={{
                value: metric === "winPct" ? "Win %" : "Points",
                angle: -90,
                position: "insideLeft",
                fill: "var(--color-ink-faint)",
                fontSize: 11,
              }}
            />
            <ReferenceLine y={metric === "winPct" ? 0.5 : meanPoints} stroke="var(--color-border)" />
            <Tooltip content={<IdentityWinTooltip />} cursor={{ stroke: "var(--color-border)" }} />
            <Scatter
              data={painted}
              shape={IdentityWinDot(meanShare, radiusFor, setHoveredKey)}
              isAnimationActive={false}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <DotSizeLegend radiusFor={radiusFor} season={season} meanPoints={meanPoints} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Hot/cold form strips
// ---------------------------------------------------------------------------

function FormStripsSection({
  matchups,
  teams,
  owners,
  seasons,
}: {
  matchups: Matchup[];
  teams: Team[];
  owners: Owner[];
  seasons: Season[];
}) {
  const allYears = getHotColdFormStrips(matchups, teams, seasons);
  const [year, setYear] = useState<number | null>(allYears[0]?.year ?? null);
  const yearData = allYears.find(y => y.year === year);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionHeading>Hot & Cold Streaks</SectionHeading>
        {allYears.length > 0 && (
          <FilterSelect value={year ?? ""} onChange={e => setYear(Number(e.target.value))} aria-label="Select season">
            {allYears.map(y => (
              <option key={y.year} value={y.year}>
                {y.year}
              </option>
            ))}
          </FilterSelect>
        )}
      </div>
      <p className="mb-3 text-xs text-ink-faint">
        Each regular-season weekly score standardized against that owner's own season mean and stdev. (z-score; color
        saturates at |z| ≥ 2.5).
      </p>
      {yearData ? (
        <FormStripsGrid yearData={yearData} owners={owners} />
      ) : (
        <p className="text-sm text-ink-dim">No data for this season.</p>
      )}
    </div>
  );
}

function FormStripsGrid({ yearData, owners }: { yearData: FormStripYear; owners: Owner[] }) {
  const rows = [...yearData.rows].sort((a, b) =>
    ownerRef(owners, a.ownerId).name.localeCompare(ownerRef(owners, b.ownerId).name)
  );
  const allWeeks = Array.from(new Set(rows.flatMap(r => r.weeks.map(w => w.week)))).sort((a, b) => a - b);

  return (
    <Board maxHeight="32rem">
      <table
        className="w-full table-fixed border-collapse text-sm"
        style={{ minWidth: `${NAME_COL_PX + 40 * allWeeks.length}px` }}>
        <NameColGroup dataColumns={allWeeks.length} />
        <thead>
          <tr>
            <th scope="col" className={stickyTh}>
              Owner
            </th>
            {allWeeks.map(w => (
              <th key={w} scope="col" className={stickyColTh}>
                Wk {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const owner = ownerRef(owners, row.ownerId);
            return (
              <tr key={row.espnTeamId}>
                <th scope="row" className={stickyRowTh} title={owner.name}>
                  {owner.name}
                </th>
                {allWeeks.map(w => {
                  const entry = row.weeks.find(x => x.week === w);
                  return (
                    <td key={w} className="border-r border-b border-border p-0 text-center">
                      {entry ? (
                        <div
                          className="flex h-8 items-center justify-center text-[0.62rem] font-semibold tabular-nums"
                          style={divergingBackground(linearStrength(entry.z, 0, 2.5))}
                          title={`${owner.name} Wk ${w}: ${formatPoints(entry.score)} pts (season avg ${formatPoints(row.mean)})`}>
                          {entry.z >= 0 ? "+" : ""}
                          {entry.z.toFixed(1)}
                        </div>
                      ) : (
                        <div className="h-8 bg-surface-2 whitespace-nowrap" />
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Board>
  );
}

// ---------------------------------------------------------------------------
// 3. Playoff riser/choker index
// ---------------------------------------------------------------------------

function RiserChoker({ matchups, teams, owners }: { matchups: Matchup[]; teams: Team[]; owners: Owner[] }) {
  const entries = getPlayoffRiserChoker(matchups, teams, owners);
  if (entries.length === 0) {
    return <p className="text-sm text-ink-dim">Not enough playoff data yet.</p>;
  }
  const maxAbsDiff = Math.max(...entries.map(e => Math.abs(e.diff)), 0.01);

  return (
    <Board>
      <div className="space-y-2 p-4">
        {entries.map(e => (
          <div
            key={e.owner.ownerId}
            className="grid grid-cols-[7rem_1fr_4.5rem] items-center gap-3 text-sm sm:grid-cols-[10rem_1fr_4.5rem]">
            <div className="truncate text-left font-semibold" title={e.owner.name}>
              {e.owner.name}
            </div>
            <div className="relative h-7 min-w-[8rem]">
              <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
              {e.diff >= 0 ? (
                <div
                  className="absolute top-1 h-5 rounded-r"
                  style={{
                    left: "50%",
                    width: `${(Math.abs(e.diff) / maxAbsDiff) * 50}%`,
                    backgroundColor: "var(--color-diverge-pos)",
                  }}
                />
              ) : (
                <div
                  className="absolute top-1 h-5 rounded-l"
                  style={{
                    right: "50%",
                    width: `${(Math.abs(e.diff) / maxAbsDiff) * 50}%`,
                    backgroundColor: "var(--color-diverge-neg)",
                  }}
                />
              )}
            </div>
            <div
              className={`text-right font-semibold tabular-nums ${e.diff >= 0 ? "text-diverge-pos" : "text-diverge-neg"}`}
              title={`${e.playoffGames} winners-bracket games`}>
              {e.diff >= 0 ? "+" : ""}
              {Math.round(e.diff * 100)}pp
            </div>
          </div>
        ))}
      </div>
    </Board>
  );
}

// ---------------------------------------------------------------------------
// 4. Bench points left behind
// ---------------------------------------------------------------------------

function BenchPointsGrid({ yearData, owners }: { yearData: BenchWeekYear; owners: Owner[] }) {
  const ownerIds = Array.from(new Set(yearData.rows.map(r => r.ownerId)))
    .map(id => ownerRef(owners, id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const allWeeks = Array.from(new Set(yearData.rows.map(r => r.week))).sort((a, b) => a - b);

  return (
    <Board maxHeight="32rem">
      <table
        className="w-full table-fixed border-collapse text-sm"
        style={{ minWidth: `${NAME_COL_PX + 40 * allWeeks.length}px` }}>
        <NameColGroup dataColumns={allWeeks.length} />
        <thead>
          <tr>
            <th scope="col" className={stickyTh}>
              Owner
            </th>
            {allWeeks.map(w => (
              <th key={w} scope="col" className={stickyColTh}>
                Wk {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ownerIds.map(owner => (
            <tr key={owner.ownerId}>
              <th scope="row" className={stickyRowTh} title={owner.name}>
                {owner.name}
              </th>
              {allWeeks.map(w => {
                const row = findBenchRow(yearData, owner.ownerId, w);
                return (
                  <td key={w} className="border-r border-b border-border p-0 text-center">
                    {row ? (
                      <div
                        className="flex h-8 items-center justify-center text-[0.62rem] font-semibold tabular-nums whitespace-nowrap"
                        style={divergingBackground(
                          linearStrength(row.benchPoints, yearData.mean, Math.max(yearData.mean, 1))
                        )}
                        title={`${owner.name} Wk ${w}: ${formatPoints(row.benchPoints)} bench pts (season avg ${formatPoints(yearData.mean)})`}>
                        {formatPoints(row.benchPoints)}
                      </div>
                    ) : (
                      <div className="h-8 bg-surface-2" />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Board>
  );
}

function findBenchRow(yearData: BenchWeekYear, ownerId: string, week: number) {
  return yearData.rows.find(r => r.ownerId === ownerId && r.week === week);
}

// ---------------------------------------------------------------------------
// 5. Scoring-rules drift
// ---------------------------------------------------------------------------

type DriftCategory = "batting" | "pitching";

const DRIFT_CATEGORY_OPTIONS: { key: DriftCategory; label: string }[] = [
  { key: "batting", label: "Batting" },
  { key: "pitching", label: "Pitching" },
];

function DriftSection({ seasons }: { seasons: Season[] }) {
  const rows = useMemo(() => getScoringRulesDrift(seasons), [seasons]);
  const [category, setCategory] = useState<DriftCategory>("batting");
  const years = useMemo(() => {
    const set = new Set<number>();
    for (const r of rows) for (const y of r.valuesByYear.keys()) set.add(y);
    return Array.from(set).sort((a, b) => a - b);
  }, [rows]);
  const visibleRows = useMemo(() => rows.filter(r => r.category === category), [rows, category]);

  if (years.length === 0) {
    return (
      <div>
        <SectionHeading className="mb-3">Scoring-Rules Drift</SectionHeading>
        <p className="text-sm text-ink-dim">No data available yet.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionHeading>Scoring-Rules Drift</SectionHeading>
        <SegmentedToggle
          ariaLabel="Stat category"
          size="sm"
          value={category}
          onChange={setCategory}
          options={DRIFT_CATEGORY_OPTIONS}
        />
      </div>
      <p className="mb-3 text-xs text-ink-faint">
        From each season&apos;s own scoring settings. Highlighted cells changed from previous season.
      </p>
      <Board maxHeight="32rem">
        <table
          className="w-full table-fixed border-collapse text-sm"
          style={{ minWidth: `${NAME_COL_PX + 56 * years.length}px` }}>
          <NameColGroup dataColumns={years.length} />
          <thead>
            <tr>
              <th scope="col" className={stickyTh}>
                Stat
              </th>
              {years.map(y => (
                <th key={y} scope="col" className={stickyColTh}>
                  {y}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(row => (
              <tr key={row.statId}>
                <th scope="row" className={stickyRowTh} title={row.label}>
                  {row.label}
                </th>
                {years.map(y => {
                  const value = row.valuesByYear.get(y) ?? null;
                  const changed = row.changedYears.has(y);
                  const prevYear = [...years].filter(yy => yy < y && (row.valuesByYear.get(yy) ?? null) !== null).pop();
                  const prev = prevYear === undefined ? null : (row.valuesByYear.get(prevYear) ?? null);
                  return (
                    <td key={y} className="border-r border-b border-border p-0 text-center">
                      <div
                        className={`flex h-8 items-center justify-center gap-1 text-[0.68rem] tabular-nums ${
                          value === null ? "text-ink-faint" : changed ? "font-bold text-ink" : "text-ink-dim"
                        }`}
                        title={
                          value === null
                            ? `${row.label} ${y}: not scored`
                            : changed && prev !== null
                              ? `${row.label} ${y}: ${formatPoints(value)} pts (was ${formatPoints(prev)} in ${prevYear})`
                              : `${row.label} ${y}: ${formatPoints(value)} pts`
                        }>
                        {value === null ? (
                          "—"
                        ) : (
                          <>
                            {formatPoints(value)}
                            {changed && (
                              <span aria-hidden="true" className="text-accent">
                                •
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Board>
    </div>
  );
}
