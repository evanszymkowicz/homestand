import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Board } from "../../components/Board";
import { CoverageBadge } from "../../components/CoverageBadge";
import { FilterSelect } from "../../components/FilterSelect";
import { SectionHeading } from "../../components/SectionHeading";
import { SegmentedToggle } from "../../components/SegmentedToggle";
import type { SeasonPlayerLine } from "../../lib/boxScore";
import { percentileBarBackground } from "../../lib/diverging";
import { formatInnings, formatOrdinal, formatPoints } from "../../lib/format";
import { getStatPercentileSeries, type PlayerCardSeasonEntry } from "../../lib/playerHistory";
import type { SeasonPositions } from "../../lib/playerPositions";
import { splitLinePoints, type ScoringByYear } from "../../lib/pointsSplit";
import {
  matchesPositionScope,
  OF_POSITION_ID,
  orderEligiblePositionIdsForPicker,
  positionLabel,
} from "../../lib/positions";
import { getSeasonPointsPercentileForPosition } from "../../lib/stats";
import type { PlayerSeasonPoints, Season } from "../../types";

type Side = "batting" | "pitching";
type Scope = "position" | "league";

interface StatMetric {
  key: string;
  label: string;
  read: (line: SeasonPlayerLine) => number | null;
  format: (value: number) => string;
  higherIsBetter?: boolean;
}

const BATTING_METRICS: StatMetric[] = [
  { key: "ab", label: "AB", read: l => l.batting?.ab ?? null, format: String },
  { key: "r", label: "R", read: l => l.batting?.r ?? null, format: String },
  { key: "hr", label: "HR", read: l => l.batting?.hr ?? null, format: String },
  { key: "rbi", label: "RBI", read: l => l.batting?.rbi ?? null, format: String },
  { key: "sb", label: "SB", read: l => l.batting?.sb ?? null, format: String },
];

const PITCHING_METRICS: StatMetric[] = [
  { key: "ip", label: "IP", read: l => l.pitching?.outs ?? null, format: formatInnings },
  { key: "w", label: "W", read: l => l.pitching?.wins ?? null, format: String },
  { key: "sv", label: "SV", read: l => l.pitching?.sv ?? null, format: String },
  { key: "k", label: "K", read: l => l.pitching?.k ?? null, format: String },
  { key: "er", label: "ER", read: l => l.pitching?.er ?? null, format: String, higherIsBetter: false },
];

const POINTS_KEY = "points";

// positions.ts's id space: 1 = SP, 11 = RP. A starting pitcher's value doesn't
// scale with how many starts they got in a given year the way a position
// player's does with games played -- an ace who missed half a season to injury
// and made 12 starts is still worth ranking on those starts' points, not hidden
// for falling under the same ≥10-games bar that keeps a defensive cameo out of
// a fielding position. So SP is exempted from qualifiedPositionsByYear below:
// every season with an SP points/stat line ranks, regardless of start count.
const SP_POSITION_ID = 1;
const RP_POSITION_ID = 11;

const SIDE_OPTIONS: { key: Side; label: string }[] = [
  { key: "batting", label: "Batting" },
  { key: "pitching", label: "Pitching" },
];

const SCOPE_OPTIONS: { key: Scope; label: string }[] = [
  { key: "position", label: "Position" },
  { key: "league", label: "League" },
];

/** When a pitcher is eligible at both SP and RP, default the position picker
 * to whichever role accounts for the majority of their career appearances.
 * For position players, prefer the player's own default_position_id when it's
 * among the eligible options. Falls back to the first available option. */
function defaultPositionId(
  positionOptions: number[],
  seasonPositions: SeasonPositions[],
  playerDefaultPositionId: number | undefined
): number | undefined {
  if (positionOptions.length === 0) return undefined;
  const eligibleSp = positionOptions.includes(SP_POSITION_ID);
  const eligibleRp = positionOptions.includes(RP_POSITION_ID);
  if (eligibleSp && eligibleRp) {
    let spGames = 0;
    let rpGames = 0;
    for (const sp of seasonPositions) {
      for (const a of sp.allAppearances) {
        if (a.positionId === SP_POSITION_ID) spGames += a.games;
        if (a.positionId === RP_POSITION_ID) rpGames += a.games;
      }
    }
    return rpGames > spGames ? RP_POSITION_ID : SP_POSITION_ID;
  }
  if (playerDefaultPositionId !== undefined && positionOptions.includes(playerDefaultPositionId)) {
    return playerDefaultPositionId;
  }
  return positionOptions[0];
}

interface PercentileBySeasonProps {
  /** This player's whole-archive point totals on the CARD basis, each season's
   * percentile ranked against every other player in the league that year -- the
   * Points measure when the scope toggle is set to League, and the source of
   * each year's raw point total when scoped to Position too (only the percentile
   * differs there -- see getSeasonPointsPercentileForPosition below). The type
   * is `PlayerCardSeasonEntry` rather than the base entry so the displayed
   * figure can't silently be the rostered one next to a card-basis percentile. */
  series: PlayerCardSeasonEntry[];
  /** This player's league-wide point totals, every player every year --
   * needed (rather than just this player's own series) because the Position
   * scope's picker can select a position that wasn't this player's own
   * declared primary in a given season (a well-played secondary spot, e.g.
   * Ryan Zimmerman's 2014 at left field), which means the comparison field
   * has to be assembled fresh per pick rather than read off a precomputed
   * per-player-season group. */
  seasonPoints: PlayerSeasonPoints[];
  /** player_seasons.json's eligible_slots (that year's real fantasy
   * eligibility, mapped to positions.ts's id space), keyed "year:player_id"
   * -- league-wide, used to narrow the Position scope's comparison field
   * (for both the Points measure and counting stats) to players eligible at
   * the picked position that specific year. Not offered for a two-way
   * player, whose own eligibility only names one side of the ball. */
  positionByPlayerSeason: Map<string, number[]>;
  /** This player's own per-season position detail, newest year first --
   * feeds the position picker's option list (every position this player was
   * ever fantasy-eligible at, including eligibility carried over from a
   * prior season, not just their declared primaries) and which years get
   * shown once a position is picked (a player only qualifies for the years
   * they were actually eligible there, e.g. Ryan Zimmerman at LF in 2014 and
   * 2015, not 2016). */
  seasonPositions: SeasonPositions[];
  /** Every year's whole roster field, for ranking counting stats. Only covers
   * the years box scores exist for (2019+, plus 2018's partial coverage). */
  rostersByYear: Map<number, SeasonPlayerLine[]>;
  /** This player's own season lines, used to drop rocker options for stats
   * they never recorded. */
  statLinesByYear: Map<number, SeasonPlayerLine>;
  playerId: number;
  defaultPositionId: number | undefined;
  isPitcher: boolean;
  /** Batted and pitched in the same season at least once. Gets a second
   * rocker to pick which side of the ball is being ranked. */
  isTwoWay: boolean;
  scoringByYear: ScoringByYear;
  boxScoresLoading: boolean;
  seasons: Season[];
}

interface StripRow {
  year: number;
  percentile: number | null;
  value: string;
}

/** Baseball-Savant-style percentile strip: one row per season, a filled bar
 * running from the 0th percentile out to where that season ranked, the
 * percentile number riding the bar's end tip as a single bar+number unit on a
 * shared 0-100 track. The scope
 * toggle picks the field: League (default) ranks against everyone, Position
 * ranks only against other players fantasy-eligible at a picked position that
 * year. When Position is active, a picker lets the viewer choose which
 * position to compare against -- every position this player was ever
 * fantasy-eligible at (player_seasons.json's `eligible_slots`, which already
 * carries ESPN's own real eligibility rules, including a season's worth of
 * carryover from the prior year even with zero games played there that
 * season), not just their declared primaries, since a season spent mostly
 * elsewhere but eligible at a second spot is still a real comparison (Ryan
 * Zimmerman's 2014 at left field, even though his declared primary stayed
 * third base). An "OF" option groups LF/CF/RF together, matching ESPN's own
 * generic outfield roster slot. Only the seasons this player was actually
 * eligible at the picked position are shown -- except SP (see SP_POSITION_ID
 * above), where a season's start count doesn't gate whether it ranks, only
 * how it ranks. A two-way player's own eligibility names only one side
 * of the ball, so their strip always ranks against that whole side's field
 * instead and the scope toggle (and position picker) is hidden (see isTwoWay
 * branches below). Percentile (not the raw total) is the only
 * cross-season-comparable measure this league has, since scoring rules
 * changed over the years -- see buildSeasonPercentiles in lib/stats.ts.
 *
 * The rocker swaps which measure is being ranked. Points spans the whole
 * archive; the counting stats only reach back as far as box-score coverage
 * does, so the row list gets shorter rather than showing fabricated zeros.
 *
 * The number rides the bar's end, so color is never the sole
 * encoding; the Season by Season table above is the full table-view twin,
 * though that table's own Percentile/YoY columns always rank against the
 * whole league, unaffected by this component's scope toggle. */
export function PercentileBySeason({
  series,
  seasonPoints,
  positionByPlayerSeason,
  seasonPositions,
  rostersByYear,
  statLinesByYear,
  playerId,
  defaultPositionId: playerDefaultPositionId,
  isPitcher,
  isTwoWay,
  scoringByYear,
  boxScoresLoading,
  seasons,
}: PercentileBySeasonProps) {
  const [side, setSide] = useState<Side>(isPitcher ? "pitching" : "batting");
  const [metricKey, setMetricKey] = useState<string>(POINTS_KEY);
  const [scope, setScope] = useState<Scope>("league");
  const [positionId, setPositionId] = useState<number | undefined>(undefined);

  // A one-sided player's rocker always shows their own side; the side state
  // only becomes reachable for a two-way player.
  const activeSide: Side = isTwoWay ? side : isPitcher ? "pitching" : "batting";

  // Every position this player was ever fantasy-eligible at (eligible_slots,
  // carryover already included) -- a utility player who moved across positions
  // over a career gets one option per position, not one per season. An "OF"
  // sentinel is added when the player was ever eligible at any of LF/CF/RF,
  // alongside (not instead of) the individual outfield spots. The whole set is
  // ordered by orderEligiblePositionIdsForPicker, which puts DH last and the
  // outfield group first (OF, then LF/CF/RF, each only when eligible).
  const positionOptions = useMemo(() => {
    const ids = new Set<number>();
    for (const sp of seasonPositions) {
      for (const id of sp.eligible) ids.add(id);
      if (matchesPositionScope(sp.eligible, OF_POSITION_ID)) ids.add(OF_POSITION_ID);
    }
    return orderEligiblePositionIdsForPicker([...ids]);
  }, [seasonPositions]);
  // Falls back to a sensible default rather than resetting on every render,
  // same reasoning as activeMetricKey below -- and recovers on its own if the
  // stored pick isn't one of this player's positions (e.g. after navigating to
  // a different player without a route remount). Pitchers eligible at both SP
  // and RP default to whichever role they appeared at more often.
  const selectedPosition =
    positionId !== undefined && positionOptions.includes(positionId)
      ? positionId
      : defaultPositionId(positionOptions, seasonPositions, playerDefaultPositionId);
  // Which seasons this player was actually eligible at each position -- gates
  // which years get shown once a position is picked. Matched via
  // matchesPositionScope (not raw membership) so the OF option's years are
  // gated on eligibility at any of LF/CF/RF, not a literal id 0 in the array.
  const qualifiedPositionsByYear = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const sp of seasonPositions) map.set(sp.year, sp.eligible);
    return map;
  }, [seasonPositions]);

  // Two-way ranking is always scoped to a whole side of the ball (see below) --
  // a two-way player's own position id only names one side, so "Position"
  // scope has nothing meaningful to filter by, and the toggle is hidden.
  const scopeToPosition = !isTwoWay && scope === "position";

  // Only offer stats this player actually recorded. A starter has no saves, so
  // an SV option would chart nothing but a flat field of zeros -- and, worse,
  // rank them against every reliever who does have them.
  const metrics = useMemo(() => {
    const sideMetrics = activeSide === "pitching" ? PITCHING_METRICS : BATTING_METRICS;
    return sideMetrics.filter(m => {
      for (const line of statLinesByYear.values()) {
        const value = m.read(line);
        if (value !== null && value !== 0) return true;
      }
      return false;
    });
  }, [activeSide, statLinesByYear]);

  // Falling back rather than resetting the stored key means a two-way player
  // who picked a pitching stat, looked at batting, and came back still has it
  // selected -- and a key that vanishes while box scores load comes back on
  // its own once they arrive.
  const activeMetricKey = metrics.some(m => m.key === metricKey) ? metricKey : POINTS_KEY;
  const metric = metrics.find(m => m.key === activeMetricKey) ?? null;

  // Only computed when actually needed (Position scope, Points measure) --
  // this is the fresh-per-pick field assembly described above, since a
  // picked position need not be this player's own declared primary in every
  // qualifying year.
  const positionPointsPercentileByYear = useMemo(() => {
    if (!scopeToPosition || selectedPosition === undefined) return new Map<number, number>();
    return getSeasonPointsPercentileForPosition(playerId, seasonPoints, positionByPlayerSeason, selectedPosition);
  }, [scopeToPosition, selectedPosition, playerId, seasonPoints, positionByPlayerSeason]);

  const rows = useMemo<StripRow[]>(() => {
    // For a two-way player "Points" means that side's half of their total,
    // which is the only way to rank the two halves separately -- their
    // combined total is what the Season by Season table's Percentile column
    // already shows. For everyone else it stays the whole-archive total,
    // which reaches back past box-score coverage.
    if (!metric && isTwoWay) {
      return getStatPercentileSeries(playerId, rostersByYear, (line, year) => {
        const split = splitLinePoints(line, scoringByYear.get(year));
        return split[activeSide];
      }).map(s => ({ year: s.year, percentile: s.percentile, value: formatPoints(s.value) }));
    }
    if (!metric) {
      if (scopeToPosition && selectedPosition !== undefined) {
        return series
          .filter(
            s =>
              selectedPosition === SP_POSITION_ID ||
              matchesPositionScope(qualifiedPositionsByYear.get(s.year) ?? [], selectedPosition)
          )
          .map(s => ({
            year: s.year,
            percentile: positionPointsPercentileByYear.get(s.year) ?? null,
            value: formatPoints(s.cardPoints),
          }));
      }
      return series.map(s => ({ year: s.year, percentile: s.percentile, value: formatPoints(s.cardPoints) }));
    }
    const statRows = getStatPercentileSeries(
      playerId,
      rostersByYear,
      metric.read,
      metric.higherIsBetter ?? true,
      scopeToPosition ? positionByPlayerSeason : undefined,
      scopeToPosition ? selectedPosition : undefined
    );
    const scopedRows =
      scopeToPosition && selectedPosition !== undefined && selectedPosition !== SP_POSITION_ID
        ? statRows.filter(s => matchesPositionScope(qualifiedPositionsByYear.get(s.year) ?? [], selectedPosition))
        : statRows;
    return scopedRows.map(s => ({ year: s.year, percentile: s.percentile, value: metric.format(s.value) }));
  }, [
    metric,
    series,
    qualifiedPositionsByYear,
    positionPointsPercentileByYear,
    selectedPosition,
    rostersByYear,
    playerId,
    isTwoWay,
    activeSide,
    scoringByYear,
    positionByPlayerSeason,
    scopeToPosition,
  ]);

  // Most recent season first, matching the Season by Season table's default.
  const ordered = useMemo(() => [...rows].sort((a, b) => b.year - a.year), [rows]);

  const pointsLabel = isTwoWay ? (activeSide === "pitching" ? "Pitching Pts" : "Batting Pts") : "Points";
  const options = [{ key: POINTS_KEY, label: pointsLabel }, ...metrics.map(m => ({ key: m.key, label: m.label }))];

  return (
    <section>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SectionHeading>Percentile Rankings</SectionHeading>
          {/* Anything read off a stat line -- every counting stat, plus a
              two-way player's split points -- is capped by stat-line coverage. */}
          {(metric || isTwoWay) && <CoverageBadge seasons={seasons} domain="stat_lines" />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isTwoWay && (
            <SegmentedToggle
              ariaLabel="Side of the ball"
              value={side}
              onChange={setSide}
              options={SIDE_OPTIONS}
              size="sm"
            />
          )}
          {!isTwoWay && (
            <SegmentedToggle
              ariaLabel="Comparison scope"
              value={scope}
              onChange={setScope}
              options={SCOPE_OPTIONS}
              size="sm"
            />
          )}
          {/* Hidden for a one-position player -- nothing to pick between, so a
              single-option dropdown would just be clutter. */}
          {scopeToPosition && positionOptions.length > 1 && (
            <FilterSelect
              value={selectedPosition}
              onChange={e => setPositionId(Number(e.target.value))}
              aria-label="Comparison position">
              {positionOptions.map(id => (
                <option key={id} value={id}>
                  {positionLabel(id)}
                </option>
              ))}
            </FilterSelect>
          )}
          <SegmentedToggle
            ariaLabel="Percentile measure"
            value={activeMetricKey}
            onChange={setMetricKey}
            options={options}
          />
        </div>
      </div>
      <p className="mb-3 text-xs text-ink-faint">
        {isTwoWay
          ? "Where each season ranked against every other player in the league that year. This player both bats and pitches, so each side is ranked against that side's field, and their points split into the two halves."
          : scopeToPosition && selectedPosition !== undefined
            ? selectedPosition === SP_POSITION_ID
              ? "Where each season ranked against other starting pitchers in the league that year."
              : `Where each season ranked against other players eligible at ${positionLabel(selectedPosition)} that year. Only seasons this player was eligible are shown. Position eligibility carries over from the prior season.`
            : "Where each season ranked against every other player in the league that year."}
        {scopeToPosition && selectedPosition !== undefined && (
          <>
            {" "}
            Rookies will often be eligible at a position that they played in the minor leagues but not the major leagues.
          </>
        )}
      </p>

      {ordered.length === 0 ? (
        <p className="text-sm text-ink-dim">
          {(metric || isTwoWay) && boxScoresLoading
            ? "Loading box scores…"
            : metric
              ? `No ${metric.label} on file for any covered season.`
              : isTwoWay
                ? `No ${activeSide} on file for any covered season.`
                : "No records found."}
        </p>
      ) : (
        <Board>
          <div className="p-4">
            <ul className="space-y-1.5">
              {ordered.map(row => (
                <li key={row.year} className="flex items-center gap-3 text-sm">
                  <Link
                    to={`/season/${row.year}`}
                    className="w-12 flex-none font-semibold tabular-nums hover:underline">
                    {row.year}
                  </Link>
                  <div className="relative h-7 flex-1">
                    {/* Track: the 0-100 range. Fill: colored 0 → percentile, the
                        number riding the fill's end tip as one unit. */}
                    <div className="absolute top-0 right-3.5 left-3.5 h-full rounded-full bg-surface-2" />
                    {row.percentile !== null && (
                      <div
                        className="absolute top-0 left-3.5 h-full rounded-full"
                        style={{
                          width: `calc(${row.percentile}% - ${(row.percentile / 100) * 1.75}rem)`,
                          ...percentileBarBackground(row.percentile),
                        }}
                      />
                    )}
                    {row.percentile === null ? (
                      <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-xs text-ink-faint">
                        not ranked
                      </span>
                    ) : (
                      <div
                        title={`${row.year}: ${formatOrdinal(Math.round(row.percentile))} percentile, ${row.value}`}
                        className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold tabular-nums text-white drop-shadow-sm"
                        style={{
                          // Anchored at the fill's end point so the circle sits
                          // directly on top of the bar tip.
                          left: `calc(0.875rem + ${row.percentile}% - ${(row.percentile / 100) * 1.75}rem)`,
                          ...percentileBarBackground(row.percentile),
                        }}>
                        {Math.round(row.percentile)}
                      </div>
                    )}
                  </div>
                  <span className="w-20 flex-none text-right text-ink-faint tabular-nums">{row.value}</span>
                </li>
              ))}
            </ul>
            <div className="mt-1 flex items-center gap-3 text-[0.62rem] text-ink-faint">
              <span className="w-12 flex-none" />
              <div className="flex flex-1 justify-between px-3.5 tabular-nums">
                <span>0</span>
                <span>50th percentile</span>
                <span>100</span>
              </div>
              <span className="w-20 flex-none text-right">{metric ? metric.label : "pts"}</span>
            </div>
          </div>
        </Board>
      )}

      {/* {(metric || isTwoWay) && (
        <p className="mt-3 text-[0.66rem] text-ink-faint">
          Ranked against{" "}
          {isTwoWay
            ? `players who recorded ${activeSide === "pitching" ? "a pitching" : "a batting"} line that year, so a${activeSide === "pitching" ? " batter's" : " pitcher's"} empty season doesn't pad the field`
            : scopeToPosition && selectedPosition !== undefined
              ? `other players eligible at ${positionLabel(selectedPosition)} that year who recorded any stats`
              : `players who recorded a stat line that year`}
          . Figures include statistics accumulated when on the bench or IL.
          {metric?.higherIsBetter === false && " ER is inverted so fewer earned runs ranks higher."}
        </p>
      )} */}
    </section>
  );
}
