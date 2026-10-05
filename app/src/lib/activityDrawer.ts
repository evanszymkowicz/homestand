import { formatPoints } from "./format";
import {
  getAchievementFeats,
  getWeeklyStatLeaders,
  WEEKLY_LEADER_STATS,
  type AchievementFeat,
  type WeeklyLeaderEntry,
  type WeeklyLeaderStat,
} from "./activityAchievements";
import { findTeam } from "./schedule";
import { IR_SLOT_ID } from "./lineupSlots";
import {
  getLowestSingleWeekScores,
  getLowestScoringWins,
} from "./superlatives";
import type { BoxScoreEntry, Matchup, Owner, Player, Season, Team, Trade, Transaction, TrophyRecord } from "../types";

export type ActivityScope = "matchup" | "season";

export type EventKind = "trade" | "fa" | "il" | "matchup" | "achievement" | "trophy" | "record";

export const ALL_EVENT_KINDS: EventKind[] = ["trade", "fa", "il", "matchup", "achievement", "trophy", "record"];

export const KIND_LABELS: Record<EventKind, string> = {
  trade: "Trades",
  fa: "Waivers/FA",
  il: "IL",
  matchup: "Matchups",
  achievement: "Highlights",
  trophy: "ESPN Trophies",
  record: "Records",
};

const SCOPE_KEY = "wsob-activity-scope";
// v2: the "trophy" kind post-dates v1's stored filter lists, and parseStoredFilters
// only prunes unknown kinds (it never adds missing ones) -- a v1 list would leave
// ESPN Trophies silently unchecked for returning sessions. Bump the key instead so
// every session starts from the all-on default once.
const FILTERS_KEY = "wsob-activity-filters-v2";
const OWNER_KEY = "wsob-activity-owner";

export function parseStoredScope(raw: string | null): ActivityScope {
  return raw === "season" ? "season" : "matchup";
}

export function parseStoredFilters(raw: string | null): EventKind[] {
  if (raw === null) return ALL_EVENT_KINDS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return ALL_EVENT_KINDS;
    return [...new Set(parsed.filter((k): k is EventKind => ALL_EVENT_KINDS.includes(k as EventKind)))];
  } catch {
    return ALL_EVENT_KINDS;
  }
}

/** sessionStorage can throw in privacy modes; the drawer then just runs with
 * defaults and doesn't persist. */
export function loadStoredScope(): ActivityScope {
  try {
    return parseStoredScope(sessionStorage.getItem(SCOPE_KEY));
  } catch {
    return "matchup";
  }
}

export function saveStoredScope(scope: ActivityScope): void {
  try {
    sessionStorage.setItem(SCOPE_KEY, scope);
  } catch {
    /* non-persistent session */
  }
}

export function loadStoredFilters(): EventKind[] {
  try {
    return parseStoredFilters(sessionStorage.getItem(FILTERS_KEY));
  } catch {
    return ALL_EVENT_KINDS;
  }
}

export function saveStoredFilters(kinds: EventKind[]): void {
  try {
    sessionStorage.setItem(FILTERS_KEY, JSON.stringify(kinds));
  } catch {
    /* non-persistent session */
  }
}

export function parseStoredOwnerFilter(raw: string | null): string | null {
  return raw === null || raw === "" ? null : raw;
}

/** null means "all owners". */
export function loadStoredOwnerFilter(): string | null {
  try {
    return parseStoredOwnerFilter(sessionStorage.getItem(OWNER_KEY));
  } catch {
    return null;
  }
}

export function saveStoredOwnerFilter(ownerId: string | null): void {
  try {
    if (ownerId === null) sessionStorage.removeItem(OWNER_KEY);
    else sessionStorage.setItem(OWNER_KEY, ownerId);
  } catch {
    /* non-persistent session */
  }
}

/** The season the drawer covers: the live one while it's in progress, else the
 * newest archived season (offseason). */
export function currentSeason(seasons: Season[]): Season | null {
  const inProgress = seasons.find(s => s.status === "in_progress");
  if (inProgress) return inProgress;
  return seasons.reduce<Season | null>((latest, s) => (latest === null || s.year > latest.year ? s : latest), null);
}

export interface PlayerRef {
  playerId: number;
  name: string;
}

export interface TradeEvent {
  id: string;
  kind: "trade";
  week: number | null;
  executedDate: number | null;
  fromOwnerId: string | null;
  toOwnerId: string | null;
  /** What the from-owner gave away. */
  outPlayers: PlayerRef[];
  /** What the from-owner received. */
  inPlayers: PlayerRef[];
}

export interface FaEvent {
  id: string;
  kind: "fa";
  week: number | null;
  date: number | null;
  ownerId: string | null;
  action: "added" | "dropped";
  playerId: number;
  playerName: string;
}

export interface IlEvent {
  id: string;
  kind: "il";
  week: number | null;
  date: number | null;
  ownerId: string | null;
  action: "placed" | "activated";
  playerId: number;
  playerName: string;
}

export interface MatchupEvent {
  id: string;
  kind: "matchup";
  year: number;
  week: number;
  matchupId: number;
  winnerName: string;
  winnerOwnerId: string | null;
  /** null on a malformed side — the UI then renders plain text, not a link. */
  winnerTeamId: number | null;
  loserName: string;
  loserOwnerId: string | null;
  loserTeamId: number | null;
  winnerScore: number;
  loserScore: number;
}

export interface AchievementEvent {
  id: string;
  kind: "achievement";
  year: number;
  week: number;
  matchupId: number;
  playerId: number;
  playerName: string;
  ownerId: string;
  label: string;
  detail: string | null;
  /** The week's fantasy points, shown right-aligned. null on weekly-leader
   * rows — their label already carries the stat value. */
  points: number | null;
}

export interface TrophyEvent {
  id: string;
  kind: "trophy";
  year: number;
  ownerId: string;
  espnTeamId: number;
  /** 0-based position in ESPN's per-member 20-slot template. */
  trophySlot: number;
  /** ESPN's payload names no trophies — the slot→name mapping is pending the
   * first observed earned slot (see TROPHY_SLOT_NAMES). Events without a
   * resolved name don't render; the section shows its placeholder instead. */
  trophyName: string | null;
}

export interface RecordEvent {
  id: string;
  kind: "record";
  year: number;
  week: number;
  matchupId: number;
  ownerId: string;
  recordType: string;
  label: string;
  detail: string | null;
  points: number | null;
}

export interface ActivityFeed {
  trades: TradeEvent[];
  fas: FaEvent[];
  ils: IlEvent[];
  matchups: MatchupEvent[];
  achievements: AchievementEvent[];
  trophies: TrophyEvent[];
  records: RecordEvent[];
}

/** Narrows the feed to events involving one owner — trades the owner is on
 * either side of, matchups they played, players they rostered. null passes
 * the feed through unchanged. */
export function filterFeedByOwner(feed: ActivityFeed, ownerId: string | null): ActivityFeed {
  if (ownerId === null) return feed;
  const involves = (ids: (string | null)[]): boolean => ids.includes(ownerId);
  return {
    trades: feed.trades.filter(t => involves([t.fromOwnerId, t.toOwnerId])),
    fas: feed.fas.filter(e => e.ownerId === ownerId),
    ils: feed.ils.filter(e => e.ownerId === ownerId),
    matchups: feed.matchups.filter(m => involves([m.winnerOwnerId, m.loserOwnerId])),
    achievements: feed.achievements.filter(a => a.ownerId === ownerId),
    trophies: feed.trophies.filter(t => t.ownerId === ownerId),
    records: feed.records.filter(r => r.ownerId === ownerId),
  };
}

export interface BuildActivityFeedArgs {
  season: Season;
  scope: ActivityScope;
  matchups: Matchup[];
  teams: Team[];
  owners: Owner[];
  players: Player[];
  transactions: Transaction[];
  trades: Trade[];
  /** The season's box scores; null when they couldn't load or the season
   * lacks stat-line coverage (achievements then stay empty). */
  boxScores: BoxScoreEntry[] | null;
  /** ESPN "Fantasy Achievements" records (2026+ only); null when they couldn't
   * load or the season lacks achievements coverage (the trophy section then
   * shows its placeholder). */
  achievements: TrophyRecord[] | null;
  /** Slot→trophy-name overrides; production uses TROPHY_SLOT_NAMES. Tests
   * inject a mapping to exercise the named-row emit path. */
  trophyNames?: Record<number, string>;
}

/** The 20 ESPN "Fantasy Achievements" trophies (2026+ feature). ESPN's
 * achievements payload carries no trophy names or ids — only positional
 * slots — so this catalog backs display once the slot→name mapping is known. */
export const TROPHY_CATALOG = [
  "Bronze Boss",
  "Choke Artist",
  "Fortune Teller",
  "Ice Cold",
  "League Champ",
  "League Leader",
  "MVFP",
  "Never Took an L",
  "No Mercy",
  "Off The Charts",
  "On Fire",
  "Playoff Bound",
  "Points Savage",
  "Runner Up",
  "Steamrolled",
  "Tapped In",
  "The Commish",
  "The Negotiator",
  "Top Dog",
  "Two-Ply Try",
] as const;

export function trophyNameForSlot(slot: number, names: Record<number, string>): string | null {
  return names[slot] ?? null;
}

function featLabel(feat: AchievementFeat, startsPhrase: string | null, inProgress: boolean): { label: string; detail: string | null } {
  switch (feat.kind) {
    case "shutout":
    case "no-hitter":
    case "perfect-game": {
      const label =
        feat.kind === "shutout"
          ? inProgress ? "throws a shutout" : "threw a shutout"
          : feat.kind === "no-hitter"
            ? inProgress ? "throws a no-hitter" : "threw a no-hitter"
            : inProgress ? "throws a perfect game" : "threw a perfect game";
      const p = feat.pitching;
      // The feat flag already carries the shape (a shutout is 0 runs by
      // definition); the K count is the context worth adding.
      const detail = p === null ? null : `${p.k} K`;
      return { label, detail: detail === null ? null : startsPhrase === null ? detail : `${detail} (${startsPhrase})` };
    }
    case "cycle": {
      const b = feat.batting;
      // BattingLine has no hits field — H derives as singles+doubles+triples+HR.
      const hits = b === null ? null : b.singles + b.doubles + b.triples + b.hr;
      const detail = b === null || hits === null ? null : `${hits}-for-${b.ab}, ${b.r} R, ${b.rbi} RBI`;
      return { label: inProgress ? "hits for the cycle" : "hit for the cycle", detail };
    }
    case "grand-slam":
      return {
        label: feat.count === 1
          ? inProgress ? "hits a grand slam" : "hit a grand slam"
          : inProgress ? `hits ${feat.count} grand slams` : `hit ${feat.count} grand slams`,
        detail: null,
      };
  }
}

const LEADER_TEMPLATES: Record<WeeklyLeaderStat, (value: string, inProgress: boolean) => string> = {
  points: (v, ip) => ip ? `leads the league with ${v} points` : `led the league with ${v} points`,
  hr: (v, ip) => ip ? `leads all hitters with ${v} HR` : `led all hitters with ${v} HR`,
  rbi: (v, ip) => ip ? `leads all hitters with ${v} RBI` : `led all hitters with ${v} RBI`,
  runs: (v, ip) => ip ? `leads all hitters with ${v} runs` : `led all hitters with ${v} runs`,
  sb: (v, ip) => ip ? `leads all hitters with ${v} SB` : `led all hitters with ${v} SB`,
  pitcherK: (v, ip) => ip ? `leads in strikeouts with ${v}` : `struck out ${v} hitters`,
};

/** ESPN position id: 1 = SP — a starter's pitching-slot days phrase as
 * "starts"; everyone else (RP, hitters) reads "appearances". */
const SP_POSITION_ID = 1;

function startsPhrase(positionId: number | undefined, appearances: number): string | null {
  // A single appearance says nothing worth saying — the count only appears
  // when there's more than one (user direction 2026-08-31).
  if (appearances <= 1) return null;
  const noun = positionId === SP_POSITION_ID ? "start" : "appearance";
  return `${appearances} ${noun}s`;
}

function leaderParts(
  stat: WeeklyLeaderStat,
  entry: WeeklyLeaderEntry,
  positionId: number | undefined,
  inProgress: boolean
): { label: string; detail: string | null } {
  const valueText = stat === "points" ? formatPoints(entry.value) : String(entry.value);
  const label = LEADER_TEMPLATES[stat](valueText, inProgress);
  // Starts context only when there's more than one appearance (user
  // direction 2026-08-31); no IP anywhere.
  const detail = stat === "pitcherK" ? startsPhrase(positionId, entry.appearances) : null;
  return { label, detail };
}

/** The one unrecorded trade (no ledger row to carry a week) can't be
 * attributed to a matchup week, so it only ever shows in season scope. */
function tradeWeeks(transactions: Transaction[]): Map<string, number | null> {
  const weeks = new Map<string, number | null>();
  for (const tx of transactions) {
    if (tx.transaction_type.startsWith("TRADE")) {
      if (!weeks.has(tx.transaction_id)) weeks.set(tx.transaction_id, tx.week);
      if (tx.related_transaction_id !== null && !weeks.has(tx.related_transaction_id)) {
        weeks.set(tx.related_transaction_id, tx.week);
      }
    }
  }
  return weeks;
}

function inScopeWeek(week: number | null, season: Season, scope: ActivityScope): boolean {
  return scope === "season" || week === season.current_week;
}

/** Assembles the drawer's events for one season + scope. Transactions and
 * trades are 2019+ only by data coverage (the processed files carry nothing
 * earlier — gate displays on the season's coverage.transactions). */
export function buildActivityFeed(args: BuildActivityFeedArgs): ActivityFeed {
  const {
    season,
    scope,
    matchups,
    teams,
    owners,
    players,
    transactions,
    trades,
    boxScores,
    achievements,
    trophyNames = {},
  } = args;
  const namesById = new Map<number, string>();
  const positionsById = new Map<number, number>();
  for (const p of players) {
    namesById.set(p.player_id, p.full_name);
    positionsById.set(p.player_id, p.default_position_id);
  }
  const playerName = (id: number): string => namesById.get(id) ?? "Unknown player";

  const weeks = tradeWeeks(transactions);

  const tradeEvents: TradeEvent[] = trades
    .filter(t => t.year === season.year && inScopeWeek(weeks.get(t.trade_id) ?? null, season, scope))
    .map(t => ({
      id: `trade-${t.trade_id}`,
      kind: "trade" as const,
      week: weeks.get(t.trade_id) ?? null,
      executedDate: t.executed_date,
      fromOwnerId: t.team_a_owner_id,
      toOwnerId: t.team_b_owner_id,
      outPlayers: t.items
        .filter(i => i.item_type === "TRADE" && i.from_espn_team_id === t.team_a_espn_team_id)
        .map(i => ({ playerId: i.player_id, name: playerName(i.player_id) })),
      inPlayers: t.items
        .filter(i => i.item_type === "TRADE" && i.to_espn_team_id === t.team_a_espn_team_id)
        .map(i => ({ playerId: i.player_id, name: playerName(i.player_id) })),
    }))
    .sort((a, b) => (b.executedDate ?? 0) - (a.executedDate ?? 0));

  const faEvents: FaEvent[] = transactions
    .filter(
      tx =>
        tx.year === season.year &&
        inScopeWeek(tx.week, season, scope) &&
        (tx.transaction_type === "FREEAGENT" || tx.transaction_type === "ROSTER") &&
        (tx.status === null || tx.status === "EXECUTED")
    )
    .flatMap(tx =>
      tx.items
        .filter(i => i.item_type === "ADD" || i.item_type === "DROP")
        .map(i => ({
          id: `fa-${tx.transaction_id}-${i.item_type}-${i.player_id}`,
          kind: "fa" as const,
          week: tx.week,
          date: tx.proposed_date,
          ownerId: tx.owner_id,
          action: i.item_type === "ADD" ? ("added" as const) : ("dropped" as const),
          playerId: i.player_id,
          playerName: playerName(i.player_id),
        }))
    )
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0));

  // IL placements/activations ride the ledger as LINEUP items touching the IR
  // slot. Only 2023+ rows exist (2023 sparse, none 2019-2022) — the league
  // didn't record IL moves through this endpoint earlier. Drops of an
  // IL-stashed player stay FA drops; TRADE items touching IL are just trades.
  const ilEvents: IlEvent[] = transactions
    .filter(
      tx =>
        tx.year === season.year &&
        inScopeWeek(tx.week, season, scope) &&
        (tx.transaction_type === "FREEAGENT" || tx.transaction_type === "ROSTER") &&
        (tx.status === null || tx.status === "EXECUTED")
    )
    .flatMap(tx =>
      tx.items
        .filter(
          i => i.item_type === "LINEUP" && (i.to_lineup_slot_id === IR_SLOT_ID || i.from_lineup_slot_id === IR_SLOT_ID)
        )
        .map(i => ({
          id: `il-${tx.transaction_id}-${i.player_id}`,
          kind: "il" as const,
          week: tx.week,
          date: tx.proposed_date,
          ownerId: tx.owner_id,
          action: i.to_lineup_slot_id === IR_SLOT_ID ? ("placed" as const) : ("activated" as const),
          playerId: i.player_id,
          playerName: playerName(i.player_id),
        }))
    )
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0));

  const matchupEvents: MatchupEvent[] = matchups
    .filter(
      m =>
        m.year === season.year &&
        (m.winner === "HOME" || m.winner === "AWAY") &&
        m.away !== null &&
        inScopeWeek(m.week, season, scope)
    )
    .map(m => {
      const teamName = (espnTeamId: number | null): string =>
        espnTeamId === null ? "Unknown team" : (findTeam(teams, m.year, espnTeamId)?.team_name ?? "Unknown team");
      const homeWins = m.winner === "HOME";
      const winnerSide = homeWins ? m.home : m.away!;
      const loserSide = homeWins ? m.away! : m.home;
      return {
        id: `matchup-${m.year}-${m.matchup_id}`,
        kind: "matchup" as const,
        year: m.year,
        week: m.week,
        matchupId: m.matchup_id,
        winnerName: teamName(winnerSide.espn_team_id),
        winnerOwnerId: winnerSide.owner_id,
        winnerTeamId: winnerSide.espn_team_id,
        loserName: teamName(loserSide.espn_team_id),
        loserOwnerId: loserSide.owner_id,
        loserTeamId: loserSide.espn_team_id,
        winnerScore: winnerSide.score,
        loserScore: loserSide.score,
      };
    })
    .sort((a, b) => b.week - a.week);

  const highlights: AchievementEvent[] = [];
  if (boxScores !== null && season.coverage.stat_lines === "full") {
    const scopedEntries = scope === "matchup" ? boxScores.filter(e => e.week === season.current_week) : boxScores;

    const featEvents = getAchievementFeats(scopedEntries).map(f => {
      const inProgress = f.week === season.current_week;
      const { label, detail } = featLabel(f, startsPhrase(positionsById.get(f.playerId), f.appearances), inProgress);
      return {
        id: `feat-${f.year}-${f.week}-${f.playerId}-${f.kind}`,
        kind: "achievement" as const,
        year: f.year,
        week: f.week,
        matchupId: f.matchupId,
        playerId: f.playerId,
        playerName: f.playerName,
        ownerId: f.ownerId,
        label,
        detail,
        points: f.points,
      };
    });

    const leaders = getWeeklyStatLeaders(scopedEntries);
    const leaderEvents = WEEKLY_LEADER_STATS.map((stat): AchievementEvent | null => {
      const entry = leaders[stat];
      if (entry === null) return null;
      const inProgress = entry.week === season.current_week;
      const { label, detail } = leaderParts(stat, entry, positionsById.get(entry.playerId), inProgress);
      return {
        id: `leader-${season.year}-${entry.week}-${stat}-${entry.playerId}`,
        kind: "achievement" as const,
        year: season.year,
        week: entry.week,
        matchupId: entry.matchupId,
        playerId: entry.playerId,
        playerName: entry.playerName,
        ownerId: entry.ownerId,
        label,
        detail,
        points: null,
      };
    }).filter((e): e is AchievementEvent => e !== null);

    highlights.push(...featEvents, ...leaderEvents);
    highlights.sort((a, b) => b.week - a.week || (b.points ?? 0) - (a.points ?? 0));
  }

  // Season scope only: the achievements payload carries no earn dates, so a
  // trophy can't be placed inside a matchup window (daily-capture diffs may
  // derive dates later — see the spec's open items). Records whose owner or
  // team didn't resolve are validate.py's problem; skipping them here keeps
  // an unattributable trophy out of the UI.
  const trophies: TrophyEvent[] = [];
  if (achievements !== null && scope === "season" && season.coverage.achievements !== "missing") {
    for (const record of achievements) {
      if (record.year !== season.year) continue;
      if (record.owner_id === null || record.espn_team_id === null) continue;
      for (const slot of record.trophies) {
        if (!slot.earned) continue;
        const trophyName = trophyNameForSlot(slot.slot, trophyNames);
        if (trophyName === null) continue;
        trophies.push({
          id: `trophy-${record.year}-${record.member_key}-${slot.slot}`,
          kind: "trophy",
          year: record.year,
          ownerId: record.owner_id,
          espnTeamId: record.espn_team_id,
          trophySlot: slot.slot,
          trophyName,
        });
      }
    }
  }

  // Detect current-week records: compare the current week's scores against
  // historical all-time records. Only in matchup scope (current week).
  const records: RecordEvent[] = [];
  if (scope === "matchup" && season.coverage.matchups === "full") {
    const currentWeekMatchups = matchups.filter(
      m => m.year === season.year && m.week === season.current_week && m.winner !== "UNDECIDED"
    );
    if (currentWeekMatchups.length > 0) {
      // Get historical records (all seasons) — exclude the current week to
      // avoid comparing a score against itself.
      const priorMatchups = matchups.filter(m => !(m.year === season.year && m.week === season.current_week));
      // The five prior-record extremes each need to walk `priorMatchups`
      // once. Three of them ("biggest margin", "highest score",
      // "highest-scoring loss") are simple side-state tracking, so derive
      // them together here in a single pass. The two "lowest" extremes need
      // the superlatives helpers' own zero-score handling, so delegate
      // those two to keep that filter logic in one place.
      let prevBlowoutMargin = 0;
      let prevHighScore = 0;
      let prevHighLoss = 0;
      for (const m of priorMatchups) {
        if (m.winner === "UNDECIDED" || m.away === null) continue;
        const margin = Math.abs(m.home.score - m.away.score);
        if (margin > prevBlowoutMargin) prevBlowoutMargin = margin;
        if (m.home.score > prevHighScore) prevHighScore = m.home.score;
        if (m.away.score > prevHighScore) prevHighScore = m.away.score;
        const homeLost = m.winner === "AWAY" && m.home.score !== 0;
        const awayLost = m.winner === "HOME" && m.away.score !== 0;
        if (homeLost && m.home.score > prevHighLoss) prevHighLoss = m.home.score;
        if (awayLost && m.away.score > prevHighLoss) prevHighLoss = m.away.score;
      }
      const lowestDecided = getLowestSingleWeekScores(priorMatchups, teams, owners, 1);
      const lowestWin = getLowestScoringWins(priorMatchups, teams, owners, 1);
      const prevLowScore = lowestDecided.length > 0 ? lowestDecided[0].team.score : Infinity;
      const prevLowWin = lowestWin.length > 0 ? lowestWin[0].team.score : Infinity;

      for (const m of currentWeekMatchups) {
        if (m.away === null) continue;
        const homeTeam = findTeam(teams, m.year, m.home.espn_team_id);
        const awayTeam = findTeam(teams, m.year, m.away.espn_team_id);
        const homeOwnerId = homeTeam?.owner_ids[0] ?? null;
        const awayOwnerId = awayTeam?.owner_ids[0] ?? null;

        const winnerSide = m.winner === "HOME" ? m.home : m.away;
        const loserSide = m.winner === "HOME" ? m.away : m.home;
        const margin = Math.abs(winnerSide.score - loserSide.score);
        const winnerOwnerId = m.winner === "HOME" ? homeOwnerId : awayOwnerId;
        const loserOwnerId = m.winner === "HOME" ? awayOwnerId : homeOwnerId;
        const winnerName = m.winner === "HOME" ? homeTeam?.team_name : awayTeam?.team_name;
        const loserName = m.winner === "HOME" ? awayTeam?.team_name : homeTeam?.team_name;

        // Biggest blowout record
        if (margin > prevBlowoutMargin && winnerOwnerId) {
          records.push({
            id: `record-blowout-${m.year}-${m.matchup_id}`,
            kind: "record",
            year: m.year,
            week: m.week,
            matchupId: m.matchup_id,
            ownerId: winnerOwnerId,
            recordType: "biggest_blowout",
            label: `Sets the all-time biggest blowout record`,
            detail: `${winnerName} over ${loserName} by ${formatPoints(margin)} points`,
            points: margin,
          });
        }

        // Highest single-week score record
        if (winnerSide.score > prevHighScore && winnerOwnerId) {
          records.push({
            id: `record-highscore-${m.year}-${m.matchup_id}`,
            kind: "record",
            year: m.year,
            week: m.week,
            matchupId: m.matchup_id,
            ownerId: winnerOwnerId,
            recordType: "highest_score",
            label: `Sets the all-time single-week scoring record`,
            detail: `${winnerName} scored ${formatPoints(winnerSide.score)} points`,
            points: winnerSide.score,
          });
        }

        // Lowest single-week score record (only if lower than previous, and > 0)
        if (loserSide.score < prevLowScore && loserSide.score > 0 && loserOwnerId) {
          records.push({
            id: `record-lowscore-${m.year}-${m.matchup_id}`,
            kind: "record",
            year: m.year,
            week: m.week,
            matchupId: m.matchup_id,
            ownerId: loserOwnerId,
            recordType: "lowest_score",
            label: `Sets the all-time single-week scoring low`,
            detail: `${loserName} scored ${formatPoints(loserSide.score)} points`,
            points: loserSide.score,
          });
        }

        // Highest losing score record
        if (loserSide.score > prevHighLoss && loserOwnerId) {
          records.push({
            id: `record-highloss-${m.year}-${m.matchup_id}`,
            kind: "record",
            year: m.year,
            week: m.week,
            matchupId: m.matchup_id,
            ownerId: loserOwnerId,
            recordType: "highest_loss",
            label: `Sets the highest-scoring loss record`,
            detail: `${loserName} scored ${formatPoints(loserSide.score)} but lost`,
            points: loserSide.score,
          });
        }

        // Lowest winning score record (only if lower than previous)
        if (winnerSide.score < prevLowWin && winnerOwnerId) {
          records.push({
            id: `record-lowwin-${m.year}-${m.matchup_id}`,
            kind: "record",
            year: m.year,
            week: m.week,
            matchupId: m.matchup_id,
            ownerId: winnerOwnerId,
            recordType: "lowest_win",
            label: `Sets the lowest-scoring win record`,
            detail: `${winnerName} scored only ${formatPoints(winnerSide.score)} but won`,
            points: winnerSide.score,
          });
        }
      }
      records.sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
    }
  }

  return {
    trades: tradeEvents,
    fas: faEvents,
    ils: ilEvents,
    matchups: matchupEvents,
    achievements: highlights,
    trophies,
    records,
  };
}
