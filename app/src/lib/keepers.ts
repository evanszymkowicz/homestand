import type { RenumberedPick } from "./draft";
import { divergingBackground, linearStrength } from "./diverging";
import { draftSlotPercentile, getSeasonPercentile, ownerRef, type OwnerRef } from "./stats";
import type { Keeper, MlbTeam, Owner, Player, PlayerSeasonPoints } from "../types";

/**
 * All derived keeper stats for the Keepers route, computed here at load time
 * from keepers.json + player_season_points.json + players.json + mlb_teams.json.
 * Nothing here is written back to data/ -- same "processed data stores facts,
 * the app computes conclusions" rule as stats.ts.
 */

/** Null when no season-points row exists at all for this player/year --
 * distinct from a real recorded 0.0 (see draft.ts's getPlayerSeasonPoints,
 * same convention). Callers summing across many keeper-seasons (a missing
 * row correctly contributes nothing) coerce with `?? 0` themselves. */
export function getPlayerSeasonPoints(
  seasonPoints: PlayerSeasonPoints[],
  year: number,
  playerId: number
): number | null {
  return seasonPoints.find(r => r.year === year && r.player_id === playerId)?.points ?? null;
}

export function getLatestKeeperYear(keepers: Keeper[]): number | null {
  if (keepers.length === 0) return null;
  return keepers.reduce((max, k) => Math.max(max, k.year), -Infinity);
}

export interface KeeperStreakEntry {
  playerId: number;
  playerName: string;
  /** Every owner who held this player across the streak, in year order, deduped
   * consecutively (so a same-owner streak always has exactly one entry). */
  owners: OwnerRef[];
  startYear: number;
  endYear: number;
  length: number;
  /** True when this is a same-team-slot streak whose owner changed hands
   * mid-run -- flagged rather than silently reading as one continuous
   * same-owner run (team 10: a rename in 2018 -> a new identity
   * from 2019 is the real case this exists for). Always false for the
   * same-owner variant, since a run that swaps owners can't stay in it. */
  ownershipTransferred: boolean;
}

type StreakKeySelector = (k: Keeper) => string;

/** Longest consecutive-year keeper runs, grouped by player + a caller-supplied
 * "same X" key (owner_id for the same-owner variant, espn_team_id for the
 * same-team-slot variant) -- a gap year (not kept, or kept under a different
 * key) breaks the run, matching the tie-breaking rule stats.ts's win/loss
 * streaks already use. Every run is returned, longest first; the UI slices
 * for "longest ever" vs. filters by endYear for "longest active". */
function keeperStreaks(keepers: Keeper[], owners: Owner[], sameKey: StreakKeySelector): KeeperStreakEntry[] {
  const byPlayer = new Map<number, Keeper[]>();
  for (const k of keepers) {
    const list = byPlayer.get(k.player_id) ?? [];
    list.push(k);
    byPlayer.set(k.player_id, list);
  }

  const entries: KeeperStreakEntry[] = [];
  for (const [playerId, records] of byPlayer) {
    const sorted = [...records].sort((a, b) => a.year - b.year);
    let run: Keeper[] = [];

    const flush = () => {
      if (run.length === 0) return;
      const distinctOwnerIds = Array.from(new Set(run.map(k => k.owner_id)));
      entries.push({
        playerId,
        playerName: run[0].player_name,
        owners: distinctOwnerIds.map(id => ownerRef(owners, id)),
        startYear: run[0].year,
        endYear: run[run.length - 1].year,
        length: run.length,
        ownershipTransferred: distinctOwnerIds.length > 1,
      });
      run = [];
    };

    for (const k of sorted) {
      const prev = run[run.length - 1];
      const contiguous = prev && k.year === prev.year + 1 && sameKey(k) === sameKey(prev);
      if (!contiguous) flush();
      run.push(k);
    }
    flush();
  }

  return entries.sort((a, b) => b.length - a.length);
}

/** Longest run kept by the same owner, regardless of which team slot they
 * held it on (a trade or waiver move that keeps the same owner still counts). */
export function getLongestKeptSameOwner(keepers: Keeper[], owners: Owner[]): KeeperStreakEntry[] {
  return keeperStreaks(keepers, owners, k => k.owner_id);
}

/** Longest run kept on the same team slot, regardless of owner -- diverges
 * from the same-owner variant when a franchise changes hands mid-streak. */
export function getLongestKeptSameTeamSlot(keepers: Keeper[], owners: Owner[]): KeeperStreakEntry[] {
  return keeperStreaks(keepers, owners, k => String(k.espn_team_id));
}

/** Longest run kept by the league at all, regardless of owner or team slot --
 * a trade or franchise handoff never breaks this streak, only a year nobody
 * kept the player does. This is the variant that answers "how long has this
 * player been a keeper," e.g. Freddie Freeman kept every year since 2013
 * across three different owners: same-owner/same-team-slot streaks would
 * chop that into three short runs, this reports the full run. */
export function getLongestKeptAnyOwner(keepers: Keeper[], owners: Owner[]): KeeperStreakEntry[] {
  return keeperStreaks(keepers, owners, () => "any");
}

/** Streaks still alive entering the most recent covered draft -- i.e. the run
 * that ends on the latest keeper year on record. */
export function getActiveStreaks(streaks: KeeperStreakEntry[], keepers: Keeper[]): KeeperStreakEntry[] {
  const latestYear = getLatestKeeperYear(keepers);
  if (latestYear === null) return [];
  return streaks.filter(s => s.endYear === latestYear).sort((a, b) => b.length - a.length);
}

export interface KeeperHandoffEntry {
  playerId: number;
  playerName: string;
  fromYear: number;
  toYear: number;
  fromOwner: OwnerRef;
  toOwner: OwnerRef;
  /** "trade" when the player moved to a different team slot; "transfer" when
   * the team slot stayed the same but a new owner took it over. */
  kind: "trade" | "transfer";
}

/** Every year-over-year owner change for a player kept in both years -- a
 * trade (moved to a different espn_team_id) or an ownership transfer (same
 * espn_team_id, franchise changed hands), as distinct from keeperStreaks'
 * "changed hands" flag, which only marks same-team-slot streaks that survive
 * a transfer. This surfaces the underlying events themselves, trades
 * included, whether or not the run around them counts as a streak. */
export function getKeeperHandoffs(keepers: Keeper[], owners: Owner[]): KeeperHandoffEntry[] {
  const byPlayer = new Map<number, Keeper[]>();
  for (const k of keepers) {
    const list = byPlayer.get(k.player_id) ?? [];
    list.push(k);
    byPlayer.set(k.player_id, list);
  }

  const entries: KeeperHandoffEntry[] = [];
  for (const records of byPlayer.values()) {
    const sorted = [...records].sort((a, b) => a.year - b.year);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (curr.year !== prev.year + 1) continue;
      if (curr.owner_id === prev.owner_id) continue;
      entries.push({
        playerId: curr.player_id,
        playerName: curr.player_name,
        fromYear: prev.year,
        toYear: curr.year,
        fromOwner: ownerRef(owners, prev.owner_id),
        toOwner: ownerRef(owners, curr.owner_id),
        kind: curr.espn_team_id === prev.espn_team_id ? "transfer" : "trade",
      });
    }
  }

  return entries.sort((a, b) => b.toYear - a.toYear);
}

export interface OwnerKeeperPoints {
  owner: OwnerRef;
  points: number;
  keeperSeasons: number;
  uniquePlayers: number;
}

/** Every owner's career keeper-points total, first to last -- for every
 * keeper-season this owner held, that player's points for that season (from
 * the precomputed player_season_points.json, same season-total convention
 * draft.ts's Mr. Irrelevant/steals already use). uniquePlayers is the same
 * distinct-player-count this table used to show as its own separate
 * "Keepers by Owner" list before the two were consolidated -- one owner-level
 * table now covers both. Every owner appears, even at zero, so the
 * leaderboard is complete top to bottom. */
export function getKeeperPointsByOwner(
  keepers: Keeper[],
  seasonPoints: PlayerSeasonPoints[],
  owners: Owner[]
): OwnerKeeperPoints[] {
  const totals = new Map<string, { points: number; keeperSeasons: number; players: Set<number> }>();
  for (const k of keepers) {
    const entry = totals.get(k.owner_id) ?? { points: 0, keeperSeasons: 0, players: new Set<number>() };
    entry.points += getPlayerSeasonPoints(seasonPoints, k.year, k.player_id) ?? 0;
    entry.keeperSeasons += 1;
    entry.players.add(k.player_id);
    totals.set(k.owner_id, entry);
  }
  return owners
    .map(o => {
      const entry = totals.get(o.owner_id) ?? { points: 0, keeperSeasons: 0, players: new Set<number>() };
      return {
        owner: ownerRef(owners, o.owner_id),
        points: entry.points,
        keeperSeasons: entry.keeperSeasons,
        uniquePlayers: entry.players.size,
      };
    })
    .sort((a, b) => b.points - a.points);
}

export interface PlayerKeeperPoints {
  playerId: number;
  playerName: string;
  points: number;
  keeperSeasons: number;
  /** Distinct owners who have ever kept this player -- the player-table
   * counterpart to OwnerKeeperPoints' uniquePlayers column. */
  uniqueOwners: number;
}

/** Every player's career keeper-points total across every owner who ever kept
 * them, first to last. */
export function getKeeperPointsByPlayer(keepers: Keeper[], seasonPoints: PlayerSeasonPoints[]): PlayerKeeperPoints[] {
  const totals = new Map<number, PlayerKeeperPoints>();
  const ownersByPlayer = new Map<number, Set<string>>();
  for (const k of keepers) {
    const entry = totals.get(k.player_id) ?? {
      playerId: k.player_id,
      playerName: k.player_name,
      points: 0,
      keeperSeasons: 0,
      uniqueOwners: 0,
    };
    entry.points += getPlayerSeasonPoints(seasonPoints, k.year, k.player_id) ?? 0;
    entry.keeperSeasons += 1;
    totals.set(k.player_id, entry);

    const owners = ownersByPlayer.get(k.player_id) ?? new Set<string>();
    owners.add(k.owner_id);
    ownersByPlayer.set(k.player_id, owners);
  }
  for (const entry of totals.values()) {
    entry.uniqueOwners = ownersByPlayer.get(entry.playerId)?.size ?? 0;
  }
  return Array.from(totals.values()).sort((a, b) => b.points - a.points);
}

export interface NeverKeptEntry {
  playerId: number;
  playerName: string;
  seasonsSeen: number;
  /** Career fantasy points across every covered season (kept or not). */
  careerPoints: number;
  /** players.json's roster_days -- distinct days on any roster, 2019+ only. */
  rosterDays: number;
}

/** Players with the most drafted-or-rostered seasons (players.json's
 * seasons_seen -- merged across kona_player_info/box scores/rosters at
 * normalize time, i.e. any appearance at all) who have never appeared in
 * keepers.json -- the loyalty-snub award. */
export function getMostPlayedNeverKept(
  players: Player[],
  keepers: Keeper[],
  seasonPoints: PlayerSeasonPoints[],
  n = 15
): NeverKeptEntry[] {
  const everKept = new Set(keepers.map(k => k.player_id));
  const careerPointsByPlayer = new Map<number, number>();
  for (const r of seasonPoints) {
    careerPointsByPlayer.set(r.player_id, (careerPointsByPlayer.get(r.player_id) ?? 0) + r.points);
  }
  return players
    .filter(p => !everKept.has(p.player_id))
    .map(p => ({
      playerId: p.player_id,
      playerName: p.full_name,
      seasonsSeen: p.seasons_seen.length,
      careerPoints: careerPointsByPlayer.get(p.player_id) ?? 0,
      rosterDays: p.roster_days ?? 0,
    }))
    .sort((a, b) => b.seasonsSeen - a.seasonsSeen)
    .slice(0, n);
}

export interface FranchiseKeeperPlayer {
  playerId: number;
  playerName: string;
  count: number;
  firstYear: number;
  lastYear: number;
  owners: OwnerRef[];
  /** One entry per keeper season (oldest first): which owner kept the player
   * that year -- backs the FranchiseGrid click-through detail card. */
  seasons: { year: number; owner: OwnerRef }[];
}

export interface FranchiseKeeperGroup {
  proTeamId: number;
  franchiseName: string;
  /** No abbreviation is shown on the card per the spec, but it still backs
   * search. */
  abbrev: string;
  isFreeAgent: boolean;
  totalKeeperSeasons: number;
  players: FranchiseKeeperPlayer[];
}

/** Every keeper, all time, grouped by the real MLB team the player was on in
 * that keeper season -- one group per mlb_teams.json entry (30 franchises +
 * the pro_team_id: 0 free-agent card), ranked together by total
 * keeper-seasons, confirmed metric per context/future-items.md's "Decisions
 * Deferred: Keepers-by-franchise ranking metric (Phase 5) -- RESOLVED". Empty
 * franchises (never had a keeper) are dropped rather than padding the grid to
 * exactly 31 cards. */
export function getKeepersByFranchise(keepers: Keeper[], mlbTeams: MlbTeam[], owners: Owner[]): FranchiseKeeperGroup[] {
  const teamById = new Map(mlbTeams.map(t => [t.pro_team_id, t]));
  const byTeam = new Map<number, Keeper[]>();
  for (const k of keepers) {
    const list = byTeam.get(k.pro_team_id) ?? [];
    list.push(k);
    byTeam.set(k.pro_team_id, list);
  }

  const groups: FranchiseKeeperGroup[] = [];
  for (const [proTeamId, records] of byTeam) {
    const team = teamById.get(proTeamId);
    const byPlayer = new Map<number, Keeper[]>();
    for (const k of records) {
      const list = byPlayer.get(k.player_id) ?? [];
      list.push(k);
      byPlayer.set(k.player_id, list);
    }
    const players: FranchiseKeeperPlayer[] = Array.from(byPlayer.values()).map(recs => {
      const sorted = [...recs].sort((a, b) => a.year - b.year);
      const ownerIds = Array.from(new Set(sorted.map(k => k.owner_id)));
      return {
        playerId: sorted[0].player_id,
        playerName: sorted[0].player_name,
        count: sorted.length,
        firstYear: sorted[0].year,
        lastYear: sorted[sorted.length - 1].year,
        owners: ownerIds.map(id => ownerRef(owners, id)),
        seasons: sorted.map(k => ({ year: k.year, owner: ownerRef(owners, k.owner_id) })),
      };
    });
    players.sort((a, b) => b.count - a.count || a.playerName.localeCompare(b.playerName));

    groups.push({
      proTeamId,
      franchiseName: team?.name ?? `Team ${proTeamId}`,
      abbrev: team?.abbrev ?? "",
      isFreeAgent: proTeamId === 0,
      totalKeeperSeasons: records.length,
      players,
    });
  }

  return groups.sort((a, b) => b.totalKeeperSeasons - a.totalKeeperSeasons);
}

export interface HeatIndexEntry {
  keeper: Keeper;
  /** Null when no season-points row exists at all for this keeper-season --
   * distinct from a real recorded 0.0. */
  points: number | null;
  priorYearPoints: number | null;
  /** This keeper season's percentile rank (0-100, higher = better) among that
   * year's whole field of scored players -- see stats.ts's
   * buildSeasonPercentiles. Null when the year has too thin a field to rank
   * within (see that function's doc comment). */
  currentPercentile: number | null;
  priorPercentile: number | null;
  /** currentPercentile minus priorPercentile, in percentile points -- the
   * year-over-year swing the spec's coloring is keyed on. This is the
   * resolved answer to the normalization question raw point deltas couldn't
   * solve: two seasons under different seasons.json scoring rules are still
   * comparable here, since each side is a rank within its own year's field,
   * not a raw point total. Null when either side has no percentile (no
   * prior-season total at all -- e.g. a suspended/injured year with 0 games,
   * or the player's first year in the data -- or a too-thin field either
   * year), rendered neutral rather than faking a 0 or a divide-by-zero
   * infinity, per the facts-not-conclusions rule. */
  percentileChange: number | null;
  positionLabel: string;
  /** This player's most recent *live* draft slot at or before the keeper
   * season -- shown as a reference label only, not a layout axis (draft
   * order among keeper rounds themselves carries no signal, see draft.ts).
   * Carries the drafting owner's id so the card can say who made the pick.
   * Null if the player has never appeared in a live draft in the covered
   * data (e.g. picked up as a free agent). */
  originalDraftSlot: { year: number; round: number; ownerId: string; overallPick: number } | null;
  /** Draft return on investment: the player's actual percentile that season
   * minus the expected percentile implied by their original draft position
   * (1st overall = 100th percentile, last pick = 0th). Positive means they
   * outperformed their draft slot; negative means they underperformed. Null
   * when the player was undrafted or there is no season-points field to rank
   * within. */
  draftRoi: number | null;
}

/** A player's most recent live (non-keeper) draft slot at or before
 * `throughYear` -- the "original draft slot" the heat index shows as an
 * info label. Walks backward from `throughYear` rather than always using
 * the player's very first live pick, since a player can leave the league
 * and get freshly live-drafted again later. */
function getOriginalDraftSlot(
  playerId: number,
  throughYear: number,
  boardsByYear: Map<number, RenumberedPick[]>
): { year: number; round: number; ownerId: string; overallPick: number } | null {
  const years = Array.from(boardsByYear.keys())
    .filter(y => y <= throughYear)
    .sort((a, b) => b - a);
  for (const year of years) {
    const pick = boardsByYear.get(year)?.find(p => p.player_id === playerId);
    if (pick) return { year, round: pick.live_round, ownerId: pick.owner_id, overallPick: pick.live_overall_pick };
  }
  return null;
}

/** Every keeper as one heat-index entry: this season's percentile rank vs.
 * the season before's, for either one year or every keeper-season ever (year
 * = null). Always sorted best-to-worst by percentileChange -- draft order
 * isn't offered as a layout option here (see Draft route's docs for why draft
 * order stopped carrying signal once keeper rounds were decoupled from it).
 * Entries with no percentile swing sort last, since they aren't comparable
 * either direction. `percentiles` is stats.ts's buildSeasonPercentiles output,
 * built once by the caller and shared across every scope/year selection. */
export function getKeeperHeatIndex(
  keepers: Keeper[],
  seasonPoints: PlayerSeasonPoints[],
  positionByPlayerId: Map<number, string>,
  boardsByYear: Map<number, RenumberedPick[]>,
  percentiles: Map<string, number>,
  year: number | null
): HeatIndexEntry[] {
  const scoped = year === null ? keepers : keepers.filter(k => k.year === year);

  const entries: HeatIndexEntry[] = scoped.map(keeper => {
    const points = getPlayerSeasonPoints(seasonPoints, keeper.year, keeper.player_id);
    const hasPriorSeason = seasonPoints.some(r => r.year === keeper.year - 1 && r.player_id === keeper.player_id);
    const priorYearPoints = hasPriorSeason
      ? getPlayerSeasonPoints(seasonPoints, keeper.year - 1, keeper.player_id)
      : null;
    const currentPercentile = getSeasonPercentile(percentiles, keeper.year, keeper.player_id);
    const priorPercentile =
      priorYearPoints === null ? null : getSeasonPercentile(percentiles, keeper.year - 1, keeper.player_id);
    const percentileChange =
      currentPercentile === null || priorPercentile === null ? null : currentPercentile - priorPercentile;
    const originalDraftSlot = getOriginalDraftSlot(keeper.player_id, keeper.year, boardsByYear);
    const board = boardsByYear.get(originalDraftSlot?.year ?? 0);
    const totalPicks = board?.length ?? 0;
    const draftPositionPercentile =
      originalDraftSlot === null ? null : draftSlotPercentile(totalPicks, originalDraftSlot.overallPick);
    const draftRoi =
      currentPercentile !== null && draftPositionPercentile !== null
        ? currentPercentile - draftPositionPercentile
        : null;
    return {
      keeper,
      points,
      priorYearPoints,
      currentPercentile,
      priorPercentile,
      percentileChange,
      positionLabel: positionByPlayerId.get(keeper.player_id) ?? "—",
      originalDraftSlot,
      draftRoi,
    };
  });

  return entries.sort((a, b) => {
    if (a.percentileChange === null && b.percentileChange === null) return 0;
    if (a.percentileChange === null) return 1;
    if (b.percentileChange === null) return -1;
    return b.percentileChange - a.percentileChange;
  });
}

/** Heat-index box color: blue for a breakout, red for a bust, scaled by how
 * far the percentile swing is from flat (a 50-point-or-larger swing, e.g.
 * bottom-half to elite, hits full strength) -- same color-mix formula and
 * CVD-safe blue/red diverging tokens as h2h.ts's cellBackground (green/red
 * failed CVD validation, see app/src/index.css). Null (no comparable prior
 * season) renders neutral. */
export function heatIndexBackground(percentileChange: number | null): { backgroundColor?: string } {
  if (percentileChange === null) return {};
  return divergingBackground(linearStrength(percentileChange, 0, 50, 60), 60);
}
