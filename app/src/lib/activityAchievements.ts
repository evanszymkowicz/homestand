import { getPitchingFeats } from "./hallOfFame";
import type { BattingLine, BoxScoreEntry, PitchingLine } from "../types";

export type FeatKind = "shutout" | "no-hitter" | "perfect-game" | "cycle" | "grand-slam";

export interface AchievementFeat {
  year: number;
  week: number;
  matchupId: number;
  playerId: number;
  playerName: string;
  ownerId: string;
  kind: FeatKind;
  /** Grand slams in the week (cycles are 0/1). 1 for the other kinds. */
  count: number;
  points: number;
  /** The week's pitching line, present on pitching feats — feeds the stat detail. */
  pitching: PitchingLine | null;
  /** The week's batting line, present on batting feats — feeds the stat detail. */
  batting: BattingLine | null;
  /** Days in a pitching slot that week — the "N starts/appearances" context. */
  appearances: number;
}

/** Pitching appearances that week, reconciled against the authoritative
 * weekly outs. Raw per-day slot stats are structurally unreliable (the live
 * pipeline's anchoring duplicates a start onto two slot days — Sale's 9-IP
 * shutout reading as two — or drops a benched start's slot entirely), so the
 * day count scales by weeklyOuts / sum(slotOuts): duplication shrinks it,
 * a missing slot day grows it, and a clean week passes through exactly.
 * Days without recorded outs (stat 34) never count — idle SP-slot days are
 * just the starter sitting there. Entries without raw_stats count 0 —
 * callers suppress the starts/appearances phrase then. */
function pitchingAppearances(entry: BoxScoreEntry): number {
  const daysWithOuts = entry.slots.filter(s => (s.raw_stats?.["34"] ?? 0) > 0);
  const weeklyOuts = entry.pitching?.outs ?? 0;
  if (daysWithOuts.length === 0 || weeklyOuts <= 0) return 0;
  const slotOuts = daysWithOuts.reduce((sum, s) => sum + (s.raw_stats?.["34"] ?? 0), 0);
  return Math.max(1, Math.round((daysWithOuts.length * weeklyOuts) / slotOuts));
}

/** Every batting feat in the given entries — cycles and grand-slam weeks.
 * Same week-grain caveat as getPitchingFeats: a BattingLine aggregates the
 * whole week, so only "year + week" is reportable, never a calendar date. */
export function getBattingFeats(entries: BoxScoreEntry[]): AchievementFeat[] {
  const feats: AchievementFeat[] = [];
  for (const entry of entries) {
    const batting = entry.batting;
    if (batting === null) continue;
    if (batting.cyc > 0) {
      feats.push({
        year: entry.year,
        week: entry.week,
        matchupId: entry.matchup_id,
        playerId: entry.player_id,
        playerName: entry.player_name,
        ownerId: entry.owner_id,
        kind: "cycle",
        count: 1,
        points: entry.total_points,
        pitching: entry.pitching,
        batting,
        appearances: pitchingAppearances(entry),
      });
    }
    if (batting.gshr > 0) {
      feats.push({
        year: entry.year,
        week: entry.week,
        matchupId: entry.matchup_id,
        playerId: entry.player_id,
        playerName: entry.player_name,
        ownerId: entry.owner_id,
        kind: "grand-slam",
        count: batting.gshr,
        points: entry.total_points,
        pitching: entry.pitching,
        batting,
        appearances: pitchingAppearances(entry),
      });
    }
  }
  return feats;
}

/** Every achievement feat in the given entries — pitching feats via
 * hallOfFame.ts's getPitchingFeats (sho/nh/pg, checked independently) plus
 * batting feats, each carrying the week's points and raw stat lines so
 * callers can compose stat details. Most recent week first, higher points
 * breaking ties within a week. Entries must all be from one season. */
export function getAchievementFeats(entries: BoxScoreEntry[]): AchievementFeat[] {
  if (entries.length === 0) return [];
  const feats: AchievementFeat[] = getBattingFeats(entries);
  const entryByKey = new Map<string, BoxScoreEntry>();
  for (const entry of entries) {
    entryByKey.set(`${entry.year}:${entry.week}:${entry.player_id}`, entry);
  }
  const year = entries[0].year;
  for (const feat of getPitchingFeats(new Map([[year, entries]]))) {
    const entry = entryByKey.get(`${feat.year}:${feat.week}:${feat.playerId}`);
    const kind: FeatKind = feat.isPerfectGame ? "perfect-game" : feat.isNoHitter ? "no-hitter" : "shutout";
    feats.push({
      year: feat.year,
      week: feat.week,
      matchupId: feat.matchupId,
      playerId: feat.playerId,
      playerName: feat.playerName,
      ownerId: feat.ownerId,
      kind,
      count: 1,
      points: entry?.total_points ?? 0,
      pitching: entry?.pitching ?? null,
      batting: entry?.batting ?? null,
      appearances: entry ? pitchingAppearances(entry) : 0,
    });
  }
  return feats.sort((a, b) => b.year - a.year || b.week - a.week || b.points - a.points);
}

export type WeeklyLeaderStat = "points" | "hr" | "rbi" | "runs" | "sb" | "pitcherK";

export const WEEKLY_LEADER_STATS: WeeklyLeaderStat[] = ["points", "hr", "rbi", "runs", "sb", "pitcherK"];

export interface WeeklyLeaderEntry {
  playerId: number;
  playerName: string;
  ownerId: string;
  week: number;
  matchupId: number;
  /** points / counts — the leader's headline number. */
  value: number;
  /** Days in a pitching slot that week — "N starts/appearances" context. */
  appearances: number;
}

interface LeaderState {
  entry: WeeklyLeaderEntry;
  points: number;
}

function better(current: LeaderState | undefined, candidate: WeeklyLeaderEntry, points: number): boolean {
  if (current === undefined) return true;
  if (candidate.value !== current.entry.value) return candidate.value > current.entry.value;
  if (points !== current.points) return points > current.points;
  return candidate.playerId < current.entry.playerId;
}

/** Best single performance per stat within the given entries — pass the week
 * window you want (one week for matchup scope, the season for season scope).
 * Entries without the relevant line (batting null for HR, pitching null for
 * K/IP) can't win that category. Ties break on points, then lower player id,
 * so the result is deterministic. */
export function getWeeklyStatLeaders(entries: BoxScoreEntry[]): Record<WeeklyLeaderStat, WeeklyLeaderEntry | null> {
  const leaders: Record<WeeklyLeaderStat, LeaderState | undefined> = {
    points: undefined,
    hr: undefined,
    rbi: undefined,
    runs: undefined,
    sb: undefined,
    pitcherK: undefined,
  };

  const consider = (stat: WeeklyLeaderStat, entry: WeeklyLeaderEntry, points: number) => {
    if (better(leaders[stat], entry, points)) leaders[stat] = { entry, points };
  };

  for (const entry of entries) {
    const appearances = pitchingAppearances(entry);
    const base = {
      playerId: entry.player_id,
      playerName: entry.player_name,
      ownerId: entry.owner_id,
      week: entry.week,
      matchupId: entry.matchup_id,
      appearances,
    };
    consider("points", { ...base, value: entry.total_points }, entry.total_points);
    if (entry.batting !== null) {
      consider("hr", { ...base, value: entry.batting.hr }, entry.total_points);
      consider("rbi", { ...base, value: entry.batting.rbi }, entry.total_points);
      consider("runs", { ...base, value: entry.batting.r }, entry.total_points);
      consider("sb", { ...base, value: entry.batting.sb }, entry.total_points);
    }
    if (entry.pitching !== null) {
      consider("pitcherK", { ...base, value: entry.pitching.k }, entry.total_points);
    }
  }

  const result = {} as Record<WeeklyLeaderStat, WeeklyLeaderEntry | null>;
  for (const stat of WEEKLY_LEADER_STATS) {
    result[stat] = leaders[stat]?.entry ?? null;
  }
  return result;
}
