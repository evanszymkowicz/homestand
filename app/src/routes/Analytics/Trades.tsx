import { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Board, TEN_ROWS } from "../../components/Board";
import { FilterSelect } from "../../components/FilterSelect";
import { OwnerLink } from "../../components/OwnerLink";
import { SectionHeading } from "../../components/SectionHeading";
import { SortHeader } from "../../components/SortHeader";
import { summarizeCoverage } from "../../lib/coverage";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSortableRows } from "../../hooks/useSortableRows";
import { formatDifferential, formatPoints } from "../../lib/format";
import { GRADE_BG, GRADE_ORDER } from "../../lib/grades";
import { ownerRef } from "../../lib/stats";
import { pointsDeltaBackground } from "../../lib/diverging";
import {
  computeRestOfSeasonValueSeries,
  type SurplusHistogramBucket,
  type TradeEvaluationIndex,
  type TradeGrade,
  type TradeSymmetryStats,
} from "../../lib/tradeEvaluation";
import {
  groupTrades,
  orientRowToOwner,
  sumTradeDeltas,
  UNKNOWN_OWNER_ID,
  type TradeEntry,
  type TradeRow,
  type TradeSide,
} from "../../lib/trades";
import type { Owner, Season } from "../../types";

interface TradesProps {
  entries: TradeEntry[];
  owners: Owner[];
  seasons: Season[];
  grades: TradeGrade[];
  symmetry: TradeSymmetryStats;
  histogram: SurplusHistogramBucket[];
  index: TradeEvaluationIndex | null;
  fullCoverageYears: Set<number>;
  /** Owners who've left the league but whose last backfilled season still shows
   * them active; see data/manual/retired-owners.json. */
  retiredOwnerIds: string[];
}

type SortKey = "year" | "grade" | "sideA" | "sideB" | "points";

function sideOwnerName(owners: Owner[], side: TradeSide | undefined): string {
  if (!side) return "";
  return side.ownerId === UNKNOWN_OWNER_ID ? "not on file" : ownerRef(owners, side.ownerId).name;
}

function OwnerCell({ owners, side, kind }: { owners: Owner[]; side: TradeSide | undefined; kind: TradeRow["kind"] }) {
  // A trade ESPN pruned can leave its counterparty genuinely unnamed, which is
  // a different fact from a pick that simply moved one way.
  if (!side) return <span className="text-ink-faint">{kind === "unrecorded" ? "not on file" : "—"}</span>;
  if (side.ownerId === UNKNOWN_OWNER_ID) return <span className="text-ink-faint">not on file</span>;
  return <OwnerLink owners={owners} ownerId={side.ownerId} />;
}

/** What one side surrendered. Picks carry their round/pick number; an
 * unrecorded trade has nothing to name. */
function GaveUpCell({ side, kind }: { side: TradeSide | undefined; kind: TradeRow["kind"] }) {
  if (kind === "unrecorded") {
    return <span className="text-ink-faint">players not recorded by ESPN</span>;
  }
  if (!side || side.assets.length === 0) return <span className="text-ink-faint">—</span>;
  return (
    // No wrapping -- a long side widens the table and the Board scrolls it
    // sideways, so every trade stays exactly one row tall.
    <span className="flex items-baseline gap-x-1 whitespace-nowrap">
      {side.assets.map((asset, i) => (
        <span key={asset.key} className="flex items-baseline gap-x-1">
          {i > 0 && <span className="text-ink-faint">·</span>}
          <span className="whitespace-nowrap">
            {asset.roundId !== null ? (
              <span
                className="font-semibold"
                title={`Became: ${asset.playerName}${asset.points !== null ? ` (${formatPoints(asset.points)} pts)` : " (no data)"}`}>
                R{asset.roundId} #{asset.overallPickNumber}
              </span>
            ) : (
              <Link to={`/player/${asset.playerId}`} className="font-semibold hover:underline">
                {asset.playerName}
              </Link>
            )}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * One row per trade, picks and players together, newest first.
 *
 * The two halves sit side by side so what each team surrendered reads straight
 * across. A trade with more than two sides (none in the archive yet) stacks the
 * remaining sides in the second pair of columns rather than dropping them.
 */
export function Trades({
  entries,
  owners,
  seasons,
  grades,
  symmetry,
  histogram,
  index,
  fullCoverageYears,
  retiredOwnerIds,
}: TradesProps) {
  const rows = groupTrades(entries);

  const gradeByTradeKey = useMemo(() => {
    const map = new Map<string, TradeGrade>();
    for (const g of grades) map.set(g.tradeKey, g);
    return map;
  }, [grades]);

  const ownerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows) for (const side of row.sides) if (side.ownerId !== UNKNOWN_OWNER_ID) ids.add(side.ownerId);
    return Array.from(ids);
  }, [rows]);

  const [ownerFilter, setOwnerFilter] = useState("all");
  const [selectedGrade, setSelectedGrade] = useState<TradeGrade | null>(null);
  const closeGradeModal = useCallback(() => setSelectedGrade(null), []);
  const lastTriggerRef = useRef<HTMLElement | null>(null);
  const visibleRows =
    ownerFilter === "all"
      ? rows
      : rows
          .filter(r => r.sides.some(s => s.ownerId === ownerFilter) || r.participantOwnerIds.includes(ownerFilter))
          // Read every trade from the filtered owner's side, so the Points Δ column
          // adds up to their total instead of its mirror.
          .map(r => orientRowToOwner(r, ownerFilter));
  // The summed delta only means something once an owner is singled out.
  const summedDelta = ownerFilter === "all" ? null : sumTradeDeltas(visibleRows, ownerFilter);
  // The coverage badge that used to carry this was removed as misleading, but
  // the hole is real: `transactions.json` has nothing before 2019, so the table
  // below silently starts there. Years come from `seasons.json`, never hardcoded.
  const transactionGap = useMemo(() => {
    const { missingYears, coveredYears } = summarizeCoverage(seasons, "transactions");
    if (missingYears.length === 0 || coveredYears.length === 0) return null;
    const first = Math.min(...coveredYears);
    const last = Math.max(...missingYears);
    return first - 1 === last ? `Trades before ${first} are missing` : `Seasons ${first}–${last} are missing`;
  }, [seasons]);

  function getValue(row: TradeRow, key: SortKey): number | string {
    const grade = gradeByTradeKey.get(row.key);
    switch (key) {
      case "year":
        return row.year;
      case "grade":
        return grade ? GRADE_ORDER.indexOf(grade.letterGrade) : -Infinity;
      case "sideA":
        return sideOwnerName(owners, row.sides[0]);
      case "sideB":
        return sideOwnerName(owners, row.sides[1]);
      case "points":
        return row.points ?? -Infinity;
    }
  }

  const { sorted, sortKey, direction, toggleSort } = useSortableRows<TradeRow, SortKey>(
    visibleRows,
    getValue,
    "year",
    "desc"
  );

  const maxAbsDelta = Math.max(0, ...sorted.filter(r => r.points !== null).map(r => Math.abs(r.points ?? 0)));

  if (rows.length === 0) {
    return <p className="text-ink-dim">No trades on file.</p>;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SectionHeading>Trades</SectionHeading>
        <FilterSelect
          value={ownerFilter}
          onChange={e => setOwnerFilter(e.target.value)}
          aria-label="Filter trades by owner"
          className="ml-auto">
          <option value="all">All owners</option>
          {ownerIds.map(id => (
            <option key={id} value={id}>
              {ownerRef(owners, id).name}
            </option>
          ))}
        </FilterSelect>
        {summedDelta !== null && (
          <span className="text-xs text-ink-dim tabular-nums">
            {ownerRef(owners, ownerFilter).name}
            &rsquo;s total Δ:{" "}
            <span className="font-semibold" style={pointsDeltaBackground(summedDelta, maxAbsDelta)}>
              {formatDifferential(summedDelta)}
            </span>
          </span>
        )}
        {ownerFilter !== "all" && summedDelta === null && (
          <span className="text-xs text-ink-faint tabular-nums">
            {ownerRef(owners, ownerFilter).name}&rsquo;s total Δ: no data
          </span>
        )}
      </div>
      <p className="mb-4 max-w-3xl text-xs text-ink-faint">
        Points Δ is what the owner on the left received minus what they gave up in points scored that season. Positive
        favors the left owner (red) and negative the right (blue). Filtering to an owner turns each trade around so that
        owner reads first.
      </p>
      <p className="mb-4 max-w-3xl text-xs text-ink-faint">
        Draft picks (e.g., "R1 #3") are shown alongside players because the same deal moved both assets; pick trades
        reach back to 2009.
      </p>
      {transactionGap && (
        <p className="mb-4 max-w-3xl text-xs text-ink-faint">
          {transactionGap} — ESPN&apos;s transaction ledger has no records for those seasons, so they don&apos;t appear
          here.
        </p>
      )}
      <Board maxHeight={TEN_ROWS}>
        {/* max-content so a wide trade overflows into Board's overflow-x-auto
            rather than wrapping a cell onto a second line. */}
        <table className="w-full border-collapse text-sm" style={{ minWidth: "max-content" }}>
          <thead>
            <tr>
              <SortHeader
                label="Season"
                sortKey="year"
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
                align="left"
                stickyLeft
                className="border-r border-border"
              />
              <SortHeader
                label="Grade"
                sortKey="grade"
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
                align="center"
              />
              <SortHeader
                label="Points Δ"
                ariaLabel="First owner's points received minus points given up"
                sortKey="points"
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
                align="left"
              />
              <SortHeader
                label="Owner"
                ariaLabel="First side's owner"
                sortKey="sideA"
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
                align="left"
              />
              <th
                scope="col"
                className="text-eyebrow sticky top-0 z-10 bg-surface px-2 py-1.5 text-left font-semibold tracking-wide text-ink-faint uppercase">
                Gave Up
              </th>
              <SortHeader
                label="Owner"
                ariaLabel="Second side's owner"
                sortKey="sideB"
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
                align="left"
                className="border-l border-border"
              />
              <th
                scope="col"
                className="text-eyebrow sticky top-0 z-10 bg-surface px-2 py-1.5 text-left font-semibold tracking-wide text-ink-faint uppercase">
                Gave Up
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => {
              const grade = gradeByTradeKey.get(row.key);
              const gradeLabel = grade ? `Trade grade: ${grade.letterGrade}` : undefined;
              return (
                <tr
                  key={row.key}
                  className={`group border-t border-border hover:bg-surface-2 ${grade ? "cursor-pointer" : ""}`}
                  onClick={e => {
                    if (!grade) return;
                    if ((e.target as HTMLElement).closest("a, button")) return;
                    lastTriggerRef.current = (e.currentTarget as HTMLElement).querySelector("button");
                    setSelectedGrade(grade);
                  }}>
                  <td className="sticky left-0 z-10 border-r border-border bg-surface px-2 py-1 text-left text-xs whitespace-nowrap text-ink-faint tabular-nums group-hover:bg-surface-2">
                    {row.kind === "pick" ? (
                      <Link to={`/players/${row.year}`} className="hover:underline">
                        {row.year} <span className="text-[0.6rem]">offseason</span>
                      </Link>
                    ) : (
                      <span>
                        {row.year}
                        {row.week !== null && <span> · wk {row.week}</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-center whitespace-nowrap tabular-nums">
                    {grade ? (
                      <button
                        type="button"
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-extrabold ${
                          GRADE_BG[grade.letterGrade] ?? "bg-surface-2 text-ink-faint"
                        }`}
                        aria-label={gradeLabel}
                        title={gradeLabel}
                        onClick={e => {
                          e.stopPropagation();
                          lastTriggerRef.current = e.currentTarget;
                          setSelectedGrade(grade);
                        }}>
                        {grade.letterGrade}
                      </button>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap text-center tabular-nums">
                    {row.points === null ? (
                      <span className="text-ink-faint">no data</span>
                    ) : (
                      <span
                        className="inline-block min-w-[3.25rem] px-1.5 py-0.5 text-center font-semibold"
                        style={pointsDeltaBackground(row.points, maxAbsDelta)}
                        title={`Points Δ: ${formatDifferential(row.points)}`}>
                        {formatDifferential(row.points)}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap text-ink-dim">
                    <OwnerCell owners={owners} side={row.sides[0]} kind={row.kind} />
                  </td>
                  <td className="px-2 py-1">
                    <GaveUpCell side={row.sides[0]} kind={row.kind} />
                  </td>
                  <td className="border-l border-border px-2 py-1 whitespace-nowrap text-ink-dim">
                    {/* Every side past the first, so a three-way deal keeps them all. */}
                    {row.sides.length < 2 ? (
                      <OwnerCell owners={owners} side={undefined} kind={row.kind} />
                    ) : (
                      row.sides.slice(1).map((side, i) => (
                        <div key={`${side.ownerId}-${i}`}>
                          <OwnerCell owners={owners} side={side} kind={row.kind} />
                        </div>
                      ))
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {row.sides.length < 2 ? (
                      <span className="text-ink-faint">—</span>
                    ) : (
                      row.sides.slice(1).map((side, i) => (
                        <div key={`${side.ownerId}-${i}`}>
                          <GaveUpCell side={side} kind={row.kind} />
                        </div>
                      ))
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Board>

      {selectedGrade && (
        <TradeGradeModal
          grade={selectedGrade}
          index={index}
          owners={owners}
          fullCoverageYears={fullCoverageYears}
          triggerRef={lastTriggerRef}
          onClose={closeGradeModal}
        />
      )}

      <div className="mt-6 space-y-6">
        <TradeSymmetry symmetry={symmetry} histogram={histogram} owners={owners} retiredOwnerIds={retiredOwnerIds} />
      </div>
    </div>
  );
}

function buildCumulativeSeries(grade: TradeGrade, index: TradeEvaluationIndex, fullCoverageYears: Set<number>) {
  const sideAByYear = new Map<number, number>();
  const sideBByYear = new Map<number, number>();
  for (const player of grade.sideAPlayers) {
    for (const { year, points } of computeRestOfSeasonValueSeries(
      player.playerId,
      grade.year,
      grade.ownerA,
      index,
      fullCoverageYears
    )) {
      sideAByYear.set(year, (sideAByYear.get(year) ?? 0) + points);
    }
  }
  for (const player of grade.sideBPlayers) {
    for (const { year, points } of computeRestOfSeasonValueSeries(
      player.playerId,
      grade.year,
      grade.ownerB,
      index,
      fullCoverageYears
    )) {
      sideBByYear.set(year, (sideBByYear.get(year) ?? 0) + points);
    }
  }
  const years = Array.from(new Set([...sideAByYear.keys(), ...sideBByYear.keys()])).sort((a, b) => a - b);
  let cumA = 0;
  let cumB = 0;
  return years.map(year => {
    cumA += sideAByYear.get(year) ?? 0;
    cumB += sideBByYear.get(year) ?? 0;
    return { year, sideA: cumA, sideB: cumB };
  });
}

interface TradeGradeModalProps {
  grade: TradeGrade;
  index: TradeEvaluationIndex | null;
  owners: Owner[];
  fullCoverageYears: Set<number>;
  triggerRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

function TradeGradeModal({ grade, index, owners, fullCoverageYears, triggerRef, onClose }: TradeGradeModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(panelRef, true, onClose, closeButtonRef, triggerRef);

  const cumulative = useMemo(
    () => (index ? buildCumulativeSeries(grade, index, fullCoverageYears) : []),
    [grade, index, fullCoverageYears]
  );
  const hasKeeperChart = cumulative.length > 1;

  const aTotal = grade.sideATotalPoints;
  const bTotal = grade.sideBTotalPoints;

  return (
    <div
      /* Scrolls the dialog itself: the panel has no height bound, so on a phone
         the roster lists ran past the viewport with nothing to scroll them. */
      className="fixed inset-0 z-40 overflow-y-auto bg-ink/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="trade-grade-title">
      <div
        ref={panelRef}
        tabIndex={-1}
        className="mx-auto my-6 w-full max-w-4xl overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-border bg-surface-2 px-5 py-4">
          <div>
            <div className="text-eyebrow font-bold tracking-wide text-ink-faint uppercase">
              {grade.context === "offseason" ? "Offseason trade" : `Week ${grade.week ?? "—"} trade`} · {grade.year}
            </div>
            <h3 id="trade-grade-title" className="mt-1 text-lg font-semibold text-ink">
              {ownerRef(owners, grade.ownerA).name} vs {ownerRef(owners, grade.ownerB).name}
            </h3>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex h-10 w-10 items-center justify-center rounded-full text-base font-extrabold ${
                GRADE_BG[grade.letterGrade] ?? "bg-surface text-ink-faint"
              }`}>
              {grade.letterGrade}
            </span>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-2">
              Close
            </button>
          </div>
        </div>

        <div className="grid gap-5 p-5 md:grid-cols-2">
          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="text-eyebrow mb-2 font-bold tracking-wide text-ink-faint uppercase">
              {ownerRef(owners, grade.ownerA).name} received
            </div>
            <ul className="space-y-1 text-sm">
              {grade.sideAPlayers.map(p => (
                <li key={p.playerId} className="flex justify-between gap-2">
                  <Link to={`/player/${p.playerId}`} className="font-semibold hover:underline">
                    {p.playerName}
                  </Link>
                  <span className="tabular-nums text-ink-faint">
                    {p.pointsReceived !== null ? `${formatPoints(p.pointsReceived)} pts` : "no data"}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 border-t border-border pt-2 text-right text-sm font-bold tabular-nums text-ink">
              Total {formatPoints(aTotal)} pts
            </div>
          </div>

          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="text-eyebrow mb-2 font-bold tracking-wide text-ink-faint uppercase">
              {ownerRef(owners, grade.ownerB).name} received
            </div>
            <ul className="space-y-1 text-sm">
              {grade.sideBPlayers.map(p => (
                <li key={p.playerId} className="flex justify-between gap-2">
                  <Link to={`/player/${p.playerId}`} className="font-semibold hover:underline">
                    {p.playerName}
                  </Link>
                  <span className="tabular-nums text-ink-faint">
                    {p.pointsReceived !== null ? `${formatPoints(p.pointsReceived)} pts` : "no data"}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 border-t border-border pt-2 text-right text-sm font-bold tabular-nums text-ink">
              Total {formatPoints(bTotal)} pts
            </div>
          </div>
        </div>

        {hasKeeperChart && (
          <div className="border-t border-border px-5 pb-5">
            <div className="py-3 text-sm font-semibold text-ink">Cumulative value after the trade</div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cumulative} margin={{ top: 8, right: 16, bottom: 8, left: 4 }}>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                  <XAxis dataKey="year" tick={{ fontSize: 11, fill: "var(--color-ink-faint)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--color-ink-faint)" }} tickFormatter={v => formatPoints(v)} />
                  <Tooltip
                    contentStyle={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
                    itemStyle={{ color: "var(--color-ink)" }}
                    formatter={(value, name) => [`${formatPoints(Number(value))} pts`, `${name}`]}
                  />
                  <Legend verticalAlign="top" height={24} />
                  {/* Both series resolve to the same colour in light mode
                      (--color-accent and --color-diverge-neg are both
                      var(--hs-blue)), so the solid/dashed split and the two dot
                      shapes are what actually distinguish them (WCAG 1.4.1). */}
                  <Line
                    type="monotone"
                    dataKey="sideA"
                    name={ownerRef(owners, grade.ownerA).name}
                    stroke="var(--color-accent)"
                    strokeWidth={2}
                    strokeDasharray="none"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="sideB"
                    name={ownerRef(owners, grade.ownerB).name}
                    stroke="var(--color-diverge-neg)"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface TradeSymmetryProps {
  symmetry: TradeSymmetryStats;
  histogram: SurplusHistogramBucket[];
  owners: Owner[];
  retiredOwnerIds: string[];
}

function TradeSymmetry({ symmetry, histogram, owners, retiredOwnerIds }: TradeSymmetryProps) {
  const retired = useMemo(() => new Set(retiredOwnerIds), [retiredOwnerIds]);
  // Retired owners drop out of this breakdown but stay in the cards above --
  // leaving the league doesn't unmake the trades they made. Unlike the Players
  // route, this is unconditional: there's no scope toggle to reach their rows.
  const ownerRows = useMemo(
    () =>
      Object.entries(symmetry.byOwner)
        .filter(([ownerId]) => !retired.has(ownerId))
        .map(([ownerId, stats]) => ({ ownerId, stats }))
        .sort((a, b) => b.stats.totalTrades - a.stats.totalTrades),
    [symmetry.byOwner, retired]
  );

  return (
    <div className="space-y-4">
      <SectionHeading>Trade Symmetry</SectionHeading>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Graded trades" value={String(symmetry.totalTrades)} />
        <StatCard label="Fair trades" value={String(symmetry.fairTrades)} />
        <StatCard label="One-sided trades" value={String(symmetry.oneSidedTrades)} />
        <StatCard label="Fair trade %" value={`${symmetry.fairTradePercentage.toFixed(0)}%`} />
      </div>

      {/* Each board gets a full row: the 7-bucket histogram reads better with the
          width, and a 4-column table crowds against a half-width one. */}
      <div className="grid gap-4">
        <Board title="Per-owner symmetry">
          {symmetry.totalTrades === 0 ? (
            <p className="px-3.5 py-3 text-sm text-ink-dim">No graded trades yet.</p>
          ) : ownerRows.length === 0 ? (
            <p className="px-3.5 py-3 text-sm text-ink-dim">No current owners have graded trades.</p>
          ) : (
            /* `max-w-lg`: the board is full-width but these four columns hold
               short values, so an unconstrained table lets Owner absorb all the
               slack and strands the three numerics as separated islands. The cap
               keeps them adjacent and left-anchored; centering is the wrong fix
               here because numerics are centered, so a centered table would
               split the owner names from their own figures. */
            <table className="w-full max-w-lg border-collapse text-sm">
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="text-eyebrow bg-surface px-3 py-2 text-left font-semibold tracking-wide text-ink-faint uppercase">
                    Owner
                  </th>
                  <th
                    scope="col"
                    className="text-eyebrow bg-surface px-3 py-2 text-center font-semibold tracking-wide text-ink-faint uppercase">
                    Trades
                  </th>
                  <th
                    scope="col"
                    className="text-eyebrow bg-surface px-3 py-2 text-center font-semibold tracking-wide text-ink-faint uppercase">
                    Fair %
                  </th>
                  <th
                    scope="col"
                    className="text-eyebrow bg-surface px-3 py-2 text-center font-semibold tracking-wide text-ink-faint uppercase">
                    Avg Δ
                  </th>
                </tr>
              </thead>
              <tbody>
                {ownerRows.map(({ ownerId, stats }) => (
                  <tr key={ownerId} className="border-t border-border">
                    <td className="px-3 py-2 text-ink">
                      <OwnerLink owners={owners} ownerId={ownerId} />
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums text-ink">{stats.totalTrades}</td>
                    <td className="px-3 py-2 text-center tabular-nums text-ink">
                      {stats.fairTradePercentage.toFixed(0)}%
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums text-ink">
                      {formatDifferential(stats.averageSurplus)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Board>

        <Board title="Surplus distribution">
          {histogram.length === 0 ? (
            <p className="px-3.5 py-3 text-sm text-ink-dim">No graded trades to chart.</p>
          ) : (
            <SurplusHistogram buckets={histogram} />
          )}
        </Board>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 text-center shadow-sm">
      <div className="text-eyebrow font-bold tracking-wide text-ink-faint uppercase">{label}</div>
      <div className="mt-1 text-2xl font-extrabold tabular-nums text-ink">{value}</div>
    </div>
  );
}

function SurplusHistogram({ buckets }: { buckets: SurplusHistogramBucket[] }) {
  const max = Math.max(1, ...buckets.map(b => b.count));
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  // Bar length and accent color carry the magnitude visually, which a
  // screen-reader or colorblind reader gets nothing from. The whole chart
  // collapses to one labelled summary and the marks are hidden from AT, so
  // nothing is announced twice.
  const summary = buckets.map(b => `${b.label}: ${b.count}`).join("; ");

  return (
    <div className="p-3">
      <p className="mb-2 px-1 text-xs text-ink-faint">
        {total} graded {total === 1 ? "trade" : "trades"} across {buckets.length} surplus{" "}
        {buckets.length === 1 ? "band" : "bands"}.
      </p>
      <div role="img" aria-label={`Surplus distribution. ${summary}`} className="space-y-1">
        <div aria-hidden="true">
          {buckets.map(b => (
            <div key={b.label} className="flex items-center gap-3 text-xs">
              <div className="w-28 flex-none truncate text-right text-ink-faint" title={b.label}>
                {b.label}
              </div>
              <div className="flex-1 rounded bg-surface-2">
                <div className="h-4 rounded bg-accent" style={{ width: `${(b.count / max) * 100}%` }} />
              </div>
              <div className="w-6 text-right tabular-nums text-ink">{b.count}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
