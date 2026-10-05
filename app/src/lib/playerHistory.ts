import { aggregateSeasonRoster, type SeasonPlayerLine } from "./boxScore";
import { matchesPositionScope } from "./positions";
import { splitLinePoints, type CategoryPoints, type ScoringByYear } from "./pointsSplit";
import { getSeasonPercentile, percentileWithin } from "./stats";
import { isBindingTransaction } from "./transactions";
import type {
  BoxScoreEntry,
  DraftPick,
  Keeper,
  PlayerSeason,
  PlayerSeasonBackfill,
  PlayerSeasonPoints,
  Transaction,
} from "../types";

/**
 * "Around the Horn" player-history derivations -- everything a single
 * player's history card needs, computed here at load time from
 * player_season_points.json and box_scores/*.json. Draft/keeper history
 * reuses draft.ts's getPlayerDraftHistory directly rather than duplicating it
 * here, since draft_picks.json already carries a `keeper` flag on every row
 * (live picks and keeper renewals both appear there).
 */

export interface PlayerCareerSeasonEntry {
  year: number;
  points: number;
  /** This season's percentile rank (0-100, higher = better) among that
   * year's whole field of scored players -- stats.ts's buildSeasonPercentiles,
   * the app's resolved answer to comparing fantasy points across seasons that
   * ran different scoring rules. Null when the year's field was too thin to
   * rank within. For a two-way player's batting+pitching seasons this ranks
   * the combined total against the whole single-side league, so it runs
   * structurally high -- the Percentile by Season section below the table is
   * the fair side-scoped version of the same comparison. */
  percentile: number | null;
  /** percentile minus the *immediately preceding calendar year's* percentile
   * -- null both when either side has no percentile and when the prior row
   * in this player's own history isn't actually the prior year (a gap season
   * with no scored points at all breaks the comparison, same as the Keeper
   * Heat Index's rule). */
  percentileChange: number | null;
}

/** One player's full career, oldest first: every season they have a scored
 * point total for for player_season_points.json, with the percentile-based
 * year-over-year swing already computed. Two-way seasons (a player both
 * batting and pitching, e.g. Ohtani) rank like any other season here -- the
 * combined total against the whole league -- while the Percentile by Season
 * section below the table additionally offers the side-scoped ranking. */
export function getPlayerCareerSeries(
  playerId: number,
  seasonPoints: PlayerSeasonPoints[],
  percentiles: Map<string, number>
): PlayerCareerSeasonEntry[] {
  const rows = seasonPoints.filter(r => r.player_id === playerId).sort((a, b) => a.year - b.year);

  let priorYear: number | null = null;
  let priorPercentile: number | null = null;

  return rows.map(r => {
    const percentile = getSeasonPercentile(percentiles, r.year, playerId);
    const comparablePrior = priorYear !== null && r.year === priorYear + 1 ? priorPercentile : null;
    const percentileChange = percentile === null || comparablePrior === null ? null : percentile - comparablePrior;
    priorYear = r.year;
    priorPercentile = percentile;
    return { year: r.year, points: r.points, percentile, percentileChange };
  });
}

/** One season of a player's career expressed on BOTH point bases, the shape
 * every card-total consumer wants. `points` is OMITTED rather than shadowed: on
 * the base entry it means ROSTERED, and carrying it here alongside an identical
 * `rosteredPoints` would leave three numbers and two of them the same. Omitting
 * it also means a `PlayerCareerSeasonEntry` can never be passed where a card
 * figure is expected — TypeScript rejects it because `cardPoints` is absent. */
export interface PlayerCardSeasonEntry extends Omit<PlayerCareerSeasonEntry, "points"> {
  /** ESPN's full-season card total — what to display and rank. */
  cardPoints: number;
  /** The rostered share, carried so `pointsTooltip` can take the row as-is. */
  rosteredPoints: number;
}

/**
 * The seasons that make up this player's actual career, ascending — the answer
 * to "how long was this player active?", NOT `Player.seasons_seen`.
 *
 * `seasons_seen` is every year ESPN listed the player in its pool, which
 * includes pure draft-eligible minor-league years with no MLB games and no
 * fantasy activity: James Wood reads 2022-2026 off it despite debuting in 2024,
 * Jordan Walker 2021-2026 despite debuting in 2023.
 *
 * Evidence of real activity in a year: MLB games above zero in
 * `player_seasons.json` (all-zero maps, which ESPN emits for a year the player
 * never played, don't count), scored points in `player_season_points.json` or a
 * `player_season_backfill.json` row, or a draft/keeper pick (the only trace for
 * a season-long injury, and the only one at all pre-2010).
 *
 * **Only the LEADING pool years are trimmed.** `games_played_by_position`
 * coverage is ~56-66% per year, so a year with no evidence usually means "ESPN
 * didn't report it" rather than "the player didn't play" — requiring evidence
 * per-year tore holes in real careers (Ichiro lost 2020-21, and 888 active
 * players gained a spurious interior gap). A debut year can't precede the first
 * evidence, so the leading run is safe to cut; interior years are not.
 *
 * The TAIL is a deliberate over-report, not an undisprovable one: ~2,000
 * players keep at least one trailing year with no evidence at all, and for a
 * retired player ESPN will never fill those in. Only one active card is
 * visibly affected today (a retired player's last season reads a year long),
 * and correcting it needs a retirement signal this function doesn't have —
 * Player.active is a league-wide latest-season flag, not a per-year one.
 * Fix it here if that per-year signal ever lands.
 *
 * A player with no evidence anywhere keeps `seasons_seen` unchanged — we have
 * nothing better to say, and dropping it would empty the card.
 */
export function getPlayerCareerYears(
  playerId: number,
  playerSeasons: PlayerSeason[],
  seasonPoints: PlayerSeasonPoints[],
  playerSeasonBackfill: PlayerSeasonBackfill[],
  draftPicks: DraftPick[],
  keepers: Keeper[],
  seasonsSeen: number[]
): number[] {
  const evidence = new Set<number>();
  for (const row of playerSeasons) {
    if (row.player_id === playerId && Object.values(row.games_played_by_position).some(games => games > 0)) {
      evidence.add(row.year);
    }
  }
  // Any of these proves a real season even with no games or points recorded.
  const rows = [seasonPoints, playerSeasonBackfill, draftPicks, keepers];
  for (const group of rows) {
    for (const row of group) if (row.player_id === playerId) evidence.add(row.year);
  }
  if (evidence.size === 0) return seasonsSeen;
  const debut = Math.min(...evidence);
  return seasonsSeen.filter(year => year >= debut);
}

/** This player's aggregated batting/pitching line for each year they have any
 * box-score activity, summed across every team that rostered them that year
 * (reuses boxScore.ts's aggregateSeasonRoster, which already sums by
 * player_id -- filtering to this one player first just gives a one-row
 * result per year instead of a whole team's). A year with box-score coverage
 * but no raw stat line (pre-2019, or a gap inside 2018's partial coverage)
 * is simply absent from the map rather than a fabricated zero line. */
export function getPlayerSeasonStatLines(
  playerId: number,
  boxScoresByYear: Map<number, BoxScoreEntry[]>
): Map<number, SeasonPlayerLine> {
  const result = new Map<number, SeasonPlayerLine>();
  for (const [year, entries] of boxScoresByYear) {
    const playerEntries = entries.filter(e => e.player_id === playerId);
    if (playerEntries.length === 0) continue;
    const [row] = aggregateSeasonRoster(playerEntries);
    if (row) result.set(year, row);
  }
  return result;
}

/** Every year's full roster field, aggregated once so a whole set of counting
 * stats can be ranked against it without re-walking the box scores per stat. */
export function aggregateRostersByYear(boxScoresByYear: Map<number, BoxScoreEntry[]>): Map<number, SeasonPlayerLine[]> {
  const result = new Map<number, SeasonPlayerLine[]>();
  for (const [year, entries] of boxScoresByYear) {
    result.set(year, aggregateSeasonRoster(entries));
  }
  return result;
}

export interface StatPercentileEntry {
  year: number;
  value: number;
  percentile: number | null;
}

/** Where one player's season total of a counting stat ranked among other
 * players fantasy-eligible at the chosen position that same year, oldest
 * first.
 *
 * The field is narrowed two ways: `read` returning null excludes anyone
 * without that kind of line at all (a batter's HR against a field padded with
 * every pitcher's zero would put a 1-homer season in the 80th percentile),
 * and `positionByPlayerSeason` + `scopePositionId` further narrows the *rest
 * of the field* to players eligible at `scopePositionId` that season
 * (player_seasons.json's `eligible_slots`, keyed "year:player_id", matched
 * via `matchesPositionScope` so the synthetic OF group id ranks against
 * everyone eligible at LF/CF/RF) -- a first baseman's HR total means
 * something different than a shortstop's. The ranked player's own line is
 * always kept in the field regardless of whether they're eligible at
 * `scopePositionId` that year (percentileWithin requires the field to
 * contain the value being ranked) -- callers that only want to show years
 * the player actually qualified at `scopePositionId` filter the returned
 * years themselves. Both position args are optional so the two-way
 * points-split rocker (which ranks a whole side of the ball, not a single
 * position -- see PercentileBySeason.tsx) can still rank against the full
 * side field. Years the player has no line of that kind are absent entirely
 * rather than ranked as a zero. `higherIsBetter=false` flips the scale for
 * stats a player wants less of (earned runs), so blue always means the
 * better season. */
export function getStatPercentileSeries(
  playerId: number,
  rostersByYear: Map<number, SeasonPlayerLine[]>,
  read: (line: SeasonPlayerLine, year: number) => number | null,
  higherIsBetter = true,
  positionByPlayerSeason?: Map<string, number[]>,
  scopePositionId?: number
): StatPercentileEntry[] {
  const scoped = positionByPlayerSeason && scopePositionId !== undefined;
  const rows: StatPercentileEntry[] = [];
  for (const [year, roster] of rostersByYear) {
    const field: number[] = [];
    let value: number | null = null;
    for (const line of roster) {
      const inScope =
        line.playerId === playerId ||
        !scoped ||
        matchesPositionScope(positionByPlayerSeason.get(`${year}:${line.playerId}`) ?? [], scopePositionId);
      if (!inScope) continue;
      const v = read(line, year);
      if (v === null) continue;
      field.push(v);
      if (line.playerId === playerId) value = v;
    }
    if (value === null) continue;
    const raw = percentileWithin(value, field);
    rows.push({ year, value, percentile: raw === null || higherIsBetter ? raw : 100 - raw });
  }
  return rows.sort((a, b) => a.year - b.year);
}

/** Every year within statLinesByYear this player recorded both a batting and
 * a pitching line -- Ohtani, plus the handful of pre-universal-DH pitchers
 * who took at-bats. Derived from the stat lines rather than from
 * default_position_id, which carries only one side of the ball (Ohtani reads
 * as a DH/batter there). A player can be two-way in some seasons and
 * one-sided in others (Ohtani's 2019 Tommy-John-recovery season batted only),
 * so this is a per-year set, not a whole-career flag; isTwoWayPlayer
 * collapses it to the page-level gate for the two-way-only UI. */
function getTwoWaySeasonYears(statLinesByYear: Map<number, SeasonPlayerLine>): Set<number> {
  const years = new Set<number>();
  for (const [year, line] of statLinesByYear) {
    if (line.batting && line.pitching) years.add(year);
  }
  return years;
}

/** Whether this player was two-way in any season on record -- gates the
 * two-way-only UI (side rocker, batting/pitching split columns) that applies
 * across the whole player page, not just specific years. */
export function isTwoWayPlayer(statLinesByYear: Map<number, SeasonPlayerLine>): boolean {
  return getTwoWaySeasonYears(statLinesByYear).size > 0;
}

/** This player's own batting/pitching points for each year with a stat line. */
export function getPlayerPointsSplit(
  statLinesByYear: Map<number, SeasonPlayerLine>,
  scoringByYear: ScoringByYear
): Map<number, CategoryPoints> {
  const result = new Map<number, CategoryPoints>();
  for (const [year, line] of statLinesByYear) {
    result.set(year, splitLinePoints(line, scoringByYear.get(year)));
  }
  return result;
}

export interface PossessionRun {
  ownerId: string;
  espnTeamId: number;
  startYear: number;
  startWeek: number;
  endYear: number;
  endWeek: number;
}

/** Every week this player had any box-score activity, attributed to whichever
 * owner/team that week's BoxScoreEntry row belongs to, collapsed into
 * contiguous same-owner-and-team runs. This is the finest-grained possession
 * record the processed data supports today -- box scores are an *activity*
 * ledger, not a roster ledger (see boxScore.ts's doc comment), so a gap
 * between two runs means no recorded activity that stretch (a real-world off
 * day, IL stint, or offseason), not necessarily that the player was off every
 * roster. A genuine mid-week trade produces two BoxScoreEntry rows for the
 * same player/week under different owners, each carrying only the scoring
 * periods its own owner actually had them (confirmed against 2019 data) --
 * ordering by each entry's own earliest scoring_period, not raw array order,
 * resolves which owner had the player first within a shared week. */
/** Weeks the ledger says a team let this player go, as sortable year*100+week
 * keys. Feeds getPlayerPossessionChain's run splitting. */
export function getPlayerReleaseKeys(playerId: number, transactions: Transaction[]): Map<number, number[]> {
  const byTeam = new Map<number, number[]>();
  for (const tx of transactions) {
    if (tx.week === null || !isBindingTransaction(tx)) continue;
    for (const item of tx.items) {
      if (item.player_id !== playerId) continue;
      if (item.item_type !== "DROP" && item.item_type !== "TRADE") continue;
      if (item.from_espn_team_id === null) continue;
      const keys = byTeam.get(item.from_espn_team_id) ?? [];
      keys.push(tx.year * 100 + tx.week);
      byTeam.set(item.from_espn_team_id, keys);
    }
  }
  return byTeam;
}

/**
 * The latest TRADE release for each team, plus the first re-acquisition
 * (ADD or TRADE back to the team) after that release. Used to discard phantom
 * box-score fragments created when a trade processes mid-week: the original
 * team still has scoring-period entries after the trade date, which would
 * otherwise read as a separate possession run.
 */
function getTradeReleaseAndReacquisitionKeys(
  playerId: number,
  transactions: Transaction[]
): { tradeReleaseByTeam: Map<number, number>; reacquiredByTeam: Map<number, number> } {
  const tradeReleaseByTeam = new Map<number, number>();
  for (const tx of transactions) {
    if (tx.week === null || !isBindingTransaction(tx)) continue;
    for (const item of tx.items) {
      if (item.player_id !== playerId || item.item_type !== "TRADE" || item.from_espn_team_id === null) continue;
      const key = tx.year * 100 + tx.week;
      const current = tradeReleaseByTeam.get(item.from_espn_team_id) ?? -1;
      if (key > current) tradeReleaseByTeam.set(item.from_espn_team_id, key);
    }
  }

  const reacquiredByTeam = new Map<number, number>();
  for (const tx of transactions) {
    if (tx.week === null || !isBindingTransaction(tx)) continue;
    for (const item of tx.items) {
      if (item.player_id !== playerId) continue;
      if ((item.item_type === "ADD" || item.item_type === "TRADE") && item.to_espn_team_id !== null) {
        const releaseKey = tradeReleaseByTeam.get(item.to_espn_team_id);
        if (releaseKey === undefined) continue;
        const key = tx.year * 100 + tx.week;
        if (key > releaseKey) {
          const current = reacquiredByTeam.get(item.to_espn_team_id) ?? Infinity;
          if (key < current) reacquiredByTeam.set(item.to_espn_team_id, key);
        }
      }
    }
  }

  return { tradeReleaseByTeam, reacquiredByTeam };
}

export function getPlayerPossessionChain(
  playerId: number,
  boxScoresByYear: Map<number, BoxScoreEntry[]>,
  releaseKeysByTeam: Map<number, number[]> = new Map(),
  transactions: Transaction[] = []
): PossessionRun[] {
  const points: { year: number; week: number; minPeriod: number; ownerId: string; espnTeamId: number }[] = [];
  for (const [year, entries] of boxScoresByYear) {
    for (const entry of entries) {
      if (entry.player_id !== playerId || entry.slots.length === 0) continue;
      const minPeriod = Math.min(...entry.slots.map(s => s.scoring_period));
      points.push({ year, week: entry.week, minPeriod, ownerId: entry.owner_id, espnTeamId: entry.espn_team_id });
    }
  }
  points.sort((a, b) => a.year - b.year || a.week - b.week || a.minPeriod - b.minPeriod);

  // A trade is a hard ownership boundary: the original team cannot have the
  // player after it executes. Box scores sometimes still attribute a few
  // scoring periods to the original team when the trade processes mid-week,
  // which would create a phantom "still had them" fragment. Skip those fragment
  // points unless the player was genuinely re-acquired by the same team later.
  const { tradeReleaseByTeam, reacquiredByTeam } = getTradeReleaseAndReacquisitionKeys(playerId, transactions);

  const runs: PossessionRun[] = [];
  for (const p of points) {
    const releaseKey = tradeReleaseByTeam.get(p.espnTeamId);
    if (releaseKey !== undefined) {
      const pointKey = p.year * 100 + p.week;
      const reacquiredKey = reacquiredByTeam.get(p.espnTeamId) ?? Infinity;
      if (pointKey > releaseKey && pointKey < reacquiredKey) continue;
    }

    const last = runs[runs.length - 1];
    // A drop between two activity points ends the run even when the same owner
    // re-acquires later -- otherwise a player dropped in 2022 and picked back
    // up in 2023 reads as one unbroken four-year hold.
    const releasedSinceLastPoint =
      last !== undefined &&
      (releaseKeysByTeam.get(p.espnTeamId) ?? []).some(
        key => key >= last.endYear * 100 + last.endWeek && key < p.year * 100 + p.week
      );
    if (last && last.ownerId === p.ownerId && last.espnTeamId === p.espnTeamId && !releasedSinceLastPoint) {
      last.endYear = p.year;
      last.endWeek = p.week;
    } else {
      runs.push({
        ownerId: p.ownerId,
        espnTeamId: p.espnTeamId,
        startYear: p.year,
        startWeek: p.week,
        endYear: p.year,
        endWeek: p.week,
      });
    }
  }

  // Box scores are an activity ledger, so a player acquired in a trade but not
  // yet active (IL, off-day, or no MLB games) never gains an activity point on
  // the new owner's roster. Ownership is the truth here, not activity: if a
  // binding trade moved this player to a team where no activity run exists,
  // append an ongoing run for the incoming owner starting the week it went
  // through, resolving the owner from the transaction's own team/owner fields.
  const trades = transactions
    .filter(tx => isBindingTransaction(tx) && tx.week !== null)
    .flatMap(tx => tx.items.map(item => ({ tx, item })))
    .filter(({ item }) => item.player_id === playerId && item.item_type === "TRADE" && item.to_espn_team_id !== null)
    .sort((a, b) => b.tx.year - a.tx.year || (b.tx.week ?? 0) - (a.tx.week ?? 0));
  const latestTrade = trades[0];
  if (
    latestTrade &&
    !runs.some(
      r =>
        r.espnTeamId === latestTrade.item.to_espn_team_id &&
        r.endYear === latestTrade.tx.year &&
        r.endWeek >= (latestTrade.tx.week ?? 0)
    )
  ) {
    const incoming =
      latestTrade.tx.espn_team_id === latestTrade.item.to_espn_team_id
        ? latestTrade.tx.owner_id
        : (trades.find(t => t.tx.espn_team_id === t.item.to_espn_team_id)?.tx.owner_id ?? null);
    if (incoming) {
      runs.push({
        ownerId: incoming,
        espnTeamId: latestTrade.item.to_espn_team_id!,
        startYear: latestTrade.tx.year,
        startWeek: latestTrade.tx.week ?? 0,
        endYear: latestTrade.tx.year,
        endWeek: latestTrade.tx.week ?? 0,
      });
    }
  }

  return runs;
}

export interface PossessionEvent {
  /** How the player arrived on this roster. `null` when the ledger has no
   * matching event, which is the normal case before 2019. */
  acquiredVia: "free agent" | "trade" | null;
  acquiredWeek: number | null;
  acquiredDate: number | null;
  /** Set when the player was drafted — live or kept — to this team in the run's
   * starting year, so a drafted player who debuted late reads as that draft
   * year in the From column rather than his first box-score week. */
  draftedToTeam: boolean;
  /** Set when the ledger shows the player leaving this roster. Distinguishes a
   * real release from the box-score chain merely going quiet. */
  releasedWeek: number | null;
  releasedVia: "dropped" | "traded away" | null;
  /** No recorded release in a year the ledger covers -- the owner still has
   * them, so the run has no end week to show. Always false pre-2019, where a
   * missing release proves nothing. */
  isOngoing: boolean;
}

export type EnrichedPossessionRun = PossessionRun & PossessionEvent;

/**
 * Overlays the transaction ledger onto a box-score-derived possession chain.
 *
 * The chain alone can only say "this player had activity for this owner these
 * weeks" — it is an activity ledger, so a gap means no recorded activity, not
 * a proven departure (see getPlayerPossessionChain). The transaction ledger
 * turns the ambiguous cases into facts: an ADD names how and when the player
 * arrived, and a DROP proves he actually left rather than just went quiet.
 *
 * **2019-2025 only.** ESPN serves no transaction data for 2009-2018, so every
 * field here is null for those runs and callers must not read a null as "he
 * was never added" — it means "not recorded". Gate the UI on the season's
 * `coverage.transactions`.
 *
 * Matching is per (year, team): the event must name this player moving to or
 * from the same espn_team_id in the same season as the run. A run is matched
 * to its LAST qualifying add at or before the run's start week and its FIRST
 * qualifying drop at or after the run's end, so a player added, dropped, and
 * re-added by the same owner resolves to the right event for each run.
 *
 * Only binding transactions count. Trade *proposals* carry TRADE items exactly
 * like an executed trade does, and the ledger holds far more of them than real
 * trades, so reading status here is what keeps a canceled offer from rendering
 * as a completed one.
 *
 * `transactionCoveredYears` gates `isOngoing` -- see transactionYears().
 */
export function enrichPossessionChain(
  runs: PossessionRun[],
  playerId: number,
  transactions: Transaction[],
  transactionCoveredYears: ReadonlySet<number>,
  draftYearsByOwner: ReadonlyMap<string, ReadonlySet<number>> = new Map()
): EnrichedPossessionRun[] {
  const relevant = transactions.filter(
    tx => isBindingTransaction(tx) && tx.items.some(item => item.player_id === playerId)
  );

  return runs.map((run, i) => {
    let acquired: PossessionEvent["acquiredVia"] = null;
    let acquiredWeek: number | null = null;
    let acquiredDate: number | null = null;
    let released: PossessionEvent["releasedVia"] = null;
    let releasedWeek: number | null = null;

    for (const tx of relevant) {
      for (const item of tx.items) {
        if (item.player_id !== playerId) continue;
        // A LINEUP item is a slot change, not a move -- it would otherwise read as "free agent".
        if (item.item_type !== "ADD" && item.item_type !== "DROP" && item.item_type !== "TRADE") continue;
        const week = tx.week;

        // Arrival: the player moved ONTO this run's team, no later than the
        // week the run starts. Weekless rows (ESPN omits the week outside
        // scheduled matchup periods) can't be ordered, so they're skipped
        // rather than guessed at.
        if (item.to_espn_team_id === run.espnTeamId && tx.year === run.startYear && week !== null) {
          if (week <= run.startWeek && (acquiredWeek === null || week >= acquiredWeek)) {
            acquiredWeek = week;
            acquiredDate = tx.proposed_date;
            acquired = item.item_type === "TRADE" ? "trade" : "free agent";
          }
        }

        // Departure: the player moved OFF this run's team, no earlier than the
        // week the run ends.
        if (item.from_espn_team_id === run.espnTeamId && tx.year === run.endYear && week !== null) {
          if (week >= run.endWeek && (releasedWeek === null || week <= releasedWeek)) {
            releasedWeek = week;
            released = item.item_type === "TRADE" ? "traded away" : "dropped";
          }
        }
      }
    }

    return {
      ...run,
      acquiredVia: acquired,
      acquiredWeek,
      acquiredDate,
      releasedWeek,
      releasedVia: released,
      // Only the newest run can still be open -- a later owner is proof this
      // one ended, even when no drop was ever recorded (an offseason keeper or
      // draft move leaves no transaction behind).
      isOngoing: i === runs.length - 1 && released === null && transactionCoveredYears.has(run.endYear),
      draftedToTeam: draftYearsByOwner.get(run.ownerId)?.has(run.startYear) ?? false,
    };
  });
}
