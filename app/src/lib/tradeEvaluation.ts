import { computeLetterGrade, isFairTrade, type LetterGrade } from "./playerComparison";
import { UNKNOWN_OWNER_ID, type TradeEntry } from "./trades";
import type { Keeper, PlayerTeamSeasonPoints } from "../types";

/**
 * Retrospective trade grading — what each side actually got, years later.
 *
 * Value is measured as points the acquired players produced FOR THE OWNER WHO
 * ACQUIRED THEM, which `player_team_season_points.json` already splits out by
 * roster possession. That split is the whole reason this file needs no week
 * arithmetic; see `computeRestOfSeasonPoints` below.
 */

/**
 * Whether a trade executed inside the season or outside it.
 *
 * A label, not an input to the points math — the per-owner split makes the
 * distinction irrelevant to valuation. Retained because a pick trade genuinely
 * has no in-season week, and the UI says so.
 */
export type TradeContext = "offseason" | "in-season";

/** Picks carry no week; a ledger row dated outside a matchup week also reads
 * null, so this is a presentation label rather than a valuation input. */
export function getTradeContext(entry: Pick<TradeEntry, "kind" | "week">): TradeContext {
  return entry.kind === "pick" ? "offseason" : "in-season";
}

export interface TradeEvaluationIndex {
  /** Points a player produced for one owner in one season, keyed
   * "year:player_id:owner_id". */
  pointsByPlayerOwnerYear: Map<string, number>;
  /** Years an owner kept a player, keyed "player_id:owner_id", ascending. */
  keeperYearsByPlayerOwner: Map<string, number[]>;
}

/**
 * Build the per-player/per-owner index once, outside any per-trade loop.
 *
 * `player_team_season_points.json` is 9,506 rows and `keepers.json` 849; the
 * trade ledger is tiny by comparison, so re-scanning either per trade is pure
 * waste.
 */
export function buildTradeEvaluationIndex(
  playerTeamSeasonPoints: PlayerTeamSeasonPoints[],
  keepers: Keeper[]
): TradeEvaluationIndex {
  const pointsByPlayerOwnerYear = new Map<string, number>();
  for (const row of playerTeamSeasonPoints) {
    pointsByPlayerOwnerYear.set(`${row.year}:${row.player_id}:${row.owner_id}`, row.points);
  }

  const keeperYearsByPlayerOwner = new Map<string, number[]>();
  for (const keeper of keepers) {
    const key = `${keeper.player_id}:${keeper.owner_id}`;
    const years = keeperYearsByPlayerOwner.get(key) ?? [];
    years.push(keeper.year);
    keeperYearsByPlayerOwner.set(key, years);
  }
  for (const years of keeperYearsByPlayerOwner.values()) years.sort((a, b) => a - b);

  return { pointsByPlayerOwnerYear, keeperYearsByPlayerOwner };
}

/**
 * Points a player produced for one owner in one season.
 *
 * This IS the rest-of-season value, with no week arithmetic: the archive splits
 * each player-season by roster possession, so an owner's row already excludes
 * everything the player scored for anyone else. All 1,419 multi-owner splits
 * sum exactly to the season total, and 304 player-seasons span 3-5 owners —
 * traded-back and waiver-churn cases a single cutoff week would get wrong.
 *
 * Returns null when no row exists — the player never produced for that owner at
 * all — which is distinct from a real recorded 0.0 (111 such rows exist: the
 * player was rostered and scored nothing). Callers summing a package coerce
 * with `?? 0`; callers displaying a single figure should show "no data" rather
 * than a fabricated zero. Same convention as `getPlayerSeasonPoints`.
 */
export function computeRestOfSeasonPoints(
  playerId: number,
  tradeYear: number,
  ownerAfterTrade: string,
  index: TradeEvaluationIndex
): number | null {
  return index.pointsByPlayerOwnerYear.get(`${tradeYear}:${playerId}:${ownerAfterTrade}`) ?? null;
}

/**
 * Rest-of-season value plus every season the acquiring owner went on to keep
 * the player.
 *
 * The chain follows CONSECUTIVE keeper years under the same owner and stops at
 * the first break: a player kept 2020-2022, lost, then re-acquired in 2025 only
 * credits this trade with 2020-2022. Gerrit Cole ran ten straight years under
 * one owner, so the chain is worth walking rather than capping.
 *
 * Null when no season in the chain has a points row at all, preserving the
 * "never produced for this owner" state; a real 0.0 anywhere in the chain makes
 * the total a number.
 */
export function computeRestOfSeasonValueWithKeepers(
  playerId: number,
  tradeYear: number,
  ownerAfterTrade: string,
  index: TradeEvaluationIndex,
  coverageYears?: Set<number>
): number | null {
  const seasonValues: number[] = [];

  const tradeYearPoints = computeRestOfSeasonPoints(playerId, tradeYear, ownerAfterTrade, index);
  if (tradeYearPoints !== null) seasonValues.push(tradeYearPoints);

  const keeperYears = index.keeperYearsByPlayerOwner.get(`${playerId}:${ownerAfterTrade}`) ?? [];
  let expected = tradeYear + 1;
  for (const year of keeperYears) {
    if (year < expected) continue;
    if (year > expected) break;
    if (coverageYears && !coverageYears.has(year)) break;
    const kept = computeRestOfSeasonPoints(playerId, year, ownerAfterTrade, index);
    if (kept !== null) seasonValues.push(kept);
    expected = year + 1;
  }

  return seasonValues.length === 0 ? null : seasonValues.reduce((sum, v) => sum + v, 0);
}

export interface TradeGradePlayer {
  playerId: number;
  playerName: string;
  /** Points produced for the owner who acquired this player, keeper years
   * included. Null when the player never produced for that owner at all —
   * distinct from a real 0.0. */
  pointsReceived: number | null;
}

export interface TradeGrade {
  tradeKey: string;
  year: number;
  week: number | null;
  context: TradeContext;
  ownerA: string;
  ownerB: string;
  /** What owner A received (the assets owner B gave up), and vice versa. */
  sideAPlayers: TradeGradePlayer[];
  sideBPlayers: TradeGradePlayer[];
  sideATotalPoints: number;
  sideBTotalPoints: number;
  /** Positive favors owner A. */
  surplus: number;
  letterGrade: LetterGrade;
  isFair: boolean;
}

/** An executed trade whose player exchange no source recovered. Listed rather
 * than dropped: omitting these would make the league's trade history look
 * smaller than it was. */
export interface UngradedTrade {
  tradeKey: string;
  year: number;
  week: number | null;
  participantOwnerIds: string[];
  reason: "exchange-unknown" | "single-sided" | "multi-party";
}

export interface TradeGradeResult {
  graded: TradeGrade[];
  ungraded: UngradedTrade[];
}

/**
 * Grade every trade the registry can evidence.
 *
 * Takes `TradeEntry[]` (the unified pick+player registry) rather than raw
 * `Trade[]` so picks and players grade through one path — a traded pick's value
 * is what the pick became, which is exactly what the registry already resolved.
 *
 * Trades are graded from the perspective of the two owners involved. A side's
 * value is what it RECEIVED: the assets the other side gave up.
 */
export function gradeAllTrades(
  entries: TradeEntry[],
  index: TradeEvaluationIndex,
  coverageYears?: Set<number>
): TradeGradeResult {
  const byTrade = new Map<string, TradeEntry[]>();
  for (const entry of entries) {
    const bucket = byTrade.get(entry.tradeKey);
    if (bucket) bucket.push(entry);
    else byTrade.set(entry.tradeKey, [entry]);
  }

  const graded: TradeGrade[] = [];
  const ungraded: UngradedTrade[] = [];

  for (const [tradeKey, assets] of byTrade) {
    const first = assets[0];

    // Skip years without full box-score coverage; grading relies on rest-of-season
    // points derived from weekly box scores.
    if (coverageYears && !coverageYears.has(first.year)) continue;

    // Nothing to grade: ESPN pruned the exchange when the trade executed.
    if (first.kind === "unrecorded") {
      ungraded.push({
        tradeKey,
        year: first.year,
        week: first.week,
        participantOwnerIds: first.participantOwnerIds,
        reason: "exchange-unknown",
      });
      continue;
    }

    // Group assets by the owner who GAVE them up.
    const bySurrenderingOwner = new Map<string, TradeEntry[]>();
    for (const asset of assets) {
      const bucket = bySurrenderingOwner.get(asset.fromOwnerId);
      if (bucket) bucket.push(asset);
      else bySurrenderingOwner.set(asset.fromOwnerId, [asset]);
    }

    const owners = [...bySurrenderingOwner.keys()].filter(o => o !== UNKNOWN_OWNER_ID).sort();
    if (owners.length < 2) {
      // Also catches a lone-asset trade whose counterparty was a non-trade
      // asset (a collateral drop). Investigate via this list rather than
      // expecting a clean grade.
      ungraded.push({
        tradeKey,
        year: first.year,
        week: first.week,
        participantOwnerIds: first.participantOwnerIds,
        reason: "single-sided",
      });
      continue;
    }

    // A/B grading cannot express a three-way deal: assets the third owner gave
    // up would belong to no side, and the two graded sides would be scored
    // against a partial exchange. The archive holds none today, but
    // getTradeRegistry deliberately preserves every participant
    // (trades.ts:195-202), so this reports rather than silently drops.
    if (owners.length > 2) {
      ungraded.push({
        tradeKey,
        year: first.year,
        week: first.week,
        participantOwnerIds: first.participantOwnerIds,
        reason: "multi-party",
      });
      continue;
    }

    const [ownerA, ownerB] = owners;

    // Owner A RECEIVED what owner B surrendered.
    const toPlayers = (surrendered: TradeEntry[], receivingOwner: string): TradeGradePlayer[] =>
      surrendered
        .filter(asset => asset.playerId !== null)
        .map(asset => ({
          playerId: asset.playerId!,
          playerName: asset.playerName,
          pointsReceived: computeRestOfSeasonValueWithKeepers(
            asset.playerId!,
            asset.year,
            receivingOwner,
            index,
            coverageYears
          ),
        }));

    const sideAPlayers = toPlayers(bySurrenderingOwner.get(ownerB) ?? [], ownerA);
    const sideBPlayers = toPlayers(bySurrenderingOwner.get(ownerA) ?? [], ownerB);

    // A package's total coerces missing rows to 0: an asset that produced
    // nothing for its new owner contributes nothing, which is the right
    // arithmetic even though the per-player figure stays null for display.
    const sideATotalPoints = sideAPlayers.reduce((sum, p) => sum + (p.pointsReceived ?? 0), 0);
    const sideBTotalPoints = sideBPlayers.reduce((sum, p) => sum + (p.pointsReceived ?? 0), 0);

    graded.push({
      tradeKey,
      year: first.year,
      week: first.week,
      context: getTradeContext(first),
      ownerA,
      ownerB,
      sideAPlayers,
      sideBPlayers,
      sideATotalPoints,
      sideBTotalPoints,
      surplus: sideATotalPoints - sideBTotalPoints,
      letterGrade: computeLetterGrade(sideATotalPoints, sideBTotalPoints),
      isFair: isFairTrade(sideATotalPoints, sideBTotalPoints),
    });
  }

  graded.sort((a, b) => b.year - a.year || (b.week ?? -1) - (a.week ?? -1) || a.tradeKey.localeCompare(b.tradeKey));
  ungraded.sort((a, b) => b.year - a.year || (b.week ?? -1) - (a.week ?? -1) || a.tradeKey.localeCompare(b.tradeKey));

  return { graded, ungraded };
}

export interface SeasonValuePoint {
  year: number;
  points: number;
}

/**
 * Rest-of-season value broken out by season, for the detail modal's cumulative
 * chart. Follows the same consecutive-owner keeper chain as
 * `computeRestOfSeasonValueWithKeepers`; the chart is only meant to appear when
 * a chain exists (the caller checks `length > 1`).
 */
export function computeRestOfSeasonValueSeries(
  playerId: number,
  tradeYear: number,
  ownerAfterTrade: string,
  index: TradeEvaluationIndex,
  coverageYears?: Set<number>
): SeasonValuePoint[] {
  const seasonValues: SeasonValuePoint[] = [];

  const tradeYearPoints = computeRestOfSeasonPoints(playerId, tradeYear, ownerAfterTrade, index);
  if (tradeYearPoints !== null) seasonValues.push({ year: tradeYear, points: tradeYearPoints });

  const keeperYears = index.keeperYearsByPlayerOwner.get(`${playerId}:${ownerAfterTrade}`) ?? [];
  let expected = tradeYear + 1;
  for (const year of keeperYears) {
    if (year < expected) continue;
    if (year > expected) break;
    if (coverageYears && !coverageYears.has(year)) break;
    const kept = computeRestOfSeasonPoints(playerId, year, ownerAfterTrade, index);
    if (kept !== null) seasonValues.push({ year, points: kept });
    expected = year + 1;
  }

  return seasonValues;
}

export interface SurplusHistogramBucket {
  label: string;
  count: number;
}

/**
 * Bins trade surpluses for the symmetry section's histogram. Signed toward
 * owner A, so positive buckets are "owner A won", negative "owner B won". The
 * range is centered on zero so the "fair" column sits in the middle of the
 * chart, and bucket labels carry the sign diff they represent.
 */
export function computeSurplusHistogram(grades: TradeGrade[], bucketCount = 7): SurplusHistogramBucket[] {
  if (grades.length === 0) return [];

  const rawMax = Math.max(...grades.map(g => Math.abs(g.surplus)));
  if (rawMax === 0) return [{ label: "near 0 (fair)", count: grades.length }];

  const width = (2 * rawMax) / bucketCount;
  const buckets: SurplusHistogramBucket[] = Array.from({ length: bucketCount }, (_, i) => {
    const low = -rawMax + width * i;
    return { label: formatSurplusBucket(low, low + width), count: 0 };
  });

  for (const grade of grades) {
    let index = Math.floor((grade.surplus + rawMax) / width);
    index = Math.max(0, Math.min(bucketCount - 1, index));
    buckets[index].count += 1;
  }

  return buckets;
}

function formatSurplusBucket(low: number, high: number): string {
  const fmt = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n)}`;
  // The one bucket that straddles zero; "fair" is a better read than "-0 to +0".
  if (low < 0 && high > 0) {
    return "near 0 (fair)";
  }
  return `${fmt(low)} to ${fmt(high)}`;
}

export interface OwnerTradeSymmetry {
  totalTrades: number;
  fairTrades: number;
  oneSidedTrades: number;
  fairTradePercentage: number;
  /** Average surplus from that owner's point of view: positive means they
   * tended to win their trades, negative means they tended to lose. */
  averageSurplus: number;
}

export interface TradeSymmetryStats {
  totalTrades: number;
  fairTrades: number;
  oneSidedTrades: number;
  fairTradePercentage: number;
  /** Plain object, not a Map: a Map breaks referential-equality checks inside
   * useMemo/React.memo, and every comparable shape in the codebase
   * (getOwnerActivity, Team.transactions) is a Record. */
  byOwner: Record<string, OwnerTradeSymmetry>;
}

/** How often trades land close to even, league-wide and per owner. */
export function computeTradeSymmetry(grades: TradeGrade[]): TradeSymmetryStats {
  const byOwner: Record<string, OwnerTradeSymmetry> = {};
  const surplusSumByOwner = new Map<string, number>();

  const bump = (ownerId: string, fair: boolean, surplus: number) => {
    const current = byOwner[ownerId] ?? {
      totalTrades: 0,
      fairTrades: 0,
      oneSidedTrades: 0,
      fairTradePercentage: 0,
      averageSurplus: 0,
    };
    current.totalTrades += 1;
    if (fair) current.fairTrades += 1;
    else current.oneSidedTrades += 1;
    current.fairTradePercentage = (current.fairTrades / current.totalTrades) * 100;
    byOwner[ownerId] = current;
    surplusSumByOwner.set(ownerId, (surplusSumByOwner.get(ownerId) ?? 0) + surplus);
  };

  let fairTrades = 0;
  for (const grade of grades) {
    if (grade.isFair) fairTrades += 1;
    bump(grade.ownerA, grade.isFair, grade.surplus);
    bump(grade.ownerB, grade.isFair, -grade.surplus);
  }

  for (const ownerId in byOwner) {
    const sum = surplusSumByOwner.get(ownerId) ?? 0;
    byOwner[ownerId].averageSurplus = byOwner[ownerId].totalTrades > 0 ? sum / byOwner[ownerId].totalTrades : 0;
  }

  const totalTrades = grades.length;
  return {
    totalTrades,
    fairTrades,
    oneSidedTrades: totalTrades - fairTrades,
    fairTradePercentage: totalTrades === 0 ? 0 : (fairTrades / totalTrades) * 100,
    byOwner,
  };
}
