import type { CSSProperties } from "react";
import type { Matchup, Owner, Team } from "../types";
import { formatRecord } from "./format";
import { ownerRef, winPct, type OwnerRef } from "./stats";

/**
 * Head-to-head aggregation over matchups.json + teams.json. Matchups only carry a
 * single primary_owner_id per side (Phase 2 schema decision), but the head-to-head
 * grid uses dual attribution to match stats.ts: a matchup credits every owner in
 * the team-season's owner_ids, not just the primary. Co-owned team-seasons (e.g.
 * Team 6, 2020+: two co-owners) never face themselves, so
 * identity pairs are skipped rather than counted as a game.
 */

export type MatchupScope = "regular" | "playoffs" | "combined";

export type MeetingResult = "W" | "L" | "T";

export interface Meeting {
  year: number;
  week: number;
  matchupId: number;
  playoffTier: string | null;
  aScore: number;
  bScore: number;
  result: MeetingResult; // from a's perspective
}

export interface PairRecord {
  wins: number;
  losses: number;
  ties: number;
}

export interface Streak {
  result: "W" | "L";
  length: number;
}

export interface PairSummary {
  overall: PairRecord;
  regular: PairRecord;
  playoffs: PairRecord;
  pointsForA: number;
  pointsForB: number;
  averageMargin: number; // a's average score minus b's, across all meetings
  streak: Streak | null; // null when there are no meetings
  meetings: Meeting[]; // chronological
}

function emptyRecord(): PairRecord {
  return { wins: 0, losses: 0, ties: 0 };
}

function bumpRecord(record: PairRecord, result: MeetingResult): void {
  if (result === "W") record.wins += 1;
  else if (result === "L") record.losses += 1;
  else record.ties += 1;
}

function inScope(matchup: Matchup, scope: MatchupScope): boolean {
  if (scope === "combined") return true;
  const isPlayoff = matchup.playoff_tier !== null;
  return scope === "playoffs" ? isPlayoff : !isPlayoff;
}

/** year:espn_team_id -> every owner credited on that team-season. */
export function buildTeamOwnersIndex(teams: Team[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const team of teams) {
    index.set(`${team.year}:${team.espn_team_id}`, team.owner_ids);
  }
  return index;
}

function ownersFor(index: Map<string, string[]>, year: number, espnTeamId: number | null): string[] {
  if (espnTeamId === null) return [];
  return index.get(`${year}:${espnTeamId}`) ?? [];
}

export function pairKey(a: string, b: string): string {
  return `${a}|${b}`;
}

function isSelfPair(a: string, b: string): boolean {
  return a === b; // co-owners never face themselves
}

/** MeetingResult for the given side, from a matchup's decided winner. */
function resultForSide(winner: Matchup["winner"], side: "HOME" | "AWAY"): MeetingResult {
  return winner === "TIE" ? "T" : winner === side ? "W" : "L";
}

function recordFor(records: Map<string, PairRecord>, key: string): PairRecord {
  let record = records.get(key);
  if (!record) {
    record = emptyRecord();
    records.set(key, record);
  }
  return record;
}

/** All-time pair records for every owner pair, keyed "rowOwnerId|colOwnerId" (both
 * directions stored, so a grid can look up either owner as the row). */
export function getPairRecords(
  matchups: Matchup[],
  teamOwnersIndex: Map<string, string[]>,
  scope: MatchupScope
): Map<string, PairRecord> {
  const records = new Map<string, PairRecord>();

  for (const matchup of matchups) {
    if (!matchup.away || matchup.winner === "UNDECIDED") continue;
    if (!inScope(matchup, scope)) continue;

    const homeOwners = ownersFor(teamOwnersIndex, matchup.year, matchup.home.espn_team_id);
    const awayOwners = ownersFor(teamOwnersIndex, matchup.year, matchup.away.espn_team_id);

    const homeResult = resultForSide(matchup.winner, "HOME");
    const awayResult = resultForSide(matchup.winner, "AWAY");

    for (const homeOwner of homeOwners) {
      for (const awayOwner of awayOwners) {
        if (isSelfPair(homeOwner, awayOwner)) continue;

        bumpRecord(recordFor(records, pairKey(homeOwner, awayOwner)), homeResult);
        bumpRecord(recordFor(records, pairKey(awayOwner, homeOwner)), awayResult);
      }
    }
  }

  return records;
}

export function getPairSummary(
  matchups: Matchup[],
  teamOwnersIndex: Map<string, string[]>,
  ownerA: string,
  ownerB: string
): PairSummary {
  const meetings: Meeting[] = [];
  if (isSelfPair(ownerA, ownerB)) {
    // Co-owners never face themselves; an identity pair has no meetings.
    return {
      overall: emptyRecord(),
      regular: emptyRecord(),
      playoffs: emptyRecord(),
      pointsForA: 0,
      pointsForB: 0,
      averageMargin: 0,
      streak: null,
      meetings,
    };
  }

  for (const matchup of matchups) {
    if (!matchup.away || matchup.winner === "UNDECIDED") continue;

    const homeOwners = ownersFor(teamOwnersIndex, matchup.year, matchup.home.espn_team_id);
    const awayOwners = ownersFor(teamOwnersIndex, matchup.year, matchup.away.espn_team_id);

    const aIsHome = homeOwners.includes(ownerA) && awayOwners.includes(ownerB);
    const aIsAway = awayOwners.includes(ownerA) && homeOwners.includes(ownerB);
    if (!aIsHome && !aIsAway) continue;

    const aSide = aIsHome ? matchup.home : matchup.away;
    const bSide = aIsHome ? matchup.away : matchup.home;
    const result = resultForSide(matchup.winner, aIsHome ? "HOME" : "AWAY");

    meetings.push({
      year: matchup.year,
      week: matchup.week,
      matchupId: matchup.matchup_id,
      playoffTier: matchup.playoff_tier,
      aScore: aSide.score,
      bScore: bSide.score,
      result,
    });
  }

  meetings.sort((m1, m2) => m1.year - m2.year || m1.week - m2.week);

  const overall = emptyRecord();
  const regular = emptyRecord();
  const playoffs = emptyRecord();
  let pointsForA = 0;
  let pointsForB = 0;

  for (const meeting of meetings) {
    bumpRecord(overall, meeting.result);
    bumpRecord(meeting.playoffTier === null ? regular : playoffs, meeting.result);
    pointsForA += meeting.aScore;
    pointsForB += meeting.bScore;
  }

  let streak: Streak | null = null;
  for (let i = meetings.length - 1; i >= 0; i--) {
    const result = meetings[i].result;
    if (result === "T") break; // a tie breaks any streak
    if (streak === null) {
      streak = { result, length: 1 };
    } else if (streak.result === result) {
      streak.length += 1;
    } else {
      break;
    }
  }

  return {
    overall,
    regular,
    playoffs,
    pointsForA,
    pointsForB,
    averageMargin: meetings.length === 0 ? 0 : (pointsForA - pointsForB) / meetings.length,
    streak,
    meetings,
  };
}

export function pairOwnerRefs(owners: Owner[], ownerA: string, ownerB: string): [OwnerRef, OwnerRef] {
  return [ownerRef(owners, ownerA), ownerRef(owners, ownerB)];
}

/** Diverging background tint by win% — a secondary signal only, capped at a
 * 45% color-mix so a cell's W-L text (the primary signal) always stays
 * readable in plain ink. See index.css for why blue/red, not brand green/red
 * (green vs red fails the dataviz skill's CVD-safety validator). Shared by
 * the head-to-head grid and any single-owner "vs everyone" list that wants
 * the same tint. */
export function cellBackground(record: PairRecord | undefined, games: number): CSSProperties {
  if (!record || games === 0) return {};
  const pct = winPct(record);
  const strength = Math.round(Math.min(Math.abs(pct - 0.5) * 2, 1) * 45);
  if (strength === 0) return {};
  const pole = pct >= 0.5 ? "var(--color-diverge-pos)" : "var(--color-diverge-neg)";
  return { backgroundColor: `color-mix(in oklab, ${pole} ${strength}%, var(--color-surface))` };
}

export function cellLabel(record: PairRecord | undefined): string {
  return record ? formatRecord(record.wins, record.losses, record.ties) : "0-0";
}
