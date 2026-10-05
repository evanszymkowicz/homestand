import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Board, TEN_ROWS } from "../../components/Board";
import { FilterSelect } from "../../components/FilterSelect";
import { Headshot } from "../../components/Headshot";
import { CoverageBadge } from "../../components/CoverageBadge";
import { OwnerLink } from "../../components/OwnerLink";
import { PartialCoverageNote } from "../../components/PartialCoverageNote";
import { PortalTooltip } from "../../components/PortalTooltip";
import { SectionHeading } from "../../components/SectionHeading";
import { SegmentedToggle } from "../../components/SegmentedToggle";
import { SortHeader } from "../../components/SortHeader";
import { TickerText } from "../../components/TickerText";
import { useAsync } from "../../hooks/useAsync";
import { useSortableRows } from "../../hooks/useSortableRows";
import { BENCH_DISPLAY_EPSILON, getBenchPoints, getPlayerWeekSlots } from "../../lib/boxScore";
import { SlotCell } from "../Matchup/BoxScoreTable";
import { loadBoxScoresPartial, type JerseyHistoryOverride } from "../../lib/data";
import type { DraftStealEntry, MrIrrelevantEntry } from "../../lib/draft";
import { getPlayerDraftHistory } from "../../lib/draft";
import {
  formatDifferential,
  formatInnings,
  formatOrdinal,
  formatPercentileChange,
  formatPoints,
} from "../../lib/format";
import { getYearRuns } from "../../lib/ownerHistory";
import { PTS_SEMANTICS_TOOLTIP_ALL_WEEK } from "../../lib/ptsSemantics";
import { cardPointsFor } from "../../lib/cardPoints";
import {
  aggregateRostersByYear,
  enrichPossessionChain,
  getPlayerCareerSeries,
  getPlayerCareerYears,
  type PlayerCardSeasonEntry,
  getPlayerPointsSplit,
  getPlayerPossessionChain,
  getPlayerReleaseKeys,
  getPlayerSeasonStatLines,
  isTwoWayPlayer,
} from "../../lib/playerHistory";
import { buildScoringByYear } from "../../lib/pointsSplit";
import {
  getJerseyHistory,
  getPlayerSeasonPositions,
  type JerseyRun,
  type SeasonPositions,
} from "../../lib/playerPositions";
import { positionLabel } from "../../lib/positions";
import { LINEUP_SPLIT_FIRST_YEAR, pointsTooltip } from "../../lib/seasonStats";
import { MLB_TEAM_COLORS } from "../../lib/mlbColors";
import { ownerRef } from "../../lib/stats";
import { mergeTradeItemsIntoTransactions } from "../../lib/trades";
import { transactionYears } from "../../lib/transactions";
import { PercentileBySeason } from "./PercentileBySeason";
import type {
  BattingLine,
  BoxScoreEntry,
  DraftPick,
  Keeper,
  MlbTeam,
  Owner,
  Player,
  PlayerSeason,
  PlayerSeasonBackfill,
  PlayerSeasonPoints,
  PitchingLine,
  Season,
  Trade,
  Transaction,
} from "../../types";

/** Anything carrying per-side stat lines -- SeasonPlayerLine (the season
 * view) and BoxScoreEntry (the week view) both qualify structurally, so one
 * set of column defs serves both tables. */
interface StatLineSource {
  batting: BattingLine | null;
  pitching: PitchingLine | null;
}

interface StatColumnDef {
  key: string;
  label: string;
  value: (line: StatLineSource | undefined) => string;
  sortValue: (line: StatLineSource | undefined) => number;
}

const BATTING_STAT_COLUMNS: StatColumnDef[] = [
  { key: "ab", label: "AB", value: l => String(l?.batting?.ab ?? "—"), sortValue: l => l?.batting?.ab ?? -1 },
  { key: "r", label: "R", value: l => String(l?.batting?.r ?? "—"), sortValue: l => l?.batting?.r ?? -1 },
  {
    key: "h",
    label: "H",
    value: l => (l?.batting ? String(l.batting.singles + l.batting.doubles + l.batting.triples + l.batting.hr) : "—"),
    sortValue: l => (l?.batting ? l.batting.singles + l.batting.doubles + l.batting.triples + l.batting.hr : -1),
  },
  { key: "2b", label: "2B", value: l => String(l?.batting?.doubles ?? "—"), sortValue: l => l?.batting?.doubles ?? -1 },
  { key: "hr", label: "HR", value: l => String(l?.batting?.hr ?? "—"), sortValue: l => l?.batting?.hr ?? -1 },
  { key: "rbi", label: "RBI", value: l => String(l?.batting?.rbi ?? "—"), sortValue: l => l?.batting?.rbi ?? -1 },
  { key: "sb", label: "SB", value: l => String(l?.batting?.sb ?? "—"), sortValue: l => l?.batting?.sb ?? -1 },
  { key: "bb", label: "BB", value: l => String(l?.batting?.bb ?? "—"), sortValue: l => l?.batting?.bb ?? -1 },
];

const PITCHING_STAT_COLUMNS: StatColumnDef[] = [
  {
    key: "ip",
    label: "IP",
    value: l => (l?.pitching ? formatInnings(l.pitching.outs) : "—"),
    sortValue: l => l?.pitching?.outs ?? -1,
  },
  { key: "w", label: "W", value: l => String(l?.pitching?.wins ?? "—"), sortValue: l => l?.pitching?.wins ?? -1 },
  { key: "l", label: "L", value: l => String(l?.pitching?.losses ?? "—"), sortValue: l => l?.pitching?.losses ?? -1 },
  { key: "sv", label: "SV", value: l => String(l?.pitching?.sv ?? "—"), sortValue: l => l?.pitching?.sv ?? -1 },
  { key: "hd", label: "HD", value: l => String(l?.pitching?.hd ?? "—"), sortValue: l => l?.pitching?.hd ?? -1 },
  { key: "k", label: "K", value: l => String(l?.pitching?.k ?? "—"), sortValue: l => l?.pitching?.k ?? -1 },
  { key: "era", label: "ER", value: l => String(l?.pitching?.er ?? "—"), sortValue: l => l?.pitching?.er ?? -1 },
];

/** Primary position, centered; every other real appearance (no games floor,
 * unlike Percentile by Season) sits in a hover/focus tooltip instead. The
 * tooltip portals out of the table card: a short career's first row opens it
 * downward, and an absolute tooltip would trip the Board's overflow-y-auto
 * into a phantom scrollbar and clip at the card's bottom edge. */
function SeasonPositionsCell({ positions, openDown }: { positions: SeasonPositions | undefined; openDown: boolean }) {
  if (!positions || (!positions.primary && positions.allAppearances.length === 0)) {
    return (
      <span className="flex justify-center">
        <span className="text-ink-faint">—</span>
      </span>
    );
  }
  const primaryGames = positions.primaryGames;
  const otherAppearances = positions.allAppearances.filter(p => p.positionId !== positions.primaryPositionId);
  return (
    <span className="flex justify-center">
      <PortalTooltip
        openDown={openDown}
        triggerClassName="cursor-help outline-none"
        content={
          <>
            <div className="font-bold">
              {positions.primary}
              {otherAppearances.length > 0 && " (primary)"}
              {primaryGames !== undefined && ` · ${primaryGames} ${primaryGames === 1 ? "game" : "games"}`}
            </div>
            {otherAppearances.map(p => (
              <div key={p.positionId} className="text-ink-dim">
                {p.label} · {p.games} {p.games === 1 ? "game" : "games"}
              </div>
            ))}
          </>
        }>
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[0.68rem] font-bold">{positions.primary}</span>
      </PortalTooltip>
    </span>
  );
}

interface PlayerPageProps {
  player: Player;
  seasonPoints: PlayerSeasonPoints[];
  playerSeasons: PlayerSeason[];
  playerSeasonBackfill: PlayerSeasonBackfill[];
  transactions: Transaction[];
  trades: Trade[];
  draftPicks: DraftPick[];
  keepers: Keeper[];
  owners: Owner[];
  seasons: Season[];
  mlbTeams: MlbTeam[];
  jerseyOverrides: JerseyHistoryOverride[];
  mrIrrelevantEntries: MrIrrelevantEntry[];
  draftSteals: DraftStealEntry[];
  percentiles: Map<string, number>;
  positionByPlayerSeason: Map<string, number[]>;
  cardPointsByYearPlayer: Map<string, number>;
  /** League-wide season points on the card basis -- the field
   * `percentiles` was built from. Percentile Rankings' Position scope rebuilds
   * its comparison field from this; feeding it rostered points there would make
   * the two scopes rank against different fields and silently disagree. */
  cardBasisSeasonPoints: PlayerSeasonPoints[];
}

/** One badge per getJerseyHistory run: a small circle in the real MLB team's
 * color, number centered, hover/focus reveals a themed tooltip with the
 * calendar years and team of that stint (a native `title` renders with a
 * black OS tooltip on most browsers, which clashed with the app's palette
 * -- this is a CSS-only group-hover popover instead). Runs with no
 * resolvable real team are dropped upstream, so every run here always has
 * a color. */
function JerseyHistory({ runs }: { runs: JerseyRun[] }) {
  if (runs.length === 0) return null;
  return (
    <span className="flex items-center gap-1">
      {runs.map((run, i) => {
        const rangeLabel = run.startYear === run.endYear ? String(run.startYear) : `${run.startYear}–${run.endYear}`;
        // Badges trail the name at the header's right end, so tooltips extend
        // leftward into open space rather than centering out past the right
        // screen edge on phones; they may also wrap rather than force a
        // whitespace-nowrap date+team string ever wider.
        return (
          <span key={`${i}-${run.proTeamId}-${run.jersey}-${run.startYear}`} className="group relative flex">
            <span
              tabIndex={0}
              className="flex h-[1.15rem] w-[1.15rem] items-center justify-center rounded-full text-[0.6rem] font-bold text-white tabular-nums outline-none"
              style={{ backgroundColor: MLB_TEAM_COLORS[run.abbrev] }}>
              {run.jersey}
            </span>
            <span
              role="tooltip"
              className="pointer-events-none invisible absolute bottom-full right-0 z-20 mb-1.5 w-max max-w-[min(12rem,calc(100vw-2rem))] rounded-md border border-border bg-surface px-2 py-1 text-left text-xs font-semibold whitespace-normal leading-snug text-ink opacity-0 shadow-md transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
              {rangeLabel} · {run.teamName}
            </span>
          </span>
        );
      })}
    </span>
  );
}

interface PlayerWeekTableProps {
  entries: BoxScoreEntry[];
  year: number;
  //  Where that player's points for the week ranked as a percentile league-wide
  pctByWeek: Map<string, number>;
  /** "week:team_id" -> WoW point swing vs this player's prior week; null on
   * the first week played. See weekWowByWeek in PlayerPage. */
  wowByWeek: Map<string, number | null>;
  /** False where no raw stat line exists (2009–2017) -- dashes would be noise. */
  showStats: boolean;
  /** Day-accurate slot data only exists where coverage.stat_lines is "full"
   * (2019+; 2018 is a season-end snapshot) */
  showSlots: boolean;
}

/** One player's season, one row per matchup week he was rostered. Points-first
 * (Wk / Pts / Bench / Pctl / WoW), then stat columns -- both Hitting and
 * Pitching groups for a two-way season, the player's one side otherwise. Same
 * five-column primary slice and flat single-row header as Season by Season.
 * The Wk cell deep-links to that week's matchup page; ownership across weeks
 * lives in the Possession Chain below, not here.
 *
 * Points is `total_points` -- ALL of the week's production while rostered,
 * started and benched alike -- so Points, Percentile and WoW all rank on one
 * basis. Bench stays as its own column to show how much of that total never
 * counted toward a team score. This is NOT ESPN's season card total, which also
 * counts free-agent days outside the matchup calendar, so a season's weeks
 * legitimately sum below the Season by Season Points figure. */
function PlayerWeekTable({ entries, year, pctByWeek, wowByWeek, showStats, showSlots }: PlayerWeekTableProps) {
  //  Two-way player stats register as one function with no switch.
  const columns = !showStats ? [] : [...BATTING_STAT_COLUMNS, ...PITCHING_STAT_COLUMNS];
  const firstPitchingKey = PITCHING_STAT_COLUMNS[0].key;

  function sortValue(entry: BoxScoreEntry, key: string): number | string {
    switch (key) {
      case "week":
        return entry.week;
      case "position":
        return getPlayerWeekSlots(entry)?.primaryLabel ?? "";
      case "pts":
        return entry.total_points;
      case "bench":
        return getBenchPoints(entry);
      case "pctl":
        return pctByWeek.get(`${entry.week}:${entry.espn_team_id}`) ?? -Infinity;
      case "wow":
        return wowByWeek.get(`${entry.week}:${entry.espn_team_id}`) ?? -Infinity;
      default:
        return columns.find(c => c.key === key)?.sortValue(entry) ?? -1;
    }
  }

  const { sorted, sortKey, direction, toggleSort } = useSortableRows<BoxScoreEntry, string>(
    entries,
    sortValue,
    "week",
    "desc"
  );

  return (
    <Board maxHeight={TEN_ROWS}>
      {/* Content-sized (not w-full) so the columns stay as dense as the season
          table's rather than stretching to fill the card. */}
      <table className="border-collapse text-sm">
        <thead>
          <tr>
            <SortHeader
              label="Week"
              sortKey="week"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
              stickyLeft
            />
            {showSlots && (
              <SortHeader
                label="Position"
                sortKey="position"
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
                align="center"
              />
            )}
            <SortHeader
              label="Points"
              sortKey="pts"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
              tooltip={PTS_SEMANTICS_TOOLTIP_ALL_WEEK}
            />
            <SortHeader
              label="Percentile"
              ariaLabel="Week percentile against every player-week this season"
              sortKey="pctl"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
            <SortHeader
              label="WoW"
              ariaLabel="Week-over-week point swing"
              sortKey="wow"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
            {columns.map(col => (
              <SortHeader
                key={col.key}
                label={col.label}
                sortKey={col.key}
                activeKey={sortKey}
                direction={direction}
                onSort={toggleSort}
                align="center"
                className={col.key === firstPitchingKey ? "border-l border-border" : ""}
              />
            ))}
            <SortHeader
              label="Bench"
              sortKey="bench"
              activeKey={sortKey}
              direction={direction}
              onSort={toggleSort}
              align="center"
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map(entry => {
            const bench = getBenchPoints(entry);
            const entryKey = `${entry.week}:${entry.espn_team_id}`;
            const wow = wowByWeek.get(entryKey);
            const pctl = pctByWeek.get(entryKey);
            return (
              <tr
                key={`${entry.week}:${entry.espn_team_id}`}
                className="group border-t border-border hover:bg-surface-2">
                <td className="sticky left-0 z-[5] bg-surface px-3 py-2 text-center font-semibold tabular-nums group-hover:bg-surface-2">
                  <Link
                    to={`/matchup/${year}/${entry.matchup_id}`}
                    title={`Week ${entry.week} matchup`}
                    className="hover:underline">
                    {entry.week}
                  </Link>
                </td>
                {showSlots && (
                  <td className="px-3 py-2 text-center">
                    <SlotCell slots={getPlayerWeekSlots(entry)} />
                  </td>
                )}
                <td className="px-3 py-2 text-center font-semibold tabular-nums">{formatPoints(entry.total_points)}</td>
                <td className="px-3 py-2 text-center text-ink-dim tabular-nums">
                  {pctl == null ? <span className="text-ink-faint">—</span> : formatOrdinal(pctl)}
                </td>
                <td className="px-3 py-2 text-center font-semibold tabular-nums">
                  {wow == null ? (
                    <span className="text-ink-faint">—</span>
                  ) : (
                    <span className={wow >= 0 ? "text-diverge-pos" : "text-diverge-neg"}>
                      {formatDifferential(wow)}
                    </span>
                  )}
                </td>
                {columns.map(col => (
                  <td
                    key={col.key}
                    className={`px-3 py-2 text-center text-ink-dim tabular-nums ${col.key === firstPitchingKey ? "border-l border-border" : ""}`}>
                    {col.value(entry)}
                  </td>
                ))}
                <td className="px-3 py-2 text-center tabular-nums text-ink-faint">
                  {Math.abs(bench) > BENCH_DISPLAY_EPSILON ? formatPoints(bench) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Board>
  );
}

/** The "Around the Horn" player card: career season-by-season production
 * (owner/status per year comes from draft.ts's getPlayerDraftHistory, the
 * same function DraftPlayerSearch's popup already uses -- its own dedicated
 * table was dropped as redundant once Season by Season absorbed those
 * columns) and a possession chain derived from box-score activity (see
 * lib/playerHistory.ts). Box scores are only fetched for years this player
 * actually played in (getPlayerCareerYears), not every covered year -- the
 * combined archive runs tens of MB and most players only touch a handful of
 * seasons. */
export function PlayerPage({
  player,
  seasonPoints,
  playerSeasons,
  playerSeasonBackfill,
  transactions,
  trades,
  draftPicks,
  keepers,
  owners,
  seasons,
  mlbTeams,
  jerseyOverrides,
  mrIrrelevantEntries,
  draftSteals,
  percentiles,
  positionByPlayerSeason,
  cardPointsByYearPlayer,
  cardBasisSeasonPoints,
}: PlayerPageProps) {
  // Real career years, not Player.seasons_seen -- see getPlayerCareerYears.
  // Computed before the box-score fan-out because it also narrows WHICH years
  // get fetched: seasons_seen carries pure minor-league pool years (Wood
  // 2022-2023, pre-debut), and fetching their multi-MB box scores to then
  // discard them is pure waste. Narrowing is structurally lossless rather than
  // merely verified: every box-score player-season has a player_season_points
  // row, and that is one of the four evidence sources below, so no box-score
  // year can ever be trimmed.
  const careerYears = useMemo(
    () =>
      getPlayerCareerYears(
        player.player_id,
        playerSeasons,
        seasonPoints,
        playerSeasonBackfill,
        draftPicks,
        keepers,
        player.seasons_seen
      ),
    [player.player_id, player.seasons_seen, playerSeasons, seasonPoints, playerSeasonBackfill, draftPicks, keepers]
  );
  const boxScoreYears = useMemo(
    () => careerYears.filter(y => seasons.some(s => s.year === y && s.coverage.box_scores !== "missing")),
    [careerYears, seasons]
  );
  const boxState = useAsync(() => loadBoxScoresPartial(boxScoreYears), [player.player_id, boxScoreYears]);
  // Years the fan-out dropped (loadBoxScoresPartial omits failed years rather
  // than failing the whole card) -- rendered as a partial-data note below.
  const failedBoxScoreYears = useMemo(
    () => (boxState.status === "success" ? boxScoreYears.filter(y => !boxState.data.has(y)) : []),
    [boxState, boxScoreYears]
  );

  // "By Season" (the original aggregated table) vs "By Week" (one row per
  // matchup week this player was rostered, mirroring Matchup/BoxScoreTable).
  const [viewMode, setViewMode] = useState<"season" | "week">("season");
  const [weekYearPref, setWeekYearPref] = useState<number | null>(null);
  // The dropdown lists only seasons with actual week-by-week data, not every
  // covered career year: a real MLB season can still have no fantasy activity
  // (a player our league never rostered or drafted). seasonPoints is the
  // synchronous source (boxState's entries derive from the same box scores,
  // unioned here in case they ever disagree); games_played_by_position can't
  // serve instead -- it's empty for real MLB seasons in several archive years
  // (e.g. Kershaw 2010-2013).
  const weekYearOptions = useMemo(() => {
    const active = new Set<number>();
    for (const s of seasonPoints) if (s.player_id === player.player_id) active.add(s.year);
    for (const row of playerSeasonBackfill) if (row.player_id === player.player_id) active.add(row.year);
    if (boxState.status === "success") {
      for (const [y, entries] of boxState.data) {
        if (entries.some(e => e.player_id === player.player_id)) active.add(y);
      }
    }
    return boxScoreYears.filter(y => active.has(y));
  }, [seasonPoints, playerSeasonBackfill, player.player_id, boxScoreYears, boxState]);
  // The selected week-view year falls back to the most recent active year,
  // so a stale preference (e.g. a year the next player wasn't rostered in)
  // self-corrects instead of rendering an empty table.
  const activeWeekYear =
    weekYearPref != null && weekYearOptions.includes(weekYearPref)
      ? weekYearPref
      : (weekYearOptions[weekYearOptions.length - 1] ?? null);
  const weekRows = useMemo(() => {
    if (boxState.status !== "success" || activeWeekYear == null) return [];
    return (boxState.data.get(activeWeekYear) ?? []).filter(e => e.player_id === player.player_id);
  }, [boxState, player.player_id, activeWeekYear]);
  // Era gate for the week view's stat columns, same convention as
  // Matchup/index.tsx: raw lines exist wherever coverage.stat_lines isn't
  // "missing" (2018's recovered lines included).
  const weekShowStats =
    activeWeekYear != null && seasons.find(s => s.year === activeWeekYear)?.coverage.stat_lines !== "missing";
  // Slot badge gate, same convention as Matchup/index.tsx: only years whose
  // stat_lines coverage is "full" carry day-accurate slots (2018's are a
  // season-end snapshot, not real).
  const weekShowSlots =
    activeWeekYear != null && seasons.find(s => s.year === activeWeekYear)?.coverage.stat_lines === "full";
  // Week percentile: each week's points ranked against EVERY player-week in
  // the league that season (all teams; zero-point weeks are real facts about
  // the field). Ranked on total_points -- all production, the same basis as
  // the Points column -- so the two always agree. Average-rank method over n-1
  // with a thin-field guard -- same convention as lib/stats.ts's season
  // percentiles. Keyed "week:teamId": a mid-week trade puts one player under
  // two teams in the same week, and each row ranks its own line.
  const weekPctByWeek = useMemo(() => {
    const empty = new Map<string, number>();
    if (boxState.status !== "success" || activeWeekYear == null) return empty;
    const yearEntries = boxState.data.get(activeWeekYear) ?? [];
    if (yearEntries.length < 2) return empty;
    // Points land on .1 boundaries; round to one decimal so float noise in
    // identical sums still ties.
    const keyOf = (v: number) => Math.round(v * 10);
    const sorted = yearEntries.map(e => keyOf(e.total_points)).sort((a, b) => a - b);
    const pctByValue = new Map<number, number>();
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j < sorted.length && sorted[j] === sorted[i]) j++;
      pctByValue.set(sorted[i], ((i + (j - i - 1) / 2) / (sorted.length - 1)) * 100);
      i = j;
    }
    // pctByValue is built from every entry this season including the player's
    // own, so their lookup always hits; skip (don't fake) in the impossible
    // miss case rather than widening the map to number|null.
    const out = new Map<string, number>();
    for (const e of yearEntries) {
      if (e.player_id === player.player_id) {
        const pct = pctByValue.get(keyOf(e.total_points));
        if (pct != null) out.set(`${e.week}:${e.espn_team_id}`, pct);
      }
    }
    return out;
  }, [boxState, player.player_id, activeWeekYear]);
  // Week-over-week point swing: this week's total points minus the prior
  // week's, summed across same-week entries (a mid-week trade splits one
  // week across two rosters; the swing tracks that week's combined output).
  // Null on the first week played, where there's no prior to swing from.
  const weekWowByWeek = useMemo(() => {
    const empty = new Map<string, number | null>();
    if (boxState.status !== "success" || activeWeekYear == null) return empty;
    const myEntries = (boxState.data.get(activeWeekYear) ?? []).filter(e => e.player_id === player.player_id);
    const ptsByWeek = new Map<number, number>();
    for (const e of myEntries) {
      ptsByWeek.set(e.week, (ptsByWeek.get(e.week) ?? 0) + e.total_points);
    }
    const swingByWeek = new Map<number, number | null>();
    let prev: number | null = null;
    for (const w of [...ptsByWeek.keys()].sort((a, b) => a - b)) {
      const p = ptsByWeek.get(w)!;
      swingByWeek.set(w, prev == null ? null : p - prev);
      prev = p;
    }
    const out = new Map<string, number | null>();
    for (const e of myEntries) {
      out.set(`${e.week}:${e.espn_team_id}`, swingByWeek.get(e.week) ?? null);
    }
    return out;
  }, [boxState, player.player_id, activeWeekYear]);

  const statLinesByYear = useMemo(
    () => (boxState.status === "success" ? getPlayerSeasonStatLines(player.player_id, boxState.data) : new Map()),
    [boxState, player.player_id]
  );
  // Started-vs-bench split per season for the Season by Season Points
  // tooltip. Box-backed lines only -- the backfill-merged map below fabricates
  // countedPoints: points / benchPoints: 0 for stint-less rows, which would
  // render a fake 100% in lineup. Pre-2018 seasons stay null (bench
  // untracked), same convention as the Players Seasons table.
  const lineupSplitByYear = useMemo(() => {
    const out = new Map<number, { counted: number; bench: number }>();
    for (const [year, line] of statLinesByYear) {
      if (year >= LINEUP_SPLIT_FIRST_YEAR) out.set(year, { counted: line.countedPoints, bench: line.benchPoints });
    }
    return out;
  }, [statLinesByYear]);

  const statLinesByYearWithBackfill = useMemo(() => {
    const merged = new Map(statLinesByYear);
    for (const row of playerSeasonBackfill) {
      if (row.player_id !== player.player_id) continue;
      const isTwoWay = row.batting !== null && row.pitching !== null;
      merged.set(row.year, {
        playerId: row.player_id,
        playerName: row.player_name,
        weeksRostered: 0,
        countedPoints: row.points,
        battingCountedPoints: isTwoWay || row.batting !== null ? row.points : 0,
        pitchingCountedPoints: isTwoWay || row.pitching !== null ? row.points : 0,
        benchPoints: 0,
        batting: row.batting,
        pitching: row.pitching,
        ilOnly: false,
        slotSide:
          row.batting !== null ? (row.pitching !== null ? null : "batting") : row.pitching !== null ? "pitching" : null,
      });
    }
    return merged;
  }, [statLinesByYear, playerSeasonBackfill, player.player_id]);

  const seasonPointsWithBackfill = useMemo(
    () =>
      playerSeasonBackfill.length === 0
        ? seasonPoints
        : [
            ...seasonPoints,
            ...playerSeasonBackfill.map(row => ({
              year: row.year,
              player_id: row.player_id,
              player_name: row.player_name,
              points: row.points,
            })),
          ],
    [seasonPoints, playerSeasonBackfill]
  );
  const careerSeries = useMemo(
    () => getPlayerCareerSeries(player.player_id, seasonPointsWithBackfill, percentiles),
    [player, seasonPointsWithBackfill, percentiles]
  );
  // The same series on the card basis. `percentiles` is built from card totals
  // (see Player/index.tsx), so the Season by Season table and the Percentile
  // Rankings strip must both DISPLAY card totals too -- otherwise each row pairs
  // a card-basis percentile with a rostered-point number beside it, which reads
  // as a contradiction whenever the two differ. Both bases are named
  // explicitly (PlayerCardSeasonEntry), so `cardPoints` is what every consumer
  // below reads and the rostered share survives only for the tooltip.
  const cardBasisSeries = useMemo(
    () =>
      careerSeries.map((s): PlayerCardSeasonEntry => ({
        ...s,
        rosteredPoints: s.points,
        cardPoints: cardPointsFor(cardPointsByYearPlayer, s.year, player.player_id, s.points),
      })),
    [careerSeries, cardPointsByYearPlayer, player.player_id]
  );
  const draftHistory = useMemo(
    () =>
      getPlayerDraftHistory(player.player_id, draftPicks, seasonPointsWithBackfill, mrIrrelevantEntries, draftSteals),
    [player, draftPicks, seasonPointsWithBackfill, mrIrrelevantEntries, draftSteals]
  );
  const draftByYear = useMemo(() => new Map(draftHistory.map(h => [h.year, h])), [draftHistory]);
  // Owner -> years this player was drafted (live or kept) to that owner, for
  // the possession chain's From label (shows the draft year). Keyed by owner,
  // not team, so a traded pick still maps to the owner who ended up with it
  // (draft_picks owner_id is that owner).
  const draftYearsByOwner = useMemo(() => {
    const map = new Map<string, Set<number>>();
    for (const dp of draftPicks) {
      if (dp.player_id !== player.player_id) continue;
      const years = map.get(dp.owner_id) ?? new Set<number>();
      years.add(dp.year);
      map.set(dp.owner_id, years);
    }
    return map;
  }, [draftPicks, player.player_id]);
  const transactionCoveredYears = useMemo(() => new Set(transactionYears(seasons)), [seasons]);
  // Most executed trades have no TRADE item on their own ledger row (ESPN
  // prunes the proposal on execution -- see Transaction.items's doc comment),
  // so reading the raw ledger alone silently drops all but 2 of the 11
  // 2019-2025 trades from the possession chain. Merging in trades.json's
  // reconstruction first (same fallback getTradeRegistry uses) recovers them.
  const transactionsWithTrades = useMemo(
    () => mergeTradeItemsIntoTransactions(transactions, trades),
    [transactions, trades]
  );
  const possessionChain = useMemo(
    () =>
      boxState.status === "success"
        ? enrichPossessionChain(
            getPlayerPossessionChain(
              player.player_id,
              boxState.data,
              getPlayerReleaseKeys(player.player_id, transactionsWithTrades),
              transactionsWithTrades
            ),
            player.player_id,
            transactionsWithTrades,
            transactionCoveredYears,
            draftYearsByOwner
          )
        : [],
    [boxState, player.player_id, transactionsWithTrades, transactionCoveredYears, draftYearsByOwner]
  );

  // 1 (SP) and 11 (RP) are this app's only pitcher position ids (positions.ts) --
  // a two-way player (e.g. Ohtani, default_position_id 10/DH) reads as a batter
  // here, so their batting columns show. Which stat columns to render follows
  // ESPN's declared primary position, not how their points were attributed.
  const isPitcher = player.default_position_id === 1 || player.default_position_id === 11;
  const statColumns = isPitcher ? PITCHING_STAT_COLUMNS : BATTING_STAT_COLUMNS;
  // Aggregated once for the whole league, not per stat -- the percentile strip
  // ranks against every rostered player's season line, and re-walking the box
  // scores on every rocker flip would be wasteful.
  const rostersByYear = useMemo(
    () => (boxState.status === "success" ? aggregateRostersByYear(boxState.data) : new Map()),
    [boxState]
  );
  const scoringByYear = useMemo(() => buildScoringByYear(seasons), [seasons]);
  const seasonPositions = useMemo(
    () => getPlayerSeasonPositions(player.player_id, playerSeasons),
    [player.player_id, playerSeasons]
  );
  const positionsByYear = useMemo(() => new Map(seasonPositions.map(sp => [sp.year, sp])), [seasonPositions]);
  const mlbTeamById = useMemo(() => new Map(mlbTeams.map(t => [t.pro_team_id, t])), [mlbTeams]);
  const proTeamIdByYear = useMemo(
    () =>
      new Map(
        draftPicks
          .filter(dp => dp.player_id === player.player_id && dp.pro_team_id !== null)
          .map(dp => [dp.year, dp.pro_team_id as number])
      ),
    [draftPicks, player]
  );
  const manualStints = useMemo(
    () =>
      jerseyOverrides
        .filter(o => o.player_id === player.player_id)
        .map(o => ({
          proTeamId: o.pro_team_id,
          jersey: o.jersey,
          startYear: o.start_year,
          endYear: o.end_year,
          startDate: o.start_date,
          endDate: o.end_date,
        })),
    [jerseyOverrides, player.player_id]
  );
  const jerseyRuns = useMemo(
    () => getJerseyHistory(seasonPositions, proTeamIdByYear, mlbTeamById, manualStints),
    [seasonPositions, proTeamIdByYear, mlbTeamById, manualStints]
  );
  // Ohtani and the pre-universal-DH pitchers who took at-bats: default_position_id
  // only names one side of the ball, so two-way status comes from the stat lines.
  const isTwoWay = isTwoWayPlayer(statLinesByYearWithBackfill);
  const pointsSplitByYear = useMemo(
    () => (isTwoWay ? getPlayerPointsSplit(statLinesByYearWithBackfill, scoringByYear) : new Map()),
    [isTwoWay, statLinesByYearWithBackfill, scoringByYear]
  );

  const seasonRows = useMemo(
    () =>
      cardBasisSeries.map(s => {
        const draftRow = draftByYear.get(s.year);
        // Every owner that rostered this player during the season: the drafting
        // owner (if any) plus every owner from the possession chain whose run
        // overlaps the season. Drafted players who were later traded or dropped
        // previously showed only the drafting owner; this union keeps the Owner
        // column consistent with waiver/trade arrivals.
        const runsThisYear = possessionChain.filter(run => run.startYear <= s.year && run.endYear >= s.year);
        const runOwnerIds = Array.from(new Set(runsThisYear.map(run => run.ownerId)));
        const ownerIds = Array.from(new Set([...(draftRow ? [draftRow.ownerId] : []), ...runOwnerIds]));
        // The team-season this owner held the player on, so the name can link
        // to that roster. Null when no box-score run names one (an uncovered
        // year, or a drafted player who never appeared in a box score).
        const teamIdFor = (ownerId: string) => runsThisYear.find(run => run.ownerId === ownerId)?.espnTeamId ?? null;
        const ownerRefs = ownerIds.map(id => ({ ...ownerRef(owners, id), espnTeamId: teamIdFor(id) }));
        return {
          ...s,
          ownerRefs,
          statusLabel: draftRow ? (draftRow.isKeeper ? "Kept" : "Drafted") : "Waiver/trade",
          draftPosition: draftRow && !draftRow.isKeeper ? `Pick ${draftRow.overallPickNumber}` : null,
          statLine: statLinesByYearWithBackfill.get(s.year),
          split: pointsSplitByYear.get(s.year),
          lineupSplit: lineupSplitByYear.get(s.year) ?? null,
        };
      }),
    [
      cardBasisSeries,
      draftByYear,
      owners,
      statLinesByYearWithBackfill,
      possessionChain,
      pointsSplitByYear,
      lineupSplitByYear,
    ]
  );
  type SeasonRow = (typeof seasonRows)[number];

  function seasonRowSortValue(row: SeasonRow, key: string): number | string {
    switch (key) {
      case "year":
        return row.year;
      case "owner":
        return row.ownerRefs.map(o => o.name).join(", ");
      case "status":
        return row.statusLabel;
      case "points":
        return row.cardPoints;
      case "batPoints":
        return row.split?.batting ?? -Infinity;
      case "pitPoints":
        return row.split?.pitching ?? -Infinity;
      case "percentile":
        return row.percentile ?? -1;
      case "yoy":
        return row.percentileChange ?? -Infinity;
      default:
        return statColumns.find(c => c.key === key)?.sortValue(row.statLine) ?? -1;
    }
  }

  const {
    sorted: sortedSeasonRows,
    sortKey: seasonSortKey,
    direction: seasonDirection,
    toggleSort: toggleSeasonSort,
  } = useSortableRows<SeasonRow, string>(seasonRows, seasonRowSortValue, "year", "desc");

  type PossessionRow = (typeof possessionChain)[number];
  function possessionSortValue(row: PossessionRow, key: string): number | string {
    switch (key) {
      case "owner":
        return ownerRef(owners, row.ownerId).name;
      case "from":
        return row.startYear * 100 + row.startWeek;
      case "to":
        return row.endYear * 100 + row.endWeek;
      default:
        return 0;
    }
  }
  const {
    sorted: sortedPossessionChain,
    sortKey: possessionSortKey,
    direction: possessionDirection,
    toggleSort: togglePossessionSort,
  } = useSortableRows<PossessionRow, string>(possessionChain, possessionSortValue, "from", "desc");

  const careerPoints = useMemo(() => cardBasisSeries.reduce((sum, s) => sum + s.cardPoints, 0), [cardBasisSeries]);
  const yearRuns = getYearRuns(careerYears);
  // Career halves only cover the stat-line years, so they deliberately don't
  // have to add up to careerPoints -- labelled "since 2019" alongside.
  const careerSplit = useMemo(() => {
    let batting = 0;
    let pitching = 0;
    for (const s of pointsSplitByYear.values()) {
      batting += s.batting ?? 0;
      pitching += s.pitching ?? 0;
    }
    return { batting, pitching };
  }, [pointsSplitByYear]);

  return (
    // overflow-x-clip: absolute popovers (jersey tooltips) must never widen
    // the document on narrow screens — the page has no horizontal scroll by
    // design; vertical layout and Board-internal scrolling are unaffected.
    <div className="overflow-x-clip">
      <div className="mb-6">
        <Link to="/players" className="text-xs text-ink-faint hover:underline">
          ← Players
        </Link>
        <div className="mt-2 flex items-start gap-3.5">
          <Headshot playerId={player.player_id} playerName={player.full_name} size={72} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold">{player.full_name}</h2>
              <span className="text-sm font-semibold text-ink-faint">{positionLabel(player.default_position_id)}</span>
              <JerseyHistory runs={jerseyRuns} />
            </div>
            <div className="mt-1 text-xs text-ink-faint tabular-nums">
              {formatPoints(careerPoints)} career pts ·{" "}
              {yearRuns.map(r => (r.start === r.end ? String(r.start) : `${r.start}–${r.end}`)).join(", ") ||
                "no MLB seasons on record"}
            </div>
            {isTwoWay && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-faint tabular-nums">
                <span>
                  {formatPoints(careerSplit.batting)} batting · {formatPoints(careerSplit.pitching)} pitching
                </span>
                <CoverageBadge seasons={seasons} domain="stat_lines" />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-10">
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <SectionHeading>{viewMode === "week" ? "Week by Week" : "Season by Season"}</SectionHeading>
              {viewMode === "week" && activeWeekYear != null && (
                <>
                  <FilterSelect
                    value={activeWeekYear}
                    onChange={e => setWeekYearPref(Number(e.target.value))}
                    aria-label="Select season for week-by-week stats">
                    {[...weekYearOptions].reverse().map(y => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </FilterSelect>
                  <CoverageBadge seasons={seasons} domain="box_scores" />
                </>
              )}
            </div>
            {weekYearOptions.length > 0 && (
              <SegmentedToggle
                ariaLabel="Stats view mode"
                value={viewMode}
                onChange={setViewMode}
                options={[
                  { key: "season", label: "Season" },
                  { key: "week", label: "Week" },
                ]}
              />
            )}
          </div>
          <PartialCoverageNote failedYears={failedBoxScoreYears} />
          {viewMode === "week" ? (
            activeWeekYear != null && (
              <>
                {boxState.status === "loading" && <p className="text-ink-dim">Loading box scores…</p>}
                {boxState.status === "error" && (
                  <p className="text-ink-dim">Couldn't load box scores. Try refreshing the page.</p>
                )}
                {boxState.status === "success" &&
                  (weekRows.length === 0 ? (
                    <p className="text-sm text-ink-dim">No box-score activity for this season.</p>
                  ) : (
                    <>
                      <PlayerWeekTable
                        entries={weekRows}
                        year={activeWeekYear}
                        pctByWeek={weekPctByWeek}
                        wowByWeek={weekWowByWeek}
                        showStats={weekShowStats}
                        showSlots={weekShowSlots}
                      />
                      <p className="mt-2 text-[0.66rem] text-ink-faint">
                        Points is all production that week while on a roster, started and benched alike; Bench is the
                        share of it that never counted toward a team score. Percentile ranks the week against every
                        player-week in the league that season; WoW is this week's points minus the prior week's. A
                        mid-season signing's first week covers only the days he was rostered. Click a week for that
                        matchup's full box score.
                      </p>
                    </>
                  ))}
              </>
            )
          ) : (
            <>
              {cardBasisSeries.length === 0 ? (
                <p className="text-sm text-ink-dim">No scored seasons on record.</p>
              ) : (
                <Board maxHeight={TEN_ROWS}>
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        <SortHeader
                          label="Year"
                          sortKey="year"
                          activeKey={seasonSortKey}
                          direction={seasonDirection}
                          onSort={toggleSeasonSort}
                          align="center"
                        />
                        <SortHeader
                          label="Points"
                          sortKey="points"
                          activeKey={seasonSortKey}
                          direction={seasonDirection}
                          onSort={toggleSeasonSort}
                          align="center"
                          tooltip="Full-season total. Hover for starting lineup split."
                        />
                        {isTwoWay && (
                          <>
                            <SortHeader
                              label="Batting"
                              sortKey="batPoints"
                              activeKey={seasonSortKey}
                              direction={seasonDirection}
                              onSort={toggleSeasonSort}
                              align="center"
                            />
                            <SortHeader
                              label="Pitching"
                              sortKey="pitPoints"
                              activeKey={seasonSortKey}
                              direction={seasonDirection}
                              onSort={toggleSeasonSort}
                              align="center"
                            />
                          </>
                        )}
                        <SortHeader
                          label="Percentile"
                          sortKey="percentile"
                          activeKey={seasonSortKey}
                          direction={seasonDirection}
                          onSort={toggleSeasonSort}
                          align="center"
                        />
                        <SortHeader
                          label="YoY"
                          sortKey="yoy"
                          activeKey={seasonSortKey}
                          direction={seasonDirection}
                          onSort={toggleSeasonSort}
                          align="center"
                        />
                        {statColumns.map(col => (
                          <SortHeader
                            key={col.key}
                            label={col.label}
                            sortKey={col.key}
                            activeKey={seasonSortKey}
                            direction={seasonDirection}
                            onSort={toggleSeasonSort}
                            align="center"
                          />
                        ))}
                        <th
                          scope="col"
                          className="text-eyebrow sticky top-0 z-10 bg-surface px-3 py-2 text-center font-semibold tracking-wide text-ink-faint">
                          Position
                        </th>
                        <SortHeader
                          label="Status"
                          sortKey="status"
                          activeKey={seasonSortKey}
                          direction={seasonDirection}
                          onSort={toggleSeasonSort}
                          align="left"
                        />
                        <SortHeader
                          label="Owner"
                          sortKey="owner"
                          activeKey={seasonSortKey}
                          direction={seasonDirection}
                          onSort={toggleSeasonSort}
                          align="left"
                        />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedSeasonRows.map((s, i) => (
                        <tr key={s.year} className="border-t border-border hover:bg-surface-2">
                          <td className="px-3 py-2 text-center font-semibold tabular-nums">{s.year}</td>
                          <td
                            className="px-3 py-2 text-center font-semibold tabular-nums"
                            title={pointsTooltip(s, s.year)}>
                            {formatPoints(s.cardPoints)}
                          </td>
                          {isTwoWay && (
                            <>
                              <td className="px-3 py-2 text-center text-ink-dim tabular-nums">
                                {s.split?.batting == null ? "—" : formatPoints(s.split.batting)}
                              </td>
                              <td className="px-3 py-2 text-center text-ink-dim tabular-nums">
                                {s.split?.pitching == null ? "—" : formatPoints(s.split.pitching)}
                              </td>
                            </>
                          )}
                          <td className="px-3 py-2 text-center text-ink-dim tabular-nums">
                            {s.percentile !== null ? formatOrdinal(s.percentile) : "—"}
                          </td>
                          <td className="px-3 py-2 text-center font-semibold tabular-nums">
                            {s.percentileChange === null ? (
                              <span className="text-ink-faint">—</span>
                            ) : (
                              <span className={s.percentileChange >= 0 ? "text-diverge-pos" : "text-diverge-neg"}>
                                {formatPercentileChange(s.percentileChange)}
                              </span>
                            )}
                          </td>
                          {statColumns.map(col => (
                            <td key={col.key} className="px-3 py-2 text-center text-ink-dim tabular-nums">
                              {col.value(s.statLine)}
                            </td>
                          ))}
                          <td className="px-3 py-2">
                            <SeasonPositionsCell positions={positionsByYear.get(s.year)} openDown={i === 0} />
                          </td>
                          <td className="px-3 py-2 text-ink-dim">
                            {s.statusLabel === "Kept" ? (
                              <span className="rounded-full bg-gold-soft px-2 py-0.5 text-[0.64rem] font-bold text-gold">
                                Kept
                              </span>
                            ) : s.statusLabel === "Drafted" ? (
                              <span className="whitespace-nowrap tabular-nums">{s.draftPosition}</span>
                            ) : (
                              <span className="text-ink-faint whitespace-nowrap">Waiver/trade</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-ink-dim">
                            {s.ownerRefs.length === 0 ? (
                              <span className="text-ink-faint">—</span>
                            ) : (
                              <TickerText className="max-w-xs">
                                {s.ownerRefs.map((o, i) => (
                                  <span key={o.ownerId}>
                                    {i > 0 && ", "}
                                    {o.espnTeamId === null ? (
                                      <OwnerLink owners={owners} ownerId={o.ownerId} />
                                    ) : (
                                      <Link
                                        to={`/season/${s.year}/team/${o.espnTeamId}`}
                                        title={`${o.name}'s ${s.year} roster`}
                                        className="hover:underline">
                                        {o.name}
                                      </Link>
                                    )}
                                  </span>
                                ))}
                              </TickerText>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Board>
              )}
              <p className="mt-2 text-[0.66rem] text-ink-faint">
                {isTwoWay &&
                  "Percentile and YoY rank the combined batting+pitching total against the whole league's single-side totals, so they run structurally high; Percentile Rankings below shows each side against its own field."}
              </p>
            </>
          )}
        </section>

        <PercentileBySeason
          series={cardBasisSeries}
          seasonPoints={cardBasisSeasonPoints}
          positionByPlayerSeason={positionByPlayerSeason}
          seasonPositions={seasonPositions}
          rostersByYear={rostersByYear}
          statLinesByYear={statLinesByYearWithBackfill}
          playerId={player.player_id}
          defaultPositionId={player.default_position_id}
          isPitcher={isPitcher}
          isTwoWay={isTwoWay}
          scoringByYear={scoringByYear}
          boxScoresLoading={boxState.status === "loading"}
          seasons={seasons}
        />

        <section>
          <div className="mb-3 flex items-center gap-2">
            <SectionHeading>Possession Chain</SectionHeading>
            <CoverageBadge seasons={seasons} domain="box_scores" />
          </div>
          <p className="mb-3 max-w-2xl text-xs text-ink-faint">
            A dash under "To" means their most recent owner still has them.
          </p>
          {boxScoreYears.length === 0 ? (
            <p className="text-sm text-ink-dim">No box-score-covered seasons for this player.</p>
          ) : (
            <>
              {boxState.status === "loading" && <p className="text-ink-dim">Loading box scores…</p>}
              {boxState.status === "error" && (
                <p className="text-ink-dim">Couldn't load box scores. Try refreshing the page.</p>
              )}
              {boxState.status === "success" &&
                (possessionChain.length === 0 ? (
                  <p className="text-sm text-ink-dim">No box-score activity.</p>
                ) : (
                  <Board maxHeight={TEN_ROWS}>
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          <SortHeader
                            label="Owner"
                            sortKey="owner"
                            activeKey={possessionSortKey}
                            direction={possessionDirection}
                            onSort={togglePossessionSort}
                            align="left"
                          />
                          <SortHeader
                            label="From"
                            sortKey="from"
                            activeKey={possessionSortKey}
                            direction={possessionDirection}
                            onSort={togglePossessionSort}
                            align="left"
                          />
                          <SortHeader
                            label="To"
                            sortKey="to"
                            activeKey={possessionSortKey}
                            direction={possessionDirection}
                            onSort={togglePossessionSort}
                            align="left"
                          />
                          <th
                            scope="col"
                            className="text-eyebrow sticky top-0 z-10 bg-surface px-3 py-2 text-left font-semibold tracking-wide text-ink-faint uppercase">
                            How
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedPossessionChain.map((run, i) => (
                          <tr key={i} className="border-t border-border hover:bg-surface-2">
                            <td className="px-3 py-2 font-semibold">
                              <OwnerLink owners={owners} ownerId={run.ownerId} />
                            </td>
                            <td className="px-3 py-2 text-left text-ink-dim tabular-nums">
                              {run.draftedToTeam ? (
                                <span className="text-ink-faint">{run.startYear} draft</span>
                              ) : (
                                `${run.startYear} Wk ${run.startWeek}`
                              )}
                            </td>
                            <td className="px-3 py-2 text-left text-ink-dim tabular-nums">
                              {run.isOngoing ? (
                                <span className="text-ink-faint">—</span>
                              ) : run.endYear === run.startYear ? (
                                `Wk ${run.endWeek}`
                              ) : (
                                `${run.endYear} Wk ${run.endWeek}`
                              )}
                            </td>
                            <td className="px-3 py-2 text-xs text-ink-faint">
                              {run.acquiredVia === null && run.releasedVia === null ? (
                                <span>—</span>
                              ) : (
                                <span className="flex flex-wrap gap-x-1.5">
                                  {run.acquiredVia && (
                                    <span>
                                      via {run.acquiredVia}
                                      {run.acquiredWeek !== null && ` wk ${run.acquiredWeek}`}
                                    </span>
                                  )}
                                  {run.acquiredVia && run.releasedVia && <span aria-hidden="true">·</span>}
                                  {run.releasedVia && (
                                    <span>
                                      {run.releasedVia}
                                      {run.releasedWeek !== null && ` wk ${run.releasedWeek}`}
                                    </span>
                                  )}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Board>
                ))}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
