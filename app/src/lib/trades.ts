import { getPlayerSeasonPoints } from "./draft";
import type { DraftPick, PlayerSeasonPoints, Team, Trade, Transaction } from "../types";

/**
 * One asset changing hands in a trade — the unified registry behind the Trades
 * page. Draft picks and players are deliberately the same row type: a trade
 * moves assets, and splitting them into two tables made it impossible to see a
 * league's trade history in one place.
 */
export type TradeAssetKind = "pick" | "player" | "unrecorded";

/** Sentinel for a side of a trade this archive cannot name. One 2021 trade has
 * only a single TRADE_ACCEPT row on file, so its counterparty is genuinely
 * unknown rather than missing from our mapping. */
export const UNKNOWN_OWNER_ID = "unknown";

export interface TradeEntry {
  /** Stable React key. */
  key: string;
  /** Groups the assets of one trade together. Player/unrecorded rows share the
   * executed cluster; picks, which carry no trade id, are grouped by season and
   * the pair of owners involved. */
  tradeKey: string;
  kind: TradeAssetKind;
  year: number;
  /** Matchup week the trade executed. null for picks (a draft pick trade has
   * no in-season week) and for ledger rows ESPN dated outside a matchup week. */
  week: number | null;
  fromOwnerId: string;
  toOwnerId: string;
  /**
   * Every owner involved, in team-id order. For `pick` and `player` rows this
   * is just [from, to]. For `unrecorded` rows it is the authoritative list —
   * `fromOwnerId`/`toOwnerId` only carry the first two, so a trade with more
   * than two sides would be under-reported if you read those alone.
   */
  participantOwnerIds: string[];
  /** null on `unrecorded` rows, where ESPN no longer serves who moved. */
  playerId: number | null;
  playerName: string;
  /** Pick rows only. */
  roundId: number | null;
  overallPickNumber: number | null;
  /**
   * The outcome: points the player scored that season. For a pick, that's what
   * the pick became; for a traded player, what he did that year. null when no
   * season-points row exists at all — distinct from a real recorded 0.0.
   */
  points: number | null;
}

/**
 * Every trade this archive can evidence, picks and players in one registry.
 *
 * Three kinds of row, because the sources have genuinely different fidelity and
 * flattening that difference would misrepresent the record:
 *
 *  - **`pick`** — from `draft_picks.json`'s `traded_pick` flag, which ESPN
 *    records permanently. Spans the full archive (2009, 2013-2015, 2019, 2023)
 *    and carries the outcome.
 *  - **`player`** — a real player exchange, either from the 2019+ transaction
 *    ledger directly (an executed trade whose `TRADE` items survived) or,
 *    failing that, from `trades.json`'s box-score-diff backfill (2019-2025
 *    trades ESPN's ledger alone can't recover — see types/trade.ts).
 *  - **`unrecorded`** — an executed trade we know happened but whose player
 *    exchange neither source recovered. These are listed rather than dropped:
 *    omitting them would make the league's trade history look smaller than
 *    it was.
 *
 * **Proposals are excluded.** The ledger carries 144 `TRADE` items on
 * `TRADE_PROPOSAL` rows, but every one is CANCELED (100) or PENDING (44) —
 * trades that never happened. Only 4 `TRADE` items sit on an EXECUTED row.
 * Listing proposals here would put trades in the record book that the league
 * never actually made.
 *
 * Multi-party trades (3+ teams) are still detected off the raw
 * `transactions` ledger, not `trades`: `trades.json`'s `Trade` entity only
 * tracks two sides (no real 3+-way trade exists in the archive yet), so
 * relying on it alone would silently drop a third team if one ever occurs.
 */
export function getTradeRegistry(
  draftPicks: DraftPick[],
  transactions: Transaction[],
  trades: Trade[],
  teams: Team[],
  seasonPoints: PlayerSeasonPoints[]
): TradeEntry[] {
  const ownerByTeamYear = new Map(teams.map(t => [`${t.year}:${t.espn_team_id}`, t.primary_owner_id]));
  const owner = (year: number, espnTeamId: number | null): string =>
    espnTeamId === null ? UNKNOWN_OWNER_ID : (ownerByTeamYear.get(`${year}:${espnTeamId}`) ?? UNKNOWN_OWNER_ID);
  const nameById = new Map(seasonPoints.map(p => [p.player_id, p.player_name]));

  const entries: TradeEntry[] = [];

  for (const pick of draftPicks) {
    if (!pick.traded_pick || pick.traded_from_espn_team_id === null) continue;
    const from = owner(pick.year, pick.traded_from_espn_team_id);
    entries.push({
      key: `pick-${pick.year}-${pick.overall_pick_number}`,
      // No trade id exists on a pick, so picks swapped between the same two
      // owners in one season read as the one deal they almost certainly were.
      tradeKey: `pick:${pick.year}:${[from, pick.owner_id].sort().join("|")}`,
      kind: "pick",
      year: pick.year,
      week: null,
      fromOwnerId: from,
      toOwnerId: pick.owner_id,
      participantOwnerIds: [from, pick.owner_id],
      playerId: pick.player_id,
      playerName: pick.player_name,
      roundId: pick.round_id,
      overallPickNumber: pick.overall_pick_number,
      points: getPlayerSeasonPoints(seasonPoints, pick.year, pick.player_id),
    });
  }

  const tradeByTradeId = new Map(trades.map(t => [t.trade_id, t]));

  // Executed trades are clustered by the proposal they answer, so a two-sided
  // deal is one trade rather than two independent rows.
  const executed = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    if (tx.transaction_type !== "TRADE_ACCEPT" && tx.transaction_type !== "TRADE_UPHOLD") continue;
    const key = `${tx.year}:${tx.related_transaction_id ?? tx.transaction_id}`;
    const bucket = executed.get(key);
    if (bucket) bucket.push(tx);
    else executed.set(key, [tx]);
  }

  for (const [clusterKey, rows] of executed) {
    const moved = rows.flatMap(tx => tx.items.filter(item => item.item_type === "TRADE").map(item => ({ tx, item })));

    if (moved.length > 0) {
      // Deduplicated: ESPN can repeat the same movement across the rows of a
      // cluster, and the same player crossing once is one line in the registry.
      const seen = new Set<string>();
      for (const { tx, item } of moved) {
        const dedupeKey = `${item.player_id}:${item.from_espn_team_id}:${item.to_espn_team_id}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        entries.push({
          key: `player-${clusterKey}-${dedupeKey}`,
          tradeKey: clusterKey,
          kind: "player",
          year: tx.year,
          week: tx.week,
          fromOwnerId: owner(tx.year, item.from_espn_team_id),
          toOwnerId: owner(tx.year, item.to_espn_team_id),
          participantOwnerIds: [owner(tx.year, item.from_espn_team_id), owner(tx.year, item.to_espn_team_id)],
          playerId: item.player_id,
          playerName: nameById.get(item.player_id) ?? `Player ${item.player_id}`,
          roundId: null,
          overallPickNumber: null,
          points: getPlayerSeasonPoints(seasonPoints, tx.year, item.player_id),
        });
      }
      continue;
    }

    // The narrower accept/uphold-only scan above found nothing -- some
    // trades' items live on the TRADE_PROPOSAL row instead (or, for
    // 2019-2025, ESPN purged the proposal entirely), so defer to
    // trades.json, which already resolves both cases: the proposal's own
    // list (build_trades checks it first) or, failing that, a box-score
    // roster diff across the trade date (see types/trade.ts's
    // TradeItem.source). `reconstructed` reflects each item's real source.
    const tradeId = rows[0].related_transaction_id ?? rows[0].transaction_id;
    const fallbackItems = (tradeByTradeId.get(tradeId)?.items ?? []).filter(item => item.item_type === "TRADE");
    if (fallbackItems.length > 0) {
      const first = rows[0];
      const seen = new Set<string>();
      for (const item of fallbackItems) {
        const dedupeKey = `${item.player_id}:${item.from_espn_team_id}:${item.to_espn_team_id}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        entries.push({
          key: `player-${clusterKey}-${dedupeKey}`,
          tradeKey: clusterKey,
          kind: "player",
          year: first.year,
          week: first.week,
          fromOwnerId: owner(first.year, item.from_espn_team_id),
          toOwnerId: owner(first.year, item.to_espn_team_id),
          participantOwnerIds: [owner(first.year, item.from_espn_team_id), owner(first.year, item.to_espn_team_id)],
          playerId: item.player_id,
          playerName: nameById.get(item.player_id) ?? `Player ${item.player_id}`,
          roundId: null,
          overallPickNumber: null,
          points: getPlayerSeasonPoints(seasonPoints, first.year, item.player_id),
        });
      }
      continue;
    }

    // No exchange survived from either source. The participating teams are
    // still knowable from the rows themselves, so the trade is recorded with
    // its sides but no players. Every participant is kept, not just the first
    // two: the archive currently holds no trade with more than two sides, but
    // a three-way deal would otherwise silently lose one.
    const participants = Array.from(new Set(rows.map(tx => tx.espn_team_id))).sort((a, b) => a - b);
    const first = rows[0];
    const participantOwnerIds = participants.map(teamId => owner(first.year, teamId));
    entries.push({
      key: `unrecorded-${clusterKey}`,
      tradeKey: `unrecorded:${clusterKey}`,
      kind: "unrecorded",
      year: first.year,
      week: first.week,
      fromOwnerId: owner(first.year, participants[0] ?? null),
      toOwnerId: owner(first.year, participants[1] ?? null),
      participantOwnerIds,
      playerId: null,
      playerName: "",
      roundId: null,
      overallPickNumber: null,
      points: null,
    });
  }

  return entries.sort(
    (a, b) =>
      b.year - a.year || (b.week ?? -1) - (a.week ?? -1) || (a.overallPickNumber ?? 0) - (b.overallPickNumber ?? 0)
  );
}

/**
 * Fills in the TRADE items missing from an executed TRADE_ACCEPT/TRADE_UPHOLD
 * row using `trades.json`'s own reconstruction (ledger-direct or
 * box-score-diff -- see types/trade.ts), the same fallback getTradeRegistry
 * uses. Anything reading the raw transaction ledger for "did this player get
 * traded" -- e.g. playerHistory.ts's possession chain -- needs this first, or
 * the 9 of 11 executed trades whose ledger items didn't survive read as a
 * silent gap instead of a trade.
 */
export function mergeTradeItemsIntoTransactions(transactions: Transaction[], trades: Trade[]): Transaction[] {
  const tradeByTradeId = new Map(trades.map(t => [t.trade_id, t]));
  return transactions.map(tx => {
    if (tx.transaction_type !== "TRADE_ACCEPT" && tx.transaction_type !== "TRADE_UPHOLD") return tx;
    if (tx.items.some(item => item.item_type === "TRADE")) return tx;
    const tradeId = tx.related_transaction_id ?? tx.transaction_id;
    const fallbackItems = (tradeByTradeId.get(tradeId)?.items ?? []).filter(item => item.item_type === "TRADE");
    if (fallbackItems.length === 0) return tx;
    return { ...tx, items: [...tx.items, ...fallbackItems] };
  });
}

/** One participant in a grouped trade, and what they gave up. */
export interface TradeSide {
  ownerId: string;
  assets: TradeEntry[];
  /** Sum of the side's asset points; null when no asset has a points row. */
  points: number | null;
}

/** One trade, all its assets folded together. */
export interface TradeRow {
  key: string;
  kind: TradeAssetKind;
  year: number;
  week: number | null;
  /** Ordered by how much the side gave up, so the fuller half reads first. */
  sides: TradeSide[];
  /** sides[1].points minus sides[0].points -- the first (left) side's net gain:
   * what they received (the second side's surrendered assets) minus what they
   * gave up. Positive favors the first owner, negative the second. null unless
   * both sides have a scored asset; a 3+-side trade (none in the archive yet)
   * would only compare the first two. */
  points: number | null;
  /** `unrecorded` rows only -- the sides carry no assets to name them. */
  participantOwnerIds: string[];
}

function sumPoints(assets: TradeEntry[]): number | null {
  const scored = assets.filter(a => a.points !== null);
  return scored.length === 0 ? null : scored.reduce((sum, a) => sum + (a.points ?? 0), 0);
}

// `sides[1].points` are what the second side surrendered -- which is what the
// first side received -- so second-minus-first is the first/left owner's net gain.
function pointsDelta(sides: TradeSide[]): number | null {
  if (sides.length < 2 || sides[0].points === null || sides[1].points === null) return null;
  return sides[1].points - sides[0].points;
}

/** `row.points` is always the first side's net (`sides[1].points -
 * sides[0].points`), so an owner on the second side contributed the opposite
 * figure. Re-sign per row rather than summing the column blind -- otherwise a
 * side-B owner's total is inverted, and owners on both sides of different trades
 * partially cancel. A third side has no attributable figure (pointsDelta only
 * compares the first two), so it drops out rather than guessing. */
function ownerSideNet(row: TradeRow, ownerId: string): number | null {
  if (row.points === null) return null;
  const index = row.sides.findIndex(s => s.ownerId === ownerId);
  if (index === 0) return row.points;
  if (index === 1) return -row.points;
  return null;
}

/** The sum of one owner's own net across their trades. null when no trade they
 * took part in carries a delta attributable to them. */
export function sumTradeDeltas(rows: TradeRow[], ownerId: string): number | null {
  const nets = rows.map(r => ownerSideNet(r, ownerId)).filter((n): n is number => n !== null);
  return nets.length === 0 ? null : nets.reduce((sum, n) => sum + n, 0);
}

/** Rotate a two-sided row so `ownerId` reads first, inverting the delta with
 * them, so a table filtered to one owner speaks from that owner's side of every
 * trade and the Points Δ column adds up to the filtered total rather than its
 * mirror. Rows already led by the owner, rows they aren't a side of, and
 * 3+-sided rows (whose delta only compares the first two) pass through
 * untouched. */
export function orientRowToOwner(row: TradeRow, ownerId: string): TradeRow {
  if (row.sides.length !== 2 || row.sides[1]?.ownerId !== ownerId) return row;
  return {
    ...row,
    sides: [row.sides[1], row.sides[0]],
    points: row.points === null ? null : -row.points,
  };
}

/**
 * Collapses the per-asset registry into one row per trade: a six-player deal is
 * one row with two sides, not six rows. A side is the owner who gave the asset
 * up, so "what each team surrendered" reads straight across.
 */
export function groupTrades(entries: TradeEntry[]): TradeRow[] {
  const byTrade = new Map<string, TradeEntry[]>();
  for (const entry of entries) {
    const bucket = byTrade.get(entry.tradeKey);
    if (bucket) bucket.push(entry);
    else byTrade.set(entry.tradeKey, [entry]);
  }

  const rows: TradeRow[] = [];
  for (const [tradeKey, assets] of byTrade) {
    const first = assets[0];
    const bySide = new Map<string, TradeEntry[]>();
    for (const asset of assets) {
      const bucket = bySide.get(asset.fromOwnerId);
      if (bucket) bucket.push(asset);
      else bySide.set(asset.fromOwnerId, [asset]);
    }
    const sides: TradeSide[] = Array.from(bySide, ([ownerId, sideAssets]) => ({
      ownerId,
      // An unrecorded trade has one placeholder asset naming no player; its
      // sides come from participantOwnerIds instead.
      assets: first.kind === "unrecorded" ? [] : sideAssets,
      points: first.kind === "unrecorded" ? null : sumPoints(sideAssets),
    })).sort((a, b) => b.assets.length - a.assets.length);

    rows.push({
      key: tradeKey,
      kind: first.kind,
      year: first.year,
      week: first.week,
      sides:
        first.kind === "unrecorded"
          ? first.participantOwnerIds.map(ownerId => ({ ownerId, assets: [], points: null }))
          : sides,
      points: first.kind === "unrecorded" ? null : pointsDelta(sides),
      participantOwnerIds: first.participantOwnerIds,
    });
  }

  return rows.sort((a, b) => b.year - a.year || (b.week ?? -1) - (a.week ?? -1) || a.key.localeCompare(b.key));
}

export interface TradeRegistrySummary {
  picks: number;
  players: number;
  unrecorded: number;
}

export function summarizeTradeRegistry(entries: TradeEntry[]): TradeRegistrySummary {
  return {
    picks: entries.filter(e => e.kind === "pick").length,
    players: entries.filter(e => e.kind === "player").length,
    unrecorded: entries.filter(e => e.kind === "unrecorded").length,
  };
}
