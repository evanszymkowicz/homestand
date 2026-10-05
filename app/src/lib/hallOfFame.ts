import { getPlayerSeasonPoints } from "./draft";
import { IR_SLOT_ID } from "./lineupSlots";
import type { BoxScoreEntry, Keeper, PlayerSeasonPoints } from "../types";

/**
 * Superlatives Hall of Fame / Hall of Shame derivations. Same convention as
 * stats.ts/superlatives.ts -- pure functions over already-loaded JSON, nothing
 * written back to data/.
 */

export interface PitchingFeatEntry {
  year: number;
  week: number;
  matchupId: number;
  playerId: number;
  playerName: string;
  ownerId: string;
  isNoHitter: boolean;
  isPerfectGame: boolean;
}

/** Every shutout (and, as a subset, every no-hitter or perfect game) thrown
 * while owned. PitchingLine is a whole-week aggregate, not per-game -- a week
 * with a no-hitter can also contain a second, ordinary start, so only
 * "year + week" is ever reportable, never an exact calendar date. Checks nh,
 * sho, and pg independently (not assuming a no-hitter or perfect game is
 * always flagged sho too) since that's a real-baseball possibility -- pg
 * specifically has never occurred in this league's history (see
 * scripts/lib/stat_ids.py's PG note), but is still checked for completeness
 * rather than silently dropped if a future season ever has one. Most recent
 * first. */
export function getPitchingFeats(boxScoresByYear: Map<number, BoxScoreEntry[]>): PitchingFeatEntry[] {
  const entries: PitchingFeatEntry[] = [];
  for (const boxScores of boxScoresByYear.values()) {
    for (const entry of boxScores) {
      if (!entry.pitching) continue;
      if (entry.pitching.sho > 0 || entry.pitching.nh > 0 || entry.pitching.pg > 0) {
        entries.push({
          year: entry.year,
          week: entry.week,
          matchupId: entry.matchup_id,
          playerId: entry.player_id,
          playerName: entry.player_name,
          ownerId: entry.owner_id,
          isNoHitter: entry.pitching.nh > 0,
          isPerfectGame: entry.pitching.pg > 0,
        });
      }
    }
  }
  return entries.sort((a, b) => b.year - a.year || b.week - a.week);
}

export interface BlownSaveLeaderEntry {
  playerId: number;
  playerName: string;
  blownSaves: number;
}

/** All-time blown-save leaderboard, summed across every BoxScoreEntry a
 * pitcher appears in (already scoped to weeks they were actually rostered,
 * since a BoxScoreEntry only exists for a rostered week). Rank 1 first. */
export function getBlownSaveHallOfShame(boxScoresByYear: Map<number, BoxScoreEntry[]>, n = 15): BlownSaveLeaderEntry[] {
  const totals = new Map<number, BlownSaveLeaderEntry>();
  for (const boxScores of boxScoresByYear.values()) {
    for (const entry of boxScores) {
      if (!entry.pitching || entry.pitching.bs === 0) continue;
      const existing = totals.get(entry.player_id) ?? {
        playerId: entry.player_id,
        playerName: entry.player_name,
        blownSaves: 0,
      };
      existing.blownSaves += entry.pitching.bs;
      totals.set(entry.player_id, existing);
    }
  }
  return Array.from(totals.values())
    .sort((a, b) => b.blownSaves - a.blownSaves)
    .slice(0, n);
}

export interface IlStashEntry {
  playerId: number;
  playerName: string;
  ownerId: string;
  year: number;
  /** Count of scoring-period days with lineup_slot_id === IR_SLOT_ID. */
  ilDays: number;
}

/** Longest IL/DL stashes, one row per (player, owner, year) -- ranked by raw
 * day count. Caller must pass a boxScoresByYear already filtered to years
 * with real day-accurate slot data (season.coverage.stat_lines === "full",
 * i.e. 2019+); mid-week activations (IL day followed by an active-slot day in
 * the same week) are handled naturally since each slot is counted independently. */
export function getIlStashLeaderboard(boxScoresByYear: Map<number, BoxScoreEntry[]>, n = 15): IlStashEntry[] {
  const totals = new Map<string, IlStashEntry>();
  for (const boxScores of boxScoresByYear.values()) {
    for (const entry of boxScores) {
      const ilSlotDays = entry.slots.filter(s => s.lineup_slot_id === IR_SLOT_ID);
      if (ilSlotDays.length === 0) continue;
      const key = `${entry.year}:${entry.owner_id}:${entry.player_id}`;
      const existing = totals.get(key) ?? {
        playerId: entry.player_id,
        playerName: entry.player_name,
        ownerId: entry.owner_id,
        year: entry.year,
        ilDays: 0,
      };
      existing.ilDays += ilSlotDays.length;
      totals.set(key, existing);
    }
  }
  return Array.from(totals.values())
    .sort((a, b) => b.ilDays - a.ilDays)
    .slice(0, n);
}

export interface KeeperBustEntry {
  playerId: number;
  playerName: string;
  ownerId: string;
  /** The keeper row's own year -- already the bust season, not the year
   * before it. Confirmed against the Stephen Strasburg case: his 2020 keeper
   * row (kept off a 323.9-point 2019) is the one that joins to his -6.0-point
   * 2020 production; keeper.year is the season being evaluated, not a
   * "platform" year needing +1. */
  year: number;
  points: number;
  /** The prior year's points, for display context (what justified keeping
   * them) -- not used for ranking. Null if no row exists for that player/year. */
  priorYearPoints: number | null;
}

/** Keepers who produced the least fantasy value in their kept season --
 * distinct from Phase 5's draft-slot-based "Biggest Busts" (DraftSteals.tsx),
 * which compares draft position to production, not keeper cost to
 * production. Worst (lowest points) first. Keeper-seasons with no
 * season-points row on file at all are excluded entirely (not treated as a
 * 0.0) -- missing data isn't a confirmed bust, and including it would let an
 * unscored keeper-season masquerade as the league's worst. */
export function getKeeperBustHallOfFame(
  keepers: Keeper[],
  seasonPoints: PlayerSeasonPoints[],
  n = 15
): KeeperBustEntry[] {
  return [...keepers]
    .map(k => {
      const priorRow = seasonPoints.find(r => r.year === k.year - 1 && r.player_id === k.player_id);
      return {
        playerId: k.player_id,
        playerName: k.player_name,
        ownerId: k.owner_id,
        year: k.year,
        points: getPlayerSeasonPoints(seasonPoints, k.year, k.player_id),
        priorYearPoints: priorRow?.points ?? null,
      };
    })
    .filter((e): e is KeeperBustEntry => e.points !== null)
    .sort((a, b) => a.points - b.points)
    .slice(0, n);
}
