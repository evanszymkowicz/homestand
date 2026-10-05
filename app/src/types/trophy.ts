/**
 * ESPN "Fantasy Achievements" trophies — a 2026+ feature (launched 2026-02-04;
 * ESPN serves no earlier seasons, so gate any display on the season's
 * `coverage.achievements`). One TrophyRecord per league member per captured
 * season; `trophies` is ESPN's fixed 20-slot per-member template where an
 * unearned slot is simply not marked earned.
 *
 * The payload carries no trophy id or name — slots are positional, and the
 * slot→trophy mapping is pending the first observed earned slot
 * (context/features/espn-trophies-activity-tray-spec.md). member_key is a
 * salted hash; ESPN's raw member ids (SWIDs) never reach processed data.
 */
export interface TrophySlot {
  /** 0-based position in ESPN's per-member template. */
  slot: number;
  earned: boolean;
}

export interface TrophyRecord {
  year: number;
  member_key: string;
  /** null when the member resolved to no canonical owner (validate fails on
   * that upstream, so a shipped null is a data bug, not a UI state). */
  owner_id: string | null;
  espn_team_id: number | null;
  trophies: TrophySlot[];
}
