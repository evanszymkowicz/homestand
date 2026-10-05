import { aggregateSeasonRoster, getSeasonTeamEntries, sumLines, type SeasonPlayerLine } from "./boxScore";
import { cardPointsFor } from "./cardPoints";
import { formatPoints } from "./format";
import { getEligiblePositionIds } from "./positions";
import type {
  BattingLine,
  BoxScoreEntry,
  DraftPick,
  PitchingLine,
  Player,
  PlayerSeason,
  PlayerSeasonBackfill,
  PlayerTeamSeasonPoints,
  Team,
} from "../types";

/** One season's production for one player, on BOTH bases and never on a bare
 * `points`: `cardPoints` is ESPN's full-season card total (everything scored in
 * real life, free-agent days included) and is what every table DISPLAYS;
 * `rosteredPoints` is the share actually credited to a fantasy roster and is
 * what the tooltip and the lineup-split percentage are measured against.
 *
 * The naming is deliberate. A bare `points` means ROSTERED on the raw data types
 * (`PlayerSeasonPoints`, `PlayerTeamSeasonPoints`) and CARD on `AllTimeStatRow`,
 * so derived rows spell both out instead — the two used to disagree silently,
 * which is how a season row ended up paired with the wrong tooltip basis. */
export interface SeasonStatRow {
  playerId: number;
  playerName: string;
  //  Owner the player currently plays for (latest season). Null means a free agent in the current season.
  ownerId: string | null;
  espnTeamId: number | null;
  positionIds: number[];
  proTeamId: number | null;
  draftPosition: number | null;
  /** Rostered share — see the interface doc. */
  rosteredPoints: number;
  /** ESPN's full-season card total — what the table shows. */
  cardPoints: number;
  lineupSplit: { counted: number; bench: number } | null;
  batting: BattingLine | null;
  pitching: PitchingLine | null;
}

//  Puts `primaryId` first if it's a member of `ids`
function primaryFirst(ids: number[], primaryId: number): number[] {
  if (!ids.includes(primaryId)) return ids;
  return [primaryId, ...ids.filter(id => id !== primaryId)];
}

//  First season with real started-vs-bench tracking
export const LINEUP_SPLIT_FIRST_YEAR = 2018;

/** Hover text for a SeasonStatsTable Points cell: the cell shows ESPN's
 * full-season card total, and the note breaks it into the rostered share plus
 * the started-vs-bench split behind that share. Percentages only make sense
 * for positive rostered totals, so zero/net-negative rows state the raw split
 * instead of a confusing >100% or negative figure.
 *
 * Takes the field names straight off `SeasonStatRow`, so any row carrying
 * `cardPoints` + `rosteredPoints` (including the Player route's per-season
 * rows) can be passed through unchanged — no remapping, no chance of swapping
 * the two bases. */
export function pointsTooltip(
  row: Pick<SeasonStatRow, "cardPoints" | "rosteredPoints" | "lineupSplit">,
  year: number | undefined
): string {
  const lines: string[] = [];
  const totalDiffers = row.cardPoints !== row.rosteredPoints;
  if (totalDiffers && !(row.cardPoints === 0 && row.rosteredPoints === 0)) {
    lines.push(`${formatPoints(row.rosteredPoints)} rostered of ${formatPoints(row.cardPoints)} total`);
  }
  const split = row.lineupSplit;
  if (split !== null) {
    if (row.rosteredPoints > 0) {
      const pct = Math.round((split.counted / row.rosteredPoints) * 100);
      if (pct >= 0 && pct <= 100) {
        lines.push(`${pct}% of rostered in a starting lineup`);
      }
    }
    lines.push(`${formatPoints(split.counted)} counted · ${formatPoints(split.bench)} bench`);
    return lines.join("\n");
  }
  if (totalDiffers) {
    if (year === undefined || year < LINEUP_SPLIT_FIRST_YEAR) {
      lines.push(`Starting-lineup split only tracked from ${LINEUP_SPLIT_FIRST_YEAR} on.`);
    }
    return lines.join("\n");
  }
  if (row.cardPoints === 0) return "No points on file for this season.";
  return year !== undefined && year >= LINEUP_SPLIT_FIRST_YEAR
    ? "All scoring came while rostered; no starting-lineup split on file for this row."
    : `Starting-lineup split only tracked from ${LINEUP_SPLIT_FIRST_YEAR} on.`;
}

//  Logic to handle players who appear on more than one roster in a single season and has to pick the "current" team for the player. This is used in both buildSeasonStatRows and buildAllTimeStatRows.
function getCurrentTeamByPlayer(boxScores: BoxScoreEntry[]): Map<number, number> {
  const lastWeekByPlayerTeam = new Map<string, number>();
  for (const e of boxScores) {
    const key = `${e.player_id}:${e.espn_team_id}`;
    const lastWeek = lastWeekByPlayerTeam.get(key);
    if (lastWeek === undefined || e.week > lastWeek) lastWeekByPlayerTeam.set(key, e.week);
  }

  const bestByPlayer = new Map<number, { espnTeamId: number; week: number }>();
  for (const [key, week] of lastWeekByPlayerTeam) {
    const [playerIdStr, teamIdStr] = key.split(":");
    const playerId = Number(playerIdStr);
    const espnTeamId = Number(teamIdStr);
    const best = bestByPlayer.get(playerId);
    if (!best || week > best.week) bestByPlayer.set(playerId, { espnTeamId, week });
  }

  return new Map(Array.from(bestByPlayer, ([playerId, best]) => [playerId, best.espnTeamId]));
}

/** Per-(player, team) batting/pitching lines for one year, across every team
 * that year's box scores show -- reuses aggregateSeasonRoster/
 * getSeasonTeamEntries unmodified (Owner/SeasonRosterTable.tsx's per-team-season
 * math), just run once per team instead of once for a single owner's page. */
function getStatsByPlayerTeam(
  boxScores: BoxScoreEntry[]
): Map<string, { batting: BattingLine | null; pitching: PitchingLine | null }> {
  const stats = new Map<string, { batting: BattingLine | null; pitching: PitchingLine | null }>();
  const teamIds = new Set(boxScores.map(e => e.espn_team_id));
  for (const teamId of teamIds) {
    const rows = aggregateSeasonRoster(getSeasonTeamEntries(boxScores, teamId));
    for (const row of rows) {
      stats.set(`${row.playerId}:${teamId}`, { batting: row.batting, pitching: row.pitching });
    }
  }
  return stats;
}

//  Function to build the season stat rows for a given year, using the player team season points, player season backfill, draft picks, player seasons, box scores, teams, and card points by year and player.
export function buildSeasonStatRows(
  year: number,
  latestYear: number,
  playerTeamSeasonPoints: PlayerTeamSeasonPoints[],
  playerSeasonBackfill: PlayerSeasonBackfill[],
  draftPicks: DraftPick[],
  playerSeasons: PlayerSeason[],
  boxScores: BoxScoreEntry[],
  teams: Team[],
  cardPointsByYearPlayer: Map<string, number>
): SeasonStatRow[] {
  const stintsByPlayer = new Map<number, PlayerTeamSeasonPoints[]>();
  for (const row of playerTeamSeasonPoints) {
    if (row.year !== year) continue;
    const stints = stintsByPlayer.get(row.player_id);
    if (stints === undefined) stintsByPlayer.set(row.player_id, [row]);
    else stints.push(row);
  }

  const draftByPlayer = new Map(draftPicks.filter(p => p.year === year).map(p => [p.player_id, p]));

  const seasonPositionsByPlayer = new Map<number, number[]>();
  const seasonProTeamByPlayer = new Map<number, number>();
  const fantasyTeamByPlayer = new Map<number, number>();
  for (const ps of playerSeasons) {
    if (ps.year !== year) continue;
    const primary = ps.default_position_id;
    const eligible = getEligiblePositionIds(ps.eligible_slots, ps.default_position_id);
    seasonPositionsByPlayer.set(ps.player_id, primaryFirst(eligible, primary));
    if (ps.pro_team_id !== null) seasonProTeamByPlayer.set(ps.player_id, ps.pro_team_id);
    if (ps.fantasy_team_id != null) fantasyTeamByPlayer.set(ps.player_id, ps.fantasy_team_id);
  }

  const currentTeamByPlayer = getCurrentTeamByPlayer(boxScores);
  const statsByPlayerTeam = getStatsByPlayerTeam(boxScores);

  const teamById = new Map(teams.filter(t => t.year === year).map(t => [t.espn_team_id, t]));
  const currentSeasonFantasyTeamByPlayer = year === latestYear ? fantasyTeamByPlayer : new Map<number, number>();

  const buildRow = (playerId: number, stints: PlayerTeamSeasonPoints[] | null): SeasonStatRow => {
    const draftPick = draftByPlayer.get(playerId);
    const currentTeamId = currentTeamByPlayer.get(playerId);
    const currentStint = stints?.find(s => s.espn_team_id === currentTeamId) ?? stints?.[stints.length - 1];

    const currentFantasyTeamId = currentSeasonFantasyTeamByPlayer.get(playerId);
    const ownerId =
      currentFantasyTeamId !== undefined
        ? (teamById.get(currentFantasyTeamId)?.primary_owner_id ?? currentStint?.owner_id ?? null)
        : (currentStint?.owner_id ?? null);
    const espnTeamId = currentFantasyTeamId ?? currentStint?.espn_team_id ?? null;

    const battingLines = (stints ?? [])
      .map(s => statsByPlayerTeam.get(`${playerId}:${s.espn_team_id}`)?.batting)
      .filter((line): line is BattingLine => line != null);
    const pitchingLines = (stints ?? [])
      .map(s => statsByPlayerTeam.get(`${playerId}:${s.espn_team_id}`)?.pitching)
      .filter((line): line is PitchingLine => line != null);
    const rosteredPoints = stints?.reduce((sum, s) => sum + s.points, 0) ?? 0;
    // No stints (free-agent-only rows carry no box-score split) and pre-2018
    // seasons (bench untracked) both degrade to the "tracked from 2018 on" message.
    const hasSplit = stints != null && year >= LINEUP_SPLIT_FIRST_YEAR;

    return {
      playerId,
      playerName: currentStint?.player_name ?? "",
      ownerId,
      espnTeamId,
      positionIds: seasonPositionsByPlayer.get(playerId) ?? [],
      proTeamId: draftPick?.pro_team_id ?? seasonProTeamByPlayer.get(playerId) ?? null,
      draftPosition: draftPick?.overall_pick_number ?? null,
      rosteredPoints,
      cardPoints: cardPointsFor(cardPointsByYearPlayer, year, playerId, rosteredPoints),
      lineupSplit: hasSplit
        ? {
          counted: (stints ?? []).reduce((sum, s) => sum + s.counted_points, 0),
          bench: (stints ?? []).reduce((sum, s) => sum + s.bench_points, 0),
        }
        : null,
      batting: battingLines.length > 0 ? sumLines(battingLines) : null,
      pitching: pitchingLines.length > 0 ? sumLines(pitchingLines) : null,
    };
  };

  const rows: SeasonStatRow[] = Array.from(stintsByPlayer, ([playerId, stints]) => buildRow(playerId, stints));

  const boxScorePlayerIds = new Set(stintsByPlayer.keys());
  const addedPlayerIds = new Set<number>(boxScorePlayerIds);
  for (const backfill of playerSeasonBackfill) {
    if (backfill.year !== year) continue;
    if (addedPlayerIds.has(backfill.player_id)) continue;
    addedPlayerIds.add(backfill.player_id);
    const currentFantasyTeamId = currentSeasonFantasyTeamByPlayer.get(backfill.player_id);
    rows.push({
      playerId: backfill.player_id,
      playerName: backfill.player_name,
      ownerId:
        currentFantasyTeamId !== undefined ? (teamById.get(currentFantasyTeamId)?.primary_owner_id ?? null) : null,
      espnTeamId: currentFantasyTeamId ?? null,
      positionIds: seasonPositionsByPlayer.get(backfill.player_id) ?? [],
      proTeamId: seasonProTeamByPlayer.get(backfill.player_id) ?? null,
      draftPosition: draftByPlayer.get(backfill.player_id)?.overall_pick_number ?? null,
      // A backfilled season was never rostered here, so both bases carry the
      // card figure -- unchanged from before the rename, which keeps the
      // tooltip silent rather than claiming a 0.0 rostered share.
      rosteredPoints: backfill.points,
      cardPoints: backfill.points,
      lineupSplit: null,
      batting: backfill.batting,
      pitching: backfill.pitching,
    });
  }

  if (year === latestYear) {
    for (const ps of playerSeasons) {
      if (ps.year !== year) continue;
      if (addedPlayerIds.has(ps.player_id)) continue;
      const currentFantasyTeamId = currentSeasonFantasyTeamByPlayer.get(ps.player_id);
      rows.push({
        playerId: ps.player_id,
        playerName: ps.player_name,
        ownerId:
          currentFantasyTeamId !== undefined ? (teamById.get(currentFantasyTeamId)?.primary_owner_id ?? null) : null,
        espnTeamId: currentFantasyTeamId ?? null,
        positionIds: seasonPositionsByPlayer.get(ps.player_id) ?? [],
        proTeamId: seasonProTeamByPlayer.get(ps.player_id) ?? null,
        draftPosition: draftByPlayer.get(ps.player_id)?.overall_pick_number ?? null,
        rosteredPoints: 0,
        cardPoints: cardPointsFor(cardPointsByYearPlayer, year, ps.player_id, 0),
        lineupSplit: null,
        batting: null,
        pitching: null,
      });
    }
  }

  return rows;
}

/** One row per player who ever scored points for a roster, aggregated across
 * every archived season — the all-time counterpart to `SeasonStatRow`.
 * Batting/pitching lines cover only the seasons with full stat-line box-score
 * coverage (2019+, matching the CoverageBadge in the Seasons tab); older
 * seasons have points but no raw stat lines, so those stay null rather than a
 * fabricated zero. */
export interface AllTimeStatRow {
  playerId: number;
  playerName: string;
  ownerId: string | null;
  espnTeamId: number | null;
  /** Union of every position the player was fantasy-eligible for across all
   * their seasons, primary-first for the latest season's primary. */
  positionIds: number[];
  /** Latest season's real MLB team, falling back to the career-level team. */
  proTeamId: number | null;
  seasons: number;
  /** Career card total — same basis as `SeasonStatRow.cardPoints`. */
  cardPoints: number;
  /** Career rostered share — same basis as `SeasonStatRow.rosteredPoints`. */
  rosteredPoints: number;
  batting: BattingLine | null;
  pitching: PitchingLine | null;
}

/** Hover text for an all-time Points cell: the cell shows the career card
 * total, and the note breaks out how much of it came from actual roster time.
 * No note when the two are identical (all production was rostered). */
export function allTimePointsTooltip(row: Pick<AllTimeStatRow, "cardPoints" | "rosteredPoints">): string | null {
  if (row.cardPoints === row.rosteredPoints || (row.cardPoints === 0 && row.rosteredPoints === 0)) return null;
  return `${formatPoints(row.rosteredPoints)} rostered of ${formatPoints(row.cardPoints)} total`;
}

export function buildAllTimeStatRows(
  playerTeamSeasonPoints: PlayerTeamSeasonPoints[],
  playerSeasons: PlayerSeason[],
  players: Player[],
  cardPointsByYearPlayer: Map<string, number>,
  latestYear: number,
  teams: Team[],
  rostersByYear: Map<number, SeasonPlayerLine[]>,
  boxScoresByYear: Map<number, BoxScoreEntry[]> = new Map()
): AllTimeStatRow[] {
  const stintsByPlayer = new Map<number, PlayerTeamSeasonPoints[]>();
  for (const row of playerTeamSeasonPoints) {
    const stints = stintsByPlayer.get(row.player_id);
    if (stints === undefined) stintsByPlayer.set(row.player_id, [row]);
    else stints.push(row);
  }

  // Career eligible-position union, keeping the latest season's primary for
  // the primary-first ordering.
  const eligibilityByPlayer = new Map<number, { ids: Set<number>; latestDefault: number | null; latestYear: number }>();
  for (const ps of playerSeasons) {
    const entry = eligibilityByPlayer.get(ps.player_id) ?? {
      ids: new Set<number>(),
      latestDefault: null,
      latestYear: -Infinity,
    };
    for (const id of getEligiblePositionIds(ps.eligible_slots, ps.default_position_id)) entry.ids.add(id);
    if (ps.year >= entry.latestYear) {
      entry.latestYear = ps.year;
      entry.latestDefault = ps.default_position_id;
    }
    eligibilityByPlayer.set(ps.player_id, entry);
  }

  // Latest season's real MLB team: the explicit per-year row first (it is the
  // exact latest-season answer), the career-level player row as fallback.
  const proTeamByPlayer = new Map<number, number>();
  for (const ps of playerSeasons) {
    if (ps.year === latestYear && ps.pro_team_id !== null && !proTeamByPlayer.has(ps.player_id)) {
      proTeamByPlayer.set(ps.player_id, ps.pro_team_id);
    }
  }
  for (const p of players) {
    if (!proTeamByPlayer.has(p.player_id) && p.pro_team_id !== null) proTeamByPlayer.set(p.player_id, p.pro_team_id);
  }

  const teamById = new Map(teams.filter(t => t.year === latestYear).map(t => [t.espn_team_id, t]));
  const fantasyTeamByPlayer = new Map<number, number>();
  for (const ps of playerSeasons) {
    if (ps.year === latestYear && ps.fantasy_team_id != null && !fantasyTeamByPlayer.has(ps.player_id)) {
      fantasyTeamByPlayer.set(ps.player_id, ps.fantasy_team_id);
    }
  }

  const statsByPlayer = new Map<number, { batting: BattingLine[]; pitching: PitchingLine[] }>();
  for (const [, roster] of rostersByYear) {
    for (const line of roster) {
      const acc = statsByPlayer.get(line.playerId) ?? { batting: [], pitching: [] };
      if (line.batting) acc.batting.push(line.batting);
      if (line.pitching) acc.pitching.push(line.pitching);
      statsByPlayer.set(line.playerId, acc);
    }
  }

  // buildSeasonStatRows applies to a single season, precomputed once here so a mid-season move resolves to the team whose stint ended last.
  const finalTeamByYear = new Map<number, Map<number, number>>();
  for (const [year, entries] of boxScoresByYear) {
    finalTeamByYear.set(year, getCurrentTeamByPlayer(entries));
  }

  const rows: AllTimeStatRow[] = [];
  for (const [playerId, stints] of stintsByPlayer) {
    const latestStint = stints.reduce((a, b) => (b.year > a.year ? b : a), stints[0]);
    const yearsSeen = new Set<number>();
    let rosteredPoints = 0;
    for (const s of stints) {
      yearsSeen.add(s.year);
      rosteredPoints += s.points;
    }

    const rosteredByYear = new Map<number, number>();
    for (const s of stints) rosteredByYear.set(s.year, (rosteredByYear.get(s.year) ?? 0) + s.points);
    const cardTotal = Array.from(rosteredByYear, ([year, rostered]) =>
      cardPointsFor(cardPointsByYearPlayer, year, playerId, rostered)
    ).reduce((sum, v) => sum + v, 0);

    const currentFantasyTeamId = latestStint.year === latestYear ? fantasyTeamByPlayer.get(playerId) : undefined;
    const finalStintTeamId =
      currentFantasyTeamId !== undefined ? currentFantasyTeamId : finalTeamByYear.get(latestStint.year)?.get(playerId);
    const ownedStint = stints.find(s => s.espn_team_id === finalStintTeamId) ?? latestStint;
    const ownerId =
      currentFantasyTeamId !== undefined
        ? (teamById.get(currentFantasyTeamId)?.primary_owner_id ?? ownedStint.owner_id ?? null)
        : (ownedStint.owner_id ?? null);
    const espnTeamId = currentFantasyTeamId ?? ownedStint.espn_team_id ?? null;

    const eligibility = eligibilityByPlayer.get(playerId);
    const positionIds =
      eligibility && eligibility.ids.size > 0
        ? primaryFirst(
          Array.from(eligibility.ids).sort((a, b) => a - b),
          eligibility.latestDefault ?? -1
        )
        : [];
    const stats = statsByPlayer.get(playerId);
    rows.push({
      playerId,
      playerName: latestStint.player_name,
      ownerId,
      espnTeamId,
      positionIds,
      proTeamId: proTeamByPlayer.get(playerId) ?? null,
      seasons: yearsSeen.size,
      cardPoints: cardTotal,
      rosteredPoints,
      batting: stats && stats.batting.length > 0 ? sumLines(stats.batting) : null,
      pitching: stats && stats.pitching.length > 0 ? sumLines(stats.pitching) : null,
    });
  }

  return rows;
}
