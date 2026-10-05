import { DISPLAY_EXCLUDED_POSITION_IDS } from "./positions";
import type {
  DraftPick,
  Keeper,
  PlayerSeasonOwnership,
  PlayerSeasonPoints,
  PlayerTeamSeasonPoints,
  Season,
  Team,
  Transaction,
} from "../types";

/**
 * Transaction-driven league records.
 *
 * COVERAGE, read this first. There are two independent transaction sources and
 * they do not span the same years:
 *
 *  - `Team.transactions` — ESPN's own season counters, present for **all 17
 *    seasons**. Totals only; no player, date, or event detail.
 *  - `transactions.json` — the per-event ledger, **2019-2025 only**. ESPN
 *    serves nothing for 2009-2018.
 *
 * Anything needing "which player" or "when" is limited to 2019+ and must say
 * so. Gate on a season's `coverage.transactions`, never on the array being
 * non-empty.
 */

/** Roster moves a team made: acquisitions + drops. ESPN's own counters, so
 * this spans all 17 seasons. Trades are deliberately excluded: ESPN counts a
 * trade once per participating team, so folding them in double-counts a single
 * two-team deal across a standings table. */
export function teamMoves(team: Team): number {
  return team.transactions.acquisitions + team.transactions.drops;
}

/** Trade proposals that were offered and never went through. 183 of the ledger's
 * 186 TRADE items belong to these, so anything reading a TRADE item as a real
 * move must filter them out first. */
const NON_BINDING_STATUSES: ReadonlySet<string> = new Set(["PENDING", "CANCELED"]);

/** A transaction that actually happened. Status is null on some real
 * TRADE_ACCEPT rows, so null passes. */
export function isBindingTransaction(tx: Transaction): boolean {
  return tx.status === null || !NON_BINDING_STATUSES.has(tx.status);
}

/** Years whose transaction ledger ESPN actually serves. */
export function transactionYears(seasons: Season[]): number[] {
  return seasons
    .filter(s => s.coverage.transactions !== "missing")
    .map(s => s.year)
    .sort((a, b) => a - b);
}

export interface WaiverPickup {
  year: number;
  /** Week of the FIRST add, when an owner picked the player up more than once. */
  week: number | null;
  playerId: number;
  playerName: string;
  ownerId: string;
  espnTeamId: number;
  /** Points the player scored WHILE ON THIS OWNER'S ROSTER — the figure the
   * board ranks by, and the one that answers "what did this pickup do for the
   * manager who made it". */
  ownerPoints: number;
  /** Points the player scored that whole season, across every team that held
   * them. Shown alongside so a pickup that only captured part of a big year
   * reads honestly rather than looking like the whole thing. */
  seasonPoints: number;
  /** What happened the next year, mirroring the Draft Steals flags: "kept"
   * (kept onto next year's roster by the same owner, rendered gold *), "drafted"
   * (re-entered the next year's live draft by anyone), or "gone" (neither). */
  nextYearStatus: "kept" | "drafted" | "gone";
}

/**
 * Free-agent pickups ranked by what the player produced **for the manager who
 * picked him up**, best first. The "I found him on the wire" record.
 *
 * Ranking by season total was the obvious first cut and it was wrong in a way
 * that mattered: 2021 Robbie Ray's Cy Young season shows up under two owners,
 * but one of them held him for 4.9 of those 318.1 points. A board of best
 * pickups that credits a manager with production he never received is not a
 * record about managers at all.
 *
 * `player_team_season_points.json` supplies the split. It comes from box
 * scores, which already attribute every week to the team that rostered the
 * player, so no transaction dates are involved — the ledger supplies *which*
 * adds happened and when, and the box scores supply what each roster actually
 * banked.
 *
 * Three things the split cannot fix, all handled here:
 *  - An owner who picks the same player up twice in a season would otherwise
 *    appear twice with identical points. Deduplicated to the FIRST add.
 *  - An owner re-adding a player they drafted that same year gets credited
 *    with their pre-drop production too, since box scores can't tell the two
 *    stints apart. Those 127 adds are excluded — re-acquiring your own draft
 *    pick isn't a wire find anyway.
 *  - A pickup whose owner-attributed points are zero or negative is not a
 *    record worth ranking.
 */
export function getWaiverPickups(
  transactions: Transaction[],
  seasonPoints: PlayerSeasonPoints[],
  teamSeasonPoints: PlayerTeamSeasonPoints[],
  draftPicks: DraftPick[],
  keepers: Keeper[] = [],
  limit = 25
): WaiverPickup[] {
  const seasonByKey = new Map(seasonPoints.map(p => [`${p.year}:${p.player_id}`, p]));
  const ownerPointsByKey = new Map<string, number>();
  for (const row of teamSeasonPoints) {
    const key = `${row.year}:${row.player_id}:${row.owner_id}`;
    ownerPointsByKey.set(key, (ownerPointsByKey.get(key) ?? 0) + row.points);
  }
  const draftedByOwner = new Set(draftPicks.map(p => `${p.year}:${p.player_id}:${p.owner_id}`));

  const firstAdd = new Map<string, WaiverPickup>();
  for (const tx of transactions) {
    if (tx.transaction_type !== "FREEAGENT" || tx.owner_id === null) continue;
    for (const item of tx.items) {
      if (item.item_type !== "ADD") continue;
      const key = `${tx.year}:${item.player_id}:${tx.owner_id}`;
      if (draftedByOwner.has(key)) continue;

      const season = seasonByKey.get(`${tx.year}:${item.player_id}`);
      const ownerPoints = ownerPointsByKey.get(key);
      // No points row means the player never scored for this owner — a pickup
      // that did nothing, which is not a record worth ranking.
      if (!season || ownerPoints === undefined || ownerPoints <= 0) continue;

      const existing = firstAdd.get(key);
      const keptNextYear = keepers.some(
        k => k.year === tx.year + 1 && k.player_id === item.player_id && k.owner_id === tx.owner_id
      );
      const redraftedNextYear = draftPicks.some(
        dp => dp.year === tx.year + 1 && dp.player_id === item.player_id && !dp.keeper
      );
      const candidate: WaiverPickup = {
        year: tx.year,
        week: tx.week,
        playerId: item.player_id,
        playerName: season.player_name,
        ownerId: tx.owner_id,
        espnTeamId: tx.espn_team_id,
        ownerPoints,
        seasonPoints: season.points,
        nextYearStatus: keptNextYear ? "kept" : redraftedNextYear ? "drafted" : "gone",
      };
      // Keep the earliest add; a null week can't be ordered, so a dated add
      // always wins over an undated one.
      if (!existing || (candidate.week !== null && (existing.week === null || candidate.week < existing.week))) {
        firstAdd.set(key, candidate);
      }
    }
  }

  return Array.from(firstAdd.values())
    .sort((a, b) => b.ownerPoints - a.ownerPoints || a.year - b.year)
    .slice(0, limit);
}

export interface OwnerActivity {
  ownerId: string;
  adds: number;
  drops: number;
  moves: number;
  trades: number;
  seasonsCovered: number;
  /** moves per covered season — the fair comparison when owners joined the
   * league at different times. */
  movesPerSeason: number;
}

/**
 * The Tinkerer board: who works the wire hardest.
 *
 * Built from `Team.transactions` rather than the ledger so it spans **all 17
 * seasons**. `movesPerSeason` exists because raw totals just rank owners by
 * longevity — an owner present for 17 years will out-move one present for 4
 * without being more active.
 */
export function getOwnerActivity(teams: Team[]): OwnerActivity[] {
  const byOwner = new Map<string, OwnerActivity>();

  for (const team of teams) {
    // Attributed to the primary owner: a co-owned team's moves have no
    // per-person attribution in ESPN's counters, so splitting them would be
    // invention.
    const existing = byOwner.get(team.primary_owner_id) ?? {
      ownerId: team.primary_owner_id,
      adds: 0,
      drops: 0,
      moves: 0,
      trades: 0,
      seasonsCovered: 0,
      movesPerSeason: 0,
    };
    existing.adds += team.transactions.acquisitions;
    existing.drops += team.transactions.drops;
    existing.moves += teamMoves(team);
    existing.trades += team.transactions.trades;
    existing.seasonsCovered += 1;
    byOwner.set(team.primary_owner_id, existing);
  }

  return Array.from(byOwner.values())
    .map(o => ({ ...o, movesPerSeason: o.seasonsCovered === 0 ? 0 : o.moves / o.seasonsCovered }))
    .sort((a, b) => b.moves - a.moves);
}

export interface BlindSpot {
  year: number;
  playerId: number;
  playerName: string;
  points: number;
  percentOwned: number;
}

/**
 * Players the wider fantasy world undervalued: high scorers at low ownership.
 *
 * `percent_owned` is averaged across every ESPN league of this type, not this
 * league's 10 rosters — so this measures a league-wide blind spot, not one
 * owner's oversight. Covers **all 17 seasons**, which makes it the only new
 * all-time record here.
 *
 * The ownership figure is a season-end snapshot, so a player who broke out
 * early and got rostered everywhere reads as highly owned. That biases this
 * toward players who stayed under the radar all year — which is the more
 * interesting finding anyway.
 */
export function getBlindSpots(
  seasonPoints: PlayerSeasonPoints[],
  ownership: PlayerSeasonOwnership[],
  { minPoints = 200, maxPercentOwned = 40, limit = 25 } = {}
): BlindSpot[] {
  const ownershipByKey = new Map(ownership.map(o => [`${o.year}:${o.player_id}`, o]));
  const rows: BlindSpot[] = [];

  for (const p of seasonPoints) {
    const ownership = ownershipByKey.get(`${p.year}:${p.player_id}`);
    if (!ownership) continue;
    if (p.points < minPoints || ownership.percent_owned >= maxPercentOwned) continue;
    rows.push({
      year: p.year,
      playerId: p.player_id,
      playerName: p.player_name,
      points: p.points,
      percentOwned: ownership.percent_owned,
    });
  }

  return rows.sort((a, b) => b.points - a.points).slice(0, limit);
}

export interface MatchupTransactionMarkers {
  droppedPlayerIds: Set<number>;
  addedPlayerIds: Set<number>;
  tradedAwayPlayerIds: Set<number>;
}

/** Players dropped, FA/waiver-added, or traded away on one matchup side during
 * that week. 2019+ only -- callers must gate on season.coverage.transactions, not on an empty result. */
export function getMatchupTransactionMarkers(
  transactions: Transaction[],
  year: number,
  week: number,
  espnTeamId: number
): MatchupTransactionMarkers {
  const droppedPlayerIds = new Set<number>();
  const addedPlayerIds = new Set<number>();
  const tradedAwayPlayerIds = new Set<number>();
  // Team membership comes from the item's own from/to, not tx.espn_team_id --
  // a trade is filed under the accepting team, so the other side would be missed.
  for (const tx of transactions) {
    if (tx.year !== year || tx.week !== week) continue;
    if (!isBindingTransaction(tx)) continue;
    for (const item of tx.items) {
      if (item.from_espn_team_id === espnTeamId) {
        if (item.item_type === "DROP") droppedPlayerIds.add(item.player_id);
        else if (item.item_type === "TRADE") tradedAwayPlayerIds.add(item.player_id);
      } else if (item.to_espn_team_id === espnTeamId && item.item_type === "ADD") {
        addedPlayerIds.add(item.player_id);
      }
    }
  }
  return { droppedPlayerIds, addedPlayerIds, tradedAwayPlayerIds };
}

export interface SeasonRosterMarkers {
  /** Left the roster and never came back that season. */
  droppedPlayerIds: Set<number>;
  freeAgentAddedPlayerIds: Set<number>;
  tradeAcquiredPlayerIds: Set<number>;
  /** Left the roster via a trade and never came back that season. */
  tradedAwayPlayerIds: Set<number>;
}

/** One team-season's roster churn, for annotating a full-season roster table.
 * A drop only counts when it's the player's LAST event with this team that
 * year -- a drop-and-re-add would otherwise read as "gone" for someone still
 * on the roster at season's end.
 *
 * `tradeAcquiredPlayerIds` reads literal TRADE items, so it is nearly always
 * empty before 2026: 9 of the 11 executed 2019-2025 trades lost their
 * player-exchange rows on ESPN's side (see data/README.md). An unmarked player
 * who changed hands is expected, not a bug.
 *
 * 2019+ only -- gate on season.coverage.transactions, not on an empty result. */
export function getSeasonRosterMarkers(
  transactions: Transaction[],
  year: number,
  espnTeamId: number
): SeasonRosterMarkers {
  const freeAgentAddedPlayerIds = new Set<number>();
  const tradeAcquiredPlayerIds = new Set<number>();
  const lastEvent = new Map<number, "ADD" | "DROP" | "TRADE">();

  // Team membership comes from the item's own from/to, not tx.espn_team_id --
  // a trade is filed under the accepting team, so the other side would be missed.
  const ordered = transactions
    .filter(tx => tx.year === year && isBindingTransaction(tx))
    .sort((a, b) => a.scoring_period_id - b.scoring_period_id);

  for (const tx of ordered) {
    for (const item of tx.items) {
      if (item.to_espn_team_id === espnTeamId) {
        if (item.item_type === "ADD") freeAgentAddedPlayerIds.add(item.player_id);
        else if (item.item_type === "TRADE") tradeAcquiredPlayerIds.add(item.player_id);
        else continue;
        lastEvent.set(item.player_id, "ADD");
      } else if (item.from_espn_team_id === espnTeamId) {
        if (item.item_type !== "DROP" && item.item_type !== "TRADE") continue;
        lastEvent.set(item.player_id, item.item_type === "TRADE" ? "TRADE" : "DROP");
      }
    }
  }

  const droppedPlayerIds = new Set<number>();
  const tradedAwayPlayerIds = new Set<number>();
  for (const [playerId, event] of lastEvent) {
    if (event === "DROP") droppedPlayerIds.add(playerId);
    if (event === "TRADE") tradedAwayPlayerIds.add(playerId);
  }
  return { droppedPlayerIds, freeAgentAddedPlayerIds, tradeAcquiredPlayerIds, tradedAwayPlayerIds };
}

export interface Journeyman {
  playerId: number;
  playerName: string;
  /** Free-agent pickups across every owner and year in the ledger. */
  pickups: number;
  ownerIds: string[];
}

/**
 * Players picked up off the wire the most times over their careers —
 * the "everybody's had a turn with this guy" board.
 *
 * Built from the per-event ledger, so it's **2019-2025 only**: a player
 * added by five different owners across 2009-2018 leaves no trace there.
 * Counts every FREEAGENT ADD, so a player re-added by the same owner after
 * being dropped and re-claimed counts twice — each is a real pickup event.
 */
export function getJourneymen(
  transactions: Transaction[],
  players: { player_id: number; full_name: string }[],
  limit = 25
): Journeyman[] {
  const nameById = new Map(players.map(p => [p.player_id, p.full_name]));
  const byPlayer = new Map<number, Journeyman>();

  for (const tx of transactions) {
    if (tx.transaction_type !== "FREEAGENT" || tx.owner_id === null) continue;
    for (const item of tx.items) {
      if (item.item_type !== "ADD") continue;
      const existing = byPlayer.get(item.player_id) ?? {
        playerId: item.player_id,
        playerName: nameById.get(item.player_id) ?? `Player ${item.player_id}`,
        pickups: 0,
        ownerIds: [],
      };
      existing.pickups += 1;
      if (!existing.ownerIds.includes(tx.owner_id)) existing.ownerIds.push(tx.owner_id);
      byPlayer.set(item.player_id, existing);
    }
  }

  return Array.from(byPlayer.values())
    .sort((a, b) => b.pickups - a.pickups || a.playerId - b.playerId)
    .slice(0, limit);
}

export interface VersatilePlayer {
  playerId: number;
  playerName: string;
  /** Positions with at least `minGames` career games. */
  positionCount: number;
  positions: { positionId: number; games: number }[];
  totalGames: number;
}

/**
 * Most versatile players by career positions played.
 *
 * `minGames` filters out the one-off appearances that would otherwise make
 * every long career look versatile — a position-player pitching a single
 * blowout inning is a fun fact, not versatility. Pinch-hitting is excluded
 * outright (DISPLAY_EXCLUDED_POSITION_IDS): it is a plate appearance, not a
 * position, and counting it ranked bench bats above real utility players.
 * Career-level, so it spans all 17 seasons wherever ESPN reported games by
 * position.
 */
export function getVersatilePlayers(
  players: { player_id: number; full_name: string; games_played_by_position: Record<string, number> }[],
  { minGames = 10, limit = 25 } = {}
): VersatilePlayer[] {
  return players
    .map(player => {
      const positions = Object.entries(player.games_played_by_position)
        .map(([positionId, games]) => ({ positionId: Number(positionId), games }))
        .filter(p => p.games >= minGames && !DISPLAY_EXCLUDED_POSITION_IDS.has(p.positionId))
        .sort((a, b) => b.games - a.games || a.positionId - b.positionId);
      return {
        playerId: player.player_id,
        playerName: player.full_name,
        positionCount: positions.length,
        positions,
        totalGames: positions.reduce((sum, p) => sum + p.games, 0),
      };
    })
    .filter(p => p.positionCount >= 2)
    .sort((a, b) => b.positionCount - a.positionCount || b.totalGames - a.totalGames)
    .slice(0, limit);
}
