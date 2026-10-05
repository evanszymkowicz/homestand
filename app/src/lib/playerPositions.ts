import { DISPLAY_EXCLUDED_POSITION_IDS, getEligiblePositionIds, positionLabel } from "./positions";
import type { MlbTeam, PlayerSeason } from "../types";

export interface SeasonPositions {
  year: number;
  /** ESPN's own `default_position_id` for that season, labelled. Present for
   * every row across all 18 years (validate.py's player_positions asserts it). */
  primary: string;
  primaryPositionId: number;
  /** Games at the primary position, straight from `games_played_by_position`
   * with no 10-game floor applied (unlike `played`/`secondary` below) --
   * ESPN's declared position is shown regardless of how little he played
   * there, so its games count shouldn't vanish just because it's under the
   * floor. undefined only when he never appears at that position id at all
   * (games_played_by_position has no entry for it). */
  primaryGames: number | undefined;
  /** Every position with recorded games that season, most-played first,
   * INCLUDING the primary — so callers can show the full picture and mark the
   * primary within it rather than reconstructing the ordering. */
  played: { positionId: number; label: string; games: number }[];
  /** Positions played that are NOT the primary, most-played first. */
  secondary: { positionId: number; label: string; games: number }[];
  /** Every position with any games that season, no 10-game floor (unlike `played`). */
  allAppearances: { positionId: number; label: string; games: number }[];
  /** Every position this player was ESPN fantasy-eligible for that season --
   * player_seasons.json's own `eligible_slots`, mapped via
   * positions.ts's getEligiblePositionIds, ascending by position id. NOT
   * games-derived and NOT the same set as `played`/`secondary` above (see
   * their doc comment for why those stay games-only): eligibility carries
   * over from a prior season's qualifying games even with zero games this
   * season (e.g. Ben Rice reads catcher-eligible here in 2026 despite zero
   * 2026 catcher games, because he caught 36 games in 2025), which is exactly
   * the real fantasy-roster question `played` deliberately doesn't answer.
   * Computed off this row directly. */
  eligible: number[];
  /** 2017+ only. null earlier means ESPN reported none, not "no number". */
  jersey: string | null;
}

/**
 * Per-season position and jersey detail for one player, newest season first.
 *
 * Two different things are deliberately kept apart here. `primary` is ESPN's
 * declared position for the season and is what the card features; `played` is
 * where the player actually appeared, from `games_played_by_position`. They
 * disagree often and legitimately — a shortstop who spent most of a year at
 * second still carries his declared position — so neither is derived from the
 * other.
 *
 * `played` requires at least 10 games at a position that season — our
 * league's own qualification threshold, not ESPN's `eligible_slots` (which
 * ESPN grants far more loosely, e.g. by default draft-day eligibility for
 * rookies). A single defensive cameo shouldn't read as a real position; the
 * primary slot is unaffected by this floor since it's ESPN's declared
 * position, not derived from games played.
 *
 * `games_played_by_position` can total well past 162: ESPN counts a player at
 * every position he appears at within a game. The counts are useful for
 * ordering and for showing versatility, not as a games-played figure.
 */
export function getPlayerSeasonPositions(
  playerId: number,
  playerSeasons: PlayerSeason[]
): SeasonPositions[] {
  return playerSeasons
    .filter(row => row.player_id === playerId)
    .map(row => {
      const allAppearances = Object.entries(row.games_played_by_position)
        .map(([positionId, games]) => ({
          positionId: Number(positionId),
          label: positionLabel(Number(positionId)),
          games,
        }))
        .filter(p => p.games > 0 && !DISPLAY_EXCLUDED_POSITION_IDS.has(p.positionId))
        .sort((a, b) => b.games - a.games || a.positionId - b.positionId);

      const played = allAppearances.filter(p => p.games >= 10);

      return {
        year: row.year,
        primary: positionLabel(row.default_position_id),
        primaryPositionId: row.default_position_id,
        primaryGames: row.games_played_by_position[row.default_position_id],
        played,
        secondary: played.filter(
          p => p.positionId !== row.default_position_id && (row.default_position_id === 10 || p.positionId !== 10)
        ),
        allAppearances,
        eligible: getEligiblePositionIds(row.eligible_slots, row.default_position_id),
        jersey: row.jersey,
      };
    })
    .sort((a, b) => b.year - a.year);
}

export interface JerseyRun {
  jersey: string;
  proTeamId: number;
  abbrev: string;
  teamName: string;
  startYear: number;
  endYear: number;
  /** Real calendar dates (from data/manual/jersey-history-overrides.json),
   * when known -- undefined for runs derived purely from ESPN's own
   * per-year data, which only has year granularity. */
  startDate?: string;
  endDate?: string;
}

/**
 * One badge per distinct (jersey number, real MLB team) stint, oldest first.
 * Consecutive seasons collapse into a single run as long as both the number
 * and the team stay the same; either changing starts a new run. Seasons with
 * no resolvable real team (no draft/keeper record that year, or ESPN's own
 * "no team on file" id 0) are dropped entirely rather than shown as a
 * teamless badge.
 *
 * Real MLB team is NOT in player_seasons.json (data/README.md 302-303):
 * per-year truth only exists in draft_picks.json/keepers.json, and only for
 * years the player was actually drafted/kept there, so `proTeamIdByYear` is
 * built by the caller from draftPicks and can legitimately have gaps (a year
 * reached purely by waiver/trade has no record at all).
 *
 * `manualStints` carries data/manual/jersey-history-overrides.json for this
 * player (oldest first). Each covers a [startYear, endYear] span -- one team,
 * one number -- and REPLACES whatever would otherwise be derived from ESPN's
 * own per-year jersey/proTeamId for every year in that span. This is how a
 * mid-season trade gets two badges instead of the single team
 * ESPN/draft_picks.json settle on for draft purposes: the traded-from and
 * traded-to teams are two adjacent manual stints both spanning the same
 * single year. A year not covered by any manual stint falls back to the
 * normal single-stint derivation from `seasonPositions`/`proTeamIdByYear`.
 * `startDate`/`endDate` (real calendar dates, when known) flow straight onto
 * the resulting run for a precise tooltip instead of a year-only range.
 */
export interface ManualJerseyStint {
  proTeamId: number;
  jersey: string;
  startYear: number;
  endYear: number;
  startDate?: string;
  endDate?: string;
}

export function getJerseyHistory(
  seasonPositions: SeasonPositions[],
  proTeamIdByYear: Map<number, number>,
  mlbTeamById: Map<number, MlbTeam>,
  manualStints: ManualJerseyStint[] = []
): JerseyRun[] {
  const manualYears = new Set<number>();
  for (const m of manualStints) {
    for (let y = m.startYear; y <= m.endYear; y++) manualYears.add(y);
  }

  interface Segment {
    proTeamId: number;
    jersey: string;
    startYear: number;
    endYear: number;
    startDate?: string;
    endDate?: string;
  }
  const segments: Segment[] = [];
  for (const sp of seasonPositions) {
    if (manualYears.has(sp.year) || sp.jersey === null) continue;
    const proTeamId = proTeamIdByYear.get(sp.year);
    if (proTeamId) segments.push({ proTeamId, jersey: sp.jersey, startYear: sp.year, endYear: sp.year });
  }
  segments.push(...manualStints);
  // Stable sort: same-year split stints (two manualStints entries both
  // startYear===endYear===that year) keep the oldest-first order they were
  // authored in, since auto-derived segments for those years are excluded
  // above and can't tie with them.
  segments.sort((a, b) => a.startYear - b.startYear || a.endYear - b.endYear);

  const runs: JerseyRun[] = [];
  for (const seg of segments) {
    const team = mlbTeamById.get(seg.proTeamId);
    if (!team) continue;
    const last = runs[runs.length - 1];
    if (last && last.jersey === seg.jersey && last.proTeamId === seg.proTeamId) {
      last.endYear = seg.endYear;
      if (seg.endDate) last.endDate = seg.endDate;
      continue;
    }
    runs.push({
      jersey: seg.jersey,
      proTeamId: seg.proTeamId,
      abbrev: team.abbrev,
      teamName: team.name,
      startYear: seg.startYear,
      endYear: seg.endYear,
      startDate: seg.startDate,
      endDate: seg.endDate,
    });
  }
  return runs;
}
