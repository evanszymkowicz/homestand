import type { Team } from "../types";

export interface TeamSlotEra {
  ownerIds: string[];
  /** The era's most recent team name -- team names can change within an
   * era (a fresh year, same owner, new nickname), so this is flavor, not a
   * claim the name held constant the whole stretch. */
  latestTeamName: string;
  startYear: number;
  endYear: number;
}

export interface TeamSlotLineage {
  espnTeamId: number;
  eras: TeamSlotEra[];
}

function sameOwners(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, i) => id === sortedB[i]);
}

/** Team-slot (espn_team_id) continuity across ownership changes -- e.g. Team
 * 10 has passed through five different owners since 2009. Built entirely
 * from teams.json, which already carries owner_ids per team-year; this just
 * collapses consecutive same-owner(s) years into eras, the same run-collapsing
 * pattern getYearRuns uses elsewhere. Co-owned team-seasons (owner_ids.length
 * > 1) compare as a set, not array order. */
export function getTeamSlotLineages(teams: Team[]): TeamSlotLineage[] {
  const bySlot = new Map<number, Team[]>();
  for (const t of teams) {
    if (!bySlot.has(t.espn_team_id)) bySlot.set(t.espn_team_id, []);
    bySlot.get(t.espn_team_id)!.push(t);
  }

  const lineages: TeamSlotLineage[] = [];
  for (const [espnTeamId, teamYears] of bySlot) {
    const sorted = [...teamYears].sort((a, b) => a.year - b.year);
    const eras: TeamSlotEra[] = [];
    for (const t of sorted) {
      const last = eras[eras.length - 1];
      if (last && sameOwners(last.ownerIds, t.owner_ids) && t.year === last.endYear + 1) {
        last.endYear = t.year;
        last.latestTeamName = t.team_name;
      } else {
        eras.push({ ownerIds: [...t.owner_ids], latestTeamName: t.team_name, startYear: t.year, endYear: t.year });
      }
    }
    lineages.push({ espnTeamId, eras });
  }
  return lineages.sort((a, b) => a.espnTeamId - b.espnTeamId);
}
