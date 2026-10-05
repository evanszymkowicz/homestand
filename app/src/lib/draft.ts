import type { DraftPick, Keeper, Player, PlayerSeasonPoints, Team } from "../types";

export interface RenumberedPick extends DraftPick {
  live_round: number;
  live_overall_pick: number;
}

/** The live (non-keeper) picks for one draft year, ordered by overall pick.
 * Filters on the `keeper` field itself, not `round_id <= 5` -- `keeper` is
 * the reconciled boolean  */
export function getLiveDraftPicks(picks: DraftPick[], year: number): DraftPick[] {
  return picks.filter(p => p.year === year && !p.keeper).sort((a, b) => a.overall_pick_number - b.overall_pick_number);
}

/** Renumbers a year's live picks starting at Round 1, independent of the raw
 * draft's round numbering. Round count derives from the live pick count and
 * team count -- never hardcoded -- since it varies by year (2009: 30 live
 * rounds, nothing kept yet; 2014: short one pick; 2019: 26 due to the Acuna
 * exception; every other year: 25). */
export function renumberLiveRounds(livePicks: DraftPick[], teamCount: number): RenumberedPick[] {
  return livePicks.map((pick, i) => ({
    ...pick,
    live_overall_pick: i + 1,
    live_round: Math.floor(i / teamCount) + 1,
  }));
}

/** Every draft year present in `picks`, each renumbered against that year's
 * own team count, ascending by year. The one map the route builds once and
 * reuses for the Seasons tab's League table, Mr. Irrelevant, and Steals &
 * Busts. */
export function getRenumberedBoardsByYear(picks: DraftPick[], teams: Team[]): Map<number, RenumberedPick[]> {
  const years = Array.from(new Set(picks.map(p => p.year))).sort((a, b) => a - b);
  const map = new Map<number, RenumberedPick[]>();
  for (const year of years) {
    const teamCount = new Set(teams.filter(t => t.year === year).map(t => t.espn_team_id)).size;
    map.set(year, renumberLiveRounds(getLiveDraftPicks(picks, year), teamCount || 1));
  }
  return map;
}

/** A player's total box-score points for one season, across every team they
 * appeared under that year (handles in-season trades/waiver pickups).
 * Reads the precomputed data/processed/player_season_points.json rather than
 * summing box_scores/*.json client-side -- that combined file runs ~70MB
 * across every year, far more than a draft leaderboard should ever cost to
 * load. Returns null when no row exists at all (no recorded box-score
 * activity that season) -- distinct from a real recorded 0.0 -- so display
 * contexts can show "no data" instead of a fake zero; callers that need a
 * guaranteed number (career-total sums, where a missing row should correctly
 * contribute nothing) coerce with `?? 0` themselves. */
export function getPlayerSeasonPoints(
  seasonPoints: PlayerSeasonPoints[],
  year: number,
  playerId: number
): number | null {
  return seasonPoints.find(r => r.year === year && r.player_id === playerId)?.points ?? null;
}

export interface MrIrrelevantEntry {
  year: number;
  pick: RenumberedPick;
  /** Null when no season-points row exists at all for this pick's player/year --
   * distinct from a real recorded 0.0. */
  points: number | null;
  keptNextYear: boolean;
}

/** The last pick of every covered season's renumbered live board, immortalized
 * -- not affected by the renumbering itself, just whichever pick ends up
 * last. Most recent year first. */
export function getMrIrrelevant(
  boardsByYear: Map<number, RenumberedPick[]>,
  seasonPoints: PlayerSeasonPoints[],
  keepers: Keeper[]
): MrIrrelevantEntry[] {
  const entries: MrIrrelevantEntry[] = [];
  for (const [year, picks] of boardsByYear) {
    if (picks.length === 0) continue;
    const pick = picks[picks.length - 1];
    entries.push({
      year,
      pick,
      points: getPlayerSeasonPoints(seasonPoints, year, pick.player_id),
      keptNextYear: keepers.some(k => k.year === year + 1 && k.player_id === pick.player_id),
    });
  }
  return entries.sort((a, b) => b.year - a.year);
}

/** How a pick's player fared afterward, for the Steals & Busts table's
 * highlight color: "kept" (kept onto next year's roster, gold, same signal as
 * Mr. Irrelevant's asterisk) outranks redraft outcome even if the player was
 * later redrafted lower, since a keeper never re-entered a live draft. Absent
 * a keeper, "improved" (redrafted into an earlier live round than this pick,
 * blue) or "declined" (redrafted into the same or a later round -- red) is
 * decided by the player's next live-draft appearance, whichever year that
 * is; "gone" (never live-drafted again) renders no marker at all -- nearly
 * every bust is gone, so arrowing them all carried no signal. */
export type RedraftStatus = "kept" | "improved" | "declined" | "gone";

export interface DraftStealEntry {
  pick: RenumberedPick;
  /** Null when no season-points row exists at all for this pick's player/year --
   * distinct from a real recorded 0.0. Excluded from the production-rank
   * computation below (see getDraftSteals), so a no-data pick's rankGap comes
   * out neutral (0) rather than looking like the league's biggest bust. */
  points: number | null;
  /** live_overall_pick minus this player's production rank that year (1 =
   * most points among that year's live picks) -- positive means he produced
   * like a much earlier pick than he was (a steal), negative means the
   * opposite (a bust). */
  rankGap: number;
  redraftStatus: RedraftStatus;
}

/** A board's round count, derived the same way renumberLiveRounds derived
 * each pick's round -- needed to compare rounds across years, since 2009 (30
 * live rounds) isn't directly comparable to every other year's 25-26. */
function getRoundCount(picks: RenumberedPick[]): number {
  return picks.length === 0 ? 0 : picks[picks.length - 1].live_round;
}

function getRedraftStatus(
  pick: RenumberedPick,
  boardsByYear: Map<number, RenumberedPick[]>,
  keepers: Keeper[]
): RedraftStatus {
  const wasKept = keepers.some(k => k.year === pick.year + 1 && k.player_id === pick.player_id);
  if (wasKept) return "kept";

  const laterYears = Array.from(boardsByYear.keys())
    .filter(y => y > pick.year)
    .sort((a, b) => a - b);
  const pickRoundCount = getRoundCount(boardsByYear.get(pick.year) ?? []);
  for (const year of laterYears) {
    const nextPick = boardsByYear.get(year)?.find(p => p.player_id === pick.player_id);
    if (nextPick) {
      const nextRoundCount = getRoundCount(boardsByYear.get(year) ?? []);
      const pickFraction = pick.live_round / pickRoundCount;
      const nextFraction = nextPick.live_round / nextRoundCount;
      return nextFraction < pickFraction ? "improved" : "declined";
    }
  }
  return "gone";
}

export interface PlayerSearchResult {
  playerId: number;
  playerName: string;
}

/** Every player in players.json matching a search query, drafted or not --
 * broader than a draft-only search, since a player added purely via waiver
 * or trade never has a draft_picks.json row but is still a real player this
 * league has rostered. Case-insensitive substring match, capped for a
 * compact dropdown. */
export function searchPlayers(players: Player[], query: string, limit = 8): PlayerSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return players
    .filter(p => p.full_name.toLowerCase().includes(q))
    .slice(0, limit)
    .map(p => ({ playerId: p.player_id, playerName: p.full_name }));
}

/** Years this player has a live (non-keeper) pick -- what the search bar's
 * onLocate (DraftPlayerSearch.tsx) jumps between, since only these years'
 * getLiveDraftPicks' rows include them. Ascending. */
export function getLiveDraftYears(playerId: number, draftPicks: DraftPick[]): number[] {
  return Array.from(new Set(draftPicks.filter(p => p.player_id === playerId && !p.keeper).map(p => p.year))).sort(
    (a, b) => a - b
  );
}

export type DraftValueLabel = "steal" | "bust" | null;

export interface PlayerDraftHistoryEntry {
  year: number;
  ownerId: string;
  isKeeper: boolean;
  /** Raw draft-slot position (draft_picks.json's round_id/overall_pick_number,
   * not the live-only renumbering RenumberedPick above uses) -- the round/pick
   * this player actually went at, keeper rounds included. */
  roundId: number;
  overallPickNumber: number;
  /** Null when no season-points row exists at all for this player/year --
   * distinct from a real recorded 0.0. */
  points: number | null;
  /** True on the live-pick row that was that year's last pick (Mr. Irrelevant
   * hall of fame) -- never true on a keeper-round row, since Mr. Irrelevant is
   * defined off the live board. */
  isMrIrrelevant: boolean;
  /** This live pick's outcome from the Steals & Busts leaderboard -- null on
   * keeper-round rows (a keeper never re-enters a live draft, so
   * getDraftSteals never produces an entry for one) and on a live pick with
   * no corresponding steals-leaderboard entry. */
  redraftStatus: RedraftStatus | null;
  rankGap: number | null;
  /** "steal" if this pick ranks in the top DRAFT_VALUE_LEADERBOARD_SIZE of
   * the all-time rankGap leaderboard, "bust" if in the bottom
   * DRAFT_VALUE_LEADERBOARD_SIZE, null otherwise (including keeper rows). */
  valueLabel: DraftValueLabel;
}

/** One player's entire draft/keeper history, oldest first -- every year they
 * were picked (live or kept), which owner picked them, that season's points,
 * and (on live-pick rows) whether that pick was Mr. Irrelevant and how it
 * ranked on the Steals & Busts leaderboard. Reads straight off
 * draft_picks.json's `keeper` flag rather than cross-referencing
 * keepers.json, since every keeper pick already has a matching draft_picks
 * entry with keeper=true (see getLiveDraftPicks's doc comment on why
 * `keeper` -- not raw round_id -- is the source of truth). Takes the same
 * mrIrrelevantEntries/draftSteals arrays the Draft route already computes
 * once, rather than recomputing league-wide leaderboards per player search. */
export function getPlayerDraftHistory(
  playerId: number,
  draftPicks: DraftPick[],
  seasonPoints: PlayerSeasonPoints[],
  mrIrrelevantEntries: MrIrrelevantEntry[],
  draftSteals: DraftStealEntry[]
): PlayerDraftHistoryEntry[] {
  return draftPicks
    .filter(p => p.player_id === playerId)
    .map(p => {
      const stealIndex = draftSteals.findIndex(s => s.pick.year === p.year && s.pick.player_id === playerId);
      const steal = stealIndex === -1 ? undefined : draftSteals[stealIndex];
      const valueLabel: DraftValueLabel =
        stealIndex === -1
          ? null
          : stealIndex < DRAFT_VALUE_LEADERBOARD_SIZE
            ? "steal"
            : stealIndex >= draftSteals.length - DRAFT_VALUE_LEADERBOARD_SIZE
              ? "bust"
              : null;
      return {
        year: p.year,
        ownerId: p.owner_id,
        isKeeper: p.keeper,
        roundId: p.round_id,
        overallPickNumber: p.overall_pick_number,
        points: getPlayerSeasonPoints(seasonPoints, p.year, p.player_id),
        isMrIrrelevant: mrIrrelevantEntries.some(e => e.year === p.year && e.pick.player_id === playerId),
        redraftStatus: steal?.redraftStatus ?? null,
        rankGap: steal?.rankGap ?? null,
        valueLabel,
      };
    })
    .sort((a, b) => b.year - a.year);
}

/** Same top/bottom cutoff the Draft Steals route's leaderboard tables use --
 * shared here so a player's history card can flag "steal"/"bust" using the
 * exact same threshold rather than a second magic number. */
export const DRAFT_VALUE_LEADERBOARD_SIZE = 15;

/** Redraft-outcome marker (kept/improved/declined) shared by the Steals &
 * Busts tables and a player's draft-history card, so both render the exact
 * same glyph/color for the same status. "gone" (never drafted again) gets no
 * marker. */
export function redraftMarker(status: RedraftStatus): string {
  switch (status) {
    case "kept":
      return "*";
    case "improved":
      return "↑";
    case "declined":
      return "↓";
    case "gone":
      return "";
  }
}

export function redraftMarkerClass(status: RedraftStatus): string {
  switch (status) {
    case "kept":
      return "text-gold";
    case "improved":
      return "text-diverge-pos";
    case "declined":
      return "text-diverge-neg";
    case "gone":
      return "";
  }
}

/** All-time draft-value leaderboard: every live pick ever, ranked by how much
 * better (or worse) a player performed than his draft slot implied. There's
 * no external ADP curve for this league to grade against, so "expected"
 * value is each pick's rank among that same year's own live-board points --
 * comparable across years since every year draws from the same 10-team pool
 * size (bar 2009's 30 live rounds), not an absolute external baseline. */
export function getDraftSteals(
  boardsByYear: Map<number, RenumberedPick[]>,
  seasonPoints: PlayerSeasonPoints[],
  keepers: Keeper[]
): DraftStealEntry[] {
  const entries: DraftStealEntry[] = [];
  for (const [year, picks] of boardsByYear) {
    const withPoints = picks.map(pick => ({ pick, points: getPlayerSeasonPoints(seasonPoints, year, pick.player_id) }));
    const productionRank = new Map<number, number>();
    //  Create ranked as a constant var to hold it so that no fake last-place finishes bubble up
    const ranked = [...withPoints]
      .filter((entry): entry is { pick: RenumberedPick; points: number } => entry.points !== null)
      .sort((a, b) => b.points - a.points);
    for (const [i, entry] of ranked.entries()) productionRank.set(entry.pick.player_id, i + 1);

    for (const { pick, points } of withPoints) {
      entries.push({
        pick,
        points,
        rankGap: pick.live_overall_pick - (productionRank.get(pick.player_id) ?? pick.live_overall_pick),
        redraftStatus: getRedraftStatus(pick, boardsByYear, keepers),
      });
    }
  }
  return entries.sort((a, b) => b.rankGap - a.rankGap);
}
