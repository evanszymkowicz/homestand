/** One ESPN member identity belonging to an owner. `member_key` is a salted
 * hash, never the raw ESPN member id (SWID session cookie). */
export interface EspnMemberKey {
  member_key: string;
  years: number[];
}

export interface Owner {
  owner_id: string;
  canonical_name: string;
  team_names_by_year: Record<string, string[]>;
  espn_member_keys: EspnMemberKey[];
  co_owners: string[];
  /** Last season this owner fields a team in the archive. */
  last_active_year: number;
  /**
   * Whether `last_active_year` predates the newest season on file. This is a
   * statement about archive coverage, NOT retirement -- an owner who leaves
   * after the newest archived season still reads as present. Use
   * `loadRetiredOwnerIds()` for who has actually left.
   */
  absent_from_latest_season: boolean;
  is_commissioner?: boolean;
}
